"use client";

import { useMemo } from "react";
import { getAgentIcon } from "@/lib/agent-icons";
import { useProject } from "@/contexts/ProjectContext";
import type { AgentSession, ProducerUIState } from "@/hooks/useCommandRoom";

interface ChatTabsProps {
  sessions: Map<string, AgentSession>;
  currentSession: string;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  producerState?: ProducerUIState;
}

export default function ChatTabs({ sessions, currentSession, onSelectSession, onCloseSession, producerState }: ChatTabsProps) {
  const { currentProject } = useProject();
  const entries = useMemo(() => [...sessions.entries()], [sessions]);
  const producerEntry = entries.find(([, s]) => s.role === "producer");
  const agentEntries = entries.filter(([, s]) => s.role !== "producer");

  return (
    <div className="shrink-0 border-b-2 border-black">
      {/* Project context header */}
      {currentProject && (
        <div className="h-8 px-3 flex items-center bg-black text-white font-[var(--font-terminal)] text-xs uppercase tracking-wider gap-3">
          <span className="material-symbols-outlined text-sm">folder_open</span>
          <span className="font-bold truncate">{currentProject.name}</span>
          <span className="opacity-50">·</span>
          <span className="opacity-70">{currentProject.engine ?? "engine: TBD"}</span>
        </div>
      )}

      <div className="h-12 bg-[#ededfb] flex items-end px-2 gap-1 overflow-x-auto">
        {/* Producer tab — always first */}
        {producerEntry && (
          <TabButton
            session={producerEntry[1]}
            isActive={currentSession === producerEntry[0]}
            isClosable={false}
            onSelect={() => onSelectSession(producerEntry[0])}
            producerState={producerState}
          />
        )}

        {/* Agent session tabs */}
        {agentEntries.map(([id, session]) => (
          <TabButton
            key={id}
            session={session}
            isActive={currentSession === id}
            isClosable={true}
            onSelect={() => onSelectSession(id)}
            onClose={() => onCloseSession(id)}
          />
        ))}
      </div>
    </div>
  );
}

function TabButton({
  session,
  isActive,
  isClosable,
  onSelect,
  onClose,
  producerState,
}: {
  session: AgentSession;
  isActive: boolean;
  isClosable: boolean;
  onSelect: () => void;
  onClose?: () => void;
  producerState?: ProducerUIState;
}) {
  const icon = getAgentIcon(session.role);
  const label = session.role === "producer" ? "BOARD_ROOM" : session.role.replace(/-/g, "_").toUpperCase();
  const isDone = session.status === "done";
  const isProducer = session.role === "producer";
  const statusChip = isProducer
    ? producerState?.mode === "thinking"
      ? "THINKING"
      : producerState?.mode === "delegated"
        ? "IN FLIGHT"
        : "READY"
    : isDone
      ? "DONE"
      : session.status === "active"
        ? "RUNNING"
        : "IDLE";
  const delegatedCount = isProducer
    ? (producerState?.activeDelegatedSessions ?? 0) + (producerState?.activeDelegatedSubagents ?? 0)
    : 0;

  return (
    <button
      onClick={onSelect}
      className={`group relative flex items-center gap-2 px-3 py-2 border-t-2 border-x-2 border-black font-[var(--font-label)] text-xs font-bold uppercase whitespace-nowrap transition-all -mb-[2px] ${
        isActive
          ? "bg-white border-b-white z-10"
          : isDone
          ? "bg-[#e7e7f5] text-[#737688] hover:bg-white"
          : "bg-[#ededfb] hover:bg-white"
      }`}
    >
      <span className="material-symbols-outlined text-sm">{icon}</span>
      <span>{label}</span>

      <span
        className={`px-1.5 py-0.5 border border-black font-[var(--font-terminal)] text-[9px] leading-none ${
          isProducer
            ? producerState?.mode === "thinking"
              ? "bg-[#0055FF] text-white"
              : producerState?.mode === "delegated"
                ? "bg-[#FF9500] text-black"
                : "bg-[#2ECC71] text-white"
            : isDone
              ? "bg-[#737688] text-white"
              : "bg-[#0055FF] text-white"
        }`}
      >
        {statusChip}
      </span>

      {delegatedCount > 0 && (
        <span className="min-w-4 h-4 px-1 border border-black bg-black text-white font-[var(--font-terminal)] text-[9px] leading-[14px] text-center">
          {delegatedCount}
        </span>
      )}

      {/* Close button */}
      {isClosable && (
        <span
          onClick={(e) => {
            e.stopPropagation();
            onClose?.();
          }}
          className="ml-1 w-4 h-4 flex items-center justify-center border border-black text-[10px] opacity-0 group-hover:opacity-100 hover:bg-[#df2b31] hover:text-white transition-all"
          title="Close session"
        >
          ×
        </span>
      )}
    </button>
  );
}
