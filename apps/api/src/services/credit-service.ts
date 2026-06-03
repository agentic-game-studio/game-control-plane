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

export async function consumeCreditsForAgent(
  agentRole: AgentRole,
  taskLabel: string,
): Promise<boolean> {
  const creditsUsed = AGENT_CREDIT_COST[agentRole] ?? DEFAULT_COST;

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
          ...data.usageLog.slice(-499),
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
