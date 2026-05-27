/**
 * Director gate enforcement at autonomous milestone boundaries.
 */

import { executeGate, type GateResult } from "./gate-service.js";
import { broadcast } from "./websocket.js";
import { createFixTicket } from "./quest-bridge.js";
import { externalizeProductionNote } from "./wiki-memory-service.js";
import { fireWebhook } from "./webhook-service.js";
import type { AgentRole, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

/** Gates to run when crossing into milestone index (1=Core, 2=Polish, 3=Ship) */
const MILESTONE_GATES: Record<number, string[]> = {
  1: ["CD-PHASE-GATE", "TD-PHASE-GATE"],
  2: ["PR-MILESTONE", "QL-TEST-COVERAGE"],
  3: ["AD-PHASE-GATE", "PR-PHASE-GATE"],
};

const PASS_VERDICTS = new Set([
  "APPROVE", "READY", "STRONG", "VIABLE", "REALISTIC", "ON_TRACK",
  "ADEQUATE", "FEASIBLE", "CONCEPTS", "CONCERNS", "GAPS", "AT_RISK", "OPTIMISTIC",
]);

const BLOCK_VERDICTS = new Set([
  "REJECT", "NOT_READY", "INFEASIBLE", "INADEQUATE", "UNREALISTIC",
  "OFF_TRACK", "HIGH_RISK", "ERROR", "NOT_SUPPORTED",
]);

export function isGatePassing(verdict: string): boolean {
  const v = verdict.toUpperCase().replace(/\s+/g, "_");
  if (BLOCK_VERDICTS.has(v)) return false;
  if (PASS_VERDICTS.has(v)) return true;
  return !BLOCK_VERDICTS.has(v);
}

export interface MilestoneGateRunResult {
  milestoneIndex: number;
  passed: boolean;
  results: GateResult[];
  blockers: string[];
}

export async function runMilestoneGates(
  milestoneIndex: number,
  sessionId: string,
  projectId: string,
  context: string,
): Promise<MilestoneGateRunResult> {
  const gateIds = MILESTONE_GATES[milestoneIndex] ?? [];
  const results: GateResult[] = [];
  const blockers: string[] = [];

  for (const gateId of gateIds) {
    const result = await executeGate(gateId, sessionId, context);
    results.push(result);

    broadcast({
      type: "gate:verdict",
      result: {
        gateId: result.gateId,
        verdict: result.verdict,
        details: result.details.slice(0, 500),
        agent: result.agent,
        timestamp: result.timestamp,
      },
      sessionId,
    } as WSEvent);

    if (!isGatePassing(result.verdict)) {
      blockers.push(`${gateId}: ${result.verdict}`);
    }
  }

  const passed = blockers.length === 0;
  const summary = passed
    ? `Milestone ${milestoneIndex} gates passed (${gateIds.join(", ")})`
    : `Milestone ${milestoneIndex} blocked: ${blockers.join("; ")}`;

  await externalizeProductionNote(projectId, "milestone-gate", summary);
  void fireWebhook("milestone:gate", { projectId, sessionId, milestoneIndex, passed, blockers });

  if (!passed) {
    await createFixTicket(
      sessionId,
      `milestone-${milestoneIndex}`,
      `Fix milestone ${milestoneIndex} gate blockers`,
      "producer" as AgentRole,
      blockers.join("\n"),
    ).catch((err) => {
      logger.warn({ err, event: "milestone_fix_ticket_failed" }, "Failed to create milestone fix ticket");
    });
  }

  return { milestoneIndex, passed, results, blockers };
}
