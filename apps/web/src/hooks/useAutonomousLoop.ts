"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "./useWebSocket";
import { apiFetch } from "@/lib/api";
import type { WSEvent, AutonomousRunMetrics } from "@game-studio/types";

// ─── Backend shapes ────────────────────────────────────────────────────────────

interface LoopState {
  projectId: string;
  sessionId: string;
  status: "idle" | "running" | "paused" | "done" | "error";
  startedAt: string;
  lastHeartbeat: string;
  currentIteration: number;
  maxIterations: number;
  currentTicketId?: string;
  currentAgentRole?: string;
  completedCount: number;
  failedCount: number;
  lastError?: string;
}

interface LoopRunRecord {
  runId: string;
  projectId: string;
  startedAt: string;
  completedAt?: string;
  totalIterations: number;
  completedCount: number;
  failedCount: number;
  status: "completed" | "stopped" | "error" | "exhausted";
}

// ─── UI shape ──────────────────────────────────────────────────────────────────

export interface LoopStatus {
  running: boolean;
  sessionId: string | null;
  currentTicketId: string | null;
  currentAgentRole: string | null;
  iteration: number;
  completedCount: number;
  failedCount: number;
  lastError: string | null;
}

export interface LoopRunSummary {
  sessionId: string;
  startedAt: string;
  completedAt?: string;
  completedCount: number;
  failedCount: number;
  totalIterations: number;
  status: LoopRunRecord["status"];
}

function mapStateToStatus(state: LoopState | { status: "not_found" }): LoopStatus {
  if ("status" in state && state.status === "not_found") {
    return {
      running: false,
      sessionId: null,
      currentTicketId: null,
      currentAgentRole: null,
      iteration: 0,
      completedCount: 0,
      failedCount: 0,
      lastError: null,
    };
  }
  return {
    running: state.status === "running",
    sessionId: state.sessionId,
    currentTicketId: state.currentTicketId ?? null,
    currentAgentRole: state.currentAgentRole ?? null,
    iteration: state.currentIteration,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    lastError: state.lastError ?? null,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAutonomousLoop() {
  const [status, setStatus] = useState<LoopStatus>({
    running: false,
    sessionId: null,
    currentTicketId: null,
    currentAgentRole: null,
    iteration: 0,
    completedCount: 0,
    failedCount: 0,
    lastError: null,
  });
  const [metrics, setMetrics] = useState<AutonomousRunMetrics | null>(null);
  const [milestone, setMilestone] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const onWSEvent = useCallback((event: WSEvent) => {
    switch (event.type) {
      case "autonomous:started":
        setStatus((prev) => ({ ...prev, running: true, sessionId: event.sessionId }));
        break;

      case "autonomous:milestone":
        setMilestone(event.milestone);
        break;

      // 25-C-stale-milestone: clear the milestone string on every
      // terminal transition so the UI doesn't show "Phase 1 complete"
      // forever after the loop ends. The `autonomous:milestone` case
      // above sets the state on every milestone event; without an
      // explicit clear in the terminal cases (completed / stopped /
      // error), the last milestone string persists across
      // re-renders and into a subsequent loop's "idle" state. The
      // user sees a stale milestone caption until the next
      // `autonomous:milestone` event lands, which may never happen
      // for a loop that exits cleanly.

      case "autonomous:metrics":
        setMetrics(event.metrics);
        break;

      case "autonomous:iteration:started":
        setStatus((prev) => ({
          ...prev,
          running: true,
          sessionId: event.sessionId,
          currentTicketId: event.ticketId,
          currentAgentRole: event.agentRole,
          iteration: event.iteration,
        }));
        break;

      case "autonomous:iteration:completed":
        setStatus((prev) => ({
          ...prev,
          running: true,
          currentTicketId: null,
          currentAgentRole: null,
          iteration: event.iteration,
          completedCount: event.completedCount,
        }));
        break;

      case "autonomous:iteration:failed":
        setStatus((prev) => ({
          ...prev,
          running: true,
          currentTicketId: null,
          currentAgentRole: null,
          iteration: event.iteration,
          failedCount: prev.failedCount + 1,
          lastError: event.error,
        }));
        break;

      case "autonomous:error":
        setStatus((prev) => ({
          ...prev,
          running: false,
          lastError: event.error,
        }));
        setMilestone(null);
        break;

      case "autonomous:completed":
        setStatus((prev) => ({
          ...prev,
          running: false,
          completedCount: event.completedCount,
          failedCount: event.failedCount,
          iteration: event.totalIterations,
          currentTicketId: null,
          currentAgentRole: null,
        }));
        setMilestone(null);
        break;

      case "autonomous:stopped":
        setStatus((prev) => ({
          ...prev,
          running: false,
          completedCount: event.completedCount,
          failedCount: event.failedCount,
          currentTicketId: null,
          currentAgentRole: null,
        }));
        setMilestone(null);
        break;
    }
  }, []);

  const { connected } = useWebSocket(onWSEvent);

  // Poll status for a given sessionId (call after start)
  const pollStatus = useCallback(async (sessionId: string) => {
    try {
      const res = await apiFetch<LoopState | { status: "not_found" }>(
        `/api/autonomous/status?sessionId=${encodeURIComponent(sessionId)}`
      );
      if (!mountedRef.current) return;
      setStatus(mapStateToStatus(res));
    } catch {
      /* ignore — loop may not have been started */
    }
  }, []);

  const startLoop = useCallback(async (sessionId: string, projectId: string): Promise<string> => {
    const result = await apiFetch<LoopState>("/api/autonomous/start", {
      method: "POST",
      body: JSON.stringify({ sessionId, projectId }),
    });
    if (!mountedRef.current) return result.sessionId;
    const loopSessionId = result.sessionId;
    // Immediately poll to sync UI state with freshly started loop
    await pollStatus(loopSessionId);
    return loopSessionId;
  }, [pollStatus]);

  const stopLoop = useCallback(async (sessionId: string): Promise<void> => {
    await apiFetch("/api/autonomous/stop", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  }, []);

  const getHistory = useCallback(async (): Promise<LoopRunSummary[]> => {
    const result = await apiFetch<LoopRunRecord[]>("/api/autonomous/history");
    return result.map((r) => ({
      sessionId: r.runId,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      completedCount: r.completedCount,
      failedCount: r.failedCount,
      totalIterations: r.totalIterations,
      status: r.status,
    }));
  }, []);

  return { status, metrics, milestone, connected, startLoop, stopLoop, getHistory, pollStatus };
}
