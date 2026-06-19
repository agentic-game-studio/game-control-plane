"use client";

import { useState, useMemo } from "react";
import { AGENT_TREE, getAgentIcon } from "@/lib/agent-icons";
import type { AgentTreeNode } from "@/lib/agent-icons";
import type { AgentSession, ProducerUIState, SubagentInfo } from "@/hooks/useCommandRoom";
import type { UsageLogEntry } from "@game-studio/types";

interface AgentTreeProps {
  sessions: Map<string, AgentSession>;
  subagents: Map<string, SubagentInfo>;
  currentSession: string;
  totalProgress: number;
  producerState?: ProducerUIState;
  usageLog?: UsageLogEntry[];
  remainingCredits?: number;
  onSelectSession: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
  onSelectSubagent?: (subagent: SubagentInfo) => void;
}

function getSessionCredits(sessionId: string, usageLog?: UsageLogEntry[]): number {
  if (!usageLog) return 0;
  return usageLog
    .filter((entry) => entry.sessionId === sessionId)
    .reduce((sum, entry) => sum + entry.creditsUsed, 0);
}

/* ─── Hierarchy Tree ─── */

function TreeNode({ node, activeRoles }: { node: AgentTreeNode; activeRoles: string[] }) {
  const isActive = activeRoles.includes(node.role);
  const icon = getAgentIcon(node.role);
  const label = node.role.replace(/-/g, "_").toUpperCase();
  const hasChildren = node.children.length > 0;

  if (node.tier === 1) {
    return (
      <div className="mb-2">
        <div className="flex items-center gap-3 mb-4 relative z-10 group">
          <div className={`w-10 h-10 border-2 border-black flex items-center justify-center relative shadow-[4px_4px_0_0_rgba(0,85,255,1)] group-hover:shadow-[2px_2px_0_0_rgba(0,0,0,1)] transition-all ${
            isActive ? "bg-[#0055FF] text-white" : "bg-black text-white"
          }`}>
            <span className="material-symbols-outlined">{icon}</span>
            {isActive && <div className="absolute -right-1 -top-1 w-2 h-2 bg-[#df2b31] border border-black animate-pulse" />}
          </div>
          <div className={`border-2 px-3 py-1 group-hover:bg-[#0055FF] group-hover:text-white transition-colors ${
            isActive ? "bg-[#0055FF] text-white border-black" : "bg-white border-black"
          }`}>
            <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          </div>
        </div>
        {hasChildren && (
          <div className="relative ml-8 z-10">
            {node.children.map((child, i) => {
              const isLast = i === node.children.length - 1;
              return (
                <div key={child.role} className="relative">
                  {!isLast && <div className="absolute left-[11px] top-8 bottom-0 w-[2px] bg-black z-0" />}
                  <TreeNode node={child} activeRoles={activeRoles} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (node.tier === 2) {
    return (
      <div className="relative mb-4">
        <div className="absolute -left-8 top-5 w-8 h-[2px] bg-black" />
        <div className="flex items-center gap-3 group">
          <div className={`w-8 h-8 border-2 border-black flex items-center justify-center text-sm relative ${
            isActive ? "bg-[#0055FF] text-white shadow-[2px_2px_0_0_rgba(0,0,0,1)]" : "bg-white text-black"
          }`}>
            <span className="material-symbols-outlined text-sm">{icon}</span>
            {isActive && <div className="absolute -right-1 -top-1 w-2 h-2 bg-[#df2b31] border border-black animate-pulse" />}
          </div>
          <div className={`border-2 px-2 py-1 ${
            isActive ? "bg-[#0055FF] text-white border-black" : "bg-white border-black"
          }`}>
            <span className="font-[var(--font-label)] text-xs font-bold uppercase">{label}</span>
          </div>
        </div>
        {hasChildren && (
          <div className="relative ml-8 mt-2 z-10">
            {node.children.map((child, i) => {
              const isLast = i === node.children.length - 1;
              return (
                <div key={child.role} className="relative">
                  {!isLast && <div className="absolute left-[7px] top-4 bottom-0 w-[2px] bg-black z-0" />}
                  <TreeNode node={child} activeRoles={activeRoles} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative mb-2 z-10">
      <div className="absolute -left-8 top-3 w-8 h-[2px] bg-black" />
      <div className={`flex items-center gap-2 ${isActive ? "opacity-100" : "opacity-60"} transition-opacity`}>
        <div className={`w-6 h-6 border-2 border-black flex items-center justify-center relative ${
          isActive ? "bg-[#0055FF] text-white" : "bg-[#e7e7f5] text-[#434656]"
        }`}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{icon}</span>
          {isActive && <div className="absolute -right-0.5 -top-0.5 w-1.5 h-1.5 bg-[#df2b31] border border-black animate-pulse" />}
        </div>
        <span className={`font-[var(--font-label)] text-xs ${isActive ? "text-black font-bold" : "text-[#434656]"}`}>{label}</span>
      </div>
      {hasChildren && (
        <div className="relative ml-6 mt-1 z-10">
          {node.children.map((child, i) => {
            const isLast = i === node.children.length - 1;
            return (
              <div key={child.role} className="relative">
                {!isLast && <div className="absolute left-[5px] top-3 bottom-0 w-[2px] bg-black z-0" />}
                <TreeNode node={child} activeRoles={activeRoles} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function filterActiveTree(nodes: AgentTreeNode[], activeRoles: string[]): AgentTreeNode[] {
  return nodes
    .map((node) => {
      const isActive = activeRoles.includes(node.role);
      const filteredChildren = filterActiveTree(node.children, activeRoles);
      if (isActive || filteredChildren.length > 0) return { ...node, children: filteredChildren };
      return null;
    })
    .filter((n): n is AgentTreeNode => n !== null);
}

/* ─── Background Task Card ─── */

function BackgroundTaskCard({ id, session, creditsUsed, onSelect, onClose }: { id: string; session: AgentSession; creditsUsed?: number; onSelect?: (sessionId: string) => void; onClose?: (sessionId: string) => void }) {
  const icon = getAgentIcon(session.role);
  const label = session.role.replace(/-/g, "_").toUpperCase();
  const isDone = session.status === "completed";
  const isActive = session.status === "active";

  return (
    <div
      onClick={() => onSelect?.(id)}
      className={`border-2 border-black p-3 relative cursor-pointer ${isDone ? "bg-[#e7e7f5] opacity-70" : "bg-white hover:bg-[#f3f2ff]"} transition-colors`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 border-2 border-black flex items-center justify-center ${isActive ? "bg-[#0055FF] text-white" : "bg-white text-black"}`}>
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-[var(--font-label)] text-[11px] font-bold uppercase truncate">{label}</div>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 border border-black ${isDone ? "bg-[#737688]" : "bg-[#0055FF] animate-pulse"}`} />
            <span className="font-[var(--font-terminal)] text-[9px] uppercase text-[#737688]">
              {isDone ? "Complete" : isActive ? "Active" : "Idle"}
            </span>
            {creditsUsed !== undefined && creditsUsed > 0 && (
              <span
                className="ml-auto font-[var(--font-terminal)] text-[9px] uppercase text-[#ba061b] border border-[#ba061b] px-1"
                title={`${creditsUsed.toLocaleString()} credits used by this session`}
              >
                -{creditsUsed.toLocaleString()} CR
              </span>
            )}
          </div>
        </div>
        {onClose && (
          <button
            onClick={() => onClose(id)}
            className="w-5 h-5 border border-black flex items-center justify-center text-[10px] hover:bg-[#df2b31] hover:text-white transition-colors"
            title="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      {isActive && session.progress > 0 && (
        <div className="w-full h-2 border border-black bg-white">
          <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${session.progress}%` }} />
        </div>
      )}
    </div>
  );
}

/* ─── Subagent Card ─── */

function SubagentCard({ subagent, onSelect }: { subagent: SubagentInfo; onSelect?: (subagent: SubagentInfo) => void }) {
  const icon = getAgentIcon(subagent.role);
  const label = subagent.role.replace(/-/g, "_").toUpperCase();
  const isDone = subagent.status === "completed";
  const isFailed = subagent.status === "failed";

  return (
    <div
      onClick={() => onSelect?.(subagent)}
      className={`border-2 border-black p-2 relative cursor-pointer ${isDone ? "bg-[#e7f5ec] opacity-80" : isFailed ? "bg-[#f5e7e7] opacity-80" : "bg-white hover:bg-[#f3f2ff]"} transition-colors`}
      title={subagent.task}
    >
      <div className="flex items-center gap-2">
        <div className={`w-6 h-6 border-2 border-black flex items-center justify-center ${isDone ? "bg-[#2ECC71] text-white" : isFailed ? "bg-[#df2b31] text-white" : "bg-[#ededfb] text-black"}`}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate">{label}</div>
          <div className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 border border-black ${isDone ? "bg-[#2ECC71]" : isFailed ? "bg-[#df2b31]" : "bg-[#0055FF] animate-pulse"}`} />
            <span className="font-[var(--font-terminal)] text-[8px] uppercase text-[#737688]">
              {isDone ? "Done" : isFailed ? "Failed" : "Active"}
            </span>
          </div>
        </div>
      </div>
      <div className="font-[var(--font-terminal)] text-[8px] text-[#737688] truncate mt-1">{subagent.task}</div>
    </div>
  );
}

/* ─── Main Sidebar ─── */

export default function AgentTree({ sessions, subagents, currentSession, totalProgress, producerState, usageLog, remainingCredits, onSelectSession, onCloseSession, onSelectSubagent }: AgentTreeProps) {
  const [showHierarchy, setShowHierarchy] = useState(false);
  const entries = useMemo(() => [...sessions.entries()], [sessions]);
  const producerEntry = useMemo(() => entries.find(([, s]) => s.role === "producer"), [entries]);
  const producerSessionId = producerEntry?.[0] ?? "";

  const activeRoles = useMemo(() =>
    entries
      .filter(([, s]) => s.role !== "producer" && s.status === "active")
      .map(([, s]) => s.role),
    [entries]);

  const activeSubagents = useMemo(() =>
    [...subagents.values()].filter((sa) => sa.status === "active"),
    [subagents]);

  const totalActive = activeRoles.length + activeSubagents.length;

  // Background tasks (all non-producer sessions, with their session id)
  const backgroundTasks = useMemo(() =>
    entries.filter(([, s]) => s.role !== "producer"),
    [entries]);

  const activeBackgroundTasks = useMemo(() =>
    backgroundTasks.filter(([, s]) => s.status === "active"),
    [backgroundTasks]);

  const treeData = showHierarchy ? AGENT_TREE : [];

  return (
    <aside className="w-80 border-r-2 border-black bg-white flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-4 border-b-2 border-black bg-[#ededfb] flex justify-between items-center shrink-0">
        <h2 className="font-[var(--font-terminal)] text-lg font-semibold uppercase tracking-tighter">AGENTS</h2>
        <button
          onClick={() => setShowHierarchy((s) => !s)}
          className={`border-2 border-black p-1 retro-press ${showHierarchy ? "bg-[#0055FF] text-white hover:bg-black" : "bg-white hover:bg-black hover:text-white"}`}
          title={showHierarchy ? "Hide Hierarchy" : "Show Hierarchy"}
        >
          <span className="material-symbols-outlined text-base">{showHierarchy ? "unfold_less" : "account_tree"}</span>
        </button>
      </div>

      {/* Scrollable content */}
      <div
        className="flex-1 overflow-y-auto"
        style={{ backgroundImage: "radial-gradient(#d9d9e6 2px, transparent 2px)", backgroundSize: "16px 16px" }}
      >
        {/* Producer — always at top */}
        {producerEntry && (
          <div className="p-4 pb-2">
            <button
              onClick={() => onSelectSession(producerSessionId)}
              className={`w-full flex items-center gap-3 p-3 border-2 border-black transition-colors ${
                currentSession === producerSessionId
                  ? "bg-[#0055FF] text-white shadow-[4px_4px_0_0_rgba(0,0,0,1)]"
                  : "bg-white hover:bg-[#e7e7f5]"
              }`}
            >
              <div className={`w-10 h-10 border-2 border-black flex items-center justify-center shrink-0 ${
                currentSession === producerSessionId ? "bg-black text-white" : "bg-[#0055FF] text-white"
              }`}>
                <span className="material-symbols-outlined">stadia_controller</span>
              </div>
              <div className="text-left flex-1 min-w-0">
                <div className="font-[var(--font-label)] text-xs font-bold uppercase">PRODUCER</div>
                <div className="font-[var(--font-terminal)] text-[10px] flex items-center gap-1.5 flex-wrap">
                  <span
                    className={`w-1.5 h-1.5 border border-black inline-block ${
                      producerState?.mode === "thinking"
                        ? "bg-[#df2b31] animate-pulse"
                        : producerState?.mode === "delegated"
                          ? "bg-[#FF9500]"
                          : "bg-[#2ECC71]"
                    }`}
                  />
                  <span>
                    {producerState?.mode === "thinking"
                      ? "THINKING"
                      : producerState?.mode === "delegated"
                        ? "AVAILABLE · DELEGATED WORK IN FLIGHT"
                        : "AVAILABLE"}
                  </span>
                </div>
                {producerState && (
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span className="px-1.5 py-0.5 border border-black bg-black text-white font-[var(--font-terminal)] text-[9px] uppercase">
                      {producerState.label}
                    </span>
                    {(producerState.activeDelegatedSessions > 0 || producerState.activeDelegatedSubagents > 0) && (
                      <span className="font-[var(--font-terminal)] text-[9px] uppercase opacity-80">
                        {producerState.activeDelegatedSessions} agents · {producerState.activeDelegatedSubagents} subagents
                      </span>
                    )}
                  </div>
                )}
                {producerState && (
                  <div className="font-[var(--font-terminal)] text-[9px] mt-1 opacity-80 line-clamp-2">
                    {producerState.detail}
                  </div>
                )}
              </div>
            </button>
          </div>
        )}

        {(activeBackgroundTasks.length > 0 || activeSubagents.length > 0) && (
          <div className="px-4 pb-3">
            <div className="border-2 border-black bg-[#fffdf7] shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
              <div className="px-3 py-2 border-b-2 border-black bg-[#191b25] text-white flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="material-symbols-outlined text-sm">hub</span>
                  <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.16em]">
                    In Flight
                  </span>
                </div>
                <span className="font-[var(--font-terminal)] text-[10px] uppercase opacity-80">
                  {activeBackgroundTasks.length + activeSubagents.length} active
                </span>
              </div>
              <div className="px-3 py-2 space-y-2">
                {activeBackgroundTasks.slice(0, 3).map(([id, session]) => {
                  const credits = getSessionCredits(id, usageLog);
                  return (
                    <button
                      key={id}
                      onClick={() => onSelectSession(id)}
                      className="w-full flex items-center gap-2 text-left border border-black bg-white px-2 py-1.5 hover:bg-[#f3f2ff] transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">{getAgentIcon(session.role)}</span>
                      <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate flex-1">
                        {session.role.replace(/-/g, "_")}
                      </span>
                      {credits > 0 && (
                        <span
                          className="font-[var(--font-terminal)] text-[9px] uppercase text-[#ba061b] border border-[#ba061b] px-1"
                          title={`${credits.toLocaleString()} credits used`}
                        >
                          -{credits.toLocaleString()}
                        </span>
                      )}
                      <span className="font-[var(--font-terminal)] text-[9px] uppercase text-[#737688]">
                        {session.progress > 0 ? `${session.progress}%` : "running"}
                      </span>
                    </button>
                  );
                })}
                {activeSubagents.slice(0, 2).map((subagent) => (
                  <button
                    key={subagent.id}
                    onClick={() => onSelectSubagent?.(subagent)}
                    className="w-full flex items-center gap-2 text-left border border-black bg-[#f9f8ff] px-2 py-1.5 hover:bg-[#f3f2ff] transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">{getAgentIcon(subagent.role)}</span>
                    <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate flex-1">
                      {subagent.role.replace(/-/g, "_")}
                    </span>
                    <span className="font-[var(--font-terminal)] text-[9px] uppercase text-[#737688]">
                      subagent
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Background Tasks */}
        {backgroundTasks.length > 0 && (
          <div className="px-4 pb-2">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-2">
              Background Tasks ({backgroundTasks.length})
            </span>
            <div className="space-y-2">
              {backgroundTasks.map(([id, session]) => (
                <BackgroundTaskCard
                  key={id}
                  id={id}
                  session={session}
                  creditsUsed={getSessionCredits(id, usageLog)}
                  onSelect={onSelectSession}
                  onClose={onCloseSession}
                />
              ))}
            </div>
          </div>
        )}

        {/* Subagent Tasks */}
        {subagents.size > 0 && (
          <div className="px-4 pb-2">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-2">
              Subagent Tasks ({subagents.size})
            </span>
            <div className="space-y-2">
              {[...subagents.values()].map((sa) => (
                <SubagentCard
                  key={sa.id}
                  subagent={sa}
                  onSelect={onSelectSubagent}
                />
              ))}
            </div>
          </div>
        )}

        {/* Hierarchy Tree (toggleable) */}
        {showHierarchy && (
          <div className="px-4 pb-8 border-t-2 border-black pt-3">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-3">
              Studio Hierarchy
            </span>
            {treeData.map((node) => (
              <TreeNode key={node.role} node={node} activeRoles={activeRoles} />
            ))}
          </div>
        )}

        {!showHierarchy && <div className="pb-8" />}
      </div>

      {/* Status Panel */}
      <div className="border-t-2 border-black bg-[#f3f2ff] p-4 shrink-0">
        {remainingCredits !== undefined && (
          <div className="flex items-center justify-between mb-2 pb-2 border-b-2 border-black/10">
            <span className="font-[var(--font-terminal)] text-[10px] uppercase text-[#434656]">Credits</span>
            <span
              className={`font-[var(--font-mono)] text-xs font-bold tabular-nums ${remainingCredits < 100 ? "text-[#df2b31]" : "text-black"}`}
              title="Remaining credits across subscription and top-up pools"
            >
              {remainingCredits.toLocaleString()} CR
            </span>
          </div>
        )}
        {totalActive > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-[#0055FF] border border-black inline-block" />
              <span className="font-[var(--font-label)] text-xs uppercase font-bold">
                Active: {totalActive}
                {activeSubagents.length > 0 && (
                  <span className="font-normal opacity-70 ml-1">({activeSubagents.length} sub)</span>
                )}
              </span>
            </div>
            <div className="w-full h-2 border-2 border-black bg-white">
              <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${totalProgress}%` }} />
            </div>
            <span className="font-[var(--font-terminal)] text-[10px] uppercase mt-1 block">
              CPU_LOAD: {totalProgress}%
            </span>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#737688] border border-black inline-block" />
            <span className="font-[var(--font-label)] text-xs uppercase text-[#737688]">No agents active</span>
          </div>
        )}
      </div>
    </aside>
  );
}
