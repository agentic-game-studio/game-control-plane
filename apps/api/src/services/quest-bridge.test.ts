/**
 * Quest bridge workflow-locks test.
 *
 * `startWorkflow` is the per-session state machine that tracks tickets
 * spawned by the Task tool. A regression that allows a second
 * `startWorkflow` for the same session to overwrite the in-flight
 * workflow would lose the ticket map (and the OMC 5-stage pipeline
 * would silently drop mid-flight tickets). We pin:
 *  - first `startWorkflow(sessionId)` returns a fresh `wf-*` id
 *  - second `startWorkflow(sessionId)` for the SAME session returns
 *    the FIRST id (no overwrite, no throw — the contract is "refuse
 *    silently with the existing id, log a warning")
 *  - `cleanupWorkflow(sessionId)` lets a new workflow start fresh
 *  - two different sessionIds get two different workflows
 */
import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock the data-store and ticket-board modules BEFORE importing the
// SUT, so the module-level `broadcastEvent` / `readTicketsBoard` /
// `updateTicketsBoard` references in quest-bridge are bound to our
// vi.fn() stubs.
vi.mock("./data-store.js", () => ({
  broadcastEvent: vi.fn(),
  readData: vi.fn(),
}));

vi.mock("./ticket-board.js", () => ({
  readTicketsBoard: vi.fn(),
  writeTicketsBoard: vi.fn(),
  updateTicketsBoard: vi.fn(),
  resolveProjectIdForSession: vi.fn().mockResolvedValue(null),
  DEFAULT_TICKETS_BOARD: {
    projectId: "",
    sprint: "",
    milestone: "",
    columns: [],
  },
}));

vi.mock("./producer-summary.js", () => ({
  ingestProducerSummaryFact: vi.fn().mockResolvedValue(undefined),
  ingestProducerSummaryFromSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./verification-service.js", () => ({
  triggerVerification: vi.fn(),
}));

import {
  startWorkflow,
  cleanupWorkflow,
  getWorkflow,
  advanceStage,
  completeWorkflow,
} from "./quest-bridge.js";
import { loadConfig } from "../config.js";

describe("quest-bridge workflow locks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void loadConfig();
  });

  it("returns a fresh workflowId on the first startWorkflow call", () => {
    const sessionId = `s-${Date.now()}-a`;
    const workflowId = startWorkflow(sessionId);

    expect(workflowId).toMatch(/^wf-\d+$/);
    const wf = getWorkflow(sessionId);
    expect(wf?.workflowId).toBe(workflowId);
    expect(wf?.stage).toBe("plan");
  });

  it("returns the EXISTING workflowId on a second concurrent startWorkflow for the same session", () => {
    // This is the regression we're guarding against. The previous
    // implementation did `activeWorkflows.set(sessionId, ...)` with
    // no check, overwriting the in-flight workflow and losing its
    // ticket map. The contract is: refuse the new workflow, return
    // the existing one.
    const sessionId = `s-${Date.now()}-b`;
    const first = startWorkflow(sessionId);
    const second = startWorkflow(sessionId);
    const third = startWorkflow(sessionId);

    expect(second).toBe(first);
    expect(third).toBe(first);

    // And the workflow object is unchanged: stage still 'plan', ticket
    // map still empty.
    const wf = getWorkflow(sessionId);
    expect(wf?.stage).toBe("plan");
    expect(wf?.tickets.size).toBe(0);
  });

  it("gives independent workflows to independent sessionIds", async () => {
    // Two startWorkflow calls in the same tick produce identical
    // `wf-${Date.now()}` ids (the workflowId format is millisecond-
    // resolution). Wait at least 1ms between the two calls to make
    // the assertion deterministic on fast hardware.
    const sA = `s-${Date.now()}-cA`;
    const sB = `s-${Date.now()}-cB`;
    const idA = startWorkflow(sA);
    await new Promise((r) => setTimeout(r, 2));
    const idB = startWorkflow(sB);

    expect(idA).not.toBe(idB);
    expect(getWorkflow(sA)?.workflowId).toBe(idA);
    expect(getWorkflow(sB)?.workflowId).toBe(idB);
  });

  it("lets a new workflow start after cleanupWorkflow", async () => {
    const sessionId = `s-${Date.now()}-d`;
    const first = startWorkflow(sessionId);

    cleanupWorkflow(sessionId);
    expect(getWorkflow(sessionId)).toBeUndefined();

    // startWorkflow keys its id on `Date.now()`. The two calls run in
    // the same tick on fast hardware, so we wait at least 1ms before
    // the second call to ensure a distinct id.
    await new Promise((r) => setTimeout(r, 2));
    const second = startWorkflow(sessionId);
    expect(second).not.toBe(first);
  });

  it("advanceStage updates the stage and is a no-op on unknown sessions", () => {
    const sessionId = `s-${Date.now()}-e`;
    startWorkflow(sessionId);

    advanceStage(sessionId, "decompose");
    expect(getWorkflow(sessionId)?.stage).toBe("decompose");

    // Unknown session — must not throw, must not pollute state.
    expect(() => advanceStage("nonexistent-session", "verify")).not.toThrow();
    expect(getWorkflow("nonexistent-session")).toBeUndefined();
  });

  it("completeWorkflow removes the workflow so a new one can start", async () => {
    const sessionId = `s-${Date.now()}-f`;
    const id = startWorkflow(sessionId);
    expect(getWorkflow(sessionId)?.workflowId).toBe(id);

    completeWorkflow(sessionId, true);
    expect(getWorkflow(sessionId)).toBeUndefined();

    // Wait at least 1ms so the new workflow's Date.now() id differs.
    await new Promise((r) => setTimeout(r, 2));
    const second = startWorkflow(sessionId);
    expect(second).not.toBe(id);
  });
});
