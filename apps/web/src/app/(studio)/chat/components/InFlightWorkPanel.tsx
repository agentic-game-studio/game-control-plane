"use client";

import { useMemo, useState } from "react";
import { getAgentIcon } from "@/lib/agent-icons";
import type { AgentSession, SubagentInfo } from "@/hooks/useCommandRoom";

interface InFlightWorkPanelProps {
  sessions: Map<string, AgentSession>;
  subagents: Map<string, SubagentInfo>;
  onSelectSession: (sessionId: string) => void;
  onSelectSubagent: (subagent: SubagentInfo) => void;
  onRequestStopSession: (sessionId: string, role: string, progress: number) => void;
  onPrioritizeSession: (sessionId: string, role: string, progress: number) => void;
  onRequestStopSubagent: (subagent: SubagentInfo) => void;
  onPrioritizeSubagent: (subagent: SubagentInfo) => void;
}

export default function InFlightWorkPanel({
  sessions,
  subagents,
  onSelectSession,
  onSelectSubagent,
  onRequestStopSession,
  onPrioritizeSession,
  onRequestStopSubagent,
  onPrioritizeSubagent,
}: InFlightWorkPanelProps) {
  const [expanded, setExpanded] = useState(true);

  const activeSessions = useMemo(
    () => [...sessions.entries()].filter(([id, session]) => !id.startsWith("producer-") && id !== "producer" && session.status === "active"),
    [sessions]
  );
  const activeSubagents = useMemo(
    () => [...subagents.values()].filter((subagent) => subagent.status === "active"),
    [subagents]
  );

  if (activeSessions.length === 0 && activeSubagents.length === 0) {
    return null;
  }

  return (
    <div className="shrink-0 border-b-2 border-black bg-[#fcfcff]">
      <div className="px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[#0055FF]">deployed_code</span>
          <div className="min-w-0">
            <div className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.18em] text-[#434656]">
              In-Flight Work
            </div>
            <div className="font-[var(--font-terminal)] text-[10px] text-[#737688]">
              Claude Code-style activity strip for delegated studio work
            </div>
          </div>
        </div>
        <button
          onClick={() => setExpanded((value) => !value)}
          className="flex items-center gap-1 border-2 border-black bg-white px-2 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
        >
          <span className="material-symbols-outlined text-sm">{expanded ? "unfold_less" : "unfold_more"}</span>
          {activeSessions.length + activeSubagents.length} active
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <section className="border-2 border-black bg-white shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
              <div className="px-3 py-2 border-b-2 border-black bg-[#191b25] text-white flex items-center justify-between">
                <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.16em]">
                  Agent Sessions
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] uppercase opacity-80">
                  {activeSessions.length}
                </span>
              </div>
              <div className="divide-y-2 divide-[#ededfb]">
                {activeSessions.length > 0 ? activeSessions.map(([id, session]) => (
                  <div key={id} className="px-3 py-2">
                    <button
                      onClick={() => onSelectSession(id)}
                      className="w-full text-left hover:bg-[#f3f2ff] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 border-2 border-black bg-[#0055FF] text-white flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-sm">{getAgentIcon(session.role)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate">
                              {session.role.replace(/-/g, "_")}
                            </span>
                            <span className="px-1.5 py-0.5 border border-black bg-[#0055FF] text-white font-[var(--font-terminal)] text-[9px] leading-none uppercase">
                              Running
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="flex-1 h-1.5 border border-black bg-white max-w-40">
                              <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${session.progress}%` }} />
                            </div>
                            <span className="font-[var(--font-terminal)] text-[9px] text-[#737688] tabular-nums">
                              {session.progress}%
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => onPrioritizeSession(id, session.role, session.progress)}
                        className="flex-1 border border-black bg-[#fff7eb] px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase hover:bg-[#FF9500] transition-colors"
                      >
                        Prioritize
                      </button>
                      <button
                        onClick={() => onRequestStopSession(id, session.role, session.progress)}
                        className="flex-1 border border-black bg-white px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
                      >
                        Ask Producer To Stop
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="px-3 py-3 font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">
                    No active agent sessions
                  </div>
                )}
              </div>
            </section>

            <section className="border-2 border-black bg-white shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
              <div className="px-3 py-2 border-b-2 border-black bg-[#191b25] text-white flex items-center justify-between">
                <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.16em]">
                  Subagents
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] uppercase opacity-80">
                  {activeSubagents.length}
                </span>
              </div>
              <div className="divide-y-2 divide-[#ededfb]">
                {activeSubagents.length > 0 ? activeSubagents.map((subagent) => (
                  <div key={subagent.id} className="px-3 py-2">
                    <button
                      onClick={() => onSelectSubagent(subagent)}
                      className="w-full text-left hover:bg-[#f8f7ff] transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 border-2 border-black bg-[#fff7eb] text-black flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-sm">{getAgentIcon(subagent.role)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate">
                              {subagent.role.replace(/-/g, "_")}
                            </span>
                            <span className="px-1.5 py-0.5 border border-black bg-[#FF9500] text-black font-[var(--font-terminal)] text-[9px] leading-none uppercase">
                              In Flight
                            </span>
                          </div>
                          <div className="mt-1 font-[var(--font-terminal)] text-[10px] text-[#737688] truncate">
                            {subagent.task}
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        onClick={() => onPrioritizeSubagent(subagent)}
                        className="flex-1 border border-black bg-[#fff7eb] px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase hover:bg-[#FF9500] transition-colors"
                      >
                        Prioritize
                      </button>
                      <button
                        onClick={() => onRequestStopSubagent(subagent)}
                        className="flex-1 border border-black bg-white px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
                      >
                        Ask Producer To Stop
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="px-3 py-3 font-[var(--font-terminal)] text-[10px] uppercase text-[#737688]">
                    No active subagents
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
