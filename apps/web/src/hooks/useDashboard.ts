"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useAbortableEffect } from "./useAbortableEffect";
import { WS_REFETCH_DEBOUNCE_MS } from "@/lib/timing";
import {
  DEFAULT_DATA,
  type DashboardData,
  type Project,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type WSEvent,
} from "@game-studio/types";

const logger = createLogger("useDashboard");

export function useDashboard() {
  const [data, setData] = useState<DashboardData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // 14-FH10-unmount-cancel: pass the AbortSignal into the initial
  // fetch so an unmount cancels the request. The previous
  // mountedRef dance still worked but left a 30s timeout in flight
  // and a queued setState that just got dropped.
  useAbortableEffect(async (signal) => {
    try {
      const result = await apiFetch<DashboardData>("/api/dashboard", { signal });
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      logger.error("Failed to fetch dashboard", { err: err });
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDashboard = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await apiFetch<DashboardData>("/api/dashboard", { signal });
      setData(result);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      logger.error("Failed to fetch dashboard", { err: err });
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }, []);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.type === "project:created" ||
        event.type === "project:updated" ||
        event.type === "project:deleted"
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          // 28-M-use-dashboard-debounce-abort: abort the previous
          // debounced fetch (if any) and install a fresh controller
          // in the ref. The unmount cleanup also aborts the latest.
          debounceControllerRef.current?.abort();
          const controller = new AbortController();
          debounceControllerRef.current = controller;
          void fetchDashboard(controller.signal);
        }, WS_REFETCH_DEBOUNCE_MS);
      }
    },
    [fetchDashboard]
  );

  useWebSocket(onWSEvent);

  // 28-M-use-dashboard-debounce-abort: hold the in-flight debounced
  // fetch controller in a ref and abort it before installing a new
  // one. The previous comment promised cancellation but the local
  // `controller` var was never ref-tracked — nothing could abort
  // it. A burst of `project:*` events fired N parallel GETs that all
  // ran to completion. Now: each new debounced fetch aborts the
  // previous one (and the unmount cleanup aborts the latest).
  const debounceControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceControllerRef.current?.abort();
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
    void fetchDashboard();
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
