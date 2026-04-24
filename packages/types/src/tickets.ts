export type TicketStatus = "available" | "in_progress" | "qa" | "completed";

export interface Ticket {
  id: string;
  title: string;
  description: string;
  area: string;
  subarea: string;
  credits: number;
  estimateHours?: number;
  status: TicketStatus;
  assignee?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TicketsColumn {
  id: TicketStatus;
  label: string;
  tickets: Ticket[];
}

export interface TicketsBoard {
  sprint: string;
  milestone: string;
  columns: TicketsColumn[];
}
