export type TicketStatus = "available" | "in_progress" | "qa" | "completed";

export type WorkflowStage = "plan" | "decompose" | "execute" | "verify" | "fix";

export interface TicketTestEvidence {
  bootCheck?: { passed: boolean; errors?: string[]; at: string };
  gut?: { passed: boolean; output?: string; at: string };
  smokePlaytest?: { passed: boolean; output?: string; at: string };
  regression?: { passed: boolean; isBaseline?: boolean; diff?: string; at: string };
  llmVerification?: { verdict: string; verifier?: string; at: string };
}

export interface Ticket {
  id: string;
  projectId?: string;
  title: string;
  description: string;
  area: string;
  subarea: string;
  credits: number;
  estimateHours?: number;
  status: TicketStatus;
  assignee?: string;
  /** Preferred agent role to handle this ticket (overrides area-based assignment). */
  agentRole?: string;
  acknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  parentTicketId?: string;
  workflowStage?: WorkflowStage;
  /** Executable QA gate results attached after verification. */
  testEvidence?: TicketTestEvidence;
}

export interface CreateTicketRequest {
  projectId?: string;
  title: string;
  description?: string;
  area: string;
  subarea: string;
  credits?: number;
  estimateHours?: number;
  status?: TicketStatus;
  /** Preferred agent role to handle this ticket. */
  agentRole?: string;
}

export interface UpdateTicketRequest {
  projectId?: string;
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
  projectId?: string;
  status: TicketStatus;
}

export interface TicketsColumn {
  id: TicketStatus;
  label: string;
  tickets: Ticket[];
}

export interface TicketsBoard {
  projectId?: string;
  sprint: string;
  milestone: string;
  columns: TicketsColumn[];
}
