/**
 * Quest Bridge Service
 * Connects the Task tool (agent spawning) to the Quest/Ticket board.
 * When a workflow is active, every Task call automatically creates and tracks a ticket.
 */

import { readData, writeData, broadcastEvent } from "./data-store.js";
import type { TicketsBoard, Ticket, TicketStatus, AgentRole, WSEvent, WorkflowStage } from "@game-studio/types";

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
}

export function cleanupWorkflow(sessionId: string): void {
  activeWorkflows.delete(sessionId);
}

// ─── Ticket CRUD (direct file access, same as REST routes) ───

const TICKETS_FILE = "tickets.json";

const DEFAULT_BOARD: TicketsBoard = {
  sprint: "Sprint 1",
  milestone: "Milestone 1",
  columns: [
    { id: "available", label: "Available", tickets: [] },
    { id: "in_progress", label: "Processing", tickets: [] },
    { id: "qa", label: "Verify", tickets: [] },
    { id: "completed", label: "Completed", tickets: [] },
  ],
};

function getBoard(): TicketsBoard {
  try {
    return readData<TicketsBoard>(TICKETS_FILE);
  } catch {
    writeData(TICKETS_FILE, DEFAULT_BOARD);
    return DEFAULT_BOARD;
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

export function createQuestTicket(
  sessionId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
  area: string,
  subarea: string,
): Ticket {
  const board = getBoard();
  const now = new Date().toISOString();
  const ticket: Ticket = {
    id: `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

  writeData(TICKETS_FILE, board);

  broadcastEvent({ type: "ticket:created", ticket } as WSEvent);

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

  return ticket;
}

export function moveQuestTicket(ticketId: string, status: TicketStatus, assignee?: string): void {
  const board = getBoard();
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

    writeData(TICKETS_FILE, board);

    broadcastEvent({
      type: "ticket:moved",
      ticket,
      fromColumn: board.columns[col].id,
      toColumn: status,
    } as WSEvent);
  } else {
    // Same column, just update
    writeData(TICKETS_FILE, board);
    broadcastEvent({ type: "ticket:updated", ticket } as WSEvent);
  }
}

export function createFixTicket(
  sessionId: string,
  parentTicketId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
): Ticket {
  const ticket = createQuestTicket(sessionId, title, agentRole, description, "WORKFLOW", "fix");
  ticket.parentTicketId = parentTicketId;
  return ticket;
}
