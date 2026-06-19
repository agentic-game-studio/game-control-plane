"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import {
  DEFAULT_SETTINGS,
  type SettingsConfig,
  type SubscriptionTier,
  type WSEvent,
} from "@game-studio/types";

const logger = createLogger("useSettings");

export function useSettings() {
  const [data, setData] = useState<SettingsConfig>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<SettingsConfig>("/api/settings", { signal });
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      logger.error("Failed to fetch settings", { err: err });
      setError(err instanceof Error ? err.message : "Failed to load settings");
      setData(DEFAULT_SETTINGS);
    }
  }, []);

  // 14-FH10-unmount-cancel
  useAbortableEffect(async (signal) => {
    try {
      await fetchSettings(signal);
    } finally {
      setLoading(false);
    }
  }, [fetchSettings]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "settings:updated") {
        setData(event.settings);
      }
    },
    []
  );

  useWebSocket(onWSEvent);

  const updateSettings = useCallback(
    async (updates: Partial<SettingsConfig>) => {
      const updated = await apiFetch<SettingsConfig>("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setData(updated);
      return updated;
    },
    []
  );

  const resetSettings = useCallback(async () => {
    const result = await apiFetch<SettingsConfig>("/api/settings/reset", {
      method: "POST",
    });
    setData(result);
    return result;
  }, []);

  const topUp = useCallback(async (amount: number) => {
    const result = await apiFetch<SettingsConfig>("/api/settings/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    setData(result);
    return result;
  }, []);

  const upgradeTier = useCallback(async (tier: SubscriptionTier) => {
    const result = await apiFetch<SettingsConfig>("/api/settings/upgrade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    setData(result);
    return result;
  }, []);

  const consumeCredits = useCallback(
    async (taskName: string, creditsUsed: number) => {
      const result = await apiFetch<SettingsConfig>("/api/settings/consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskName, creditsUsed }),
      });
      setData(result);
      return result;
    },
    []
  );

  const retry = useCallback(() => {
    setLoading(true);
    void fetchSettings();
  }, [fetchSettings]);

  return {
    data,
    loading,
    error,
    retry,
    updateSettings,
    resetSettings,
    topUp,
    upgradeTier,
    consumeCredits,
  };
}
