"use client";

import { useState, useCallback, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type { SkillName } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";

interface UseSkillsReturn {
  skills: SkillName[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  getSkill: (id: string) => SkillName | undefined;
  invokeSkill: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export function useSkills(): UseSkillsReturn {
  const [skills, setSkills] = useState<SkillName[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      const result = await apiFetch<SkillName[]>("/api/skills");
      setSkills(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
      setError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "checkpoint:saved") {
        fetchSkills();
      }
    },
    [fetchSkills]
  );

  useWebSocket(onWSEvent);

  const getSkill = useCallback(
    (id: string) => skills.find((s) => s === id),
    [skills]
  );

  const invokeSkill = useCallback(
    async (id: string, params?: Record<string, unknown>) => {
      const result = await apiFetch(`/api/skills/${id}/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
      });
      return result;
    },
    []
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchSkills();
  }, [fetchSkills]);

  return { skills, loading, error, retry, getSkill, invokeSkill };
}
