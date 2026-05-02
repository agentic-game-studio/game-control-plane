"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  CONTEXT_CHARS_PER_TOKEN_ESTIMATE,
  PRODUCER_CONTEXT_WINDOW_CHARS,
  PRODUCER_MODEL_CONTEXT_TOKENS,
  countConversationHistoryChars,
  estimateConversationTokensFromHistory,
  producerModelContextFillPercent,
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

export default function ProgressSummary({ activeAgents, producerSessionId }: ProgressSummaryProps) {
  const [tickets, setTickets] = useState<TicketSummary | null>(null);
  const [contextPct, setContextPct] = useState(0);
  const [contextUsedChars, setContextUsedChars] = useState(0);
  const [contextEstTokens, setContextEstTokens] = useState(0);

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const board = await apiFetch<TicketsResponse>(`/api/tickets`);
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
  }, []);

  useEffect(() => {
    if (!producerSessionId) {
      setContextPct(0);
      setContextUsedChars(0);
      setContextEstTokens(0);
      return;
    }

    const fetchProducerContext = async () => {
      try {
        const session = await apiFetch<SessionPayload>(
          `/api/chat/sessions/${encodeURIComponent(producerSessionId)}`
        );
        const usedChars = countConversationHistoryChars(session.conversationHistory);
        setContextUsedChars(usedChars);
        setContextEstTokens(estimateConversationTokensFromHistory(session.conversationHistory));
        setContextPct(producerModelContextFillPercent(session.conversationHistory));
      } catch (err) {
        console.error("[Progress] Failed to fetch producer context:", err);
      }
    };

    fetchProducerContext();
    const interval = setInterval(fetchProducerContext, 10000);
    return () => clearInterval(interval);
  }, [producerSessionId]);

  const contextHint =
    producerSessionId === null
      ? undefined
      : [
          `Producer (glm-5.1 class): ~${contextEstTokens.toLocaleString()} est. tokens / ${PRODUCER_MODEL_CONTEXT_TOKENS.toLocaleString()} (${contextPct}% of model window).`,
          `Estimate: ${contextUsedChars.toLocaleString()} chars ÷ ${CONTEXT_CHARS_PER_TOKEN_ESTIMATE}; not billing-accurate.`,
          `API prune cap: ${PRODUCER_CONTEXT_WINDOW_CHARS.toLocaleString()} chars.`,
        ].join(" ");

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

        <div
          className="flex items-center gap-2 sm:gap-3 shrink-0"
          title={contextHint}
        >
          <span className="text-[#737688] text-[10px] font-[var(--font-terminal)] uppercase tracking-wider whitespace-nowrap">
            Context
          </span>
          <div className="flex items-center gap-2">
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
