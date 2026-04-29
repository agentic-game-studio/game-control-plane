import { Router } from "express";
import type { Request, Response } from "express";
import { executeGate, getSupportedGates, getGateInfo } from "../services/gate-service.js";
import { broadcast } from "../services/websocket.js";
import { logger } from "../utils/logger.js";
import type { WSEvent } from "@game-studio/types";

export const gatesRouter: Router = Router();

// Track gate verdicts in memory (could be persisted)
const gateVerdicts: Map<string, { verdict: string; details: string; timestamp: string }> = new Map();

// GET /gates — list all gate statuses
gatesRouter.get("/", async (req: Request, res: Response) => {
  const { sessionId } = req.query;
  const supportedGates = getSupportedGates();

  const gates = supportedGates.map((gateId) => {
    const gateKey = `${sessionId || "default"}:${gateId}`;
    const verdict = gateVerdicts.get(gateKey);
    const info = getGateInfo(gateId);

    return {
      gateId,
      verdict: verdict?.verdict ?? null,
      sessionId: sessionId || "default",
      mode: "lean",
      agent: info?.agent ?? "unknown",
      verdictOptions: info?.verdictOptions ?? [],
      timestamp: verdict?.timestamp,
    };
  });

  res.json({ success: true, data: gates });
});

// POST /gates/:gateId/run — run a gate with real LLM
gatesRouter.post("/:gateId/run", async (req: Request, res: Response) => {
  const { sessionId, targetPhase, reviewMode, context } = req.body as {
    sessionId?: string;
    targetPhase?: string;
    reviewMode?: string;
    context?: string;
  };

  const gateId = req.params.gateId as string;
  const effectiveSessionId = sessionId || "default";

  // Check review mode
  if (reviewMode === "solo") {
    const result = {
      gateId,
      verdict: "SKIPPED",
      details: `[${gateId}] skipped — Solo mode (no director gates)`,
      agent: "system",
      timestamp: new Date().toISOString(),
    };
    res.json({ success: true, data: result });
    return;
  }

  // Execute gate with LLM
  res.json({
    success: true,
    data: { gateId, status: "running" },
  });

  try {
    // Add context about target phase if provided
    let gateContext = context || "";
    if (targetPhase) {
      gateContext += `\n\nTarget phase: ${targetPhase}`;
    }

    const result = await executeGate(gateId, effectiveSessionId, gateContext);

    // Store verdict
    const gateKey = `${effectiveSessionId}:${gateId}`;
    gateVerdicts.set(gateKey, {
      verdict: result.verdict,
      details: result.details.slice(0, 500),
      timestamp: result.timestamp,
    });

    // Broadcast verdict event
    broadcast({
      type: "gate:verdict",
      result: {
        gateId: result.gateId,
        verdict: result.verdict,
        details: result.details.slice(0, 200),
        agent: result.agent,
        timestamp: result.timestamp,
      },
      sessionId: effectiveSessionId,
    } as WSEvent);
  } catch (error) {
    logger.error({ gateId, error: error instanceof Error ? error.message : String(error), event: "gate_error" }, "Gate execution failed");
  }
});

// GET /gates/:gateId — get gate info
gatesRouter.get("/:gateId", (req: Request, res: Response) => {
  const gateId = String(req.params.gateId);
  const info = getGateInfo(gateId);

  if (!info) {
    res.status(404).json({ success: false, error: "Gate not found" });
    return;
  }

  res.json({
    success: true,
    data: {
      gateId,
      agent: info.agent,
      verdictOptions: info.verdictOptions,
    },
  });
});
