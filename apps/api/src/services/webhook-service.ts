/**
 * Fire webhook notifications from settings.webhookUrl.
 *
 * SSRF protection: validates the URL before issuing a fetch so a malicious
 * settings value can't probe internal services (cloud metadata endpoints,
 * localhost-bound admin UIs, link-local addresses).
 */

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
    const [a, b] = [parseInt(ipv4[1], 10), parseInt(ipv4[2], 10)];
    if (a === 0 || a === 127) return true;                    // 0.0.0.0/8, 127.0.0.0/8
    if (a === 10) return true;                                 // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                   // 192.168.0.0/16
    if (a === 169 && b === 254) return true;                   // 169.254.0.0/16 (link-local, includes cloud metadata)
    if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64.0.0/10 (CGNAT, RFC 6598)
    if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18.0.0/15 (benchmark, RFC 2544)
  }
  // IPv6 loopback / link-local
  if (lower === "::1" || lower === "[::1]") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("[fe80:")) return true;
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

export async function fireWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
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
    logger.warn(
      { event, webhookUrl, event_type: "webhook_rejected" },
      "Webhook URL rejected by SSRF guard (must be http(s) and not point at private/loopback addresses)",
    );
    return;
  }

  try {
    await fetch(parsed.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
  } catch (err) {
    logger.warn(
      { event, error: err instanceof Error ? err.message : String(err), event_type: "webhook_failed" },
      "Webhook delivery failed",
    );
  }
}
