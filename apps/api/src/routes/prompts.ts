import { Router } from "express";
import type { Request, Response } from "express";
import { loadAgentPrompts, getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import { logger } from "../utils/logger.js";

export const promptsRouter: Router = Router();

// GET /prompts/agents — list all agent prompts
promptsRouter.get("/agents", async (_req: Request, res: Response) => {
  try {
    const prompts = await loadAgentPrompts();
    const list = [...prompts.values()].map((p) => ({
      name: p.name,
      description: p.description,
      model: p.model,
      maxTurns: p.maxTurns,
      memory: p.memory,
      tools: p.tools,
      disallowedTools: p.disallowedTools,
      skills: p.skills,
    }));
    res.json({ success: true, data: list });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event: "prompts_list_failed" },
      "Failed to list agent prompts",
    );
    res.status(500).json({ success: false, error: "Failed to list agent prompts" });
  }
});

// GET /prompts/agents/:role — get system prompt for specific agent
promptsRouter.get("/agents/:role", async (req: Request, res: Response) => {
  try {
    const prompt = await getAgentSystemPrompt(req.params.role as string);
    res.json({ success: true, data: { role: req.params.role, systemPrompt: prompt } });
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), role: req.params.role, event: "prompts_get_failed" },
      "Failed to fetch agent prompt",
    );
    res.status(500).json({ success: false, error: "Failed to fetch agent prompt" });
  }
});