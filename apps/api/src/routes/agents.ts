import { Router } from "express";
import type { Request, Response } from "express";
import { agents } from "@game-studio/agents";
import { broadcast } from "../services/websocket.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import { logger } from "../utils/logger.js";
import { newId } from "../utils/ids.js";
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

// GET /agents/:id/prompt — get system prompt from .md file
agentsRouter.get("/:id/prompt", async (req: Request, res: Response) => {
  try {
    const prompt = await getAgentSystemPrompt(req.params.id as string);
    res.json({ success: true, data: { role: req.params.id as string, systemPrompt: prompt } });
  } catch (err) {
    // Most paths here are the expected "no .md file for this agent" case.
    // Log at debug to keep the 404 response shape consistent with how the
    // prompt loader signals missing prompts; bump to warn if a non-ENOENT
    // error path becomes common.
    logger.debug(
      { err: err instanceof Error ? err.message : String(err), agentId: req.params.id },
      "Agent prompt not found",
    );
    res.status(404).json({ success: false, error: `Prompt not found for agent: ${req.params.id}` });
  }
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

  const invocationId = newId("invoke");

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
