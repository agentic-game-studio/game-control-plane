"use client";

import { useState, useEffect } from "react";
import AgentTree from "./components/AgentTree";
import ChatTabs from "./components/ChatTabs";
import ChatThread from "./components/ChatThread";
import CommandInput from "./components/CommandInput";
import QuestionToolbar from "./components/QuestionToolbar";
import ProgressSummary from "./components/ProgressSummary";
import SubagentDrawer from "./components/SubagentDrawer";
import { useCommandRoom } from "@/hooks/useCommandRoom";
import { ProjectGuard } from "@/components/ProjectGuard";
import { useProject } from "@/contexts/ProjectContext";
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
  const isGodot = currentProject?.engine === "godot";

  // Poll MCP health for Godot projects
  useEffect(() => {
    console.log("[Chat] useEffect running, currentProject:", currentProject?.id, "engine:", currentProject?.engine);

    if (!currentProject?.id || currentProject?.engine !== "godot") {
      console.log("[Chat] Not Godot project, skipping MCP check");
      setMcpStatus(null);
      return;
    }

    const checkHealth = async () => {
      try {
        console.log("[Chat] Checking MCP health for:", currentProject.id);
        const result = await apiFetch<{ success: boolean; data: MCPStatus }>(
          `/api/dashboard/projects/${currentProject.id}/mcp-health`
        );
        console.log("[Chat] MCP health result:", JSON.stringify(result.data));
        setMcpStatus(result.data);
      } catch (err) {
        console.error("[Chat] MCP health check failed:", err);
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
    selectSession,
    approveAgent,
    closeSession,
    closeConsultation,
    initialized,
    connected,
    isLoading,
    producerSessionId,
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
      <AgentTree
        sessions={sessions}
        subagents={subagents}
        currentSession={currentSession}
        totalProgress={totalProgress}
        onSelectSession={selectSession}
        onCloseSession={handleCloseSession}
        onSelectSubagent={(sa) => setSelectedSubagentId(sa.id)}
      />
      {/* Subagent Detail Drawer */}
      <SubagentDrawer
        subagent={selectedSubagentId ? subagents.get(selectedSubagentId) ?? null : null}
        onClose={() => setSelectedSubagentId(null)}
        onGotoParent={(sessionId) => {
          selectSession(sessionId);
          setSelectedSubagentId(null);
        }}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChatTabs
          sessions={sessions}
          currentSession={currentSession}
          onSelectSession={selectSession}
          onCloseSession={handleCloseSession}
        />
        <ProgressSummary
          activeAgents={[...sessions.values()].filter(s => s.status === "active" && s.role !== "producer").length}
          producerSessionId={producerSessionId || null}
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
                onClick={() => {
                  if (confirm(`Close ${roleLabel} consultation and send summary back to Producer?`)) {
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
      {currentSession ? (
        <CommandInput onSend={executeCommand} isLoading={isLoading} />
      ) : (
        <AgentStatusBar session={sessions.get(currentSession)} onClose={() => handleCloseSession(currentSession)} />
      )}
    </div>
  );
}

function AgentStatusBar({ session, onClose }: { session?: { role: string; status: string; progress: number }; onClose: () => void }) {
  const isDone = session?.status === "done";
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
