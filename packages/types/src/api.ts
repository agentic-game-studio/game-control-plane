import type { AgentRole } from "./agent.js";
import type { SessionState, SessionConfig } from "./session.js";
import type { GateResult, GateStatus, ReviewMode } from "./gate.js";
import type { WorkflowStage } from "./tickets.js";
import type { DocumentCategory, DocumentEntry, DocumentDetail, CategoryMeta, GraphData } from "./document.js";
import type { Project } from "./dashboard.js";
import type { Ticket, TicketStatus } from "./tickets.js";
import type { GameAsset } from "./assets.js";
import type { SettingsConfig } from "./settings.js";
import type { ChatSession, ChatMessage, ContextUsage } from "./chat.js";

/** WebSocket event types for real-time frontend updates */
export type WSEvent =
  | { type: "agent:spawned"; agentId: string; agent: AgentRole; sessionId: string; projectId?: string | null }
  | { type: "agent:completed"; agentId: string; output: string; sessionId: string }
  | { type: "agent:failed"; agentId: string; error: string; sessionId: string }
  | { type: "gate:verdict"; result: GateResult; sessionId: string }
  | { type: "skill:phase:complete"; skillId: string; phase: number; output: string; sessionId: string }
  | { type: "checkpoint:saved"; checkpointId: string; sessionId: string }
  | { type: "session:status"; sessionId: string; status: string }
  | { type: "log:entry"; sessionId: string; level: string; message: string; timestamp: string; agent?: string }
  | { type: "document:created"; documentId: string; category: DocumentCategory; title: string }
  | { type: "document:updated"; documentId: string; category: DocumentCategory; title: string }
  | { type: "project:created"; project: Project }
  | { type: "project:updated"; project: Project }
  | { type: "project:deleted"; projectId: string }
  | { type: "ticket:created"; ticket: Ticket }
  | { type: "ticket:updated"; ticket: Ticket }
  | { type: "ticket:deleted"; ticketId: string }
  | { type: "ticket:moved"; ticket: Ticket; fromColumn: string; toColumn: string }
  | { type: "asset:created"; asset: GameAsset }
  | { type: "asset:updated"; asset: GameAsset }
  | { type: "asset:deleted"; assetId: string }
  | { type: "settings:updated"; settings: SettingsConfig }
  | { type: "team:started"; teamId: string; sessionId: string }
  | { type: "team:completed"; teamId: string; sessionId: string; output: string }
  | { type: "chat:message"; sessionId: string; message: ChatMessage }
  | { type: "chat:progress"; sessionId: string; progressMsgId: string; progress: number; content: string; thinking?: string }
  | { type: "agent:loop:detected"; sessionId: string; toolName: string; iterations: number; message: string }
  | { type: "chat:session:created"; session: ChatSession }
  | { type: "chat:session:updated"; sessionId: string; session: { id: string; role?: string; progress?: number; status?: string } }
  | { type: "chat:session:deleted"; sessionId: string }
  | { type: "chat:context"; sessionId: string; contextUsage: ContextUsage }
  | { type: "chat:context-pressure"; sessionId: string; fillPercent: number }
  | { type: "chat:session:compacted"; oldSessionId: string; newSession: ChatSession }
  | { type: "workflow:stage"; sessionId: string; workflowId: string; stage: WorkflowStage; ticketId?: string; agentRole?: string }
  | { type: "workflow:complete"; sessionId: string; workflowId: string; success: boolean }
  | { type: "quest:linked"; sessionId: string; ticketId: string; agentRole: string }
  | { type: "subagent:spawned"; agentRole: AgentRole; parentSessionId: string; ticketId: string; task: string }
  | { type: "subagent:completed"; agentRole: AgentRole; parentSessionId: string; ticketId: string; output: string }
  | { type: "subagent:failed"; agentRole: AgentRole; parentSessionId: string; ticketId: string; error: string }
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
