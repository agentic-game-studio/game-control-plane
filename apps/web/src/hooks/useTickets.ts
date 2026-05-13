"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useProject } from "@/contexts/ProjectContext";
import type {
  TicketsBoard,
  Ticket,
  UpdateTicketRequest,
  WSEvent,
} from "@game-studio/types";

const DEFAULT_BOARD: TicketsBoard = {
  sprint: "Sprint_01",
  milestone: "Alpha_Milestone",
  columns: [
    { id: "available", label: "Available", tickets: [] },
    { id: "in_progress", label: "Processing", tickets: [] },
    { id: "qa", label: "Verify", tickets: [] },
    { id: "completed", label: "Archived", tickets: [] },
  ],
};

export function useTickets() {
  const { currentProjectId } = useProject();
  const [data, setData] = useState<TicketsBoard>(DEFAULT_BOARD);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const fetchTickets = useCallback(async () => {
    try {
      const query = currentProjectId ? `?projectId=${encodeURIComponent(currentProjectId)}` : "";
      const result = await apiFetch<TicketsBoard>(`/api/tickets${query}`);
      setData(result);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch tickets:", err);
      setError(err instanceof Error ? err.message : "Failed to load quest board");
      setData(DEFAULT_BOARD);
    } finally {
      setLoading(false);
    }
  }, [currentProjectId]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const onWSEvent = useCallback(
    (event: WSEvent) => {
      if (event.type === "ticket:created" || event.type === "ticket:updated" || event.type === "ticket:moved" || event.type === "ticket:deleted") {
        const eventProjectId =
          event.type === "ticket:deleted" ? event.projectId ?? null : event.projectId ?? event.ticket.projectId ?? null;
        if (eventProjectId !== currentProjectId) {
          return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetchTickets();
        }, 300);
      }
    },
    [currentProjectId, fetchTickets]
  );

  useWebSocket(onWSEvent);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const acknowledgeTicket = useCallback(
    async (id: string) => {
      const query = currentProjectId ? `?projectId=${encodeURIComponent(currentProjectId)}` : "";
      const updated = await apiFetch<Ticket>(`/api/tickets/${id}${query}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true, projectId: currentProjectId ?? undefined } as UpdateTicketRequest),
      });
      await fetchTickets();
      return updated;
    },
    [currentProjectId, fetchTickets]
  );

  const retry = useCallback(() => {
    setLoading(true);
    fetchTickets();
  }, [fetchTickets]);

  return {
    data,
    loading,
    error,
    retry,
    acknowledgeTicket,
  };
}
