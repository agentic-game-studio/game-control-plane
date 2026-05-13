"use client";

import { useEffect, useState, useRef } from "react";
import type { ContextUsage } from "@game-studio/types";
import { apiFetch } from "@/lib/api";
import { useProject } from "@/contexts/ProjectContext";
import {
  PRODUCER_MODEL_CONTEXT_TOKENS,
  countConversationHistoryChars,
  estimateConversationTokensFromHistory,
  producerModelContextFillPercent,
  contextFillPercentFromUsage,
} from "@/lib/chat-context";

interface TicketSummary {
  available: number;
  in_progress: number;
  qa: number;
  completed: number;
}

interface ProgressSummaryProps {
  activeAgents: number;
  /** Producer session only — persisted LLM thread for the board-room agent. */
  producerSessionId: string | null;
  /** Currently active session tab (may differ from producer). */
  currentSession?: string | null;
  /** Real-time token usage from WS (keyed by sessionId). */
  contextUsageMap?: Map<string, ContextUsage>;
  /** Context pressure warnings from WS (keyed by sessionId, value = fillPercent). */
  contextPressure?: Map<string, number>;
  /** Compact the given session into a new generation. */
  onCompact?: (sessionId: string) => void;
  /** Session currently being compacted (shows progress bar). */
  compactingSessionId?: string | null;
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

interface SessionPayload {
  conversationHistory?: Array<{ content?: unknown }>;
}

export default function ProgressSummary({ activeAgents, producerSessionId, currentSession, contextUsageMap, contextPressure, onCompact, compactingSessionId }: ProgressSummaryProps) {
  const { currentProjectId } = useProject();
  /** Which session to show context for — active tab, falling back to producer. */
  const targetSession = currentSession || producerSessionId;
  const [tickets, setTickets] = useState<TicketSummary | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const [contextUsedChars, setContextUsedChars] = useState(0);
  const [contextEstTokens, setContextEstTokens] = useState(0);
  const [contextRealTokens, setContextRealTokens] = useState<number | null>(null);
  const [contextWindowTokens, setContextWindowTokens] = useState(PRODUCER_MODEL_CONTEXT_TOKENS);

  // Compacting progress animation
  const [compactPct, setCompactPct] = useState(0);
  const compactIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (compactingSessionId) {
      setCompactPct(0);
      let tick = 0;
      compactIntervalRef.current = setInterval(() => {
        tick++;
        // Ease-out: fast start, slow end — reaches ~90% in 15s, never 100% until done
        setCompactPct(Math.min(90, Math.round(90 * (1 - Math.exp(-tick / 8)))));
      }, 300);
    } else {
      if (compactIntervalRef.current) clearInterval(compactIntervalRef.current);
      setCompactPct(0);
    }
    return () => {
      if (compactIntervalRef.current) clearInterval(compactIntervalRef.current);
    };
  }, [compactingSessionId]);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const query = currentProjectId ? `?projectId=${encodeURIComponent(currentProjectId)}` : "";
        const board = await apiFetch<TicketsResponse>(`/api/tickets${query}`);
        if (board.columns) {
          const summary: TicketSummary = { available: 0, in_progress: 0, qa: 0, completed: 0 };
          board.columns.forEach((col) => {
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
  }, [currentProjectId]);

  useEffect(() => {
    if (!targetSession) {
      setContextPct(0);
      setContextUsedChars(0);
      setContextEstTokens(0);
      setContextRealTokens(null);
      setContextWindowTokens(PRODUCER_MODEL_CONTEXT_TOKENS);
      return;
    }

    // Prefer real WS data when available
    const wsUsage = contextUsageMap?.get(targetSession);
    if (wsUsage) {
      setContextRealTokens(wsUsage.lastInputTokens);
      setContextWindowTokens(wsUsage.contextWindowTokens);
      setContextPct(contextFillPercentFromUsage(wsUsage));
      // Don't zero out estimates — keep as fallback info
      return;
    }

    // Fallback: REST polling with char estimation (only when no WS data)
    setContextRealTokens(null);
    const fetchSessionContext = async () => {
      try {
        const session = await apiFetch<SessionPayload>(
          `/api/chat/sessions/${encodeURIComponent(targetSession)}`
        );
        const usedChars = countConversationHistoryChars(session.conversationHistory);
        setContextUsedChars(usedChars);
        setContextEstTokens(estimateConversationTokensFromHistory(session.conversationHistory));
        setContextPct(producerModelContextFillPercent(session.conversationHistory));
      } catch (err) {
        console.error("[Progress] Failed to fetch session context:", err);
      }
    };

    fetchSessionContext();
    const interval = setInterval(fetchSessionContext, 30000);
    return () => clearInterval(interval);
  }, [targetSession, contextUsageMap]);

  const contextHint =
    targetSession === null
      ? undefined
      : contextRealTokens !== null
        ? [
            `Context: ${contextRealTokens.toLocaleString()} tokens / ${contextWindowTokens.toLocaleString()} (${contextPct}% of model window).`,
            `API-reported token usage. Real-time via WebSocket.`,
          ].join(" ")
        : [
            `~${contextEstTokens.toLocaleString()} est. tokens / ${PRODUCER_MODEL_CONTEXT_TOKENS.toLocaleString()} (${contextPct}% of model window).`,
            `Estimate: ${contextUsedChars.toLocaleString()} chars ÷ 4; not billing-accurate. Send a message for real data.`,
          ].join(" ");

  const isViewingProducer = targetSession === producerSessionId;

  const total = tickets ? tickets.available + tickets.in_progress + tickets.qa + tickets.completed : 0;
  const completionPct = total > 0 ? Math.round((tickets?.completed ?? 0) / total * 100) : 0;
  const pipelineActive = (tickets?.in_progress ?? 0) + (tickets?.qa ?? 0);

  return (
    <div className="shrink-0 min-w-0 max-w-full overflow-x-auto bg-[#1a1a2e] border-b-2 border-[#2a2a4e]">
      <div className="flex items-center gap-x-4 gap-y-2 px-3 sm:px-4 py-2 w-max min-w-full">
        {/* Quests — pipeline + queue only (done % is in Progress) */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider whitespace-nowrap">
            Quests
          </span>
          <div className="flex items-center gap-2 sm:gap-3 text-[10px] sm:text-[11px] font-[var(--font-mono)]">
            <TicketCount
              title="In flight: processing + verify columns"
              label="PIPE"
              count={pipelineActive}
              color="#FF9500"
            />
            <TicketCount title="Available queue" label="QUE" count={tickets?.available ?? 0} color="#0055FF" />
          </div>
        </div>

        <div className="w-px h-5 bg-[#2a2a4e] shrink-0 hidden sm:block" aria-hidden />

        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider">
            Agents
          </span>
          <span className="text-white font-[var(--font-mono)] text-xs">{activeAgents} active</span>
        </div>

        <div className="w-px h-5 bg-[#2a2a4e] shrink-0" aria-hidden />

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider whitespace-nowrap">
            Progress
          </span>
          <div className="flex items-center gap-2">
            <div className="w-16 sm:w-24 h-2 bg-[#2a2a4e] border border-[#3a3a5e] overflow-hidden shrink-0">
              <div
                className="h-full bg-gradient-to-r from-[#0055FF] to-[#2ECC71] transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <span className="text-white font-[var(--font-mono)] text-xs tabular-nums w-[2.5rem] text-right">
              {completionPct}%
            </span>
          </div>
        </div>

        <div className="w-px h-5 bg-[#2a2a4e] shrink-0" aria-hidden />

        {/* Context — shows compacting progress bar when active */}
        <div
          className="flex items-center gap-2 sm:gap-3 shrink-0"
          title={compactingSessionId ? "Summarizing context into new session..." : contextHint}
        >
          <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider whitespace-nowrap">
            Context
          </span>
          <div className="flex items-center gap-2">
            {compactingSessionId ? (
              <>
                <div className="w-16 sm:w-24 h-2 bg-[#2a2a4e] border border-[#AF52FF]/50 overflow-hidden shrink-0">
                  <div
                    className="h-full bg-[#AF52FF] transition-all duration-300 ease-out"
                    style={{ width: `${compactPct}%` }}
                  />
                </div>
                <span className="text-[#AF52FF] font-[var(--font-mono)] text-[10px] uppercase animate-pulse whitespace-nowrap">
                  Compact{compactPct > 0 ? ` ${compactPct}%` : "..."}
                </span>
              </>
            ) : (
              <>
                <div className="w-16 sm:w-24 h-2 bg-[#2a2a4e] border border-[#3a3a5e] overflow-hidden shrink-0">
                  <div
                    className={`h-full transition-all duration-500 ${
                      contextPct >= 90
                        ? "bg-[#df2b31]"
                        : contextPct >= 70
                          ? "bg-[#FF9500]"
                          : "bg-gradient-to-r from-[#AF52FF] to-[#0055FF]"
                    }`}
                    style={{ width: `${contextPct}%` }}
                  />
                </div>
                <span className="text-white font-[var(--font-mono)] text-xs tabular-nums w-[2.5rem] text-right">
                  {contextPct}%
                </span>
                {contextRealTokens !== null && (
                  <span className="text-[#5a5a7a] font-[var(--font-mono)] text-[10px] tabular-nums">
                    {contextRealTokens >= 1000 ? `${(contextRealTokens / 1000).toFixed(1)}k` : contextRealTokens}/{(contextWindowTokens / 1000).toFixed(0)}k
                  </span>
                )}
                {contextPct >= 80 && onCompact && isViewingProducer && producerSessionId && (
                  <button
                    onClick={() => onCompact(producerSessionId)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 border text-[10px] font-[var(--font-mono)] uppercase shrink-0 ${
                      contextPct >= 90
                        ? "bg-[#df2b31] border-[#df2b31] text-white animate-pulse"
                        : "bg-[#FF9500]/20 border-[#FF9500] text-[#FF9500]"
                    }`}
                    title={`Context at ${contextPct}% — compact into new session`}
                  >
                    Compact
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketCount({
  label,
  count,
  color,
  title,
}: {
  label: string;
  count: number;
  color: string;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-1 whitespace-nowrap" title={title}>
      <div className="w-2 h-2 shrink-0 border border-black/20" style={{ backgroundColor: color }} />
      <span className="text-[#a0a0b8] tabular-nums">{count}</span>
      <span className="text-[#4a4a6a] uppercase">{label}</span>
    </div>
  );
}
