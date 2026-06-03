"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import type { SkillName } from "@game-studio/types";
import type { WSEvent } from "@game-studio/types";
const logger = createLogger("useSkills");

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

  const fetchSkills = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<SkillName[]>("/api/skills", { signal });
      setSkills(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      logger.error("Failed to fetch skills", { err: err });
      setError(err instanceof Error ? err.message : "Failed to load skills");
    }
  }, []);

  // 14-FH10-unmount-cancel: same AbortController pattern as the
  // other data hooks.
  useAbortableEffect(async (signal) => {
    try {
      await fetchSkills(signal);
    } finally {
      setLoading(false);
    }
  }, [fetchSkills]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "checkpoint:saved") {
        void fetchSkills();
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
    void fetchSkills();
  }, [fetchSkills]);

  return { skills, loading, error, retry, getSkill, invokeSkill };
}
