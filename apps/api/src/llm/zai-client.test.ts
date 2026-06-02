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
import { callLLMWithTools } from "./zai-client.js";

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

/**
 * Tool-loop cap regression tests.
 *
 * `callLLMWithTools` enforces two caps from config:
 *  - MAX_TOOL_CALLS: stops the loop once totalTools >= maxTools, sends
 *    a "you have reached the maximum" user message, and returns the
 *    final response with tool_calls=undefined.
 *  - TOOL_CHECKPOINT_INTERVAL: emits a checkpoint log + optional
 *    summary every N iterations.
 *
 * A regression that removes the cap lets a runaway agent burn credits
 * (Phase 1 fix from the audit). A regression that drops the
 * checkpoint leaves long sessions without an in-memory breadcrumb to
 * recover from on a crash.
 */

function anthropicToolUse(toolName: string, args: Record<string, unknown>): Response {
  return jsonResponse({
    id: "msg_test",
    model: "glm-5.1",
    content: [
      { type: "text", text: "calling tool" },
      {
        type: "tool_use",
        id: `toolu_${Math.random().toString(36).slice(2, 10)}`,
        name: toolName,
        input: args,
      },
    ],
    usage: { input_tokens: 5, output_tokens: 5 },
  });
}

describe("callLLMWithTools caps", () => {
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

  it("stops at MAX_TOOL_CALLS and returns the final response with no tool_calls", async () => {
    // Config defaults: MAX_TOOL_CALLS=100. The mock returns a tool-use
    // response on every call with VARYING input so the loop-detection
    // guard (which trips on 4+ consecutive identical tool+args) doesn't
    // short-circuit before the cap. We use a Write tool (not an
    // exploration tool) with a unique path per iteration.
    let counter = 0;
    // The loop-detection guard trips on MAX_CONSECUTIVE_SAME_TOOL_CALLS=4
    // same-tool calls (for non-exploration tools) within the last
    // `recentToolCalls` window. To reach MAX_TOOL_CALLS=100 we cycle
    // through enough distinct tool names that no single tool name
    // hits the threshold. The cap test is about the *count* of tool
    // calls, not what they do — varying names lets the loop hit its
    // MAX_TOOL_CALLS budget cleanly.
    const TOOL_NAMES = [
      "Write", "Edit", "Bash", "GenerateAsset", "StartConsultation",
      "ProposePlan", "AskUserQuestion", "Read", "Glob", "Grep",
    ] as const;
    mockFetch((attempt) => {
      counter++;
      if (attempt < 100) {
        const toolName = TOOL_NAMES[attempt % TOOL_NAMES.length];
        return anthropicToolUse(toolName, { file_path: `/tmp/cap-test-${attempt}`, content: "x" });
      }
      return anthropicOk("done");
    });

    const res = await callLLMWithTools(
      {
        model: "glm-5.1",
        messages: [{ role: "user", content: "ping" }],
      },
      // Tool executor: returns immediately with a stub. The cap test
      // is about the *count* of tool calls, not what they do.
      async () => "ok",
    );

    expect(res.content).toBe("done");
    expect(res.tool_calls).toBeUndefined();
    // 100 tool iterations + 1 final cap-exit call.
    expect(counter).toBe(101);
  }, 30_000);
});
