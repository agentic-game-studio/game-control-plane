"use client";

import { useState, useMemo } from "react";
import { AGENT_TREE, getAgentIcon } from "@/lib/agent-icons";
import type { AgentTreeNode as StudioAgentTreeNode } from "@/lib/agent-icons";
import type { AgentSession, ProducerUIState } from "@/hooks/useCommandRoom";

interface AgentTreeProps {
  sessions: Map<string, AgentSession>;
  currentSession: string;
  totalProgress: number;
  producerState?: ProducerUIState;
  onSelectSession: (sessionId: string) => void;
  onCloseSession?: (sessionId: string) => void;
}

type AgentSidebarView = "sessions" | "hierarchy";

function formatRoleLabel(role: string): string {
  return role.replace(/-/g, "_").toUpperCase();
}

/* ─── Task Card ─── */

function TaskCard({ id, session, onSelect, onClose, indent = 0 }: { id: string; session: AgentSession; onSelect?: (sessionId: string) => void; onClose?: (sessionId: string) => void; indent?: number }) {
  const icon = getAgentIcon(session.role ?? "agent");
  const label = formatRoleLabel(session.role ?? "agent");
  const isDone = session.status === "done";
  const isActive = session.status === "active";

  return (
    <div
      onClick={() => onSelect?.(id)}
      className={`border-2 border-black p-3 relative cursor-pointer ${isDone ? "bg-[#e7e7f5] opacity-70" : "bg-white hover:bg-[#f3f2ff]"} transition-colors`}
      style={{ marginLeft: indent * 16 }}
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
        {onClose && !indent && (
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

/* ─── Studio Hierarchy ─── */

function StudioHierarchyNode({
  node,
  activeRoles,
  selectedRole,
  depth = 0,
}: {
  node: StudioAgentTreeNode;
  activeRoles: Set<string>;
  selectedRole?: string;
  depth?: number;
}) {
  const icon = getAgentIcon(node.role);
  const label = formatRoleLabel(node.role);
  const isActive = activeRoles.has(node.role);
  const isSelected = selectedRole === node.role;
  const hasChildren = node.children.length > 0;

  const cardClassName =
    depth === 0
      ? `flex items-center gap-3 border-2 border-black px-3 py-2.5 shadow-[3px_3px_0_0_rgba(0,0,0,1)] transition-colors ${
          isSelected
            ? "bg-[#0055FF] text-white"
            : isActive
              ? "bg-[#eef3ff]"
              : "bg-white"
        }`
      : depth === 1
        ? `flex items-center gap-2 border-2 border-black px-2.5 py-2 transition-colors ${
            isSelected
              ? "bg-[#0055FF] text-white"
              : isActive
                ? "bg-[#f3f2ff]"
                : "bg-[#fffdf7]"
          }`
        : `flex items-center gap-2 border border-black px-2 py-1.5 transition-colors ${
            isSelected
              ? "bg-[#0055FF] text-white"
              : isActive
                ? "bg-[#eef3ff]"
                : "bg-white"
          }`;

  return (
    <div className={depth === 0 ? "mb-3 last:mb-0" : "mt-2"}>
      <div className="relative">
        {depth > 0 && <div className="absolute -left-3 top-4 h-px w-3 bg-black" />}
        <div className={cardClassName}>
          <div
            className={`flex items-center justify-center border-2 border-black ${
              depth === 0 ? "h-9 w-9" : depth === 1 ? "h-7 w-7" : "h-6 w-6"
            } ${
              isSelected
                ? "bg-black text-white"
                : isActive
                  ? "bg-[#0055FF] text-white"
                  : "bg-white text-black"
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: depth === 0 ? 18 : depth === 1 ? 14 : 12 }}
            >
              {icon}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className={`truncate font-[var(--font-label)] font-bold uppercase ${
              depth === 0 ? "text-[11px]" : "text-[10px]"
            }`}>
              {label}
            </div>
            {depth < 2 && (
              <div className={`mt-0.5 font-[var(--font-terminal)] uppercase ${
                depth === 0 ? "text-[9px]" : "text-[8px]"
              } ${isSelected ? "text-white/80" : "text-[#737688]"}`}>
                {isSelected ? "OPEN SESSION" : isActive ? "ACTIVE IN SIDEBAR" : hasChildren ? `${node.children.length} linked roles` : "STANDBY"}
              </div>
            )}
          </div>
          {(isSelected || isActive) && (
            <span className={`shrink-0 border border-black px-1.5 py-0.5 font-[var(--font-terminal)] text-[8px] uppercase ${
              isSelected
                ? "bg-black text-white"
                : "bg-[#fff36d] text-black"
            }`}>
              {isSelected ? "OPEN" : "LIVE"}
            </span>
          )}
        </div>
      </div>
      {hasChildren && (
        <div className={`${depth === 0 ? "ml-5 pl-4" : "ml-4 pl-3"} border-l-2 border-black/70`}>
          {node.children.map((child) => (
            <StudioHierarchyNode
              key={`${node.role}-${child.role}`}
              node={child}
              activeRoles={activeRoles}
              selectedRole={selectedRole}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Recursive Tree Node ─── */

function SessionTreeNode({
  id,
  session,
  childTasks,
  onSelect,
  onClose,
  indent = 0,
}: {
  id: string;
  session: AgentSession;
  childTasks: Map<string, Array<[string, AgentSession]>>;
  onSelect?: (sessionId: string) => void;
  onClose?: (sessionId: string) => void;
  indent?: number;
}) {
  const children = childTasks.get(id);
  return (
    <div>
      <TaskCard id={id} session={session} onSelect={onSelect} onClose={onClose} indent={indent} />
      {children?.map(([childId, childSession]) => (
        <div key={childId} className="mt-1">
          <SessionTreeNode
            id={childId}
            session={childSession}
            childTasks={childTasks}
            onSelect={onSelect}
            onClose={onClose}
            indent={indent + 1}
          />
        </div>
      ))}
    </div>
  );
}

/* ─── Main Sidebar ─── */

export default function AgentTree({ sessions, currentSession, totalProgress, producerState, onSelectSession, onCloseSession }: AgentTreeProps) {
  const [view, setView] = useState<AgentSidebarView>("sessions");
  const entries = useMemo(() => [...sessions.entries()], [sessions]);
  const producerEntry = useMemo(() => entries.find(([, s]) => s.role === "producer"), [entries]);
  const producerSessionId = producerEntry?.[0] ?? "";
  const currentRole = sessions.get(currentSession)?.role;

  // Build parent-child tree from sessions
  const { rootTasks, childTasks } = useMemo(() => {
    const roots: Array<[string, AgentSession]> = [];
    const children = new Map<string, Array<[string, AgentSession]>>();
    for (const [id, s] of entries) {
      if (s.role === "producer") continue;
      if (s.parentSessionId && sessions.has(s.parentSessionId)) {
        const list = children.get(s.parentSessionId) ?? [];
        list.push([id, s]);
        children.set(s.parentSessionId, list);
      } else {
        roots.push([id, s]);
      }
    }
    return { rootTasks: roots, childTasks: children };
  }, [entries, sessions]);

  const activeCount = useMemo(() =>
    entries.filter(([, s]) => s.role !== "producer" && s.status === "active").length,
    [entries]);

  const inFlightTasks = useMemo(() =>
    entries.filter(([, s]) => s.role !== "producer" && s.status === "active").slice(0, 5),
    [entries]);

  const activeRoles = useMemo(() => {
    const roles = new Set<string>();
    if (producerEntry) roles.add("producer");
    for (const [, session] of entries) {
      if (session.role !== "producer" && session.status === "active") {
        roles.add(session.role);
      }
    }
    return roles;
  }, [entries, producerEntry]);

  return (
    <aside className="w-80 border-r-2 border-black bg-white flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-4 border-b-2 border-black bg-[#ededfb] flex justify-between items-center shrink-0">
        <h2 className="font-[var(--font-terminal)] text-lg font-semibold uppercase tracking-tighter">AGENTS</h2>
        <div className="flex items-center gap-1 border-2 border-black bg-white p-0.5 shadow-[2px_2px_0_0_rgba(0,0,0,1)]">
          <button
            type="button"
            onClick={() => setView("sessions")}
            aria-pressed={view === "sessions"}
            title="Show agent sessions"
            className={`flex items-center gap-1.5 px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase transition-colors ${
              view === "sessions"
                ? "bg-[#191b25] text-white"
                : "text-[#434656] hover:bg-[#f3f2ff]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">hub</span>
            <span>Sessions</span>
          </button>
          <button
            type="button"
            onClick={() => setView("hierarchy")}
            aria-pressed={view === "hierarchy"}
            title="Show studio hierarchy"
            className={`flex items-center gap-1.5 px-2 py-1 font-[var(--font-label)] text-[9px] font-bold uppercase transition-colors ${
              view === "hierarchy"
                ? "bg-[#0055FF] text-white"
                : "text-[#434656] hover:bg-[#f3f2ff]"
            }`}
          >
            <span className="material-symbols-outlined text-sm">account_tree</span>
            <span>Hierarchy</span>
          </button>
        </div>
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
                    {producerState.activeDelegatedSessions > 0 && (
                      <span className="font-[var(--font-terminal)] text-[9px] uppercase opacity-80">
                        {producerState.activeDelegatedSessions} agents
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

        {/* In Flight */}
        {view === "sessions" && inFlightTasks.length > 0 && (
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
                  {inFlightTasks.length} active
                </span>
              </div>
              <div className="px-3 py-2 space-y-2">
                {inFlightTasks.map(([id, session]) => (
                  <button
                    key={id}
                    onClick={() => onSelectSession(id)}
                    className="w-full flex items-center gap-2 text-left border border-black bg-white px-2 py-1.5 hover:bg-[#f3f2ff] transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">{getAgentIcon(session.role)}</span>
                    <span className="font-[var(--font-label)] text-[10px] font-bold uppercase truncate flex-1">
                      {session.role.replace(/-/g, "_")}
                    </span>
                    <span className="font-[var(--font-terminal)] text-[9px] uppercase text-[#737688]">
                      {session.progress > 0 ? `${session.progress}%` : "running"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Agent Sessions Tree */}
        {view === "sessions" && rootTasks.length > 0 && (
          <div className="px-4 pb-2">
            <span className="font-[var(--font-label)] text-[10px] uppercase text-[#434656] tracking-widest block mb-2">
              Agent Sessions ({rootTasks.length + [...childTasks.values()].flat().length})
            </span>
            <div className="space-y-2">
              {rootTasks.map(([id, session]) => (
                <SessionTreeNode
                  key={id}
                  id={id}
                  session={session}
                  childTasks={childTasks}
                  onSelect={onSelectSession}
                  onClose={onCloseSession}
                />
              ))}
            </div>
          </div>
        )}

        {/* Studio Hierarchy */}
        {view === "hierarchy" && (
          <div className="px-4 pb-4">
            <div className="mb-3 border-2 border-black bg-[#fffdf7] px-3 py-2 shadow-[3px_3px_0_0_rgba(0,0,0,1)]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.16em] text-[#191b25]">
                  Studio Hierarchy
                </span>
                <span className="border border-black bg-[#fff36d] px-1.5 py-0.5 font-[var(--font-terminal)] text-[9px] uppercase">
                  {activeRoles.size} live
                </span>
              </div>
              <p className="mt-1 font-[var(--font-terminal)] text-[9px] uppercase text-[#737688]">
                Active roles glow here while the producer card stays pinned above.
              </p>
            </div>
            <div className="space-y-0">
              {AGENT_TREE.map((node) => (
                <StudioHierarchyNode
                  key={node.role}
                  node={node}
                  activeRoles={activeRoles}
                  selectedRole={currentRole}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state — no sessions at all */}
        {view === "sessions" && entries.length === 0 && (
          <div className="px-4 py-6 text-center">
            <div className="border-2 border-black border-dashed p-4 bg-[#f7f6ff]">
              <span className="material-symbols-outlined text-2xl text-[#737688] mb-2 block">hub</span>
              <div className="font-[var(--font-label)] text-[10px] font-bold uppercase text-[#434656] mb-1">
                No Active Sessions
              </div>
              <div className="font-[var(--font-terminal)] text-[9px] text-[#737688]">
                Spawn an agent to see the hierarchy tree here.
              </div>
            </div>
          </div>
        )}

        <div className="pb-8" />
      </div>

      {/* Status Panel */}
      <div className="border-t-2 border-black bg-[#f3f2ff] p-4 shrink-0">
        {activeCount > 0 ? (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-[#0055FF] border border-black inline-block" />
              <span className="font-[var(--font-label)] text-xs uppercase font-bold">
                Active: {activeCount}
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
