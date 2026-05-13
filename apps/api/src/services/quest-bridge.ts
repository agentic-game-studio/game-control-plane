/**
 * Quest Bridge Service
 * Connects the Task tool (agent spawning) to the Quest/Ticket board.
 * When a workflow is active, every Task call automatically creates and tracks a ticket.
 */

import { broadcastEvent } from "./data-store.js";
import { readData } from "./data-store.js";
import { DEFAULT_TICKETS_BOARD, readTicketsBoard, resolveProjectIdForSession, writeTicketsBoard } from "./ticket-board.js";
import type { TicketsBoard, Ticket, TicketStatus, AgentRole, WSEvent, WorkflowStage, DashboardData } from "@game-studio/types";
import { ingestProducerSummaryFact, ingestProducerSummaryFromSession } from "./producer-summary.js";

// ─── Workflow State (in-memory, per session) ───

interface WorkflowState {
  workflowId: string;
  stage: WorkflowStage;
  tickets: Map<string, string>; // ticketId -> agentRole
}

const activeWorkflows = new Map<string, WorkflowState>();

export function startWorkflow(sessionId: string): string {
  const workflowId = `wf-${Date.now()}`;
  activeWorkflows.set(sessionId, {
    workflowId,
    stage: "plan",
    tickets: new Map(),
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
  });
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
  });
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
  const board = await getBoard(resolvedProjectId);
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

  // Add to "available" column
  const availableCol = board.columns.find((c) => c.id === "available");
  if (availableCol) {
    availableCol.tickets.push(ticket);
  }

  await writeTicketsBoard(board, resolvedProjectId);

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
    });
  }

  return ticket;
}

export async function moveQuestTicket(ticketId: string, status: TicketStatus, assignee?: string): Promise<void> {
  const projectId = await resolveProjectIdForTicket(ticketId);
  const board = await getBoard(projectId);
  const found = findTicketInBoard(board, ticketId);
  if (!found) return;

  const { col, idx, ticket } = found;

  // Update ticket fields
  ticket.status = status;
  ticket.updatedAt = new Date().toISOString();
  if (assignee !== undefined) ticket.assignee = assignee;

  // If status changed columns, move it
  const targetCol = board.columns.find((c) => c.id === status);
  if (targetCol && targetCol.id !== board.columns[col].id) {
    // Remove from source column
    board.columns[col].tickets.splice(idx, 1);
    // Add to target column
    targetCol.tickets.push(ticket);

    await writeTicketsBoard(board, projectId);

    broadcastEvent({
      type: "ticket:moved",
      ticket,
      fromColumn: board.columns[col].id,
      toColumn: status,
      projectId,
    } as WSEvent);

    if (projectId) {
      void ingestProducerSummaryFact(projectId, {
        kind: "ticket_moved",
        at: ticket.updatedAt,
        ticketId,
        title: ticket.title,
        fromColumn: board.columns[col].id,
        toColumn: status,
        agentRole: ticket.assignee,
      });
    }
  } else {
    // Same column, just update
    await writeTicketsBoard(board, projectId);
    broadcastEvent({ type: "ticket:updated", ticket, projectId } as WSEvent);

    if (projectId) {
      void ingestProducerSummaryFact(projectId, {
        kind: "ticket_updated",
        at: ticket.updatedAt,
        ticketId,
        title: ticket.title,
        detail: `status=${status}${assignee !== undefined ? ` assignee=${assignee}` : ""}`,
        agentRole: ticket.assignee,
      });
    }
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
  ticket.parentTicketId = parentTicketId;
  return ticket;
}

async function resolveProjectIdForTicket(ticketId: string): Promise<string | null> {
  const legacyBoard = await getBoard(null);
  const legacyFound = findTicketInBoard(legacyBoard, ticketId);
  if (legacyFound) return legacyFound.ticket.projectId ?? null;

  try {
    const dashboard = await readData<DashboardData>("dashboard.json");
    for (const project of dashboard.projects) {
      const board = await getBoard(project.id);
      const found = findTicketInBoard(board, ticketId);
      if (found) return project.id;
    }
  } catch {
    // Ignore scan failures and fall back to null.
  }

  return null;
}
