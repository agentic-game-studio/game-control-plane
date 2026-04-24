"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type { TeamConfig } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

interface UseTeamsReturn {
  teams: TeamConfig[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  getTeam: (id: string) => TeamConfig | undefined;
  runTeam: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
  getTeamStatus: (id: string) => Promise<unknown>;
}

export function useTeams(): UseTeamsReturn {
  const [teams, setTeams] = useState<TeamConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeams = useCallback(async () => {
    try {
      const result = await apiFetch<TeamConfig[]>("/api/teams");
      setTeams(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch teams:", err);
      setError(err instanceof Error ? err.message : "Failed to load teams");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "team:started" || event.type === "team:completed") {
        fetchTeams();
      }
    },
    [fetchTeams]
  );

  useWebSocket(onWSEvent);

  const getTeam = useCallback(
    (id: string) => teams.find((t) => t.id === id),
    [teams]
  );

  const runTeam = useCallback(
    async (id: string, params?: Record<string, unknown>) => {
      const result = await apiFetch(`/api/teams/${id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
      });
      return result;
    },
    []
  );

  const getTeamStatus = useCallback(
    async (id: string) => {
      const result = await apiFetch(`/api/teams/${id}/status`);
      return result;
    },
    []
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchTeams();
  }, [fetchTeams]);

  return { teams, loading, error, retry, getTeam, runTeam, getTeamStatus };
}
