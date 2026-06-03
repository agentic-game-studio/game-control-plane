import { describe, expect, it } from "vitest";
import type { ProducerSummaryFact } from "@game-studio/types";
import {
  MAX_RECENT_FACTS,
  buildProducerUpdateMarkdown,
  clearProjectProducerSummary,
  emptyProducerSummarySnapshot,
  hashProducerUpdateContent,
  pushProducerSummaryFact,
  safeIngestProducerSummaryFact,
} from "./producer-summary.js";

describe("producer-summary reducer", () => {
  it("caps recentFacts at MAX_RECENT_FACTS", () => {
    let snap = emptyProducerSummarySnapshot();
    for (let i = 0; i < MAX_RECENT_FACTS + 5; i++) {
      snap = pushProducerSummaryFact(snap, {
        kind: "ticket_created",
        at: new Date().toISOString(),
        ticketId: `t-${i}`,
        title: `Task ${i}`,
      });
    }
    expect(snap.recentFacts.length).toBe(MAX_RECENT_FACTS);
    expect(snap.recentFacts[0]?.ticketId).toBe(`t-${5}`);
  });

  it("buildProducerUpdateMarkdown buckets ticket moves", () => {
    const facts: ProducerSummaryFact[] = [
      {
        kind: "ticket_moved",
        at: "2026-01-01T00:00:00.000Z",
        ticketId: "ticket-a",
        fromColumn: "available",
        toColumn: "processing",
      },
      {
        kind: "ticket_moved",
        at: "2026-01-01T00:01:00.000Z",
        ticketId: "ticket-a",
        fromColumn: "processing",
        toColumn: "completed",
      },
    ];
    let snap = emptyProducerSummarySnapshot();
    for (const f of facts) {
      snap = pushProducerSummaryFact(snap, f);
    }
    const md = buildProducerUpdateMarkdown(snap);
    expect(md).toContain("## Producer update");
    expect(md).toContain("**Completed**");
    expect(md).toContain("processing → completed");
    expect(md).toContain("**In flight**");
    expect(md).toContain("available → processing");
  });

  it("hashProducerUpdateContent is stable for identical markdown", () => {
    const md = "## Producer update\n\n**Completed**\n- Done\n";
    expect(hashProducerUpdateContent(md)).toBe(hashProducerUpdateContent(md));
  });

  it("workflow_complete failure lands in Notes", () => {
    let snap = emptyProducerSummarySnapshot();
    snap = pushProducerSummaryFact(snap, {
      kind: "workflow_complete",
      at: "2026-01-01T00:00:00.000Z",
      detail: "false",
    });
    const md = buildProducerUpdateMarkdown(snap);
    expect(md).toContain("**Notes**");
    expect(md).toMatch(/ended \(failed\)|failed/i);
  });
});

/**
 * 11-H18: pending-emit timer cleanup on project delete.
 *
 * The `pendingEmitTimers` Map is keyed by projectId. If a project is
 * deleted while an emit is debounced, the timer would otherwise fire
 * and call `flushEmitProducerUpdate(projectId)` against a torn-down
 * state — which would import chat.js and broadcast to a dead project.
 *
 * `clearProjectProducerSummary(projectId)` cancels the pending timer.
 * The function exists and is wired into the project-delete path in
 * `routes/dashboard.ts`; this test pins the contract that it returns
 * safely even when called with an unknown projectId (idempotent) and
 * that calling it twice doesn't throw.
 */
describe("clearProjectProducerSummary", () => {
  it("is idempotent and safe with an unknown projectId", () => {
    expect(() => clearProjectProducerSummary("never-existed-1")).not.toThrow();
    expect(() => clearProjectProducerSummary("never-existed-1")).not.toThrow();
  });

  it("does not throw on empty-string or malformed projectId", () => {
    expect(() => clearProjectProducerSummary("")).not.toThrow();
    expect(() => clearProjectProducerSummary("/etc/passwd")).not.toThrow();
    expect(() => clearProjectProducerSummary("../../../etc")).not.toThrow();
  });
});

/**
 * 16-M: safeIngestProducerSummaryFact swallows rejections so a transient
 * persistChatStore() failure (EIO / ENOSPC / EROFS) doesn't escalate to
 * unhandledRejection → fatalExit. Pin the no-throw contract: the helper
 * is fire-and-forget, so callers expect it to never throw synchronously
 * and to swallow the rejected promise from ingestProducerSummaryFact.
 *
 * We don't have the chat.js module graph in a unit test, but an empty
 * projectId short-circuits inside ingestProducerSummaryFact without
 * touching any I/O, so we can confirm the wrapper itself doesn't
 * throw synchronously.
 */
describe("safeIngestProducerSummaryFact", () => {
  it("does not throw synchronously with an empty projectId", () => {
    expect(() =>
      safeIngestProducerSummaryFact("", {
        kind: "ticket_created",
        at: new Date().toISOString(),
        ticketId: "t-1",
      }),
    ).not.toThrow();
  });

  it("does not throw synchronously with an unknown projectId", () => {
    expect(() =>
      safeIngestProducerSummaryFact("never-existed-2", {
        kind: "ticket_moved",
        at: new Date().toISOString(),
        ticketId: "t-2",
      }),
    ).not.toThrow();
  });
});
