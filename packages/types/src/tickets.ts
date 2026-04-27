export type TicketStatus = "available" | "in_progress" | "qa" | "completed";

export type WorkflowStage = "plan" | "decompose" | "execute" | "verify" | "fix";

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
  acknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  parentTicketId?: string;
  workflowStage?: WorkflowStage;
}

export interface CreateTicketRequest {
  title: string;
  description?: string;
  area: string;
  subarea: string;
  credits?: number;
  estimateHours?: number;
  status?: TicketStatus;
}

export interface UpdateTicketRequest {
  title?: string;
  description?: string;
  area?: string;
  subarea?: string;
  credits?: number;
  estimateHours?: number;
  status?: TicketStatus;
  assignee?: string;
  acknowledged?: boolean;
}

export interface MoveTicketRequest {
  status: TicketStatus;
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
