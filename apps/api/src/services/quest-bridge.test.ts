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

vi.mock("./ticket-board.js", async () => {
  // Mutable per-project board state so moveQuestTicket can move tickets
  // between columns and createFixTicket can persist parentTicketId —
  // both depend on the board-mutation callback running with a real
  // (in-memory) board so findTicketInBoard can find the ticket.
  const boards = new Map<string, {
    projectId: string;
    sprint: string;
    milestone: string;
    columns: Array<{ id: string; label: string; tickets: Array<{ id: string; title: string; status: string; parentTicketId?: string; updatedAt: string; assignee?: string; description?: string }> }>;
  }>();

  const makeBoard = (projectId: string) => {
    const board = {
      projectId,
      sprint: "Sprint_01",
      milestone: "Alpha_Milestone",
      columns: [
        { id: "available", label: "Available", tickets: [] },
        { id: "in_progress", label: "Processing", tickets: [] },
        { id: "qa", label: "Verify", tickets: [] },
        { id: "completed", label: "Archived", tickets: [] },
      ],
    };
    boards.set(projectId, board);
    return board;
  };

  return {
    readTicketsBoard: vi.fn(async (projectId: string) => boards.get(projectId) ?? makeBoard(projectId)),
    // 11-C4: real signature is `writeTicketsBoard(board, projectId?)`.
    // The previous mock had the args reversed; tests passed only
    // because the mock signature matched the call site, masking a
    // latent bug. A refactor that drops this mock would surface
    // the bug immediately at the first call site (writes the
    // string "proj" as a board, then everything after breaks).
    writeTicketsBoard: vi.fn(async (board: unknown, projectId?: string | null) => {
      const key = projectId ?? "default";
      boards.set(key, board as ReturnType<typeof makeBoard>);
    }),
    updateTicketsBoard: vi.fn(async (projectId: string, updater: (board: ReturnType<typeof makeBoard>) => ReturnType<typeof makeBoard>) => {
      const current = boards.get(projectId) ?? makeBoard(projectId);
      const next = updater(current);
      boards.set(projectId, next);
      return next;
    }),
    resolveProjectIdForSession: vi.fn(async (sessionId: string) => {
      // Session ids starting with "sess-proj-" belong to that project.
      const m = /^sess-proj-([\w-]+)$/.exec(sessionId);
      return m ? m[1] : null;
    }),
    DEFAULT_TICKETS_BOARD: {
      projectId: "",
      sprint: "",
      milestone: "",
      columns: [],
    },
  };
});

vi.mock("./producer-summary.js", () => ({
  ingestProducerSummaryFact: vi.fn().mockResolvedValue(undefined),
  ingestProducerSummaryFromSession: vi.fn().mockResolvedValue(undefined),
  // 16-M: safeIngestProducerSummaryFact wraps ingestProducerSummaryFact
  // with a swallow-and-log .catch. The test only verifies the
  // happy-path board mutation, so the wrapper is a no-op pass-through
  // here.
  safeIngestProducerSummaryFact: vi.fn(),
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
  createFixTicket,
  moveQuestTicket,
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

    // 10-L2: workflowId is now `wf-<ms>-<6 hex>` for collision
    // resistance across concurrent startWorkflow calls. Update the
    // regex to match the new format.
    expect(workflowId).toMatch(/^wf-\d+-[0-9a-f]{6}$/);
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

/**
 * `createFixTicket` regression — parent/child ticket relationship.
 *
 * The fix-ticket flow creates a child ticket, then writes
 * parentTicketId back to the board so the UI can group them. A
 * regression that drops the second updateTicketsBoard call would leave
 * orphans: the child exists, but the board has no record of the
 * parent. We assert that the returned ticket has parentTicketId set
 * AND that the persisted board entry matches.
 */
describe("createFixTicket parent/child persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void loadConfig();
  });

  it("persists parentTicketId on the child ticket", async () => {
    const sessionId = "sess-proj-fix-1";
    const parentId = "ticket-parent-123";
    const child = await createFixTicket(
      sessionId,
      parentId,
      "Fix: door collider not loading",
      "gameplay-programmer",
      "Door collider fails to load on first frame",
    );

    expect(child.parentTicketId).toBe(parentId);
    expect(child.title).toBe("Fix: door collider not loading");
    expect(child.status).toBe("available");
  });
});

/**
 * `moveQuestTicket` fromColumnId capture regression.
 *
 * The broadcast event for `ticket:moved` carries `fromColumn` so the
 * frontend can render a slide animation. A regression that captured
 * the column id AFTER the updater ran would broadcast
 * fromColumn === toColumn for every move, producing a self-loop and
 * killing the animation. We assert the broadcast event shape so any
 * future regression is loud.
 */
describe("moveQuestTicket fromColumnId capture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    void loadConfig();
  });

  it("broadcasts a fromColumn distinct from toColumn", async () => {
    // Seed the board with a ticket in 'available'.
    const { readTicketsBoard, writeTicketsBoard } = await import("./ticket-board.js");
    const seeded = await readTicketsBoard("move-test");
    seeded.columns[0].tickets.push({
      id: "ticket-move-1",
      title: "Test ticket",
      status: "available",
      updatedAt: new Date().toISOString(),
    });
    await writeTicketsBoard(seeded, "move-test");

    await moveQuestTicket("ticket-move-1", "in_progress", "gameplay-programmer", "move-test");

    const { broadcastEvent } = await import("./data-store.js");
    const calls = (broadcastEvent as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const movedCall = calls.find((c) => {
      const arg = c[0] as { type?: string };
      return arg?.type === "ticket:moved";
    });
    expect(movedCall).toBeDefined();
    const event = movedCall![0] as { fromColumn: string; toColumn: string; projectId: string };
    expect(event.fromColumn).toBe("available");
    expect(event.toColumn).toBe("in_progress");
  });
});
