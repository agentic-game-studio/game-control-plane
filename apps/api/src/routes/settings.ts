import { Router } from "express";
import type { Request, Response } from "express";
import { readData, writeData, updateData, broadcastEvent } from "../services/data-store.js";
import { logger } from "../utils/logger.js";
import { newId } from "../utils/ids.js";
import type { SettingsConfig, SubscriptionTier } from "@game-studio/types";
import { DEFAULT_SETTINGS, TIER_DEFINITIONS, createDefaultSettings } from "@game-studio/types";
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
  // 31-CR-settings-get-destroy-state: the previous catch-all silently
  // overwrote the on-disk settings with `createDefaultSettings()` on
  // *any* error from the read-check-reset-write. A transient parse
  // failure (the 30-M data-store parse-fail path surfaces
  // "temporarily unavailable" to the caller), a disk-full EIO
  // from writeData, or an unrelated retry-throw from updateData would
  // all destroy the user's tier, topUpHistory, usageLog, and
  // subscription state in a single GET. Distinguish the only
  // legitimate "no file yet" case (ENOENT) from every other failure
  // and only seed defaults in that single case. Every other error
  // bubbles as 500 so the operator sees the real failure and the
  // user's persisted state is preserved.
  try {
    // 23-H-weekly-reset-rmw: route the read-check-reset-write through
    // updateData so the per-file mutex serializes against a concurrent
    // PATCH /api/settings (which already uses updateData properly). The
    // previous shape (readData → checkWeeklyReset → writeData if
    // changed) bypassed the mutex — a concurrent PATCH that read the
    // pre-reset snapshot could be clobbered by the reset's writeData,
    // silently reverting the user's edit, or vice-versa. The
    // `checkWeeklyReset` is now an in-place mutation inside the
    // callback so the reset decision is atomic with the write.
    const data = await updateData<SettingsConfig>("settings.json", (current) => {
      const originalResetAt = current.credits.subscription.resetAt;
      const reset = checkWeeklyReset(current);
      if (reset.credits.subscription.resetAt !== originalResetAt) {
        // Reset happened this call. Broadcast the updated state from
        // the same atomic op so subscribers don't see a half-updated
        // view.
        broadcastEvent({ type: "settings:updated", settings: reset } as WSEvent);
      }
      return reset;
    });
    res.json({ success: true, data });
  } catch (err) {
    // Seed defaults ONLY when the file is genuinely missing. Every
    // other failure (corrupted JSON, EIO, EROFS, parse retry
    // exhaustion) propagates as 500 so the user's persisted state is
    // preserved on the next retry. getOrCreateData already does this
    // for the create-if-missing case, so the seed-and-return path
    // here is reachable only on the very first GET before the data
    // store has ever seen the file.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const fresh = createDefaultSettings();
      await writeData("settings.json", fresh);
      res.json({ success: true, data: fresh });
      return;
    }
    logger.error(
      { err: err instanceof Error ? err.message : String(err), event: "settings_get_failed" },
      "Failed to read settings — preserving on-disk state",
    );
    res.status(500).json({ success: false, error: "Failed to read settings" });
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
        // 31-H-settings-dead-fallback: topUpHistory and usageLog are
        // not in SETTINGS_PATCH_KEYS, so the whitelist filter above
        // has already stripped any client-supplied value for them —
        // `updates.topUpHistory` and `updates.usageLog` are always
        // undefined here. The `...data` spread two lines above
        // already carries them through unchanged, so the
        // `?? data.topUpHistory` fallthrough is a no-op. Drop the
        // dead lines so a future reader doesn't conclude PATCH can
        // mutate these append-only arrays.
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
    const fresh = createDefaultSettings();
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

  // 15-CR-settings-topup-cap: clamp each topup to 100,000 credits.
  // A leaked API_SECRET could otherwise add a billion credits in one
  // request and overflow the persisted JSON. The rate limiter caps the
  // number of topups per minute; this caps the magnitude of each one.
  const MAX_TOPUP = 100_000;
  if (!amount || amount <= 0 || !Number.isFinite(amount) || amount > MAX_TOPUP) {
    res.status(400).json({ success: false, error: `Invalid amount (max ${MAX_TOPUP})` });
    return;
  }

  try {
    // 16-M-topup-history-cap: cap the topUpHistory array. The rate
    // limiter caps topups to 1 per 10s, but over months of use the
    // array still grows unbounded — at the cap of 1/10s, that's 360
    // entries/hour, 8.6k/day, 3M/year. Each topup entry is ~150 bytes,
    // so a year of data is ~500KB of JSON that gets re-serialized on
    // every PATCH /api/settings. Keep the most recent 500 (about
    // 1.4 days at the rate limit) — operators reading the ledger care
    // about recent activity, not year-old history.
    const TOPUP_HISTORY_CAP = 500;
    const updated = await updateData<SettingsConfig>("settings.json", (data) => {
      const newHistory = [
        ...data.topUpHistory,
        {
          id: newId("top"),
          amount,
          timestamp: new Date().toISOString(),
        },
      ];
      if (newHistory.length > TOPUP_HISTORY_CAP) {
        newHistory.splice(0, newHistory.length - TOPUP_HISTORY_CAP);
      }
      return {
        ...data,
        credits: {
          ...data.credits,
          onTop: {
            current: data.credits.onTop.current + amount,
            totalPurchased: data.credits.onTop.totalPurchased + amount,
          },
        },
        topUpHistory: newHistory,
      };
    });

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
        // 20-M-usage-log-cap: mirror the cap that
        // credit-service.ts:54 enforces. Both code paths target the
        // same settings.json usageLog field; without the cap, the
        // alternate route here grows the array unbounded and forces
        // PATCH /api/settings to re-serialize the entire history on
        // every subsequent call. Cap at 500 (one more than credit-
        // service's 499) so the two paths can't disagree about the
        // cap during a transition window.
        usageLog: [
          ...data.usageLog.slice(-499),
          {
            id: newId("use"),
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
