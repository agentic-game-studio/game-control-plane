"use client";

import AgentTree from "./components/AgentTree";
import ChatThread from "./components/ChatThread";
import CommandInput from "./components/CommandInput";
import { useCommandRoom } from "@/hooks/useCommandRoom";

export default function ChatPage() {
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
    initialized,
  } = useCommandRoom();

  const handleDecision = (action: string, sender: string) => {
    if (action === "approve") {
      approveAgent(sender);
    } else if (action === "navigate") {
      selectSession(sender === "game-director" ? "game-director" : sender);
    }
  };

  const handleNavigate = (targetSession: string) => {
    selectSession(targetSession);
  };

  const handleAnswer = (questionId: string, selected: string[], customInput?: string) => {
    // Build answer content from selections and custom input
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
      />
      <ChatThread
        messages={currentMessages}
        threadId={threadId}
        threadTitle={threadTitle}
        currentSession={currentSession}
        onDecision={handleDecision}
        onNavigate={handleNavigate}
        onAnswer={handleAnswer}
        onPlanAction={handlePlanAction}
      />
      <CommandInput onSend={executeCommand} />
    </div>
  );
}
