/**
 * gdd.ts — Game Design Document ingestion route (delegates to gdd-ingest-service).
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { ingestGDD } from "../services/gdd-ingest-service.js";
import { ingestProducerSummaryFact } from "../services/producer-summary.js";

export const gddRouter: Router = Router();

gddRouter.post("/ingest", async (req: Request, res: Response) => {
  const { sessionId, projectId } = req.body as { sessionId?: string; projectId?: string };

  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const projectSlug = projectId ?? "default";
  const result = await ingestGDD(sessionId, projectSlug);

  if (!result.gddPath && result.totalItems === 0) {
    res.status(404).json({
      success: false,
      error: "GDD file not found",
    });
    return;
  }

  if (result.errors.length > 0 && result.created === 0) {
    res.status(422).json({ success: false, error: result.errors[0], data: result });
    return;
  }

  void ingestProducerSummaryFact(projectSlug, {
    kind: "gdd_ingested",
    at: new Date().toISOString(),
    detail: `total=${result.totalItems} created=${result.created} skipped=${result.skipped} errors=${result.errors.length}`,
  });

  res.json({
    success: true,
    data: {
      gddPath: result.gddPath,
      sectionsFound: result.sectionsFound,
      totalItems: result.totalItems,
      created: result.created,
      skipped: result.skipped,
      skippedTitles: result.skippedTitles.slice(0, 20),
      errors: result.errors,
      createdTitles: result.createdTitles,
    },
  });
});
