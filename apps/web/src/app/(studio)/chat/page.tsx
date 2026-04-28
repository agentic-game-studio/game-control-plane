"use client";

import AgentTree from "./components/AgentTree";
import ChatTabs from "./components/ChatTabs";
import ChatThread from "./components/ChatThread";
import CommandInput from "./components/CommandInput";
import { useCommandRoom } from "@/hooks/useCommandRoom";
import { ProjectGuard } from "@/components/ProjectGuard";

export default function ChatPage() {
  return (
    <ProjectGuard>
      <ChatPageInner />
    </ProjectGuard>
  );
}

function ChatPageInner() {
  const {
    sessions,
    currentSession,
    currentMessages,
    threadId,
    threadTitle,
    totalProgress,
    executeCommand,
    selectSession,
    approveAgent,
    closeSession,
    initialized,
    connected,
    isLoading,
  } = useCommandRoom();

  const handleDecision = (action: string, sender: string) => {
    if (action === "approve") {
      approveAgent(sender);
    } else if (action === "navigate") {
      selectSession(sender === "producer" ? "producer" : sender);
    } else if (action === "close") {
      closeSession(sender);
    }
  };

  const handleNavigate = (targetSession: string) => {
    selectSession(targetSession);
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
        currentSession={currentSession}
        totalProgress={totalProgress}
        onSelectSession={selectSession}
        onCloseSession={closeSession}
      />
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChatTabs
          sessions={sessions}
          currentSession={currentSession}
          onSelectSession={selectSession}
          onCloseSession={closeSession}
        />
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
        />
      </div>
      {currentSession === "producer" ? (
        <CommandInput onSend={executeCommand} isLoading={isLoading} />
      ) : (
        <AgentStatusBar session={sessions.get(currentSession)} onClose={() => closeSession(currentSession)} />
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
