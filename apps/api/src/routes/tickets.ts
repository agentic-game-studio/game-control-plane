import { Router } from "express";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { broadcastEvent } from "../services/data-store.js";
import { DEFAULT_TICKETS_BOARD, readTicketsBoard, writeTicketsBoard, updateTicketsBoard } from "../services/ticket-board.js";
import { triggerVerification } from "../services/verification-service.js";
import { logger } from "../utils/logger.js";
import type {
  TicketsBoard,
  Ticket,
  CreateTicketRequest,
  UpdateTicketRequest,
  MoveTicketRequest,
  TicketStatus,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

export const ticketsRouter: Router = Router();

// 13-M5: explicit allowlist for PATCH /tickets/:id body fields.
// Spreading `updates` verbatim would let a client overwrite
// `id`, `createdAt`, `consecutiveFailures`, `lastError`, or
// `testEvidence` — fields the API owns and a malicious client
// could forge. `id` and `updatedAt` are re-asserted after spread
// (defence-in-depth), but the allowlist makes the contract
// explicit and keeps the surface tight.
const ALLOWED_TICKET_UPDATE_FIELDS: ReadonlyArray<keyof UpdateTicketRequest> = [
  "title",
  "description",
  "status",
  "credits",
  "estimateHours",
  "agentRole",
  "acknowledged",
  "assignee",
  "area",
  "subarea",
];

function getProjectId(req: Request): string | null {
  const queryProjectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
  const bodyProjectId = req.body && typeof req.body.projectId === "string" ? req.body.projectId : null;
  return queryProjectId ?? bodyProjectId ?? null;
}

// GET /api/tickets - Get all tickets board for the specified project
ticketsRouter.get("/", async (req: Request, res: Response) => {
  const projectId = getProjectId(req);
  try {
    const data = await readTicketsBoard(projectId);
    res.json({ success: true, data });
  } catch {
    await writeTicketsBoard(DEFAULT_TICKETS_BOARD, projectId);
    res.json({ success: true, data: DEFAULT_TICKETS_BOARD });
  }
});

// GET /api/tickets/:id - Get ticket by ID
ticketsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const projectId = getProjectId(req);
  try {
    const data = await readTicketsBoard(projectId);
    const ticket = data.columns.flatMap((col) => col.tickets).find((t) => t.id === id);
    if (!ticket) {
      res.status(404).json({ success: false, error: "Ticket not found" });
      return;
    }
    res.json({ success: true, data: ticket });
  } catch {
    res.status(500).json({ success: false, error: "Failed to read ticket" });
  }
});

// POST /api/tickets - Create new ticket
ticketsRouter.post("/", async (req: Request, res: Response) => {
  const body = req.body as CreateTicketRequest;

  if (!body.title || !body.area || !body.subarea) {
    res.status(400).json({
      success: false,
      error: "title, area, and subarea are required",
    });
    return;
  }

  try {
    const projectId = getProjectId(req);
    const data = await readTicketsBoard(projectId);
    const now = new Date().toISOString();
    const status: TicketStatus = body.status ?? "available";

    const newTicket: Ticket = {
      // Q4-6th: unguessable ticket IDs. The previous `ticket-${Date.now()}`
      // was predictable — an attacker who knows roughly when a ticket was
      // created could enumerate the board by ID. Use crypto.randomUUID()
      // for 122 bits of entropy. The board is auth-gated so this is not
      // a direct leak, but it eliminates enumeration as an oracle.
      id: `ticket-${randomUUID()}`,
      projectId: projectId ?? undefined,
      title: body.title,
      description: body.description ?? "",
      area: body.area,
      subarea: body.subarea,
      credits: body.credits ?? 100,
      estimateHours: body.estimateHours,
      status,
      agentRole: body.agentRole,
      acknowledged: false,
      createdAt: now,
      updatedAt: now,
    };

    // Find the column for this status
    const column = data.columns.find((col) => col.id === status);
    if (column) {
      column.tickets.push(newTicket);
    } else {
      // Default to available column
      data.columns[0].tickets.push(newTicket);
    }

    await writeTicketsBoard(data, projectId);

    // Broadcast event
    broadcastEvent({
      type: "ticket:created",
      ticket: newTicket,
      projectId,
    } as WSEvent);

    res.status(201).json({ success: true, data: newTicket });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "ticket_create_failed" },
      "Failed to create ticket",
    );
    res.status(500).json({ success: false, error: "Failed to create ticket" });
  }
});

// PATCH /api/tickets/:id - Update ticket
ticketsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateTicketRequest;
  const projectId = getProjectId(req);

  // 13-M17: route through updateTicketsBoard (per-file mutex) so a
  // concurrent PATCH /tickets/:id or PATCH /tickets/:id/move on
  // the same ticket can't clobber each other. The previous version
  // used readTicketsBoard + writeTicketsBoard (lock-free), so two
  // concurrent PATCHes could both see the same starting state and
  // last-writer-wins, losing one update silently.
  let notFound = false;
  let updatedTicket: Ticket | null = null;

  await updateTicketsBoard(projectId, (board) => {
    let ticket: Ticket | undefined;
    let ticketColumn = -1;
    let ticketIndex = -1;

    for (let i = 0; i < board.columns.length; i++) {
      const idx = board.columns[i].tickets.findIndex((t) => t.id === id);
      if (idx !== -1) {
        ticket = board.columns[i].tickets[idx];
        ticketColumn = i;
        ticketIndex = idx;
        break;
      }
    }

    if (!ticket) {
      notFound = true;
      return board;
    }

    // 13-M5: only allow specific fields. The previous version spread
    // `updates` verbatim, so a client could PATCH `id`,
    // `createdAt`, or `consecutiveFailures` — the `id` was
    // re-asserted after spread, but other fields were not
    // protected. Lock the allowlist to the documented update
    // surface.
    const safeUpdates: Partial<Ticket> = {};
    for (const key of ALLOWED_TICKET_UPDATE_FIELDS) {
      const value = (updates as Record<string, unknown>)[key];
      if (value !== undefined) {
        (safeUpdates as Record<string, unknown>)[key] = value;
      }
    }

    const ticketId = String(id);
    updatedTicket = {
      ...ticket,
      ...safeUpdates,
      projectId: ticket.projectId ?? projectId ?? undefined,
      id: ticketId, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString(),
    };
    board.columns[ticketColumn].tickets[ticketIndex] = updatedTicket;
    return board;
  });

  if (notFound) {
    res.status(404).json({ success: false, error: "Ticket not found" });
    return;
  }
  if (!updatedTicket) {
    res.status(500).json({ success: false, error: "Failed to update ticket" });
    return;
  }

  // Broadcast event
  broadcastEvent({
    type: "ticket:updated",
    ticket: updatedTicket,
    projectId,
  } as WSEvent);

  res.json({ success: true, data: updatedTicket });
});

// PATCH /api/tickets/:id/move - Move ticket to different column
ticketsRouter.patch("/:id/move", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as MoveTicketRequest;
  const projectId = getProjectId(req);

  if (!status) {
    res.status(400).json({ success: false, error: "status is required" });
    return;
  }

  // C9: route the read-modify-write through updateTicketsBoard so the
  // per-file mutex held by updateData serializes concurrent PATCH /tickets
  // calls. The previous code used readTicketsBoard + writeTicketsBoard
  // (lock-free) so two concurrent moves on the same board could clobber
  // each other — last writer wins, with potentially lost intermediate
  // moves.
  let notFound = false;
  let invalidStatus = false;
  let fromColumnId: string | null = null;
  let updatedTicket: Ticket | null = null;

  await updateTicketsBoard(projectId, (board) => {
    let ticket: Ticket | undefined;
    let fromColumn = -1;
    let ticketIndex = -1;

    for (let i = 0; i < board.columns.length; i++) {
      const idx = board.columns[i].tickets.findIndex((t) => t.id === id);
      if (idx !== -1) {
        ticket = board.columns[i].tickets[idx];
        fromColumn = i;
        ticketIndex = idx;
        break;
      }
    }

    if (!ticket) { notFound = true; return board; }

    const toColumnIndex = board.columns.findIndex((col) => col.id === status);
    if (toColumnIndex === -1) { invalidStatus = true; return board; }

    fromColumnId = board.columns[fromColumn].id;
    board.columns[fromColumn].tickets.splice(ticketIndex, 1);

    const next: Ticket = {
      ...ticket,
      projectId: ticket.projectId ?? projectId ?? undefined,
      status,
      updatedAt: new Date().toISOString(),
    };
    board.columns[toColumnIndex].tickets.push(next);
    updatedTicket = next;
    return board;
  });

  if (notFound) {
    res.status(404).json({ success: false, error: "Ticket not found" });
    return;
  }
  if (invalidStatus) {
    res.status(400).json({ success: false, error: "Invalid status" });
    return;
  }
  if (!updatedTicket) {
    res.status(500).json({ success: false, error: "Failed to move ticket" });
    return;
  }
  // TS can't narrow through the closure that assigns `updatedTicket`, so we
  // capture a non-null local here. The check above guarantees it's set.
  const moved: Ticket = updatedTicket;

  // Broadcast event
  broadcastEvent({
    type: "ticket:moved",
    ticket: moved,
    fromColumn: fromColumnId ?? moved.status,
    toColumn: status,
    projectId,
  } as WSEvent);

  if (status === "qa") {
    triggerVerification(moved, moved.description || moved.title);
  }

  res.json({ success: true, data: moved });
});

// DELETE /api/tickets/:id - Delete ticket
ticketsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const projectId = getProjectId(req);

  // 13-M17: route through updateTicketsBoard (per-file mutex)
  // so a concurrent PATCH on the same ticket can't have its
  // read of the board land AFTER our splice but BEFORE our
  // write — the previous lock-free readTicketsBoard +
  // writeTicketsBoard pair would let a PATCH see the ticket
  // present, then we'd delete it, then the PATCH would write
  // the ticket back as a "deleted" resurrection.
  let notFound = false;

  await updateTicketsBoard(projectId, (board) => {
    for (const column of board.columns) {
      const ticketIndex = column.tickets.findIndex((t) => t.id === id);
      if (ticketIndex !== -1) {
        column.tickets.splice(ticketIndex, 1);
        return board;
      }
    }
    notFound = true;
    return board;
  });

  if (notFound) {
    res.status(404).json({ success: false, error: "Ticket not found" });
    return;
  }

  // Broadcast event
  broadcastEvent({
    type: "ticket:deleted",
    ticketId: id,
    projectId,
  } as WSEvent);

  res.json({ success: true });
});
