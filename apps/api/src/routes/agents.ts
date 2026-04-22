import { Router } from "express";
import type { Request, Response } from "express";
import { agents } from "@game-studio/agents";
import { broadcast } from "../services/websocket.js";
import type { AgentRole } from "@game-studio/types";

export const agentsRouter: Router = Router();

// GET /agents — list all agents
agentsRouter.get("/", (_req: Request, res: Response) => {
  const all = Object.entries(agents).map(([role, def]) => ({ role, ...def }));
  res.json({ success: true, data: all });
});

// GET /agents/:id — get agent definition
agentsRouter.get("/:id", (req: Request, res: Response) => {
  const agent = agents[req.params.id as keyof typeof agents];
  if (!agent) {
    res.status(404).json({ success: false, error: "Agent not found" });
    return;
  }
  res.json({ success: true, data: agent });
});

// POST /agents/spawn — spawn an agent in a session
agentsRouter.post("/spawn", async (req: Request, res: Response) => {
  const { sessionId, agent, context } = req.body as {
    sessionId?: string;
    agent?: string;
    context?: string;
  };
  if (!sessionId || !agent) {
    res.status(400).json({ success: false, error: "sessionId and agent are required" });
    return;
  }

  const agentDef = agents[agent as keyof typeof agents];
  if (!agentDef) {
    res.status(404).json({ success: false, error: `Agent '${agent}' not found` });
    return;
  }

  const invocationId = crypto.randomUUID();

  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: agent as AgentRole,
    sessionId,
  });

  res.json({
    success: true,
    data: {
      invocationId,
      agent,
      status: "spawned",
      definition: agentDef,
    },
  });
});
