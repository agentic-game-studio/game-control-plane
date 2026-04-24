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
      />
      <CommandInput onSend={executeCommand} />
    </div>
  );
}
