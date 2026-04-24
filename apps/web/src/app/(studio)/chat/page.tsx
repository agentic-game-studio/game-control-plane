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
  } = useCommandRoom();

  const handleDecision = (action: string, sender: string) => {
    if (action === "approve") {
      approveAgent(sender);
    }
  };

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
        onNavigate={selectSession}
      />
      <CommandInput onSend={executeCommand} />
    </div>
  );
}
