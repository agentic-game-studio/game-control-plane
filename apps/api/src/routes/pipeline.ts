/**
 * Pipeline routes — HTTP surface for `kind: "pipeline"` skill runs.
 *
 *   POST /api/pipeline/start                  → startPipelineRun
 *   POST /api/pipeline/runs/:runId/advance    → advanceFromGate (human /advance past a paused gate)
 *   POST /api/pipeline/runs/:runId/stop       → stopPipelineRun (cancel)
 *   GET  /api/pipeline/runs/:runId            → run-state
 *   GET  /api/pipeline/runs?sessionId=        → runs for a session
 *
 * See services/pipeline-service.ts for the runner. Legacy skill invocation stays
 * on POST /api/skills/:id/invoke (which delegates here only when kind === "pipeline").
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { skills } from "@game-studio/skills";
import { SessionStore } from "@game-studio/state";
import { loadConfig } from "../config.js";
import { readData } from "./../services/data-store.js";
import type { GateMode, SkillDefinition } from "@game-studio/types";
import {
  startPipelineRun,
  advanceFromGate,
  stopPipelineRun,
  getRunAsync,
  listRuns,
} from "../services/pipeline-service.js";

export const pipelineRouter: Router = Router();

const config = loadConfig();
const store = new SessionStore(config.WORKSPACE_DIR);

/**
 * Look up a session in either the SessionStore (autonomous-loop sessions, which
 * are file-per-session under production/session-state) OR the chat-state JSON
 * (chat sessions created via /api/chat/sessions). The two stores are owned by
 * different routes and are NOT kept in sync; the pipeline runs are sessionId-
 * keyed regardless of which store owns the record.
 *
 * Returns true iff some session record exists for sessionId in either store.
 */
async function sessionExists(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  if (await store.get(sessionId)) return true;
  try {
    const chatState = await readData<{ sessions?: Record<string, unknown> }>("chat-state.json");
    return Boolean(chatState?.sessions?.[sessionId]);
  } catch {
    return false;
  }
}

// POST /start — start a pipeline run
pipelineRouter.post("/start", async (req: Request, res: Response) => {
  const { skillName, sessionId, gateMode, projectId, reviewMode, taskArgs } = req.body as {
    skillName?: string;
    sessionId?: string;
    gateMode?: GateMode;
    projectId?: string;
    reviewMode?: string;
    taskArgs?: string;
  };

  if (!skillName) {
    res.status(400).json({ success: false, error: "skillName is required" });
    return;
  }
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const skill = skills[skillName as keyof typeof skills] as SkillDefinition | undefined;
  if (!skill) {
    res.status(404).json({ success: false, error: "Skill not found" });
    return;
  }
  if (skill.kind !== "pipeline") {
    res.status(400).json({ success: false, error: `Skill ${skillName} is not a pipeline (kind !== "pipeline"). Use POST /api/skills/:id/invoke.` });
    return;
  }

  if (!(await sessionExists(sessionId))) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  const run = await startPipelineRun(skill, sessionId, { gateMode, projectId, reviewMode, taskArgs });
  res.json({ success: true, data: run });
});

// POST /runs/:runId/advance — human-approved advance past a paused gate
pipelineRouter.post("/runs/:runId/advance", async (req: Request, res: Response) => {
  const run = await advanceFromGate(req.params.runId as string);
  if (!run) {
    res.status(400).json({ success: false, error: "Run not found or not paused at a gate" });
    return;
  }
  res.json({ success: true, data: run });
});

// POST /runs/:runId/stop — cancel a run
pipelineRouter.post("/runs/:runId/stop", async (req: Request, res: Response) => {
  const run = await stopPipelineRun(req.params.runId as string);
  if (!run) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }
  res.json({ success: true, data: run });
});

// GET /runs/:runId — run-state
pipelineRouter.get("/runs/:runId", async (req: Request, res: Response) => {
  const run = await getRunAsync(req.params.runId as string);
  if (!run) {
    res.status(404).json({ success: false, error: "Run not found" });
    return;
  }
  res.json({ success: true, data: run });
});

// GET /runs?sessionId= — list runs (optionally filtered by session)
pipelineRouter.get("/runs", (req: Request, res: Response) => {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
  res.json({ success: true, data: listRuns(sessionId) });
});
