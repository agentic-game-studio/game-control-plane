/**
 * Research API — deep research endpoints powered by MiroMind.
 *
 * Routes:
 *   POST /research/analyze  — Run deep research on a game concept
 *   GET  /research/:projectId — Read stored research for a project
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { loadConfig } from "../config.js";
import { runDeepResearch, readResearchReport, isDeepResearchAvailable } from "../services/deep-research-service.js";
import { broadcast } from "../services/websocket.js";
import { logger } from "../utils/logger.js";

export const researchRouter: Router = Router();

// POST /api/research/analyze
researchRouter.post("/analyze", async (req: Request, res: Response) => {
  const { projectId, concept, projectDescription } = req.body as {
    projectId?: string;
    concept?: string;
    projectDescription?: string;
  };

  if (!concept || typeof concept !== "string" || concept.trim().length === 0) {
    res.status(400).json({ success: false, error: "concept is required" });
    return;
  }

  if (!isDeepResearchAvailable()) {
    res.status(503).json({
      success: false,
      error: "Deep research is not available. Set MIROMIND_API_KEY in .env",
    });
    return;
  }

  try {
    logger.info(
      { projectId: projectId ?? "none", concept: concept.slice(0, 80), event: "research_analyze_start" },
      "Research analyze started",
    );

    const report = await runDeepResearch(
      projectId ?? `research-${Date.now()}`,
      concept.trim(),
      { projectDescription: projectDescription?.trim() },
    );

    broadcast({
      type: "research:completed",
      projectId: projectId ?? "unknown",
      concept: concept.slice(0, 80),
      sections: report.sections.length,
    });

    res.json({
      success: true,
      data: {
        concept: report.concept,
        timestamp: report.timestamp,
        model: report.model,
        sections: report.sections,
        totalTokens: report.totalTokens,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { projectId: projectId ?? "none", err: msg, event: "research_analyze_failed" },
      "Research analyze failed",
    );
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/research/:projectId
researchRouter.get("/:projectId", async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId ?? "");

  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }

  try {
    const report = await readResearchReport(projectId);
    if (!report) {
      res.status(404).json({
        success: false,
        error: "No research found for this project. Run a deep research analysis first.",
      });
      return;
    }

    res.json({
      success: true,
      data: {
        concept: report.concept,
        timestamp: report.timestamp,
        sections: report.sections,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      { projectId, err: msg, event: "research_get_failed" },
      "Failed to read research report",
    );
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/research/status — check if MiroMind is configured
researchRouter.get("/status", (_req: Request, res: Response) => {
  const available = isDeepResearchAvailable();
  const config = loadConfig();
  res.json({
    success: true,
    data: {
      available,
      model: available ? config.MIROMIND_MODEL : null,
    },
  });
});
