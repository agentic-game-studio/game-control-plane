export type MessageType =
  | "system"
  | "agent"
  | "user"
  | "progress"
  | "welcome"
  | "diff"
  | "navigate"
  | "question"
  | "plan"
  | "workflow"
  /** Rolling orchestration summary persisted on the producer thread */
  | "producer_update";

/** Fact ingested into the producer rolling summary reducer (backend). */
export type ProducerSummaryFactKind =
  | "subagent_spawned"
  | "subagent_completed"
  | "subagent_failed"
  | "ticket_created"
  | "ticket_moved"
  | "ticket_updated"
  | "workflow_stage"
  | "workflow_complete"
  | "autonomous_iteration_started"
  | "autonomous_iteration_completed"
  | "autonomous_iteration_failed"
  | "autonomous_iteration_boot_check_failed"
  | "autonomous_loop_completed"
  | "autonomous_loop_stopped"
  | "autonomous_error"
  | "gdd_ingested"
  | "consultation_closed"
  | "agent_spawned"
  | "spawn_task_complete"
  | "spawn_task_failed";

export interface ProducerSummaryFact {
  kind: ProducerSummaryFactKind;
  /** ISO timestamp */
  at: string;
  title?: string;
  ticketId?: string;
  agentRole?: string;
  sessionId?: string;
  detail?: string;
  fromColumn?: string;
  toColumn?: string;
}

/** Persisted on producer chat session — durable summary memory for hybrid rollups */
export interface ProducerSummarySnapshot {
  version: 1;
  recentFacts: ProducerSummaryFact[];
  lastEmittedAt: number | null;
  lastEmittedContentHash: string | null;
  /** Short line for autonomous activity */
  autonomousHint?: string | null;
}
export type ChatSessionStatus = "active" | "done" | "completed";

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionData {
  questionId: string;
  question: string;
  options: QuestionOption[];
  allowMultiple?: boolean;
  allowCustomInput?: boolean;
}

export interface PlanPhase {
  id: string;
  label: string;
  description?: string;
  status: "pending" | "active" | "completed";
  estimatedEffort?: string;
}

export interface PlanData {
  phases: PlanPhase[];
  summary?: string;
}

export interface CodeBlock {
  language: string;
  code: string;
}

export interface DiffHunk {
  lines: string[];
  type: "add" | "remove" | "context";
  lineNum?: number;
}

export interface DiffBlock {
  filePath: string;
  hunks: DiffHunk[];
}

export interface ToolCall {
  tool: string;
  status: "pending" | "success" | "error";
  input?: string;
  output?: string;
  duration?: number;
  args?: Record<string, unknown>;
}

export interface NavigateAction {
  targetSession: string;
  label: string;
}

export interface WorkflowStep {
  stage: import("./tickets.js").WorkflowStage;
  label: string;
  ticketId?: string;
  agentRole?: string;
  status: "pending" | "active" | "completed" | "failed";
}

export interface WorkflowData {
  workflowId: string;
  steps: WorkflowStep[];
  currentStage: import("./tickets.js").WorkflowStage;
}

export interface ChatMessage {
  id: string;
  type: MessageType;
  sender: string;
  content: string;
  timestamp: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: CodeBlock;
  diffBlocks?: DiffBlock[];
  toolCalls?: ToolCall[];
  logs?: string[];
  thinking?: string;
  navigate?: NavigateAction;
  images?: string[];
  question?: QuestionData;
  planPhases?: PlanPhase[];
  workflow?: WorkflowData;
}

export interface CreateMessageRequest {
  type: MessageType;
  sender: string;
  content: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: CodeBlock;
  images?: string[];
}

export interface FileOperation {
  tool: string;
  path?: string;
  result: "success" | "failed";
  timestamp: string;
}

/** Token usage tracking per session — populated from API response usage data */
export interface ContextUsage {
  lastInputTokens: number;
  lastOutputTokens: number;
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
  contextWindowTokens: number;
  lastUpdated: string;
}

export interface ChatSession {
  id: string;
  role: string;
  projectId: string | null;
  messages: ChatMessage[];
  status: ChatSessionStatus;
  progress: number;
  spawnedAt: string;
  // Execution state for long-running tasks
  fileOperations?: FileOperation[];
  completedPhases?: string[];
  currentTask?: string;
  // Token usage from API responses
  contextUsage?: ContextUsage;
  // Session compaction (Claude Code style)
  compactedFrom?: string;
  generation?: number;
  /** Rolling producer summary state (API-only extended field; persisted in chat-state.json) */
  producerSummary?: ProducerSummarySnapshot;
}

export interface CreateChatSessionRequest {
  role?: string;
  projectId?: string | null;
}

export interface ChatState {
  sessions: Record<string, ChatSession>;
  currentSessionId: string;
  threadId: string;
  threadTitle: string;
}
