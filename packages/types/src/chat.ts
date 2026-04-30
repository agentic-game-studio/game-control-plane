export type MessageType = "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate" | "question" | "plan" | "workflow";
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
