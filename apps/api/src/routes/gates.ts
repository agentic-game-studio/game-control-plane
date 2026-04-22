import { Router } from "express";
import type { Request, Response } from "express";

export const gatesRouter: Router = Router();

// GET /gates — list all gate statuses for a session
gatesRouter.get("/", async (req: Request, res: Response) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  // Return all gate statuses for the session
  const gates = [
    { gateId: "CD-PILLARS", verdict: undefined },
    { gateId: "CD-GDD-ALIGN", verdict: undefined },
    { gateId: "CD-SYSTEMS", verdict: undefined },
    { gateId: "CD-PHASE-GATE", verdict: undefined },
    { gateId: "TD-FEASIBILITY", verdict: undefined },
    { gateId: "TD-ARCHITECTURE", verdict: undefined },
    { gateId: "TD-SYSTEM-BOUNDARY", verdict: undefined },
    { gateId: "TD-PHASE-GATE", verdict: undefined },
    { gateId: "PR-SCOPE", verdict: undefined },
    { gateId: "PR-SPRINT", verdict: undefined },
    { gateId: "PR-MILESTONE", verdict: undefined },
    { gateId: "PR-PHASE-GATE", verdict: undefined },
    { gateId: "LP-CODE-REVIEW", verdict: undefined },
    { gateId: "LP-FEASIBILITY", verdict: undefined },
    { gateId: "QL-STORY-READY", verdict: undefined },
    { gateId: "QL-TEST-COVERAGE", verdict: undefined },
    { gateId: "AD-PHASE-GATE", verdict: undefined },
    { gateId: "AD-ART-BIBLE", verdict: undefined },
  ].map((g) => ({ ...g, sessionId: sessionId as string, mode: "lean" }));

  res.json({ success: true, data: gates });
});

// POST /gates/:gateId/run — run a gate
gatesRouter.post("/:gateId/run", async (req: Request, res: Response) => {
  const { sessionId, targetPhase, reviewMode } = req.body;
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  res.json({
    success: true,
    data: {
      gateId: req.params.gateId,
      verdict: "READY",
      details: "Gate executed",
      timestamp: new Date().toISOString(),
      mode: reviewMode ?? "lean",
    },
  });
});
