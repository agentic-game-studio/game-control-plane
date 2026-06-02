"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import {
  DEFAULT_DATA,
  type DashboardData,
  type Project,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type WSEvent,
} from "@game-studio/types";

export function useDashboard() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);

  const fetchDashboard = useCallback(async () => {
    try {
      const result = await apiFetch<DashboardData>("/api/dashboard");
      if (!mountedRef.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
      // Preserve the previous data on a transient fetch failure — wiping it
      // to DEFAULT_DATA hides already-loaded projects/activity on every
      // momentary backend hiccup. The initial load (when `data === DEFAULT_DATA`)
      // is the only case where we want to leave an empty state.
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.type === "project:created" ||
        event.type === "project:updated" ||
        event.type === "project:deleted"
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchDashboard();
        }, 300);
      }
    },
    [fetchDashboard]
  );

  useWebSocket(onWSEvent);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const createProject = useCallback(
    async (request: CreateProjectRequest) => {
      const newProject = await apiFetch<Project>("/api/dashboard/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      await fetchDashboard();
      return newProject;
    },
    [fetchDashboard]
  );

  const createDemoProject = useCallback(async () => {
    const demoProject = await apiFetch<Project>("/api/dashboard/demo-project", {
      method: "POST",
    });
    await fetchDashboard();
    return demoProject;
  }, [fetchDashboard]);

  const deleteProject = useCallback(
    async (id: string) => {
      await apiFetch(`/api/dashboard/projects/${id}`, {
        method: "DELETE",
      });
      await fetchDashboard();
    },
    [fetchDashboard]
  );

  const updateProject = useCallback(
    async (id: string, updates: UpdateProjectRequest) => {
      const updated = await apiFetch<Project>(`/api/dashboard/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      await fetchDashboard();
      return updated;
    },
    [fetchDashboard]
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchDashboard();
  }, [fetchDashboard]);

  return {
    data,
    loading,
    error,
    retry,
    createProject,
    createDemoProject,
    deleteProject,
    updateProject,
  };
}
