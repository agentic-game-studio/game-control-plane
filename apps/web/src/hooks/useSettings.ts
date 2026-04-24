"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import {
  DEFAULT_SETTINGS,
  type SettingsConfig,
  type SubscriptionTier,
  type WSEvent,
} from "@game-studio/types";

export function useSettings() {
  const [data, setData] = useState<SettingsConfig>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const result = await apiFetch<SettingsConfig>("/api/settings");
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch settings:", err);
      setError(err instanceof Error ? err.message : "Failed to load settings");
      setData(DEFAULT_SETTINGS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
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
    fetchSettings();
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
