import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentRole } from "@game-studio/types";
import { broadcastEvent } from "../services/data-store.js";
import type {
  ChatState,
  ChatSession,
  ChatMessage,
  CreateMessageRequest,
  CreateChatSessionRequest,
} from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

export const chatRouter: Router = Router();

// In-memory store for chat sessions (can be persisted to file if needed)
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
    },
  },
  currentSessionId: "game-director",
  threadId: "thread-001",
  threadTitle: "Game Director Session",
};

// GET /api/chat/sessions - Get all sessions
chatRouter.get("/sessions", (_req: Request, res: Response) => {
  res.json({ success: true, data: chatStore });
});

// GET /api/chat/sessions/:id - Get session by ID
chatRouter.get("/sessions/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }
  res.json({ success: true, data: session });
});

// POST /api/chat/sessions - Create new session
chatRouter.post("/sessions", (req: Request, res: Response) => {
  const body = req.body as CreateChatSessionRequest;

  const sessionId = `session-${Date.now()}`;
  const now = new Date().toISOString();

  const newSession: ChatSession = {
    id: sessionId,
    role: body.role ?? "agent",
    messages: [],
    status: "active",
    progress: 0,
    spawnedAt: now,
  };

  chatStore.sessions[sessionId] = newSession;

  // Broadcast event
  broadcastEvent({
    type: "chat:session:created",
    session: newSession,
  } as WSEvent);

  res.status(201).json({ success: true, data: newSession });
});

// DELETE /api/chat/sessions/:id - Delete session
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

  // Broadcast event
  broadcastEvent({
    type: "chat:session:deleted",
    sessionId: id,
  } as WSEvent);

  res.json({ success: true });
});

// POST /api/chat/sessions/:id/messages - Add message to session
chatRouter.post("/sessions/:id/messages", (req: Request, res: Response) => {
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

  const newMessage: ChatMessage = {
    id: `msg-${Date.now()}`,
    type: body.type ?? "system",
    sender: body.sender ?? "SYSTEM",
    content: body.content,
    timestamp: new Date().toISOString(),
    showActions: body.showActions,
    progress: body.progress,
    codeBlock: body.codeBlock,
  };

  session.messages.push(newMessage);

  // Broadcast event
  broadcastEvent({
    type: "chat:message",
    sessionId: id,
    message: newMessage,
  } as WSEvent);

  res.status(201).json({ success: true, data: newMessage });
});

// POST /api/chat/spawn - Spawn an agent
chatRouter.post("/spawn", (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };

  if (!role) {
    res.status(400).json({ success: false, error: "role is required" });
    return;
  }

  const invocationId = `invoke-${Date.now()}`;
  const sessionId = role.toLowerCase().replace(/\s+/g, "-");
  const now = new Date().toISOString();

  // Create session for the spawned agent
  const newSession: ChatSession = {
    id: sessionId,
    role: role as AgentRole,
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
  };

  chatStore.sessions[sessionId] = newSession;

  // Broadcast spawn event
  broadcastEvent({
    type: "agent:spawned",
    agentId: invocationId,
    agent: role as AgentRole,
    sessionId: sessionId,
  } as WSEvent);

  // Also broadcast session created
  broadcastEvent({
    type: "chat:session:created",
    session: newSession,
  } as WSEvent);

  res.json({ success: true, data: { invocationId, role, sessionId } });
});

// POST /api/chat/approve - Approve agent
chatRouter.post("/approve", (req: Request, res: Response) => {
  const { invocationId } = req.body as { invocationId?: string };

  if (!invocationId) {
    res.status(400).json({ success: false, error: "invocationId is required" });
    return;
  }

  res.json({ success: true, data: { invocationId, status: "approved" } });
});
