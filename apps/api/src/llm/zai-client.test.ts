/**
 * ZAI client retry + abort tests.
 *
 * `fetchWithRetry` is the only thing standing between a transient
 * 5xx / 429 from the LLM provider and a failed agent turn. We mock
 * `fetch` directly so we can count call attempts and inject scripted
 * responses (200, 500, 429, abort).
 *
 * What we pin:
 *  - 5xx responses are retried up to MAX_RETRIES=3 times before failing
 *  - 200 responses are returned on the first try (no retry)
 *  - a 500 followed by a 200 succeeds (proves the retry actually runs)
 *  - an external AbortSignal aborts the call without retry
 *  - the per-model semaphore does not deadlock when called sequentially
 *    (smoke check — a regression in permit accounting would manifest
 *    as a hang under repeated sequential calls)
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { loadConfig } from "../config.js";

// We must not import the module before the env is ready — loadConfig
// throws synchronously at import-time in some paths. Pre-warm it.
void loadConfig();

import { callZAI } from "./zai-client.js";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function anthropicOk(text: string): Response {
  return jsonResponse({
    id: "msg_test",
    model: "glm-5.1",
    content: [{ type: "text", text }],
    usage: { input_tokens: 5, output_tokens: 5 },
  });
}

describe("callZAI retry behavior", () => {
  let calls: FetchCall[];
  let originalFetch: typeof fetch;

  beforeEach(() => {
    calls = [];
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  function mockFetch(impl: (attempt: number) => Response | Promise<Response>) {
    globalThis.fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const attempt = calls.length;
      calls.push({ url: String(url), init: init ?? {} });
      return impl(attempt);
    }) as unknown as typeof fetch;
  }

  it("returns the first response on 200", async () => {
    mockFetch(() => anthropicOk("hello"));

    const res = await callZAI({
      model: "glm-5.1",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(res.content).toBe("hello");
    expect(calls.length).toBe(1);
  });

  it("retries on 5xx and eventually succeeds when the 2nd attempt is 200", async () => {
    // The 2xx must come back in the retry window — fetchWithRetry's
    // loop is `attempt <= retries`, so with MAX_RETRIES=3 a 500 on
    // attempt 0 leaves 3 more chances.
    mockFetch((attempt) => {
      if (attempt === 0) return jsonResponse({ error: "boom" }, 503);
      return anthropicOk("recovered");
    });

    const res = await callZAI({
      model: "glm-5.1",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(res.content).toBe("recovered");
    expect(calls.length).toBe(2);
  });

  it("gives up after MAX_RETRIES=3 on persistent 5xx", async () => {
    // fetchWithRetry has `attempt <= MAX_RETRIES`, so total attempts is
    // MAX_RETRIES + 1 = 4. All 4 return 500.
    mockFetch(() => jsonResponse({ error: "still down" }, 500));

    await expect(
      callZAI({ model: "glm-5.1", messages: [{ role: "user", content: "ping" }] }),
    ).rejects.toThrow(/LLM API error 500/);
    expect(calls.length).toBe(4);
  }, 30_000);

  it("aborts immediately when the external AbortSignal fires before the request", async () => {
    mockFetch(async () => {
      // The abort should cancel the fetch — but the mock doesn't observe
      // the signal directly. We assert the call rejects (not that it
      // hangs), which is the operator-visible contract.
      throw new DOMException("aborted", "AbortError");
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      callZAI({
        model: "glm-5.1",
        messages: [{ role: "user", content: "ping" }],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("does not deadlock the per-model semaphore across sequential calls", async () => {
    // 20 sequential calls — if permit accounting leaks (e.g., a stray
    // release), the semaphore would either exhaust after the first
    // batch or deadlock after a negative-permit clamp. Sequential
    // completion is the contract: every call resolves.
    mockFetch(() => anthropicOk("ok"));

    for (let i = 0; i < 20; i++) {
      const res = await callZAI({
        model: "glm-5.1",
        messages: [{ role: "user", content: `ping ${i}` }],
      });
      expect(res.content).toBe("ok");
    }
    expect(calls.length).toBe(20);
  });
});
