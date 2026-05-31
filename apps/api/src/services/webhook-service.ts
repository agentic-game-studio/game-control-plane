/**
 * Fire webhook notifications from settings.webhookUrl.
 */

import { readData } from "./data-store.js";
import type { SettingsConfig } from "@game-studio/types";
import { logger } from "../utils/logger.js";

export async function fireWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  let webhookUrl: string | undefined;
  try {
    const settings = await readData<SettingsConfig>("settings.json");
    webhookUrl = settings.webhookUrl?.trim();
  } catch {
    return;
  }

  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.warn(
      { event, error: err instanceof Error ? err.message : String(err), event_type: "webhook_failed" },
      "Webhook delivery failed",
    );
  }
}
