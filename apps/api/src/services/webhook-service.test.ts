/**
 * Webhook URL validation (SSRF guard) tests.
 *
 * `validateWebhookUrl` is the only thing standing between a
 * settings.webhookUrl that points at `http://169.254.169.254/...`
 * (cloud metadata) and a token exfil. These tests pin down the
 * exact accept/reject matrix so any future relaxation is loud.
 */
import { describe, expect, it } from "vitest";
import { validateWebhookUrl } from "./webhook-service.js";

describe("validateWebhookUrl", () => {
  describe("rejects", () => {
    it.each([
      ["empty string", ""],
      ["plain hostname", "example.com"],
      ["file scheme", "file:///etc/passwd"],
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/plain,hello"],
      ["gopher scheme", "gopher://example.com/"],
      ["localhost", "http://localhost/x"],
      ["localhost subdomain", "http://api.localhost/x"],
      ["127.0.0.1", "http://127.0.0.1:8080/x"],
      ["10.x private", "http://10.0.0.1/x"],
      ["172.16 private", "http://172.16.0.1/x"],
      ["172.31 private", "http://172.31.255.255/x"],
      ["192.168 private", "http://192.168.1.1/x"],
      ["AWS metadata", "http://169.254.169.254/latest/meta-data/"],
      ["0.0.0.0", "http://0.0.0.0/x"],
      ["IPv6 loopback", "http://[::1]/x"],
      ["IPv6 link-local", "http://[fe80::1]/x"],
    ])("rejects %s (%s)", (_label, input) => {
      expect(validateWebhookUrl(input)).toBeNull();
    });
  });

  describe("accepts", () => {
    it.each([
      ["public https", "https://hooks.example.com/event"],
      ["public http", "http://example.com/hook"],
      ["public with port", "https://api.example.com:8443/hook"],
      ["public with query", "https://hooks.slack.com/services/T0/B0/XXXX?token=1"],
      ["8.8.8.8 public DNS", "https://8.8.8.8/hook"],
    ])("accepts %s (%s)", (_label, input) => {
      const out = validateWebhookUrl(input);
      expect(out).not.toBeNull();
      expect(out?.toString()).toBe(input);
    });
  });

  it("rejects strings that fail URL parsing", () => {
    expect(validateWebhookUrl("not a url")).toBeNull();
    expect(validateWebhookUrl("://no-scheme")).toBeNull();
  });
});
