"use client";

import { useState, useEffect } from "react";
import AgentTree from "./components/AgentTree";
import ChatTabs from "./components/ChatTabs";
import ChatThread from "./components/ChatThread";
import CommandInput from "./components/CommandInput";
import QuestionToolbar from "./components/QuestionToolbar";
import ProgressSummary from "./components/ProgressSummary";
import SubagentDrawer from "./components/SubagentDrawer";
import AutonomousControlBar from "./components/AutonomousControlBar";
import InFlightWorkPanel from "./components/InFlightWorkPanel";
import ActivityRail from "./components/ActivityRail";
import NotificationToasts from "./components/NotificationToasts";
import { useCommandRoom } from "@/hooks/useCommandRoom";
import { ProjectGuard } from "@/components/ProjectGuard";
import { useProject } from "@/contexts/ProjectContext";
import { useDialog } from "@/hooks/useDialog";
import { apiFetch } from "@/lib/api";

interface MCPStatus {
  status: "not_running" | "connected" | "disconnected";
  serverRunning?: boolean;
  godotConnected?: boolean;
  error?: string;
}

export default function ChatPage() {
  return (
    <ProjectGuard>
      <ChatPageInner />
    </ProjectGuard>
  );
}

function ChatPageInner() {
  const { currentProject } = useProject();
  const [mcpStatus, setMcpStatus] = useState<MCPStatus | null>(null);
  const [selectedSubagentId, setSelectedSubagentId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = window.localStorage.getItem("studio-chat-focus-mode");
    return saved === null ? true : saved === "true";
  });
  const isGodot = currentProject?.engine === "godot";

  useEffect(() => {
    window.localStorage.setItem("studio-chat-focus-mode", String(focusMode));
  }, [focusMode]);

  // Poll MCP health for Godot projects
  useEffect(() => {
    if (!currentProject?.id || currentProject?.engine !== "godot") {
      setMcpStatus(null);
      return;
    }

    const checkHealth = async () => {
      try {
        const result = await apiFetch<{ success: boolean; data: MCPStatus }>(
          `/api/dashboard/projects/${currentProject.id}/mcp-health`
        );
        setMcpStatus(result.data);
      } catch (err) {
        // Backend restarts or local network hiccups should degrade gracefully
        // without surfacing a noisy dev-overlay error for the chat page.
        setMcpStatus({ status: "disconnected", error: err instanceof Error ? err.message : "Failed to check" });
      }
    };

    // Initial check
    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, [currentProject?.id, currentProject?.engine]);

  const {
    sessions,
    subagents,
    currentSession,
    currentMessages,
    threadId,
    threadTitle,
    totalProgress,
    executeCommand,
    requestProducerAction,
    selectSession,
    approveAgent,
    closeSession,
    closeConsultation,
    initialized,
    connected,
    isLoading,
    messageQueue,
    producerSessionId,
    producerUIState,
    activityFeed,
    toastNotifications,
    dismissToast,
    contextUsageMap,
    contextPressure,
    compactSession,
    compactingSessionId,
  } = useCommandRoom();

  const handleDecision = (action: string, sender: string) => {
    if (action === "approve") {
      approveAgent(sender);
    } else if (action === "navigate") {
      selectSession(sender === "producer" ? producerSessionId : sender);
    } else if (action === "close") {
      closeSession(sender);
    }
  };

  const handleNavigate = (targetSession: string) => {
    selectSession(targetSession);
  };

  const { confirm: showConfirm } = useDialog();

  const handleCloseSession = (sessionId: string) => {
    if (sessionId.startsWith("consultation-")) {
      closeConsultation(sessionId);
    } else {
      closeSession(sessionId);
    }
  };

  const handleAnswer = (questionId: string, selected: string[], customInput?: string) => {
    const parts: string[] = [];
    if (selected.length > 0) {
      parts.push(`Selected: ${selected.join(", ")}`);
    }
    if (customInput) {
      parts.push(`Additional input: ${customInput}`);
    }
    executeCommand(parts.join("\n"));
  };

  const handlePlanAction = (phaseId: string, action: "execute" | "execute-all") => {
    if (action === "execute-all") {
      executeCommand(`Execute all phases of the plan. Start with Phase 1 and proceed sequentially.`);
    } else {
      executeCommand(`Execute phase: ${phaseId}`);
    }
  };

  const requestStopAgentSession = (sessionId: string, role: string, progress: number) => {
    requestProducerAction(
      `[WORK CONTROL] Please review whether we should stop, pause, or de-scope the delegated ${role} session (${sessionId}). Current observed progress is ${progress}%. Do not claim it is cancelled unless the system can truly stop it. Instead, avoid spawning dependent work from it, assess the safest next action, and report back with the decision.`
    );
  };

  const requestPrioritizeAgentSession = (sessionId: string, role: string, progress: number) => {
    requestProducerAction(
      `[WORK CONTROL] Reprioritize the delegated ${role} session (${sessionId}) as a higher priority item. Current observed progress is ${progress}%. Review its latest state, sequence the next supporting work around it, and tell me what changed in the queue.`
    );
  };

  const requestStopSubagent = (role: string, ticketId: string, task: string) => {
    requestProducerAction(
      `[WORK CONTROL] Please review whether we should stop, pause, or de-scope the subagent ${role} on ticket ${ticketId}. Task summary: ${task}. Do not claim the subagent is cancelled unless the runtime supports it. Instead, prevent follow-on work if needed, decide the safest path, and report back.`
    );
  };

  const requestPrioritizeSubagent = (role: string, ticketId: string, task: string) => {
    requestProducerAction(
      `[WORK CONTROL] Prioritize the subagent ${role} on ticket ${ticketId}. Task summary: ${task}. Reorder supporting work around it, monitor for blockers, and report back with the updated priority plan.`
    );
  };

  if (!initialized) {
    return (
      <div className="flex h-full items-center justify-center bg-surface">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-black border-t-primary animate-spin mx-auto mb-4" />
          <span className="font-[var(--font-terminal)] text-sm uppercase text-outline">
            Initializing Board Room...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      <NotificationToasts toasts={toastNotifications} onDismiss={dismissToast} />
      {!focusMode && (
        <AgentTree
          sessions={sessions}
          subagents={subagents}
          currentSession={currentSession}
          totalProgress={totalProgress}
          producerState={producerUIState}
          onSelectSession={selectSession}
          onCloseSession={handleCloseSession}
          onSelectSubagent={(sa) => setSelectedSubagentId(sa.id)}
        />
      )}
      {/* Subagent Detail Drawer */}
      <SubagentDrawer
        subagent={selectedSubagentId ? subagents.get(selectedSubagentId) ?? null : null}
        onClose={() => setSelectedSubagentId(null)}
        onGotoParent={(sessionId) => {
          selectSession(sessionId);
          setSelectedSubagentId(null);
        }}
        onRequestStop={(subagent) => requestStopSubagent(subagent.role, subagent.ticketId, subagent.task)}
        onPrioritize={(subagent) => requestPrioritizeSubagent(subagent.role, subagent.ticketId, subagent.task)}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChatTabs
          sessions={sessions}
          currentSession={currentSession}
          onSelectSession={selectSession}
          onCloseSession={handleCloseSession}
          producerState={producerUIState}
        />
        <div className="shrink-0 border-b-2 border-black bg-[#f7f6ff] px-3 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-[var(--font-label)] text-[10px] font-bold uppercase tracking-[0.16em] text-[#434656]">
              {focusMode ? "Focus Mode" : "Full Layout"}
            </div>
            <div className="font-[var(--font-terminal)] text-[10px] text-[#737688] truncate">
              {focusMode
                ? "Chat-first view. Sidebar and activity rail are hidden by default."
                : "Full orchestration view with agent tree, in-flight work, and activity rail."}
            </div>
          </div>
          <button
            onClick={() => setFocusMode((value) => !value)}
            className={`shrink-0 flex items-center gap-2 border-2 border-black px-3 py-1.5 font-[var(--font-label)] text-[10px] font-bold uppercase transition-colors ${
              focusMode
                ? "bg-black text-white hover:bg-[#0055FF]"
                : "bg-white text-black hover:bg-black hover:text-white"
            }`}
          >
            <span className="material-symbols-outlined text-sm">
              {focusMode ? "center_focus_strong" : "dashboard_customize"}
            </span>
            {focusMode ? "Exit Focus" : "Enter Focus"}
          </button>
        </div>
        <ProgressSummary
          activeAgents={[...sessions.values()].filter(s => s.status === "active" && s.role !== "producer").length}
          producerSessionId={producerSessionId || null}
          currentSession={currentSession}
          contextUsageMap={contextUsageMap}
          contextPressure={contextPressure}
          onCompact={compactSession}
          compactingSessionId={compactingSessionId}
        />
        {currentSession === producerSessionId && producerUIState && producerUIState.mode !== "available" && (
          <ProducerStateBanner producerState={producerUIState} />
        )}
        {!focusMode && currentSession === producerSessionId && (
          <InFlightWorkPanel
            sessions={sessions}
            subagents={subagents}
            onSelectSession={selectSession}
            onSelectSubagent={(sa) => setSelectedSubagentId(sa.id)}
            onRequestStopSession={requestStopAgentSession}
            onPrioritizeSession={requestPrioritizeAgentSession}
            onRequestStopSubagent={(subagent) => requestStopSubagent(subagent.role, subagent.ticketId, subagent.task)}
            onPrioritizeSubagent={(subagent) => requestPrioritizeSubagent(subagent.role, subagent.ticketId, subagent.task)}
          />
        )}
        {/* Autonomous production loop control — rendered below ProgressSummary */}
        <AutonomousControlBar
          projectId={currentProject?.id}
          producerSessionId={producerSessionId}
          onLoopStarted={(sessionId) => selectSession(sessionId)}
        />
        {/* Godot MCP Warning Banner */}
        {isGodot && mcpStatus && mcpStatus.status !== "connected" && (
          <div className="flex items-center gap-3 px-4 py-2 bg-yellow-50 border-b-2 border-yellow-400">
            <span className="material-symbols-outlined text-yellow-600">warning</span>
            <div className="flex-1">
              <span className="font-[var(--font-terminal)] text-sm text-yellow-800">
                {mcpStatus.status === "not_running"
                  ? "Godot MCP service not started. Open the chat to initialize."
                  : "Godot MCP not connected. "}
              </span>
              <span className="font-[var(--font-terminal)] text-xs text-yellow-700 ml-2">
                Open your Godot project in the editor with the MCP plugin enabled.
              </span>
            </div>
          </div>
        )}
        {/* Director Consultation Close Banner */}
        {(() => {
          const directorRoles = ["creative-director", "technical-director", "art-director", "narrative-director", "audio-director"];
          const currentRole = sessions.get(currentSession)?.role;
          if (!currentRole || !directorRoles.includes(currentRole)) return null;
          const roleLabel = currentRole.replace(/-/g, " ").toUpperCase();
          return (
            <div className="flex items-center gap-3 px-4 py-2 bg-[#0055FF] border-b-2 border-black text-white">
              <span className="material-symbols-outlined">chat</span>
              <div className="flex-1">
                <span className="font-[var(--font-terminal)] text-xs font-bold uppercase">
                  {roleLabel} CONSULTATION
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] ml-2 opacity-80">
                  Chat directly with the director. Close when satisfied.
                </span>
              </div>
              <button
                onClick={async () => {
                  if (await showConfirm(`Close ${roleLabel} consultation and send summary back to Producer?`)) {
                    closeConsultation(currentSession);
                  }
                }}
                className="flex items-center gap-1 border-2 border-white bg-white text-[#0055FF] px-3 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white hover:border-black transition-colors"
              >
                <span className="material-symbols-outlined text-sm">check_circle</span>
                Close & Return
              </button>
            </div>
          );
        })()}
        {(() => {
          const session = sessions.get(currentSession);
          if (!session || session.role === "producer" || session.status !== "active") return null;
          const roleLabel = session.role.replace(/-/g, " ").toUpperCase();
          return (
            <div className="flex items-center gap-3 px-4 py-2 bg-[#fff7eb] border-b-2 border-black text-black">
              <span className="material-symbols-outlined">tune</span>
              <div className="flex-1">
                <span className="font-[var(--font-terminal)] text-xs font-bold uppercase">
                  {roleLabel} WORK CONTROLS
                </span>
                <span className="font-[var(--font-terminal)] text-[10px] ml-2 opacity-80">
                  These controls ask Producer to reprioritize or stop this delegated work.
                </span>
              </div>
              <button
                onClick={() => requestPrioritizeAgentSession(currentSession, session.role, session.progress)}
                className="flex items-center gap-1 border-2 border-black bg-[#fff7eb] px-3 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-[#FF9500] transition-colors"
              >
                <span className="material-symbols-outlined text-sm">priority_high</span>
                Prioritize
              </button>
              <button
                onClick={() => requestStopAgentSession(currentSession, session.role, session.progress)}
                className="flex items-center gap-1 border-2 border-black bg-white px-3 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-sm">pause_circle</span>
                Ask Producer To Stop
              </button>
            </div>
          );
        })()}
        <ChatThread
          messages={currentMessages}
          sessions={sessions}
          threadId={threadId}
          threadTitle={threadTitle}
          currentSession={currentSession}
          connected={connected}
          onDecision={handleDecision}
          onNavigate={handleNavigate}
          onAnswer={handleAnswer}
          onPlanAction={handlePlanAction}
          onSamplePrompt={(prompt) => executeCommand(prompt)}
        />
        {/* Sticky Question Toolbar */}
        {(() => {
          // Find most recent unanswered question
          const questionMsg = [...currentMessages].reverse().find(
            (msg) => msg.type === "question" && msg.question
          );
          if (!questionMsg?.question) return null;

          // Check if already answered
          const msgIndex = currentMessages.indexOf(questionMsg);
          const answerMsg = currentMessages.slice(msgIndex + 1).find(
            (m) => m.type === "user" && (m.content.startsWith("Selected:") || m.content.startsWith("Additional input:"))
          );
          if (answerMsg) return null;

          return (
            <QuestionToolbar
              key={questionMsg.question.questionId}
              questionId={questionMsg.question.questionId}
              question={questionMsg.question.question}
              options={questionMsg.question.options}
              allowMultiple={questionMsg.question.allowMultiple}
              onAnswer={handleAnswer}
              disabled={isLoading}
            />
          );
        })()}
      </div>
      {!focusMode && <ActivityRail items={activityFeed} />}
      {currentSession ? (
        <CommandInput
          onSend={executeCommand}
          isLoading={isLoading}
          queueCount={messageQueue.length}
          statusHint={
            currentSession === producerSessionId
              ? producerUIState.mode === "delegated"
                ? "Producer available — other agents are still running"
                : producerUIState.mode === "available"
                  ? "Producer available — ask anything or delegate more work"
                  : undefined
              : undefined
          }
        />
      ) : (
        <AgentStatusBar
          session={sessions.get(currentSession)}
          onClose={() => handleCloseSession(currentSession)}
          onPrioritize={() => {
            const session = sessions.get(currentSession);
            if (!session) return;
            requestPrioritizeAgentSession(currentSession, session.role, session.progress);
          }}
          onRequestStop={() => {
            const session = sessions.get(currentSession);
            if (!session) return;
            requestStopAgentSession(currentSession, session.role, session.progress);
          }}
        />
      )}
    </div>
  );
}

function ProducerStateBanner({
  producerState,
}: {
  producerState: {
    mode: "thinking" | "delegated" | "available";
    label: string;
    detail: string;
    activeDelegatedSessions: number;
    activeDelegatedSubagents: number;
  };
}) {
  const styles = {
    thinking: {
      container: "bg-[#eef4ff] border-b-2 border-[#0055FF]",
      badge: "bg-[#0055FF] text-white border-black animate-pulse",
      icon: "sync",
      iconClass: "text-[#0055FF] animate-spin",
    },
    delegated: {
      container: "bg-[#fff7eb] border-b-2 border-[#FF9500]",
      badge: "bg-[#FF9500] text-black border-black",
      icon: "hub",
      iconClass: "text-[#FF9500]",
    },
    available: {
      container: "bg-[#effaf3] border-b-2 border-[#2ECC71]",
      badge: "bg-[#2ECC71] text-white border-black",
      icon: "check_circle",
      iconClass: "text-[#2ECC71]",
    },
  }[producerState.mode];

  return (
    <div className={`flex items-center gap-3 px-4 py-2 ${styles.container}`}>
      <span className={`material-symbols-outlined ${styles.iconClass}`}>{styles.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-0.5 border font-[var(--font-label)] text-[10px] font-bold uppercase ${styles.badge}`}>
            {producerState.label}
          </span>
          {producerState.activeDelegatedSessions > 0 && (
            <span className="font-[var(--font-terminal)] text-[10px] text-[#434656] uppercase">
              {producerState.activeDelegatedSessions} agent session{producerState.activeDelegatedSessions === 1 ? "" : "s"}
            </span>
          )}
          {producerState.activeDelegatedSubagents > 0 && (
            <span className="font-[var(--font-terminal)] text-[10px] text-[#434656] uppercase">
              {producerState.activeDelegatedSubagents} subagent{producerState.activeDelegatedSubagents === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <p className="font-[var(--font-terminal)] text-[10px] text-[#434656] mt-1">
          {producerState.detail}
        </p>
      </div>
    </div>
  );
}

function AgentStatusBar({
  session,
  onClose,
  onPrioritize,
  onRequestStop,
}: {
  session?: { role: string; status: string; progress: number };
  onClose: () => void;
  onPrioritize: () => void;
  onRequestStop: () => void;
}) {
  const isDone = session?.status === "completed";
  const label = session?.role.replace(/-/g, "_").toUpperCase() ?? "AGENT";

  return (
    <div className="h-14 border-t-2 border-black bg-[#f3f2ff] flex items-center justify-between px-6 shrink-0 z-30">
      <div className="flex items-center gap-3">
        {/* Status icon */}
        <div className={`w-6 h-6 border-2 border-black flex items-center justify-center ${isDone ? "bg-[#2ECC71] text-white" : "bg-[#0055FF] text-white"}`}>
          <span className="material-symbols-outlined text-sm">
            {isDone ? "check_circle" : "smart_toy"}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="font-[var(--font-label)] text-xs font-bold uppercase leading-tight">
            {label}
          </span>
          <span className="font-[var(--font-terminal)] text-[9px] text-[#737688] leading-tight">
            {isDone ? "Task complete — awaiting closure" : "Working autonomously from Producer commands"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!isDone && (
          <>
            <button
              onClick={onPrioritize}
              className="flex items-center gap-1 border-2 border-black bg-[#fff7eb] px-2 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-[#FF9500] transition-colors"
            >
              <span className="material-symbols-outlined text-sm">priority_high</span>
              Prioritize
            </button>
            <button
              onClick={onRequestStop}
              className="flex items-center gap-1 border-2 border-black bg-white px-2 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black hover:text-white transition-colors"
            >
              <span className="material-symbols-outlined text-sm">pause_circle</span>
              Ask Producer To Stop
            </button>
          </>
        )}
        {/* Progress */}
        {!isDone && session?.progress !== undefined && (
          <div className="flex items-center gap-2">
            <span className="font-[var(--font-terminal)] text-[10px] text-[#737688] tabular-nums">
              {session.progress}%
            </span>
            <div className="w-24 h-2 border border-black bg-white">
              <div className="h-full bg-[#0055FF] transition-all duration-500" style={{ width: `${session.progress}%` }} />
            </div>
          </div>
        )}
        {/* Done badge */}
        {isDone && (
          <span className="font-[var(--font-label)] text-[10px] font-bold uppercase bg-[#2ECC71] text-white px-2 py-0.5 border border-black">
            COMPLETE
          </span>
        )}
        {/* Close button */}
        {isDone && (
          <button
            onClick={onClose}
            className="border-2 border-black bg-[#df2b31] text-white px-3 py-1 font-[var(--font-label)] text-[10px] font-bold uppercase hover:bg-black retro-press flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">close</span>
            CLOSE
          </button>
        )}
      </div>
    </div>
  );
}
