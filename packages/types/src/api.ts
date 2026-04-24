import type { AgentRole } from "./agent.js";
import type { SessionState, SessionConfig } from "./session.js";
import type { GateResult, GateStatus } from "./gate.js";
import type { ReviewMode } from "./gate.js";
import type { DocumentCategory, DocumentEntry, DocumentDetail, CategoryMeta, GraphData } from "./document.js";
import type { DashboardSummary } from "./dashboard.js";
import type { TicketStatus } from "./tickets.js";
import type { GameAsset } from "./assets.js";

/** WebSocket event types for real-time frontend updates */
export type WSEvent =
  | { type: "agent:spawned"; agentId: string; agent: AgentRole; sessionId: string }
  | { type: "agent:completed"; agentId: string; output: string; sessionId: string }
  | { type: "agent:failed"; agentId: string; error: string; sessionId: string }
  | { type: "gate:verdict"; result: GateResult; sessionId: string }
  | { type: "skill:phase:complete"; skillId: string; phase: number; output: string; sessionId: string }
  | { type: "checkpoint:saved"; checkpointId: string; sessionId: string }
  | { type: "session:status"; sessionId: string; status: string }
  | { type: "log:entry"; sessionId: string; level: string; message: string; timestamp: string }
  | { type: "document:created"; documentId: string; category: DocumentCategory; title: string }
  | { type: "document:updated"; documentId: string; category: DocumentCategory; title: string }
  | { type: "dashboard:updated"; summary: DashboardSummary }
  | { type: "ticket:updated"; ticketId: string; status: TicketStatus }
  | { type: "asset:created"; asset: GameAsset }
  | { type: "credits:updated"; credits: { current: number; max: number } }
  | { type: "error"; error: string; sessionId?: string };

/** API request/response types */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Sessions
export interface CreateSessionRequest {
  name: string;
  config?: SessionConfig;
}

export interface CreateSessionResponse {
  session: SessionState;
}

// Agents
export interface SpawnAgentRequest {
  sessionId: string;
  agent: AgentRole;
  context?: string;
  parentAgent?: AgentRole;
}

// Skills
export interface InvokeSkillRequest {
  sessionId: string;
  skillId: string;
  args?: Record<string, string>;
  reviewMode?: ReviewMode;
}

// Teams
export interface RunTeamRequest {
  sessionId: string;
  teamId: string;
  input?: string;
  reviewMode?: ReviewMode;
}

// Gates
export interface RunGateRequest {
  sessionId: string;
  gateId: string;
  targetPhase?: string;
  reviewMode?: ReviewMode;
}

export interface GetGatesResponse {
  gates: GateStatus[];
}

// Documents
export interface ListDocumentsResponse {
  documents: DocumentEntry[];
  categories: CategoryMeta[];
}

export interface GetDocumentResponse {
  document: DocumentDetail;
}

export interface GetGraphResponse {
  graph: GraphData;
}
