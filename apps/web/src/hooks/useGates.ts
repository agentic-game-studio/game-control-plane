"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type { GateDefinition } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

interface UseGatesReturn {
  gates: GateDefinition[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  getGate: (id: string) => GateDefinition | undefined;
  runGate: (id: string, context?: Record<string, unknown>) => Promise<unknown>;
}

export function useGates(): UseGatesReturn {
  const [gates, setGates] = useState<GateDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchGates = useCallback(async () => {
    try {
      const result = await apiFetch<GateDefinition[]>("/api/gates");
      setGates(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch gates:", err);
      setError(err instanceof Error ? err.message : "Failed to load gates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGates();
  }, [fetchGates]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "gate:verdict") {
        fetchGates();
      }
    },
    [fetchGates]
  );

  useWebSocket(onWSEvent);

  const getGate = useCallback(
    (id: string) => gates.find((g) => g.id === id),
    [gates]
  );

  const runGate = useCallback(
    async (id: string, context?: Record<string, unknown>) => {
      const result = await apiFetch(`/api/gates/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context || {}),
      });
      return result;
    },
    []
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchGates();
  }, [fetchGates]);

  return { gates, loading, error, retry, getGate, runGate };
}
