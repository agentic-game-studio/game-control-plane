"use client";

import { useMemo } from "react";
import { getAgentIcon } from "@/lib/agent-icons";
import { useProject } from "@/contexts/ProjectContext";
import type { AgentSession } from "@/hooks/useCommandRoom";

interface ChatTabsProps {
  sessions: Map<string, AgentSession>;
  currentSession: string;
  onSelectSession: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
}

export default function ChatTabs({ sessions, currentSession, onSelectSession, onCloseSession }: ChatTabsProps) {
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
}: {
  session: AgentSession;
  isActive: boolean;
  isClosable: boolean;
  onSelect: () => void;
  onClose?: () => void;
}) {
  const icon = getAgentIcon(session.role);
  const label = session.role === "producer" ? "BOARD_ROOM" : session.role.replace(/-/g, "_").toUpperCase();
  const isDone = session.status === "done";

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

      {/* Status dot */}
      <span
        className={`w-2 h-2 border border-black ${
          session.role === "producer"
            ? "bg-[#df2b31] animate-pulse"
            : isDone
            ? "bg-[#737688]"
            : "bg-[#0055FF] animate-pulse"
        }`}
      />

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
