import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import type {
  TicketsBoard,
  Ticket,
  CreateTicketRequest,
  UpdateTicketRequest,
  MoveTicketRequest,
  TicketStatus,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const DEFAULT_BOARD: TicketsBoard = {
  sprint: "Sprint_01",
  milestone: "Alpha_Milestone",
  columns: [
    { id: "available", label: "Available", tickets: [] },
    { id: "in_progress", label: "Processing", tickets: [] },
    { id: "qa", label: "Verify", tickets: [] },
    { id: "completed", label: "Archived", tickets: [] },
  ],
};

export const ticketsRouter: Router = Router();

// GET /api/tickets - Get all tickets board
ticketsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await readData<TicketsBoard>("tickets.json");
    res.json({ success: true, data });
  } catch {
    // Initialize with default data if file doesn't exist
    await writeData("tickets.json", DEFAULT_BOARD);
    res.json({ success: true, data: DEFAULT_BOARD });
  }
});

// GET /api/tickets/:id - Get ticket by ID
ticketsRouter.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = await readData<TicketsBoard>("tickets.json");
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
    const data = await readData<TicketsBoard>("tickets.json");
    const now = new Date().toISOString();
    const status: TicketStatus = body.status ?? "available";

    const newTicket: Ticket = {
      id: `ticket-${Date.now()}`,
      title: body.title,
      description: body.description ?? "",
      area: body.area,
      subarea: body.subarea,
      credits: body.credits ?? 100,
      estimateHours: body.estimateHours,
      status,
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

    await writeData("tickets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "ticket:created",
      ticket: newTicket,
    } as WSEvent);

    res.status(201).json({ success: true, data: newTicket });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to create ticket" });
  }
});

// PATCH /api/tickets/:id - Update ticket
ticketsRouter.patch("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const updates = req.body as UpdateTicketRequest;

  try {
    const data = await readData<TicketsBoard>("tickets.json");

    // Find the ticket
    let ticket: Ticket | undefined;
    let ticketColumn: number = -1;
    let ticketIndex: number = -1;

    for (let i = 0; i < data.columns.length; i++) {
      const idx = data.columns[i].tickets.findIndex((t) => t.id === id);
      if (idx !== -1) {
        ticket = data.columns[i].tickets[idx];
        ticketColumn = i;
        ticketIndex = idx;
        break;
      }
    }

    if (!ticket) {
      res.status(404).json({ success: false, error: "Ticket not found" });
      return;
    }

    const ticketId = String(id);
    const updatedTicket: Ticket = {
      ...ticket,
      ...updates,
      id: ticketId, // Ensure ID cannot be changed
      updatedAt: new Date().toISOString(),
    };

    data.columns[ticketColumn].tickets[ticketIndex] = updatedTicket;
    await writeData("tickets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "ticket:updated",
      ticket: updatedTicket,
    } as WSEvent);

    res.json({ success: true, data: updatedTicket });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to update ticket" });
  }
});

// PATCH /api/tickets/:id/move - Move ticket to different column
ticketsRouter.patch("/:id/move", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body as MoveTicketRequest;

  if (!status) {
    res.status(400).json({ success: false, error: "status is required" });
    return;
  }

  try {
    const data = await readData<TicketsBoard>("tickets.json");

    // Find the ticket
    let ticket: Ticket | undefined;
    let fromColumn: number = -1;
    let ticketIndex: number = -1;

    for (let i = 0; i < data.columns.length; i++) {
      const idx = data.columns[i].tickets.findIndex((t) => t.id === id);
      if (idx !== -1) {
        ticket = data.columns[i].tickets[idx];
        fromColumn = i;
        ticketIndex = idx;
        break;
      }
    }

    if (!ticket) {
      res.status(404).json({ success: false, error: "Ticket not found" });
      return;
    }

    const toColumnIndex = data.columns.findIndex((col) => col.id === status);
    if (toColumnIndex === -1) {
      res.status(400).json({ success: false, error: "Invalid status" });
      return;
    }

    const fromColumnId = data.columns[fromColumn].id;

    // Remove from old column
    data.columns[fromColumn].tickets.splice(ticketIndex, 1);

    // Update status and add to new column
    const updatedTicket: Ticket = {
      ...ticket,
      status,
      updatedAt: new Date().toISOString(),
    };

    data.columns[toColumnIndex].tickets.push(updatedTicket);
    await writeData("tickets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "ticket:moved",
      ticket: updatedTicket,
      fromColumn: fromColumnId,
      toColumn: status,
    } as WSEvent);

    res.json({ success: true, data: updatedTicket });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to move ticket" });
  }
});

// DELETE /api/tickets/:id - Delete ticket
ticketsRouter.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const data = await readData<TicketsBoard>("tickets.json");

    let found = false;
    for (const column of data.columns) {
      const ticketIndex = column.tickets.findIndex((t) => t.id === id);
      if (ticketIndex !== -1) {
        column.tickets.splice(ticketIndex, 1);
        found = true;
        break;
      }
    }

    if (!found) {
      res.status(404).json({ success: false, error: "Ticket not found" });
      return;
    }

    await writeData("tickets.json", data);

    // Broadcast event
    broadcastEvent({
      type: "ticket:deleted",
      ticketId: id,
    } as WSEvent);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: "Failed to delete ticket" });
  }
});
