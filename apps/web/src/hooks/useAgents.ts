"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type { AgentDefinition } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

interface UseAgentsReturn {
  agents: AgentDefinition[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  getAgent: (name: string) => AgentDefinition | undefined;
}

export function useAgents(): UseAgentsReturn {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    try {
      const result = await apiFetch<AgentDefinition[]>("/api/agents");
      setAgents(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch agents:", err);
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "agent:spawned") {
        fetchAgents();
      }
    },
    [fetchAgents]
  );

  useWebSocket(onWSEvent);

  const getAgent = useCallback(
    (name: string) => agents.find((a) => a.name === name),
    [agents]
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, retry, getAgent };
}
