import { Router } from "express";
import type { Request, Response } from "express";
import { PROJECT_ENGINES } from "@game-studio/types";
import type { ProjectEngine } from "@game-studio/types";
import { hasEngineAdapter } from "../services/engine-adapter-factory.js";
// Side-effect: register every implemented engine adapter so the factory
// reflects the real runtime capability set.
import "../adapters/index.js";

export interface EngineHealthEntry {
  engine: ProjectEngine;
  healthy: boolean;
}

/**
 * Build the per-engine health snapshot used by both the HTTP endpoint and
 * the route unit tests. Health is derived from whether a runtime adapter is
 * registered for the engine; unimplemented engines (bevy, playcanvas) are
 * reported as not healthy.
 */
export function getEngineHealth(): EngineHealthEntry[] {
  return (PROJECT_ENGINES as readonly ProjectEngine[]).map((engine) => ({
    engine,
    healthy: hasEngineAdapter(engine),
  }));
}

export const enginesRouter: Router = Router();

// GET /api/engines - Return the health status of every known engine.
enginesRouter.get("/", (_req: Request, res: Response) => {
  res.json({ success: true, data: { engines: getEngineHealth() } });
});
