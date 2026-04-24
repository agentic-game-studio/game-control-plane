import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentRole, ChatSession, ChatMessage, CreateMessageRequest, CreateChatSessionRequest } from "@game-studio/types";
import type { LLMMessage } from "../llm/zai-client.js";
import { broadcastEvent } from "../services/data-store.js";
import { invokeAgent, continueConversation } from "../services/llm-service.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import type { WSEvent } from "@game-studio/types";
import { broadcast } from "../services/websocket.js";

export const chatRouter: Router = Router();

// In-memory store for chat sessions with conversation history
interface ExtendedChatSession extends ChatSession {
  conversationHistory: LLMMessage[];
}

const chatStore: ChatState = {
  sessions: {
    "game-director": {
      id: "game-director",
      role: "creative-director",
      messages: [
        {
          id: "msg-welcome",
          type: "welcome" as const,
          sender: "Game Director",
          content:
            "Welcome to the Board Room. I'm the Game Director, orchestrating our studio's multi-agent game development pipeline.",
          timestamp: new Date().toISOString(),
          showActions: false,
        },
        {
          id: "msg-prompt",
          type: "system" as const,
          sender: "SYSTEM",
          content:
            "Type a command to spawn an agent or request a task. Use /spawn <role> to bring in a specialist.",
          timestamp: new Date().toISOString(),
          showActions: false,
        },
      ],
      status: "active" as const,
      progress: 0,
      spawnedAt: new Date().toISOString(),
      conversationHistory: [],
    },
  },
  currentSessionId: "game-director",
  threadId: "thread-001",
  threadTitle: "Game Director Session",
};

interface ChatState {
  sessions: Record<string, ExtendedChatSession>;
  currentSessionId: string;
  threadId: string;
  threadTitle: string;
}

// GET /api/chat/sessions — Get all sessions
chatRouter.get("/sessions", (_req: Request, res: Response) => {
  const sessionsData = Object.values(chatStore.sessions).map((s) => ({
    id: s.id,
    role: s.role,
    messages: s.messages,
    status: s.status,
    progress: s.progress,
    spawnedAt: s.spawnedAt,
  }));
  res.json({ success: true, data: { sessions: sessionsData, currentSessionId: chatStore.currentSessionId } });
});

// GET /api/chat/sessions/:id — Get session by ID
chatRouter.get("/sessions/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }
  res.json({ success: true, data: session });
});

// POST /api/chat/sessions — Create new session
chatRouter.post("/sessions", async (req: Request, res: Response) => {
  const body = req.body as CreateChatSessionRequest;

  const sessionId = `session-${Date.now()}`;
  const now = new Date().toISOString();
  const role = (body.role ?? "agent") as AgentRole;

  // Load the agent's system prompt for the welcome message
  let welcomeContent = `${role} session initialized.`;
  try {
    const systemPrompt = await getAgentSystemPrompt(role);
    welcomeContent = systemPrompt.split("\n")[0]; // First line as welcome
  } catch {
    // Use default
  }

  const newSession: ExtendedChatSession = {
    id: sessionId,
    role,
    messages: [
      {
        id: `msg-${Date.now()}-1`,
        type: "system",
        sender: "SYSTEM",
        content: welcomeContent,
        timestamp: now,
        showActions: false,
      },
    ],
    status: "active",
    progress: 0,
    spawnedAt: now,
    conversationHistory: [],
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  res.status(201).json({ success: true, data: newSession });
});

// DELETE /api/chat/sessions/:id — Delete session
chatRouter.delete("/sessions/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Prevent deleting game-director
  if (id === "game-director") {
    res.status(400).json({ success: false, error: "Cannot delete game-director session" });
    return;
  }

  if (!chatStore.sessions[id]) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  delete chatStore.sessions[id];

  broadcast({
    type: "chat:session:deleted",
    sessionId: id,
  } as WSEvent);

  res.json({ success: true });
});

// POST /api/chat/sessions/:id/messages — Add message and get LLM response
chatRouter.post("/sessions/:id/messages", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as CreateMessageRequest;

  if (!body.content) {
    res.status(400).json({ success: false, error: "content is required" });
    return;
  }

  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  const userMessageId = `msg-${Date.now()}`;
  const userMessage: ChatMessage = {
    id: userMessageId,
    type: body.type ?? "user",
    sender: body.sender ?? "USER",
    content: body.content,
    timestamp: new Date().toISOString(),
    showActions: body.showActions,
    progress: body.progress,
    codeBlock: body.codeBlock,
  };

  session.messages.push(userMessage);

  // Add to conversation history
  session.conversationHistory.push({
    role: "user",
    content: body.content,
  });

  // Broadcast user message
  broadcast({
    type: "chat:message",
    sessionId: id,
    message: userMessage,
  } as WSEvent);

  // If this is a system message or no auto-response needed, return early
  if (body.type === "system" || body.type === "progress") {
    res.status(201).json({ success: true, data: userMessage });
    return;
  }

  // Get response from LLM
  try {
    const agentRole = session.role as AgentRole;

    // Add thinking/progress message
    const progressMsgId = `msg-${Date.now()}`;
    const progressMessage: ChatMessage = {
      id: progressMsgId,
      type: "progress",
      sender: agentRole,
      content: `${agentRole} is thinking...`,
      timestamp: new Date().toISOString(),
      showActions: false,
      progress: 0,
    };
    session.messages.push(progressMessage);
    broadcast({
      type: "chat:message",
      sessionId: id,
      message: progressMessage,
    } as WSEvent);

    // Call the LLM
    const result = await continueConversation(agentRole, session.conversationHistory, id);

    // Add assistant response to conversation
    session.conversationHistory.push({
      role: "assistant",
      content: result.content,
    });

    // Create assistant message
    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      type: "agent",
      sender: agentRole,
      content: result.content,
      timestamp: new Date().toISOString(),
      showActions: true,
      progress: 100,
      toolCalls: result.toolCalls?.map((tc) => ({
        tool: tc.name,
        args: tc.input,
        status: "success",
      })),
    };

    session.messages.push(assistantMessage);

    // Update session progress
    session.progress = Math.min(100, session.progress + 10);
    if (session.progress >= 100) {
      session.status = "completed";
    }

    // Broadcast assistant response
    broadcast({
      type: "chat:message",
      sessionId: id,
      message: assistantMessage,
    } as WSEvent);

    res.status(201).json({ success: true, data: { userMessage, assistantMessage } });
  } catch (err: unknown) {
    const error = err as Error;

    const errorMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      type: "system",
      sender: "SYSTEM",
      content: `Error: ${error.message}`,
      timestamp: new Date().toISOString(),
      showActions: false,
    };
    session.messages.push(errorMessage);

    broadcast({
      type: "chat:message",
      sessionId: id,
      message: errorMessage,
    } as WSEvent);

    res.status(201).json({ success: true, data: { userMessage, errorMessage } });
  }
});

// POST /api/chat/spawn — Spawn an agent with real ZAI API
chatRouter.post("/spawn", async (req: Request, res: Response) => {
  const { role, task } = req.body as { role?: string; task?: string };

  if (!role) {
    res.status(400).json({ success: false, error: "role is required" });
    return;
  }

  const invocationId = `invoke-${Date.now()}`;
  const sessionId = role.toLowerCase().replace(/\s+/g, "-");
  const now = new Date().toISOString();
  const agentRole = role as AgentRole;

  // Create session for the spawned agent
  const newSession: ExtendedChatSession = {
    id: sessionId,
    role: agentRole,
    messages: [
      {
        id: `msg-${Date.now()}-1`,
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} session initialized.`,
        timestamp: now,
        showActions: false,
      },
    ],
    status: "active",
    progress: 0,
    spawnedAt: now,
    conversationHistory: [],
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: agentRole,
    sessionId: sessionId,
  } as WSEvent);

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  // If a task is provided, execute it immediately
  if (task) {
    try {
      const result = await invokeAgent(agentRole, task, sessionId, undefined, []);

      const responseMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        type: "agent",
        sender: role,
        content: result.content,
        timestamp: new Date().toISOString(),
        showActions: true,
        progress: 100,
        toolCalls: result.toolCalls?.map((tc) => ({
          tool: tc.name,
          args: tc.input,
          status: "success",
        })),
      };

      newSession.messages.push(responseMessage);
      newSession.conversationHistory.push({ role: "assistant", content: result.content });

      broadcast({
        type: "chat:message",
        sessionId,
        message: responseMessage,
      } as WSEvent);

      broadcast({
        type: "agent:completed",
        agentId: invocationId,
        output: result.content,
        sessionId: sessionId,
      } as WSEvent);
    } catch (err: unknown) {
      const error = err as Error;

      broadcast({
        type: "agent:failed",
        agentId: invocationId,
        error: error.message,
        sessionId: sessionId,
      } as WSEvent);
    }
  }

  res.json({
    success: true,
    data: { invocationId, role, sessionId, status: task ? "completed" : "ready" },
  });
});

// POST /api/chat/approve — Approve agent action
chatRouter.post("/approve", (req: Request, res: Response) => {
  const { invocationId } = req.body as { invocationId?: string };

  if (!invocationId) {
    res.status(400).json({ success: false, error: "invocationId is required" });
    return;
  }

  res.json({ success: true, data: { invocationId, status: "approved" } });
});

// POST /api/chat/diff — Save or retrieve diffs
chatRouter.post("/diff", (req: Request, res: Response) => {
  const { sessionId, diffBlocks } = req.body as { sessionId?: string; diffBlocks?: unknown[] };

  const diffId = `diff-${Date.now()}`;

  broadcast({
    type: "chat:message",
    sessionId: sessionId ?? "game-director",
    message: {
      id: diffId,
      type: "diff" as const,
      sender: "SYSTEM",
      content: "Diff generated",
      timestamp: new Date().toISOString(),
      diffBlocks: diffBlocks as import("@game-studio/types").DiffBlock[],
    },
  } as WSEvent);

  res.json({ success: true, data: { diffId, diffBlocks } });
});

// GET /api/chat/diff/:id — Get diff by ID
chatRouter.get("/diff/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  res.json({ success: true, data: { id, diffBlocks: [] } });
});

// Export for use by other routes
export { chatStore };
