"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { ProjectEngine } from "@game-studio/types";

export interface EngineHealth {
  engine: ProjectEngine;
  healthy: boolean;
}

export interface UseEnginesResult {
  engines: EngineHealth[] | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Fetch the per-engine health snapshot from `/api/engines`.
 * The hook is safe to use in StrictMode because the fetch is gated
 * by a cancellation flag and the request method is GET (safe to retry
 * if the runtime fires it twice).
 */
export function useEngines(): UseEnginesResult {
  const [engines, setEngines] = useState<EngineHealth[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch<{ engines: EngineHealth[] }>("/api/engines");
        if (!cancelled) {
          setEngines(data.engines);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { engines, loading, error };
}
