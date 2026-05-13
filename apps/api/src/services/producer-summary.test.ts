import { describe, expect, it } from "vitest";
import type { ProducerSummaryFact } from "@game-studio/types";
import {
  MAX_RECENT_FACTS,
  buildProducerUpdateMarkdown,
  emptyProducerSummarySnapshot,
  hashProducerUpdateContent,
  pushProducerSummaryFact,
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
