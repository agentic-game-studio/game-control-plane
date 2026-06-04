/**
 * Credit consumption for LLM agent invocations.
 */

import { updateData, broadcastEvent } from "./data-store.js";
import type { AgentRole, SettingsConfig, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";
import { newId } from "../utils/ids.js";

const AGENT_CREDIT_COST: Partial<Record<AgentRole, number>> = {
  producer: 50,
  "autonomous-producer": 50,
  "creative-director": 40,
  "technical-director": 40,
  "godot-specialist": 25,
  "qa-tester": 15,
  "code-reviewer": 10,
};

const DEFAULT_COST = 20;

// 27-M-usage-log-cap-const: hoist the usageLog slice cap to a
// named constant. The 26th pass established the pattern in
// gateVerdicts / toolsCache (MAX_GATE_VERDICTS, MAX_TOOLS_CACHE_ENTRIES);
// credit-service had a magic 499 inline. The +1 in
// `slice(-499).concat([new])` = 500 total, but the literal was
// uncommented, so a future bump (e.g. to 1000) would need to
// touch the same line twice. Exposed for tests to assert the cap.
const MAX_USAGE_LOG_ENTRIES = 500;

// 27-H-credit-default-warn: log a warning the first time each
// unmapped agent falls back to DEFAULT_COST. The previous behavior
// silently charged 20 credits for 46 of 53 agents — fine for
// current usage (most calls go through producer / godot-specialist
// / code-reviewer), but a misconfigured new agent would silently
// charge 20 credits instead of the expected cost, and a removed
// agent's "decommission" would be invisible. Track the warned
// set so a single agent doesn't spam the log once per call.
const warnedAgents = new Set<AgentRole>();

export async function consumeCreditsForAgent(
  agentRole: AgentRole,
  taskLabel: string,
): Promise<boolean> {
  let creditsUsed = AGENT_CREDIT_COST[agentRole];
  if (creditsUsed === undefined) {
    if (!warnedAgents.has(agentRole)) {
      warnedAgents.add(agentRole);
      logger.warn(
        { agentRole, defaultCost: DEFAULT_COST, event: "agent_credit_cost_unmapped" },
        `No credit cost configured for agent "${agentRole}" — falling back to default ${DEFAULT_COST}. Add an entry to AGENT_CREDIT_COST in credit-service.ts to silence this warning.`,
      );
    }
    creditsUsed = DEFAULT_COST;
  }

  try {
    const updated = await updateData<SettingsConfig>("settings.json", (data) => {
      let remaining = creditsUsed;
      let onTopCurrent = data.credits.onTop.current;
      let subCurrent = data.credits.subscription.current;

      if (onTopCurrent + subCurrent < creditsUsed) {
        throw new Error("Insufficient credits");
      }

      if (onTopCurrent > 0) {
        const deduct = Math.min(onTopCurrent, remaining);
        onTopCurrent -= deduct;
        remaining -= deduct;
      }
      if (remaining > 0) {
        subCurrent = Math.max(0, subCurrent - remaining);
      }

      return {
        ...data,
        credits: {
          ...data.credits,
          subscription: { ...data.credits.subscription, current: subCurrent },
          onTop: { ...data.credits.onTop, current: onTopCurrent },
        },
        usageLog: [
          ...data.usageLog.slice(-(MAX_USAGE_LOG_ENTRIES - 1)),
          {
            // 23-H-predictable-use-id: use newId("use") (128 bits of
            // crypto.randomUUID() entropy, prefixed) instead of
            // `use-${Date.now()}` (timestamp-only, guessable within a
            // millisecond window). Two `consume` calls in the same
            // millisecond for the same agent produced identical IDs —
            // usageLog entries deduplicate by ID, so the second entry
            // overwrote the first. The companion endpoint
            // `settings.ts:308` was already migrated in a prior pass
            // but this file was missed. Mirrors the Q4-6th (tickets),
            // Q5-6th (assets), and 22-M-predictable-build-id fix shape.
            id: newId("use"),
            taskName: `${agentRole}: ${taskLabel.slice(0, 80)}`,
            creditsUsed,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    });

    broadcastEvent({ type: "settings:updated", settings: updated } as WSEvent);
    return true;
  } catch (err) {
    logger.warn(
      { agentRole, error: err instanceof Error ? err.message : String(err), event: "credit_consume_failed" },
      "Credit consumption skipped or failed",
    );
    return false;
  }
}
