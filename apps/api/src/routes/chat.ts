import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentRole } from "@game-studio/types";
import { broadcast } from "../services/websocket.js";

export const chatRouter: Router = Router();

chatRouter.get("/sessions", (_req: Request, res: Response) => {
  const initialSession = {
    sessions: {
      "game-director": {
        id: "game-director",
        role: "creative-director",
        messages: [
          {
            id: "msg-welcome",
            type: "welcome" as const,
            sender: "Game Director",
            content: "Welcome to the Board Room. I'm the Game Director, orchestrating our studio's multi-agent game development pipeline.",
            timestamp: new Date().toISOString(),
            showActions: false
          },
          {
            id: "msg-prompt",
            type: "system" as const,
            sender: "SYSTEM",
            content: "Type a command to spawn an agent or request a task. Use /spawn <role> to bring in a specialist.",
            timestamp: new Date().toISOString(),
            showActions: false
          }
        ],
        status: "active" as const,
        progress: 0,
        spawnedAt: new Date().toISOString()
      }
    },
    currentSessionId: "game-director",
    threadId: "thread-001",
    threadTitle: "Game Director Session"
  };
  res.json({ success: true, data: initialSession });
});

chatRouter.post("/spawn", (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };
  if (!role) {
    res.status(400).json({ success: false, error: "role is required" });
    return;
  }
  const invocationId = crypto.randomUUID();
  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: role as AgentRole,
    sessionId: "game-director"
  });
  res.json({ success: true, data: { invocationId, role } });
});

chatRouter.post("/approve", (req: Request, res: Response) => {
  const { invocationId } = req.body as { invocationId?: string };
  if (!invocationId) {
    res.status(400).json({ success: false, error: "invocationId is required" });
    return;
  }
  res.json({ success: true, data: { invocationId, status: "approved" } });
});
