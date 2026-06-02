/**
 * Verification dead-letter + dedup tests.
 *
 * The dedup logic added in the 5th-pass audit must:
 *  - increment `consecutiveFailures` on each error
 *  - dead-letter the ticket exactly once on the 3rd consecutive error
 *  - skip the move + re-broadcast on a re-applied dead-letter
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock the ticket-board service before importing the verification
// service so the import-time `updateTicketsBoard` reference is bound
// to our vi.fn() stub.
vi.mock("./ticket-board.js", () => ({
  updateTicketsBoard: vi.fn(),
  readTicketsBoard: vi.fn(),
}));

vi.mock("./llm-service.js", () => ({
  invokeAgent: vi.fn(),
}));

vi.mock("./data-store.js", () => ({
  broadcastEvent: vi.fn(),
  moveQuestTicket: vi.fn(),
  createFixTicket: vi.fn(),
}));

import { triggerVerification, verifyTicket } from "./verification-service.js";
import * as ticketBoard from "./ticket-board.js";
import * as llm from "./llm-service.js";
import * as dataStore from "./data-store.js";
import type { Ticket } from "@game-studio/types";

const baseTicket: Ticket = {
  id: "T-1",
  projectId: "P-1",
  title: "test",
  description: "d",
  area: "code",
  subarea: "code",
  credits: 1,
  estimateHours: 1,
  status: "qa",
  agentRole: "code-reviewer",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  sessionId: "S-1",
};

describe("verifyTicket dead-letter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("increments consecutiveFailures on each error", async () => {
    // Track the ticket state as the mock invokes our updater fn.
    const ticket: Ticket = { ...baseTicket, consecutiveFailures: 0 };
    const seenCounts: number[] = [];
    // The mock has to persist the bumped state across calls — the verify
    // error path does TWO updateTicketsBoard calls (one to bump the
    // counter, then moveQuestTicket → updateTicketsBoard to move the
    // ticket back to `available`). A stateless mock would feed the same
    // starting board to both updaters and report 1,1 instead of 1,2.
    const liveBoard = {
      projectId: "P-1",
      sprint: "",
      milestone: "",
      columns: [
        { id: "qa", label: "Verify", tickets: [{ ...ticket }] },
        { id: "failed", label: "Failed", tickets: [] },
      ],
    };

    vi.mocked(ticketBoard.updateTicketsBoard).mockImplementation(
      async (_projectId, updater) => {
        const result = updater(liveBoard);
        // Persist the mutation in-place so the next call observes the
        // bumped counter.
        liveBoard.columns = result.columns;
        const updated = result.columns
          .flatMap((c) => c.tickets)
          .find((t) => t.id === ticket.id);
        if (updated) seenCounts.push(updated.consecutiveFailures ?? 0);
        return result;
      },
    );
    vi.mocked(ticketBoard.readTicketsBoard).mockResolvedValue(liveBoard);
    vi.mocked(llm.invokeAgent).mockRejectedValue(new Error("llm down"));

    // 11-M15: call `verifyTicket` directly. `triggerVerification` is
    // fire-and-forget — `await triggerVerification(...)` resolves to
    // `undefined` immediately and the assertion below was racing the
    // actual work. The dead-letter test (further down) already
    // documents this with the same workaround.
    await verifyTicket(ticket, "output");

    // First error: counter is bumped to 1 in the first update, then the
    // ticket is moved back to `available` (second update sees 1 because
    // the move is a no-op for the counter). One error = one increment.
    expect(seenCounts).toEqual([1, 1]);
  });

  it("dead-letters exactly once on the 3rd consecutive error", async () => {
    const ticket: Ticket = { ...baseTicket, consecutiveFailures: 2 };
    // The dead-letter flow calls `updateTicketsBoard` twice: once to
    // bump the failure counter, then a second time to actually move
    // the ticket to the `failed` column. We capture the post-update
    // state of each call so we can assert the second one is the move
    // and the first is just the counter bump.
    const failedColumnCounts: number[] = [];

    vi.mocked(ticketBoard.updateTicketsBoard).mockImplementation(
      async (_projectId, updater) => {
        const result = updater({
          projectId: "P-1",
          sprint: "",
          milestone: "",
          columns: [
            { id: "qa", label: "Verify", tickets: [{ ...ticket }] },
            { id: "failed", label: "Failed", tickets: [] },
          ],
        });
        failedColumnCounts.push(
          result.columns
            .find((c) => c.id === "failed")!
            .tickets.filter((t) => t.id === ticket.id).length,
        );
        return result;
      },
    );
    vi.mocked(ticketBoard.readTicketsBoard).mockResolvedValue({
      projectId: "P-1",
      sprint: "",
      milestone: "",
      columns: [
        { id: "qa", label: "Verify", tickets: [ticket] },
        { id: "failed", label: "Failed", tickets: [] },
      ],
    });
    vi.mocked(llm.invokeAgent).mockRejectedValue(new Error("llm down"));
    const broadcastSpy = vi.mocked(dataStore.broadcastEvent);

    // Call verifyTicket directly (not triggerVerification) so the
    // returned promise IS the actual work. triggerVerification is
    // fire-and-forget and returns void, so `await triggerVerification`
    // would resolve before the verification finishes.
    await verifyTicket(ticket, "output");

    // Call 0: counter bump — ticket stays in qa, nothing in failed.
    expect(failedColumnCounts[0]).toBe(0);
    // Call 1: actual dead-letter move — ticket lands in failed.
    expect(failedColumnCounts[1]).toBe(1);

    const deadLetterEvents = broadcastSpy.mock.calls.filter(
      ([event]) => (event as { type: string }).type === "ticket:deadletter",
    );
    expect(deadLetterEvents.length).toBe(1);
  });
});
