"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import type { TicketsBoard, Ticket } from "@game-studio/types";
import { DataLoader } from "@/components/DataLoader";

const statusColors: Record<string, { border: string; bg: string; text: string; label?: string }> = {
  available: {
    border: "border-on-background",
    bg: "bg-surface-container-lowest",
    text: "text-outline",
  },
  in_progress: {
    border: "border-primary-container",
    bg: "bg-surface-container-lowest",
    text: "text-primary-container",
    label: "Active",
  },
  qa: {
    border: "border-tertiary-container",
    bg: "bg-surface-container-lowest",
    text: "text-tertiary-container",
    label: "QA_PENDING",
  },
  completed: {
    border: "border-outline-variant",
    bg: "bg-surface-container-low",
    text: "text-outline",
    label: "Logged",
  },
};

const statusIcons: Record<string, string> = {
  available: "person_add",
  in_progress: "smart_toy",
  qa: "bug_report",
  completed: "done_all",
};

export default function TicketsPage() {
  const [board, setBoard] = useState<TicketsBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    setError(null);
    try {
      const ticketsData = await apiFetch<TicketsBoard>("/api/tickets");
      setBoard(ticketsData);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load tickets";
      setError(message);
      console.error("Failed to fetch tickets data:", err);
    } finally {
      if (isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
  }, [fetchData, retryCount]);

  useEffect(() => {
    if (board) {
      const interval = setInterval(() => fetchData(false), 60000);
      return () => clearInterval(interval);
    }
  }, [board, fetchData]);

  const handleRetry = () => {
    setRetryCount((c) => c + 1);
  };

  return (
    <DataLoader loading={loading} error={error} onRetry={handleRetry}>
      <div className="p-[var(--spacing-margin)] h-full flex flex-col gap-[var(--spacing-margin)] overflow-hidden bg-background">
        {/* Board Header */}
        <div className="flex justify-between items-end border-b-2 border-on-background pb-[var(--spacing-sm)]">
          <div>
            <h1 className="font-[var(--font-headline)] text-5xl font-bold text-on-background uppercase leading-none">
              Active_Quests
            </h1>
            <p className="font-[var(--font-terminal)] text-base text-on-surface-variant uppercase mt-[var(--spacing-xs)]">
              {board ? `${board.sprint} // ${board.milestone}` : "—"}
            </p>
          </div>
          <div className="flex gap-[var(--spacing-md)]">
            <button className="bg-surface-container-lowest text-on-background border-2 border-on-background font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-on-background hover:text-on-primary retro-press transition-all">
              FILTER_LOG
            </button>
            <button className="bg-primary-container text-on-primary border-2 border-on-background font-[var(--font-label)] text-xs font-bold uppercase px-[var(--spacing-md)] py-[var(--spacing-sm)] hover:bg-on-background hover:text-on-primary retro-press transition-all flex items-center gap-[var(--spacing-xs)]">
              <span className="material-symbols-outlined text-base">add</span>
              INIT_QUEST
            </button>
          </div>
        </div>

        {/* Kanban Grid */}
        <div className="flex-grow grid grid-cols-4 gap-[var(--spacing-gutter)] overflow-hidden">
          {board?.columns.map((column) => {
            const colors = statusColors[column.id] ?? statusColors.available;
            return (
              <div
                key={column.id}
                className="flex flex-col gap-[var(--spacing-sm)] h-full border-r-2 border-outline-variant pr-[var(--spacing-gutter)] pb-[var(--spacing-xl)] overflow-y-auto"
              >
                <div className="sticky top-0 bg-background z-10 py-[var(--spacing-xs)] mb-[var(--spacing-sm)] border-b-2 border-on-background flex justify-between items-center">
                  <h3
                    className={`font-[var(--font-headline)] text-2xl font-semibold uppercase ${column.id === "in_progress" ? "text-primary-container" : column.id === "qa" ? "text-tertiary-container" : column.id === "completed" ? "text-outline" : ""}`}
                  >
                    {column.label}
                  </h3>
                  <span
                    className={`font-[var(--font-label)] text-xs font-bold px-2 py-1 ${
                      column.id === "in_progress"
                        ? "bg-primary-container text-on-primary border-2 border-primary-container"
                        : column.id === "qa"
                          ? "bg-tertiary-container text-on-tertiary"
                          : column.id === "completed"
                            ? "bg-surface-variant text-outline border-2 border-outline-variant"
                            : "bg-on-background text-on-primary"
                    }`}
                  >
                    {column.tickets.length}
                  </span>
                </div>

                {column.tickets.map((ticket) => (
                  <TicketCard key={ticket.id} ticket={ticket} colors={colors} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </DataLoader>
  );
}

function TicketCard({
  ticket,
  colors,
}: {
  ticket: Ticket;
  colors: { border: string; bg: string; text: string; label?: string };
}) {
  const icon = statusIcons[ticket.status] ?? "person_add";
  const label = colors.label;

  return (
    <div
      className={`${colors.bg} border-2 ${colors.border} p-[var(--spacing-md)] flex flex-col gap-[var(--spacing-md)] relative group hover:border-primary-container transition-colors cursor-pointer ${
        ticket.status === "in_progress"
          ? "shadow-[4px_4px_0px_#0055ff]"
          : ""
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="font-[var(--font-label)] text-xs font-bold uppercase text-outline flex flex-col">
          <span>
            {ticket.area} &gt; {ticket.subarea}
          </span>
          <span className={`${colors.text} mt-[var(--spacing-xs)]`}>{ticket.title}</span>
        </div>
        <span
          className={`font-[var(--font-terminal)] text-xs px-1 font-bold ${
            ticket.status === "available"
              ? "bg-surface-variant border-2 border-on-background text-on-background"
              : ticket.status === "in_progress"
                ? "bg-primary-container text-on-primary border-2 border-primary-container"
                : ticket.status === "qa"
                  ? "bg-surface-variant border-2 border-on-background text-on-background"
                  : "text-outline"
          }`}
        >
          {ticket.credits}cr
        </span>
      </div>
      <p className="font-[var(--font-body)] text-base line-clamp-3">{ticket.description}</p>
      <div className="flex justify-between items-end mt-auto pt-[var(--spacing-sm)] border-t-2 border-outline-variant">
        <div className="flex items-center gap-[var(--spacing-xs)]">
          <span className="material-symbols-outlined text-outline text-base">{icon}</span>
          <span className={`font-[var(--font-label)] text-xs font-bold uppercase ${colors.text}`}>
            {label ?? (ticket.estimateHours ? `Est. ${ticket.estimateHours}h` : "")}
          </span>
        </div>
        {ticket.status === "available" && (
          <div className="w-8 h-8 border-2 border-on-background border-dashed flex items-center justify-center bg-surface-container-low text-outline">
            <span className="material-symbols-outlined text-base">person_add</span>
          </div>
        )}
        {ticket.assignee && (
          <div className="w-8 h-8 border-2 border-on-background overflow-hidden bg-surface flex items-center justify-center">
            <span className="material-symbols-outlined text-base">smart_toy</span>
          </div>
        )}
      </div>
    </div>
  );
}
