export type MessageType = "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate" | "question" | "plan";
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

export interface ChatSession {
  id: string;
  role: string;
  messages: ChatMessage[];
  status: ChatSessionStatus;
  progress: number;
  spawnedAt: string;
}

export interface CreateChatSessionRequest {
  role?: string;
}

export interface ChatState {
  sessions: Record<string, ChatSession>;
  currentSessionId: string;
  threadId: string;
  threadTitle: string;
}
