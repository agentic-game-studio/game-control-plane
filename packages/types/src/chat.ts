export type MessageType = "system" | "agent" | "user" | "progress" | "welcome";
export type ChatSessionStatus = "active" | "done";

export interface CodeBlock {
  language: string;
  code: string;
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
}

export interface CreateMessageRequest {
  type: MessageType;
  sender: string;
  content: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: CodeBlock;
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
