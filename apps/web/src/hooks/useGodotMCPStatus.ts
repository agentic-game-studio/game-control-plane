"use client";
import { createLogger } from "../lib/logger";
import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
const logger = createLogger("useGodotMCPStatus");

interface MCPHealthStatus {
  status: "not_running" | "connected" | "disconnected";
  serverRunning?: boolean;
  godotConnected?: boolean;
  projectInfo?: {
    name: string;
    version: string;
    viewport?: { width: number; height: number };
    renderer?: string;
  };
  error?: string;
  message?: string;
}

interface UseGodotMCPStatusOptions {
  /** Polling interval in ms (default: 10000) */
  pollInterval?: number;
  /** Enable polling (default: true) */
  enabled?: boolean;
}

export function useGodotMCPStatus(
  projectId: string | null,
  engine: "godot" | null,
  options: UseGodotMCPStatusOptions = {}
) {
  const { pollInterval = 10000, enabled = true } = options;

  const [status, setStatus] = useState<MCPHealthStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const mountedRef = useRef(true);

  const checkHealth = useCallback(async () => {
    if (!projectId || !engine || engine !== "godot") {
      setStatus(null);
      return;
    }

    // Capture the projectId at request time so an in-flight fetch started for
    // the old projectId can't overwrite the new project's status when the user
    // switches projects. Without this guard, switching projectA → projectB
    // briefly shows projectA's status under projectB's name.
    const requestProjectId = projectId;
    setChecking(true);
    try {
      const result = await apiFetch<{ success: boolean; data: MCPHealthStatus }>(
        `/api/dashboard/projects/${requestProjectId}/mcp-health`
      );
      if (mountedRef.current) {
        setStatus(result.data);
        setLastChecked(new Date());
      }
    } catch (err) {
      logger.error("Failed to check MCP health", { err: err });
      if (mountedRef.current) {
        setStatus({
          status: "disconnected",
          error: err instanceof Error ? err.message : "Failed to check status",
        });
      }
    } finally {
      if (mountedRef.current) {
        setChecking(false);
      }
    }
  }, [projectId, engine]);

  // Initial fetch and polling
  useEffect(() => {
    mountedRef.current = true;
    checkHealth();

    if (enabled && engine === "godot") {
      intervalRef.current = setInterval(checkHealth, pollInterval);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [checkHealth, enabled, engine, pollInterval]);

  const refresh = useCallback(() => {
    checkHealth();
  }, [checkHealth]);

  return {
    status,
    checking,
    lastChecked,
    refresh,
    isConnected: status?.status === "connected",
    isDisconnected: status?.status === "disconnected",
    isNotRunning: status?.status === "not_running",
    error: status?.error,
    projectInfo: status?.projectInfo,
  };
}
