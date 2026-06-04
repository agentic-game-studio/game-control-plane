/**
 * Fire webhook notifications from settings.webhookUrl.
 *
 * SSRF protection: validates the URL before issuing a fetch so a malicious
 * settings value can't probe internal services (cloud metadata endpoints,
 * localhost-bound admin UIs, link-local addresses).
 *
 * Two-stage check:
 *  1. `validateWebhookUrl` — sync. Rejects bad schemes and IP literals
 *     that obviously point at private/loopback space.
 *  2. `resolveAndValidateWebhookTarget` — async. Resolves the hostname via
 *     DNS and re-checks every returned address. Defends against the
 *     `evil.com → 127.0.0.1` DNS-rebinding flavor of SSRF: a registered
 *     domain that resolves to a private IP would pass stage 1 (the hostname
 *     literal is fine) but fail stage 2.
 */

import { lookup } from "node:dns/promises";
import { readData } from "./data-store.js";
import type { SettingsConfig } from "@game-studio/types";
import { logger } from "../utils/logger.js";

const WEBHOOK_TIMEOUT_MS = 10_000;

/** Reject obviously non-routable / loopback / link-local targets. The list
 * covers the IPs commonly abused for SSRF (cloud metadata, internal admin
 * panels, localhost services bound to 127.0.0.0/8, IPv6 loopback). */
function isBlockedAddress(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) {
    return true;
  }
  // Numeric IPv4 check — covers 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12,
  // 192.168.0.0/16, 169.254.0.0/16, 0.0.0.0/8, 100.64.0.0/10, 198.18.0.0/15.
  // CGNAT (RFC 6598) and benchmarking (RFC 2544) ranges are reserved and
  // should never be legitimate webhook targets. We use a coarse prefix match
  // rather than `node:net.isIP` + bitwise checks because the goal is to
  // block whole /8 boundaries, not to be a full IP validator.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(lower);
  if (ipv4) {
    const octets = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10), parseInt(ipv4[3], 10), parseInt(ipv4[4], 10)];
    // 17-M1: reject malformed IPv4 literals (octets >255). The regex
    // above only checks the digit count, so `999.999.999.999`
    // matched and slipped past every prefix check below — the DNS
    // lookup eventually failed and the function returned false, but
    // failing here gives a cleaner error path and protects future
    // maintainers who skip the DNS stage.
    if (octets.some((o) => o < 0 || o > 255)) return true;
    const [a, b] = octets;
    if (a === 0 || a === 127) return true;                    // 0.0.0.0/8, 127.0.0.0/8
    if (a === 10) return true;                                 // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
    if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 (link-local, includes cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64.0.0/10 (CGNAT, RFC 6598)
    if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18.0.0/15 (benchmark, RFC 2544)
  }
  // 29-H-webhook-ipv6-ula: previous shape blocked only ::1 and
  // fe80::/10. The IPv6 unique-local-address range fc00::/7
  // (RFC 4193, used for site-local private networks) was
  // unblocked, and so was the IPv4-mapped-IPv6 form ::ffff:0:0/96
  // (RFC 4291, lets a host stack treat an IPv4 address as
  // ::ffff:127.0.0.1). Both bypasses are commonly abused: a
  // URL like `http://[fc00::1]/admin` or `http://[::ffff:127.0.0.1]/`
  // would pass the old guard and reach the fetch.
  //
  // Note on brackets: the URL parser strips the surrounding [] from
  // `parsed.hostname` for IPv6, so we get the raw `fc00::1` form.
  // Strip any leading/trailing brackets defensively in case the
  // caller passed a literal rather than a parsed URL.
  const bare = lower.replace(/^\[|\]$/g, "");
  // IPv6 loopback
  if (bare === "::1") return true;
  // IPv6 link-local (fe80::/10)
  if (bare.startsWith("fe80:") || bare.startsWith("fe8") ||
      bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) return true;
  // 29-H-webhook-ipv6-ula: IPv6 unique-local (fc00::/7). The /7
  // means the first 7 bits match, so the first byte is 0xfc or 0xfd.
  if (bare.startsWith("fc") || bare.startsWith("fd")) return true;
  // 29-H-webhook-ipv4-mapped-ipv6: ::ffff:0:0/96 — the IPv4-mapped
  // block. Anything starting with `::ffff:` is suspect; we'll let
  // the IPv4 octet-prefix checks above catch the well-known
  // private/loopback ranges once we extract them, but a fully
  // empty IPv4 tail (e.g. `::ffff:0:0`) needs an explicit block.
  if (bare.startsWith("::ffff:")) {
    // `::ffff:127.0.0.1` style — strip the prefix and re-validate
    // the IPv4 tail with the same prefix rules.
    const v4Tail = bare.slice(7);
    return isBlockedAddress(v4Tail);
  }
  // Multicast ff00::/8 — never a legitimate webhook target.
  if (bare.startsWith("ff")) return true;
  return false;
}

/** Validate a webhook URL string. Returns the parsed URL if acceptable,
 * null otherwise. Acceptable = http/https scheme + public DNS or unblocked
 * IP. Rejects anything that resolves to a private/loopback/link-local
 * address or that fails to parse. */
export function validateWebhookUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (isBlockedAddress(parsed.hostname)) return null;
  return parsed;
}

/**
 * Resolve the URL's hostname via DNS and re-check the resolved IPs against
 * the blocklist. Returns true if every resolved address is safe to fetch.
 *
 * Why this is separate from `validateWebhookUrl`: tests pin the sync
 * accept/reject matrix without a real DNS resolver, and the URL-literal
 * check still catches the common abuses (raw IPs, localhost). DNS
 * resolution catches the harder case: an attacker who controls a registered
 * domain and points it at `169.254.169.254` (or `127.0.0.1`, or any RFC1918
 * range).
 *
 * Tradeoff: a malicious DNS server can rebind between this lookup and the
 * actual fetch (DNS rebinding). True hardening requires pinning the
 * resolved IP and dialing it directly with a Host header. For a webhook
 * sender that fires a single short-lived request, the rebind window is
 * narrow and this check raises the bar substantially.
 */
export async function resolveAndValidateWebhookTarget(parsed: URL): Promise<boolean> {
  try {
    const results = await lookup(parsed.hostname, { all: true });
    for (const { address } of results) {
      if (isBlockedAddress(address)) return false;
    }
    return true;
  } catch {
    // DNS failure — refuse to send. An NXDOMAIN or SERVFAIL means we
    // can't verify the target, and an attacker who controls the DNS path
    // could exploit the difference between our resolver and Node's
    // fetch resolver. Fail closed.
    return false;
  }
}

export async function fireWebhook(eventName: string, payload: Record<string, unknown>): Promise<void> {
  let webhookUrl: string | undefined;
  try {
    const settings = await readData<SettingsConfig>("settings.json");
    webhookUrl = settings.webhookUrl?.trim();
  } catch {
    return;
  }

  if (!webhookUrl) return;

  const parsed = validateWebhookUrl(webhookUrl);
  if (!parsed) {
    // 23-M-webhook-event-convention: rename the function parameter
    // from `event` to `eventName` so the standard `event:` log
    // discriminator (used by every other service — credit-service,
    // producer-summary, etc.) doesn't shadow it. The previous
    // `event_type:` key was the workaround, but a `rg "event:"` over
    // the logs returned nothing for the webhook subsystem, hiding
    // failures from alert pipelines that key on the convention.
    logger.warn(
      { event: "webhook_rejected", eventName, webhookUrl },
      "Webhook URL rejected by SSRF guard (must be http(s) and not point at private/loopback addresses)",
    );
    return;
  }

  // Stage 2: resolve hostname and ensure no returned IP is in a blocked
  // range. Catches the `evil.com → 127.0.0.1` flavor that stage 1 misses.
  const dnsSafe = await resolveAndValidateWebhookTarget(parsed);
  if (!dnsSafe) {
    logger.warn(
      { event: "webhook_rejected_dns", eventName, webhookUrl, hostname: parsed.hostname },
      "Webhook URL rejected by SSRF guard (hostname resolves to private/loopback IP)",
    );
    return;
  }

  try {
    await fetch(parsed.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventName, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn(
      { event: "webhook_failed", eventName, error: err instanceof Error ? err.message : String(err) },
      "Webhook delivery failed",
    );
  }
}
