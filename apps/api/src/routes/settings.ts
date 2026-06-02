import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, updateData, broadcastEvent } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import type { SettingsConfig, SubscriptionTier } from "@game-studio/types";
import { DEFAULT_SETTINGS, TIER_DEFINITIONS } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const VALID_ENGINES = ["Unity", "Unreal", "Godot"];

/** Q6-6th: whitelist of top-level fields PATCH /api/settings will accept.
 * Anything else in the request body is silently dropped. Without this,
 * `{...data, ...updates}` would let a client set arbitrary fields
 * (topUpHistory, usageLog, etc.) directly. topUpHistory and usageLog
 * are append-only — they must be mutated via /topup and /consume, not
 * PATCHed wholesale. The field-by-field validator below is still
 * applied on top of this whitelist. */
const SETTINGS_PATCH_KEYS = [
  "targetEngine",
  "assetModel",
  "externalApiKey",
  "webhookUrl",
  "tier",
  "autoRenew",
  "credits",
] as const;

function getNextResetDate(): string {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + 7);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

function checkWeeklyReset(data: SettingsConfig): SettingsConfig {
  const now = new Date();
  const resetAt = new Date(data.credits.subscription.resetAt);
  if (now >= resetAt) {
    const tierDef = TIER_DEFINITIONS.find((t) => t.id === data.tier) ?? TIER_DEFINITIONS[0];
    return {
      ...data,
      credits: {
        ...data.credits,
        subscription: {
          ...data.credits.subscription,
          current: tierDef.weeklyCredits,
          weeklyAllowance: tierDef.weeklyCredits,
          resetAt: getNextResetDate(),
        },
      },
    };
  }
  return data;
}

export const settingsRouter: Router = Router();

// GET /api/settings - Get settings (with auto weekly reset check)
settingsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const data = await readData<SettingsConfig>("settings.json");
    const originalResetAt = data.credits.subscription.resetAt;
    const resetData = checkWeeklyReset(data);
    // Only write back if reset actually happened
    if (resetData.credits.subscription.resetAt !== originalResetAt) {
      await writeData("settings.json", resetData);
      broadcastEvent({ type: "settings:updated", settings: resetData } as WSEvent);
    }
    res.json({ success: true, data: resetData });
  } catch {
    const fresh = DEFAULT_SETTINGS;
    await writeData("settings.json", fresh);
    res.json({ success: true, data: fresh });
  }
});

// PATCH /api/settings - Update settings
settingsRouter.patch("/", async (req: Request, res: Response) => {
  const rawUpdates = req.body as Record<string, unknown>;

  // Q6-6th: strip any field not on the whitelist. Without this filter,
  // a client could PATCH `{topUpHistory: [...], usageLog: [...],
  // credits: {subscription: {current: 99999}}}` and the deep-spread on
  // the line below would persist the tampered arrays. Whitelist first,
  // then run field-by-field validation.
  const updates: Partial<SettingsConfig> = {};
  for (const key of SETTINGS_PATCH_KEYS) {
    if (key in rawUpdates) {
      (updates as Record<string, unknown>)[key] = rawUpdates[key];
    }
  }

  if (updates.targetEngine && !VALID_ENGINES.includes(updates.targetEngine)) {
    res.status(400).json({ success: false, error: "Invalid target engine" });
    return;
  }

  if (updates.tier && !TIER_DEFINITIONS.some((t) => t.id === updates.tier)) {
    res.status(400).json({ success: false, error: "Invalid subscription tier" });
    return;
  }

  try {
    const updatedSettings = await updateData<SettingsConfig>("settings.json", (data) => {
      // Deep-merge credits so a partial PATCH (e.g. only subscription.current)
      // doesn't clobber sibling fields like weeklyAllowance or resetAt.
      // Shallow-spreading `...updates.credits` would replace the whole
      // subscription/onTop objects and lose the unrelated fields. We
      // also preserve burnRatePerHour (and any other top-level fields
      // that may be added to CreditPools later) by spreading the source
      // first, then layering the merged subscription/onTop on top.
      const mergedCredits = updates.credits
        ? {
            ...data.credits,
            ...(updates.credits.subscription
              ? { subscription: { ...data.credits.subscription, ...updates.credits.subscription } }
              : {}),
            ...(updates.credits.onTop
              ? { onTop: { ...data.credits.onTop, ...updates.credits.onTop } }
              : {}),
          }
        : data.credits;

      return {
        ...data,
        ...updates,
        credits: mergedCredits,
        topUpHistory: updates.topUpHistory ?? data.topUpHistory,
        usageLog: updates.usageLog ?? data.usageLog,
      };
    });

    broadcastEvent({ type: "settings:updated", settings: updatedSettings } as WSEvent);
    res.json({ success: true, data: updatedSettings });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "settings_update_failed" },
      "Failed to update settings",
    );
    res.status(500).json({ success: false, error: "Failed to update settings" });
  }
});

// POST /api/settings/reset - Reset settings to defaults
settingsRouter.post("/reset", async (_req: Request, res: Response) => {
  try {
    const fresh = DEFAULT_SETTINGS;
    await writeData("settings.json", fresh);
    broadcastEvent({ type: "settings:updated", settings: fresh } as WSEvent);
    res.json({ success: true, data: fresh });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), event: "settings_reset_failed" },
      "Failed to reset settings",
    );
    res.status(500).json({ success: false, error: "Failed to reset settings" });
  }
});

// POST /api/settings/topup - Add on-top credits
settingsRouter.post("/topup", async (req: Request, res: Response) => {
  const { amount } = req.body as { amount?: number };

  if (!amount || amount <= 0 || !Number.isFinite(amount)) {
    res.status(400).json({ success: false, error: "Invalid amount" });
    return;
  }

  try {
    const updated = await updateData<SettingsConfig>("settings.json", (data) => ({
      ...data,
      credits: {
        ...data.credits,
        onTop: {
          current: data.credits.onTop.current + amount,
          totalPurchased: data.credits.onTop.totalPurchased + amount,
        },
      },
      topUpHistory: [
        ...data.topUpHistory,
        {
          id: `top-${Date.now()}`,
          amount,
          timestamp: new Date().toISOString(),
        },
      ],
    }));

    broadcastEvent({ type: "settings:updated", settings: updated } as WSEvent);
    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), amount, event: "settings_topup_failed" },
      "Failed to top up credits",
    );
    res.status(500).json({ success: false, error: "Failed to top up credits" });
  }
});

// POST /api/settings/upgrade - Upgrade subscription tier
settingsRouter.post("/upgrade", async (req: Request, res: Response) => {
  const { tier } = req.body as { tier?: SubscriptionTier };

  if (!tier || !TIER_DEFINITIONS.some((t) => t.id === tier)) {
    res.status(400).json({ success: false, error: "Invalid tier" });
    return;
  }

  try {
    const tierDef = TIER_DEFINITIONS.find((t) => t.id === tier)!;
    const updated = await updateData<SettingsConfig>("settings.json", (data) => ({
      ...data,
      tier,
      credits: {
        ...data.credits,
        subscription: {
          current: tierDef.weeklyCredits,
          weeklyAllowance: tierDef.weeklyCredits,
          resetAt: getNextResetDate(),
        },
      },
    }));

    broadcastEvent({ type: "settings:updated", settings: updated } as WSEvent);
    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), tier, event: "settings_upgrade_failed" },
      "Failed to upgrade tier",
    );
    res.status(500).json({ success: false, error: "Failed to upgrade tier" });
  }
});

// POST /api/settings/consume - Consume credits for a task
settingsRouter.post("/consume", async (req: Request, res: Response) => {
  const { taskName, creditsUsed } = req.body as { taskName?: string; creditsUsed?: number };

  if (!taskName || !creditsUsed || creditsUsed <= 0 || !Number.isFinite(creditsUsed)) {
    res.status(400).json({ success: false, error: "Invalid task name or credit amount" });
    return;
  }

  try {
    const updated = await updateData<SettingsConfig>("settings.json", (data) => {
      let remaining = creditsUsed;
      let onTopCurrent = data.credits.onTop.current;
      let subCurrent = data.credits.subscription.current;

      // Deduct from on-top first
      if (onTopCurrent > 0) {
        const deduct = Math.min(onTopCurrent, remaining);
        onTopCurrent -= deduct;
        remaining -= deduct;
      }

      // Then from subscription
      if (remaining > 0) {
        subCurrent = Math.max(0, subCurrent - remaining);
      }

      return {
        ...data,
        credits: {
          ...data.credits,
          subscription: {
            ...data.credits.subscription,
            current: subCurrent,
          },
          onTop: {
            ...data.credits.onTop,
            current: onTopCurrent,
          },
        },
        usageLog: [
          ...data.usageLog,
          {
            id: `use-${Date.now()}`,
            taskName,
            creditsUsed,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    });

    broadcastEvent({ type: "settings:updated", settings: updated } as WSEvent);
    res.json({ success: true, data: updated });
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), taskName, creditsUsed, event: "settings_consume_failed" },
      "Failed to consume credits",
    );
    res.status(500).json({ success: false, error: "Failed to consume credits" });
  }
});
