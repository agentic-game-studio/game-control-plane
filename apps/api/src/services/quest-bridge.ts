/**
 * Quest Bridge Service
 * Connects the Task tool (agent spawning) to the Quest/Ticket board.
 * When a workflow is active, every Task call automatically creates and tracks a ticket.
 */

import { broadcastEvent } from "./data-store.js";
import { readData } from "./data-store.js";
import { DEFAULT_TICKETS_BOARD, readTicketsBoard, resolveProjectIdForSession, writeTicketsBoard, updateTicketsBoard } from "./ticket-board.js";
import { logger } from "../utils/logger.js";
import type { TicketsBoard, Ticket, TicketStatus, AgentRole, WSEvent, WorkflowStage, DashboardData } from "@game-studio/types";
import { ingestProducerSummaryFact, ingestProducerSummaryFromSession } from "./producer-summary.js";
import { triggerVerification } from "./verification-service.js";

// ─── Workflow State (in-memory, per session) ───

interface WorkflowState {
  workflowId: string;
  stage: WorkflowStage;
  tickets: Map<string, string>; // ticketId -> agentRole
  createdAt: number; // epoch ms for TTL cleanup
}

const activeWorkflows = new Map<string, WorkflowState>();
const WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Periodic cleanup of stale workflows. Handle is exported so the graceful
// shutdown path in index.ts can clearInterval it; without that, the interval
// keeps running on a torn-down module graph until the process exits.
export const workflowCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, wf] of activeWorkflows) {
    if (now - wf.createdAt > WORKFLOW_TTL_MS) {
      activeWorkflows.delete(sessionId);
    }
  }
}, 60 * 60 * 1000);
workflowCleanupInterval.unref(); // don't keep process alive on its own

export function startWorkflow(sessionId: string): string {
  // Guard against concurrent startWorkflow calls for the same session: the
  // previous version of this function would silently overwrite an in-flight
  // workflow, losing the ticket map. The Map is a regular Map (not concurrent),
  // so the check + set must happen in the same synchronous frame — which it
  // does here because Node is single-threaded.
  const existing = activeWorkflows.get(sessionId);
  if (existing) {
    logger.warn(
      { sessionId, existingWorkflowId: existing.workflowId, event: "workflow_already_active" },
      "Refusing to start a new workflow — one is already in flight for this session",
    );
    return existing.workflowId;
  }

  const workflowId = `wf-${Date.now()}`;
  activeWorkflows.set(sessionId, {
    workflowId,
    stage: "plan",
    tickets: new Map(),
    createdAt: Date.now(),
  });

  broadcastEvent({
    type: "workflow:stage",
    sessionId,
    workflowId,
    stage: "plan",
  } as WSEvent);

  return workflowId;
}

export function getWorkflow(sessionId: string): WorkflowState | undefined {
  return activeWorkflows.get(sessionId);
}

export function advanceStage(sessionId: string, stage: WorkflowStage, ticketId?: string, agentRole?: string): void {
  const wf = activeWorkflows.get(sessionId);
  if (!wf) return;
  wf.stage = stage;

  broadcastEvent({
    type: "workflow:stage",
    sessionId,
    workflowId: wf.workflowId,
    stage,
    ticketId,
    agentRole,
  } as WSEvent);

  void ingestProducerSummaryFromSession(sessionId, {
    kind: "workflow_stage",
    at: new Date().toISOString(),
    detail: stage,
    ticketId,
    agentRole,
    sessionId,
  }).catch((err) => logger.warn({ sessionId, err: String(err), event: "producer_summary_workflow_stage_failed" },
    "ingestProducerSummary rejected in workflow_stage"));

  if (stage === "verify") {
    void triggerWorkflowVerification(sessionId, wf).catch((err) => logger.warn({ sessionId, err: String(err), event: "workflow_verify_failed" },
      "triggerWorkflowVerification rejected"));
  }
}

async function triggerWorkflowVerification(sessionId: string, wf: WorkflowState): Promise<void> {
  const projectId = await resolveProjectIdForSession(sessionId);
  if (!projectId) return;

  try {
    const board = await readTicketsBoard(projectId);
    for (const ticketId of wf.tickets.keys()) {
      for (const col of board.columns) {
        const ticket = col.tickets.find((t) => t.id === ticketId);
        if (ticket && ticket.status === "qa") {
          triggerVerification(
            { ...ticket, sessionId },
            ticket.description || ticket.title,
          );
        }
      }
    }
  } catch (err) {
    logger.warn(
      { sessionId, error: err instanceof Error ? err.message : String(err), event: "workflow_verify_failed" },
      "Workflow verify stage failed",
    );
  }
}

export function completeWorkflow(sessionId: string, success: boolean): void {
  const wf = activeWorkflows.get(sessionId);
  if (!wf) return;

  broadcastEvent({
    type: "workflow:complete",
    sessionId,
    workflowId: wf.workflowId,
    success,
  } as WSEvent);

  activeWorkflows.delete(sessionId);

  void ingestProducerSummaryFromSession(sessionId, {
    kind: "workflow_complete",
    at: new Date().toISOString(),
    detail: String(success),
    sessionId,
  }).catch((err) => logger.warn({ sessionId, err: String(err), event: "producer_summary_workflow_complete_failed" },
    "ingestProducerSummary rejected in workflow_complete"));
}

export function cleanupWorkflow(sessionId: string): void {
  activeWorkflows.delete(sessionId);
}

// ─── Ticket CRUD (direct file access, same as REST routes) ───

async function getBoard(projectId?: string | null): Promise<TicketsBoard> {
  try {
    return await readTicketsBoard(projectId);
  } catch {
    await writeTicketsBoard(DEFAULT_TICKETS_BOARD, projectId);
    return structuredClone(DEFAULT_TICKETS_BOARD);
  }
}

function findTicketInBoard(board: TicketsBoard, ticketId: string): { col: number; idx: number; ticket: Ticket } | null {
  for (let c = 0; c < board.columns.length; c++) {
    for (let i = 0; i < board.columns[c].tickets.length; i++) {
      if (board.columns[c].tickets[i].id === ticketId) {
        return { col: c, idx: i, ticket: board.columns[c].tickets[i] };
      }
    }
  }
  return null;
}

// ─── Quest Bridge API ───

export async function createQuestTicket(
  sessionId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
  area: string,
  subarea: string,
  projectId?: string | null,
): Promise<Ticket> {
  const resolvedProjectId = projectId ?? await resolveProjectIdForSession(sessionId);
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    projectId: resolvedProjectId ?? undefined,
    title,
    description,
    area,
    subarea,
    credits: 100,
    status: "available",
    assignee: agentRole,
    acknowledged: false,
    createdAt: now,
    updatedAt: now,
    sessionId,
    workflowStage: getWorkflow(sessionId)?.stage,
  };

  // Use mutex-protected write to prevent lost updates under concurrent calls
  const board = resolvedProjectId
    ? await updateTicketsBoard(resolvedProjectId, (b) => {
        const availableCol = b.columns.find((c) => c.id === "available");
        if (availableCol) {
          availableCol.tickets.push(ticket);
        }
        return b;
      })
    : (() => { throw new Error("projectId required for ticket creation"); })();

  broadcastEvent({ type: "ticket:created", ticket, projectId: resolvedProjectId } as WSEvent);

  broadcastEvent({
    type: "quest:linked",
    sessionId,
    ticketId: ticket.id,
    agentRole: agentRole as string,
  } as WSEvent);

  // Track in workflow
  const wf = getWorkflow(sessionId);
  if (wf) {
    wf.tickets.set(ticket.id, agentRole as string);
  }

  if (resolvedProjectId) {
    void ingestProducerSummaryFact(resolvedProjectId, {
      kind: "ticket_created",
      at: now,
      title,
      ticketId: ticket.id,
      agentRole: agentRole as string,
      sessionId,
    }).catch((err) => logger.warn({ projectId: resolvedProjectId, err: String(err), event: "producer_summary_ticket_created_failed" },
      "ingestProducerSummaryFact rejected in ticket_created"));
  }

  return ticket;
}

export async function moveQuestTicket(
  ticketId: string,
  status: TicketStatus,
  assignee?: string,
  // C8: callers that already know the projectId can pass it in to skip the
  // N-project resolver (which still reads every board file). Verification
  // service has the ticket object; chat/teams route can look it up once.
  knownProjectId?: string | null,
): Promise<void> {
  const projectId = knownProjectId ?? await resolveProjectIdForTicket(ticketId);

  // Capture the source column id *before* the mutation runs so the broadcast
  // event can carry the actual fromColumn. Without this snapshot, the
  // updater mutates the board and the later `findTicketInBoard` lookup
  // returns the *destination* column, producing a self-loop
  // (fromColumn === toColumn) for every move.
  let fromColumnId: string | null = null;

  // Serialize the board mutation to prevent lost updates
  const moved = projectId
    ? await updateTicketsBoard(projectId, (board) => {
        const found = findTicketInBoard(board, ticketId);
        if (!found) {
          logger.warn({ ticketId, status, event: "ticket_move_not_found" }, `Ticket ${ticketId} not found on board — skipping move to ${status}`);
          return board;
        }
        const { col, idx, ticket } = found;
        fromColumnId = board.columns[col].id;
        ticket.status = status;
        ticket.updatedAt = new Date().toISOString();
        if (assignee !== undefined) ticket.assignee = assignee;
        const targetCol = board.columns.find((c) => c.id === status);
        if (targetCol && targetCol.id !== board.columns[col].id) {
          board.columns[col].tickets.splice(idx, 1);
          targetCol.tickets.push(ticket);
        }
        return board;
      })
    : null;

  if (!projectId || !moved) return;
  // Broadcast after the lock is released
  const found = findTicketInBoard(moved, ticketId);
  if (!found) return;
  const { ticket } = found;

  broadcastEvent({
    type: "ticket:moved",
    ticket,
    fromColumn: fromColumnId ?? ticket.status,
    toColumn: status,
    projectId,
  } as WSEvent);

  void ingestProducerSummaryFact(projectId, {
    kind: "ticket_moved",
    at: ticket.updatedAt,
    ticketId,
    title: ticket.title,
    fromColumn: fromColumnId ?? ticket.status,
    toColumn: status,
    agentRole: ticket.assignee,
  }).catch((err) => logger.warn({ projectId, err: String(err), event: "producer_summary_ticket_moved_failed" },
    "ingestProducerSummaryFact rejected in ticket_moved"));

  if (status === "qa") {
    triggerVerification(ticket, ticket.description || ticket.title);
  }
}

export async function createFixTicket(
  sessionId: string,
  parentTicketId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
): Promise<Ticket> {
  const ticket = await createQuestTicket(sessionId, title, agentRole, description, "WORKFLOW", "fix");
  // Persist parentTicketId — updateTicketsBoard ensures atomic write
  const projectId = ticket.projectId ?? null;
  if (projectId) {
    await updateTicketsBoard(projectId, (board) => {
      const found = findTicketInBoard(board, ticket.id);
      if (found) found.ticket.parentTicketId = parentTicketId;
      return board;
    });
  }
  ticket.parentTicketId = parentTicketId;
  return ticket;
}

async function resolveProjectIdForTicket(ticketId: string): Promise<string | null> {
  const legacyBoard = await getBoard(null);
  const legacyFound = findTicketInBoard(legacyBoard, ticketId);
  if (legacyFound) return legacyFound.ticket.projectId ?? null;

  try {
    const dashboard = await readData<DashboardData>("dashboard.json");
    if (!dashboard.projects.length) return null;
    // C8: scan all per-project boards in parallel instead of one-at-a-time
    // (was N+1 sequential disk reads — quadratic as the project list grows).
    const boards = await Promise.all(
      dashboard.projects.map((p) => getBoard(p.id).then((board) => ({ projectId: p.id, board })))
    );
    for (const { projectId, board } of boards) {
      if (findTicketInBoard(board, ticketId)) return projectId;
    }
  } catch {
    // Ignore scan failures and fall back to null.
  }

  return null;
}
