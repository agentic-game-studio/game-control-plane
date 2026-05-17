import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, updateData, broadcastEvent } from "../services/data-store.js";
import type { SettingsConfig, SubscriptionTier } from "@game-studio/types";
import { DEFAULT_SETTINGS, TIER_DEFINITIONS } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

const VALID_ENGINES = ["Unity", "Unreal", "Godot"];

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
  const updates = req.body as Partial<SettingsConfig>;

  if (updates.targetEngine && !VALID_ENGINES.includes(updates.targetEngine)) {
    res.status(400).json({ success: false, error: "Invalid target engine" });
    return;
  }

  if (updates.tier && !TIER_DEFINITIONS.some((t) => t.id === updates.tier)) {
    res.status(400).json({ success: false, error: "Invalid subscription tier" });
    return;
  }

  try {
    const updatedSettings = await updateData<SettingsConfig>("settings.json", (data) => ({
      ...data,
      ...updates,
      credits: updates.credits ? { ...data.credits, ...updates.credits } : data.credits,
      topUpHistory: updates.topUpHistory ?? data.topUpHistory,
      usageLog: updates.usageLog ?? data.usageLog,
    }));

    broadcastEvent({ type: "settings:updated", settings: updatedSettings } as WSEvent);
    res.json({ success: true, data: updatedSettings });
  } catch (error) {
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
    res.status(500).json({ success: false, error: "Failed to consume credits" });
  }
});
