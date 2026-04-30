"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

interface TicketSummary {
  available: number;
  in_progress: number;
  qa: number;
  completed: number;
}

interface ProgressSummaryProps {
  activeAgents: number;
  totalProgress: number;
}

interface TicketColumn {
  id: string;
  label: string;
  tickets: { id: string; status: string }[];
}

interface TicketsResponse {
  sprint: string;
  milestone: string;
  columns: TicketColumn[];
}

export default function ProgressSummary({ activeAgents, totalProgress }: ProgressSummaryProps) {
  const [tickets, setTickets] = useState<TicketSummary | null>(null);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const result = await apiFetch<{ success: boolean; data: TicketsResponse }>(
          `/api/tickets`
        );
        if (result.data?.columns) {
          const summary: TicketSummary = { available: 0, in_progress: 0, qa: 0, completed: 0 };
          result.data.columns.forEach((col) => {
            if (col.id in summary) {
              summary[col.id as keyof TicketSummary] = col.tickets.length;
            }
          });
          setTickets(summary);
        }
      } catch (err) {
        console.error("[Progress] Failed to fetch tickets:", err);
      }
    };

    fetchTickets();
    const interval = setInterval(fetchTickets, 30000);
    return () => clearInterval(interval);
  }, []);

  const total = tickets ? tickets.available + tickets.in_progress + tickets.qa + tickets.completed : 0;
  const completionPct = total > 0 ? Math.round((tickets?.completed ?? 0) / total * 100) : 0;

  return (
    <div className="shrink-0 px-4 py-2 bg-[#1a1a2e] border-b-2 border-[#2a2a4e] flex items-center gap-6">
      {/* Quest Board Summary */}
      <div className="flex items-center gap-4">
        <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider">
          Quests
        </span>
        <div className="flex items-center gap-3 text-[11px] font-[var(--font-mono)]">
          <TicketCount label="AVAILABLE" count={tickets?.available ?? 0} color="#0055FF" />
          <TicketCount label="ACTIVE" count={tickets?.in_progress ?? 0} color="#FF9500" />
          <TicketCount label="VERIFY" count={tickets?.qa ?? 0} color="#AF52FF" />
          <TicketCount label="DONE" count={tickets?.completed ?? 0} color="#2ECC71" />
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#2a2a4e]" />

      {/* Agents */}
      <div className="flex items-center gap-2">
        <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider">
          Agents
        </span>
        <span className="text-white font-[var(--font-mono)] text-xs">
          {activeAgents} active
        </span>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#2a2a4e]" />

      {/* Progress */}
      <div className="flex items-center gap-3">
        <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider">
          Progress
        </span>
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-[#2a2a4e] border border-[#3a3a5e] overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0055FF] to-[#2ECC71] transition-all duration-500"
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <span className="text-white font-[var(--font-mono)] text-xs tabular-nums">
            {completionPct}%
          </span>
        </div>
      </div>

      {/* Divider */}
      <div className="w-px h-5 bg-[#2a2a4e]" />

      {/* Overall Progress */}
      <div className="flex items-center gap-2">
        <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider">
          Tasks
        </span>
        <div className="flex items-center gap-2">
          <div className="w-24 h-2 bg-[#2a2a4e] border border-[#3a3a5e] overflow-hidden">
            <div
              className="h-full bg-[#df2b31] transition-all duration-500"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
          <span className="text-white font-[var(--font-mono)] text-xs tabular-nums">
            {totalProgress}%
          </span>
        </div>
      </div>
    </div>
  );
}

function TicketCount({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-2 h-2" style={{ backgroundColor: color }} />
      <span className="text-[#a0a0b8]">{count}</span>
      <span className="text-[#4a4a6a]">{label}</span>
    </div>
  );
}
