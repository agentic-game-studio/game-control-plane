"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import type { AgentDefinition } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
const logger = createLogger("useAgents");

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

  const fetchAgents = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<AgentDefinition[]>("/api/agents", { signal });
      setAgents(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      logger.error("Failed to fetch agents", { err: err });
      setError(err instanceof Error ? err.message : "Failed to load agents");
    }
  }, []);

  // 14-FH10-unmount-cancel: AbortController-driven initial fetch.
  useAbortableEffect(async (signal) => {
    try {
      await fetchAgents(signal);
    } finally {
      setLoading(false);
    }
  }, [fetchAgents]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "agent:spawned") {
        void fetchAgents();
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
    void fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, error, retry, getAgent };
}
