"use client";

import { useState, useMemo } from "react";
import { AGENT_TREE, getAgentIcon } from "@/lib/agent-icons";
import type { AgentTreeNode } from "@/lib/agent-icons";
import type { AgentSession } from "@/hooks/useCommandRoom";

interface AgentTreeProps {
  sessions: Map<string, AgentSession>;
  currentSession: string;
  totalProgress: number;
  onSelectSession: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
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

function BackgroundTaskCard({ id, session, onSelect, onClose }: { id: string; session: AgentSession; onSelect?: (sessionId: string) => void; onClose?: (sessionId: string) => void }) {
  const icon = getAgentIcon(session.role);
  const label = session.role.replace(/-/g, "_").toUpperCase();
  const isDone = session.status === "done";
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

/* ─── Main Sidebar ─── */

export default function AgentTree({ sessions, currentSession, totalProgress, onSelectSession, onCloseSession }: AgentTreeProps) {
  const [showHierarchy, setShowHierarchy] = useState(false);
  const entries = useMemo(() => [...sessions.entries()], [sessions]);
  const producerEntry = useMemo(() => entries.find(([, s]) => s.role === "producer"), [entries]);
  const producerSessionId = producerEntry?.[0] ?? "";

  const activeRoles = useMemo(() =>
    entries
      .filter(([, s]) => s.role !== "producer" && s.status === "active")
      .map(([, s]) => s.role),
    [entries]);

  // Background tasks (all non-producer sessions, with their session id)
  const backgroundTasks = useMemo(() =>
    entries.filter(([, s]) => s.role !== "producer"),
    [entries]);

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
                <div className="font-[var(--font-terminal)] text-[10px] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-[#df2b31] border border-black inline-block animate-pulse" />
                  ORCHESTRATOR — ONLINE
                </div>
              </div>
            </button>
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
                  onSelect={onSelectSession}
                  onClose={onCloseSession}
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
        {activeRoles.length > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-[#0055FF] border border-black inline-block" />
              <span className="font-[var(--font-label)] text-xs uppercase font-bold">
                Active: {activeRoles.length}
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
