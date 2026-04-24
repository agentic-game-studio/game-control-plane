"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import type { WSEvent } from "@game-studio/types";

export interface DiffBlock {
  filePath: string;
  hunks: { lines: string[]; type: "add" | "remove" | "context"; lineNum?: number }[];
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  status: string;
  result?: string;
}

// Normalize tool calls from backend format to frontend format
function normalizeToolCalls(toolCalls?: { tool?: string; name?: string; args?: Record<string, unknown> }[]): ToolCall[] | undefined {
  if (!toolCalls) return undefined;
  return toolCalls.map((tc) => ({
    name: tc.name ?? tc.tool ?? "unknown",
    args: tc.args ?? {},
    status: "success",
  }));
}

export interface ChatMessage {
  id: string;
  type: "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate";
  sender: string;
  content: string;
  timestamp: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: string;
  toolCalls?: ToolCall[];
  diff?: { oldContent: string; newContent: string; filePath: string };
  thinking?: string;
  navigate?: { targetSession: string; label: string };
  navigateTo?: string;
}

export interface FileOp {
  path: string;
  operation: "read" | "written" | "edited";
  timestamp: string;
}

export interface AgentSession {
  role: string;
  messages: ChatMessage[];
  status: "active" | "done";
  progress: number;
  spawnedAt: string;
  fileOps?: FileOp[];
}

const GREETINGS: Record<string, string> = {
  "creative-director": "I'm the Creative Director. I oversee the artistic vision and ensure all creative elements align. What would you like to explore?",
  "technical-director": "Technical Director online. I manage the technical architecture and engineering pipeline. What system needs attention?",
  producer: "Producer here. I manage timelines, resources, and coordination across teams. What's the priority?",
  "game-designer": "Game Designer ready. I design core mechanics, systems, and gameplay loops. What system should we work on?",
  "lead-programmer": "Lead Programmer spawned. I coordinate all programming tasks and code architecture. What needs implementation?",
  "art-director": "Art Director online. I define the visual style and guide all artistic output. What's the creative brief?",
  "audio-director": "Audio Director here. I oversee sound design, music, and audio systems. What's the soundscape vision?",
  "narrative-director": "Narrative Director ready. I guide story, dialogue, and world-building. What tale shall we craft?",
  "qa-lead": "QA Lead spawned. I manage testing strategy and quality assurance. What needs verification?",
  "release-manager": "Release Manager online. I coordinate builds, deployments, and release schedules. What's the target?",
};

const DEFAULT_GREETING = "Agent spawned and ready. Awaiting your instructions.";

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

function handleWSEvent(event: WSEvent, sessions: Map<string, AgentSession>, addSessionMessage: (role: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void): Map<string, AgentSession> | null {
  switch (event.type) {
    case "agent:spawned": {
      const role = event.agent;
      if (sessions.has(role)) return null;
      const next = new Map(sessions);
      next.set(role, {
        role,
        messages: [
          { id: uid(), type: "system", sender: "SYSTEM", content: `${role.toUpperCase()} session initialized.`, timestamp: timestamp() },
          { id: uid(), type: "progress", sender: role, content: "Initializing...", timestamp: timestamp(), progress: 0 },
        ],
        status: "active",
        progress: 0,
        spawnedAt: timestamp(),
        fileOps: [],
      });
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} spawned via WebSocket at ${timestamp()} UTC`,
      });
      return next;
    }
    case "agent:completed": {
      const role = event.agentId;
      const session = sessions.get(role);
      if (!session) return null;
      const next = new Map(sessions);
      next.set(role, {
        ...session,
        status: "done",
        progress: 100,
        messages: [
          ...session.messages,
          {
            id: uid(),
            type: "agent" as const,
            sender: role,
            content: event.output || "Task completed.",
            timestamp: timestamp(),
            showActions: true,
          },
          {
            id: uid(),
            type: "navigate" as const,
            sender: "SYSTEM",
            content: "Back to Game Director",
            timestamp: timestamp(),
            navigate: { targetSession: "game-director", label: "Back to Game Director" },
          },
        ],
      });
      addSessionMessage("game-director", {
        type: "agent",
        sender: "game-director",
        content: `${role.replace(/-/g, " ")} reports task complete.`,
        showActions: false,
      });
      return next;
    }
    case "agent:failed": {
      const role = event.agentId;
      const session = sessions.get(role);
      if (!session) return null;
      const next = new Map(sessions);
      next.set(role, {
        ...session,
        status: "done",
        messages: [...session.messages, {
          id: uid(),
          type: "system" as const,
          sender: "SYSTEM",
          content: `Task failed: ${event.error}`,
          timestamp: timestamp(),
        }],
      });
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} failed: ${event.error}`,
      });
      return next;
    }
    case "chat:message": {
      const sessionId = event.sessionId;
      const message = event.message;
      if (!message) return null;
      const session = sessions.get(sessionId);
      if (!session) return null;
      const next = new Map(sessions);
      next.set(sessionId, {
        ...session,
        messages: [...session.messages, {
          id: message.id || uid(),
          type: message.type,
          sender: message.sender,
          content: message.content,
          timestamp: message.timestamp || timestamp(),
          showActions: message.showActions,
          progress: message.progress,
          toolCalls: message.toolCalls as ToolCall[] | undefined,
        }],
        progress: message.progress ?? session.progress,
        status: message.type === "agent" ? "done" : session.status,
      });
      return next;
    }
    case "skill:phase:complete": {
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `Skill phase ${event.phase}: ${(event.output as string)?.slice(0, 100) ?? "complete"}...`,
      });
      return null;
    }
    case "log:entry": {
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `[${event.level.toUpperCase()}] ${event.message}`,
      });
      return null;
    }
    default:
      return null;
  }
}

export function useCommandRoom() {
  const [sessions, setSessions] = useState<Map<string, AgentSession>>(new Map());
  const [currentSession, setCurrentSession] = useState("game-director");
  const [threadId, setThreadId] = useState("");
  const [threadTitle, setThreadTitle] = useState("Board Room");
  const [initialized, setInitialized] = useState(false);
  const lastSpawnedRef = useRef<string | null>(null);
  const activityLogRef = useRef<string[]>([]);
  const addSessionMessageRef = useRef<(role: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void | undefined>(undefined);

  // Initialize on client by fetching from API
  useEffect(() => {
    const init = async () => {
      try {
        const response = await apiFetch<{
          sessions: Array<{ id: string; role: string; messages: ChatMessage[]; status: string; progress: number; spawnedAt: string }>;
          currentSessionId: string;
        }>("/api/chat/sessions");

        // Convert backend sessions array to frontend Map format
        const sessionsMap = new Map<string, AgentSession>();
        response.sessions.forEach((s) => {
          sessionsMap.set(s.id, {
            role: s.role,
            messages: s.messages.map((m) => ({
              ...m,
              // Normalize progress messages that have progress 100
              type: m.type === "progress" && m.progress === 100 ? "agent" as const : m.type,
              showActions: m.type === "agent" ? true : m.showActions,
            })),
            status: s.status as "active" | "done",
            progress: s.progress,
            spawnedAt: s.spawnedAt,
            fileOps: [],
          });
        });

        setSessions(sessionsMap);
        setCurrentSession(response.currentSessionId);
        setThreadId(`#${Math.floor(Math.random() * 9000 + 1000)}`);
        setThreadTitle("BOARD_ROOM");
      } catch (error) {
        console.error("Failed to fetch chat sessions:", error);
        // Fallback to local initialization
        const gd: AgentSession = {
          role: "game-director",
          messages: [{
            id: uid(),
            type: "welcome",
            sender: "GAME_DIRECTOR",
            content: "BOARD_ROOM initialized. Game Director online.",
            timestamp: timestamp(),
          }],
          status: "active",
          progress: 0,
          spawnedAt: timestamp(),
          fileOps: [],
        };
        setSessions(new Map([["game-director", gd]]));
        setThreadId(`#${Math.floor(Math.random() * 9000 + 1000)}`);
      } finally {
        setInitialized(true);
      }
    };

    init();
  }, []);

  const addSessionMessage = useCallback((sessionRole: string, msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setSessions((prev) => {
      const session = prev.get(sessionRole);
      if (!session) return prev;
      const next = new Map(prev);
      next.set(sessionRole, {
        ...session,
        messages: [...session.messages, { ...msg, id: uid(), timestamp: timestamp() }],
      });
      return next;
    });
  }, []);

  // Keep ref updated for WebSocket handler
  addSessionMessageRef.current = addSessionMessage;

  // WebSocket integration
  const onWSEvent = useCallback((event: WSEvent) => {
    const updated = handleWSEvent(event, sessions, addSessionMessageRef.current!);
    if (updated) {
      setSessions(updated);
    }
  }, [sessions]);

  useWebSocket(onWSEvent);

  const spawnAgent = useCallback(async (role: string, task?: string) => {
    const r = role.toLowerCase().trim();

    // Create agent session locally
    setSessions((prev) => {
      if (prev.has(r)) return prev;
      const next = new Map(prev);
      next.set(r, {
        role: r,
        messages: [
          { id: uid(), type: "system", sender: "SYSTEM", content: `${r.toUpperCase()} session initialized.`, timestamp: timestamp() },
          { id: uid(), type: "progress", sender: r, content: "Initializing...", timestamp: timestamp(), progress: 0 },
        ],
        status: "active",
        progress: 0,
        spawnedAt: timestamp(),
        fileOps: [],
      });
      return next;
    });

    lastSpawnedRef.current = r;

    addSessionMessage("game-director", {
      type: "system",
      sender: "SYSTEM",
      content: `${r.toUpperCase()} spawned at ${timestamp()} UTC`,
    });

    if (threadTitle === "Board Room") {
      setThreadTitle(`Session: ${r.replace(/-/g, " ")}`);
    }

    // Call backend API to spawn agent and get response
    try {
      const result = await apiFetch<{ invocationId: string; role: string; sessionId: string; status: string }>(
        "/api/chat/spawn",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: r, task: task ?? "What can you help me with?" }),
        }
      );

      // Update session with initial greeting
      setSessions((prev) => {
        const session = prev.get(r);
        if (!session) return prev;
        const next = new Map(prev);
        next.set(r, {
          ...session,
          messages: [
            { id: uid(), type: "system", sender: "SYSTEM", content: `${r.toUpperCase()} session initialized.`, timestamp: timestamp() },
            { id: uid(), type: "progress", sender: r, content: "Awaiting response...", timestamp: timestamp(), progress: 50 },
          ],
        });
        return next;
      });

      // The real response will come via WebSocket or we need to fetch it
      // For now, add a message that the agent is processing
      addSessionMessage("game-director", {
        type: "agent",
        sender: "game-director",
        content: `${r.replace(/-/g, " ")} is online and processing your request...`,
        showActions: false,
      });
    } catch (error) {
      console.error("Failed to spawn agent via API:", error);
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `Failed to spawn ${r}: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }, [addSessionMessage, threadTitle]);

  // Approve agent — send approval via API and wait for response
  const approveAgent = useCallback(async (role: string) => {
    const progressMsgId = uid();
    activityLogRef.current = [];

    setSessions((prev) => {
      const next = new Map(prev);
      const session = next.get(role);
      if (!session || session.status !== "active") return prev;
      next.set(role, {
        ...session,
        progress: 10,
        messages: [...session.messages, {
          id: progressMsgId,
          type: "progress" as const,
          sender: role,
          content: "Approving and continuing task...",
          timestamp: timestamp(),
          progress: 10,
        }],
      });
      return next;
    });

    // Call API to approve
    apiFetch<{ invocationId: string; status: string }>("/api/chat/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invocationId: role }),
    }).catch((error) => {
      console.error("Failed to approve agent via API:", error);
    });

    // Now send a message to the agent session to continue
    try {
      const result = await apiFetch<{ userMessage: ChatMessage; assistantMessage?: ChatMessage }>(
        `/api/chat/sessions/${role}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "user",
            sender: "DIRECTOR",
            content: "Approved. Continue with the task.",
          }),
        }
      );

      if (result.assistantMessage) {
        // Update session with real response
        setSessions((prev) => {
          const session = prev.get(role);
          if (!session) return prev;
          const next = new Map(prev);

          const updatedMessages = session.messages.map((m) => {
            if (m.id === progressMsgId) {
              return {
                ...m,
                progress: 100,
                content: "Task completed",
                timestamp: timestamp(),
              };
            }
            return m;
          });

          next.set(role, {
            ...session,
            progress: 100,
            status: "done",
            messages: [
              ...updatedMessages,
              {
                id: uid(),
                type: "agent" as const,
                sender: role,
                content: result.assistantMessage!.content,
                timestamp: timestamp(),
                showActions: true,
                toolCalls: result.assistantMessage!.toolCalls as ToolCall[] | undefined,
              },
              {
                id: uid(),
                type: "navigate" as const,
                sender: "SYSTEM",
                content: "Back to Game Director",
                timestamp: timestamp(),
                navigate: { targetSession: "game-director", label: "Back to Game Director" },
              },
            ],
          });
          return next;
        });

        addSessionMessage("game-director", {
          type: "agent",
          sender: "game-director",
          content: `${role.replace(/-/g, " ")} completed the task.`,
          showActions: false,
        });
      }
    } catch (error) {
      console.error("Failed to continue agent task:", error);
      setSessions((prev) => {
        const session = prev.get(role);
        if (!session) return prev;
        const next = new Map(prev);
        next.set(role, {
          ...session,
          status: "done",
          messages: [
            ...session.messages,
            {
              id: uid(),
              type: "system" as const,
              sender: "SYSTEM",
              content: `Error: ${error instanceof Error ? error.message : "Failed to continue task"}`,
              timestamp: timestamp(),
            },
          ],
        });
        return next;
      });
    }
  }, [addSessionMessage]);

  const executeCommand = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();

    // Always switch to GD view for typed commands
    setCurrentSession("game-director");

    // Slash commands
    if (lower.startsWith("/")) {
      const parts = lower.slice(1).split(" ");
      const cmd = parts[0];
      const args = parts.slice(1).join(" ");

      switch (cmd) {
        case "clear": {
          setSessions((prev) => {
            const next = new Map(prev);
            const gd = next.get("game-director");
            if (gd) {
              next.set("game-director", { ...gd, messages: [] });
            }
            return next;
          });
          addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Chat cleared." });
          return;
        }
        case "help": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "agent",
            sender: "game-director",
            content: `Available commands:
- /clear — Clear the chat
- /help — Show this message
- /spawn <agent> — Bring an agent online
- /cost — Show mock token usage
- /diff — Show recent changes
You can also use: spawn <agent>, approve, done <agent>`,
            showActions: false,
          });
          return;
        }
        case "spawn": {
          if (!args) {
            addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Usage: /spawn <agent-role>" });
            return;
          }
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          spawnAgent(args);
          return;
        }
        case "cost": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "agent",
            sender: "game-director",
            content: `Token Usage Estimates:
━━━━━━━━━━━━━━━━━━━━━━━
Input:  ~12,500 tokens ($0.09)
Output: ~8,200 tokens ($0.24)
Tools:  ~45 calls ($0.18)
━━━━━━━━━━━━━━━━━━━━━━━
Total:  ~$0.51 USD
Agents: 3 active`,
            showActions: false,
          });
          return;
        }
        case "diff": {
          addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage("game-director", {
            type: "diff",
            sender: "game-director",
            content: "Recent changes",
            diff: {
              filePath: "src/utils.ts",
              oldContent: "function oldName() {\n  return 42;\n}",
              newContent: "function newName() {\n  return 42;\n}",
            },
          });
          return;
        }
        default: {
          addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: `Unknown command: /${cmd}. Type /help for available commands.` });
          return;
        }
      }
    }

    // spawn <agent>
    if (lower.startsWith("spawn ")) {
      const role = lower.slice(6).trim();
      if (!role) {
        addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "Usage: spawn <agent-role>" });
        return;
      }
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });
      spawnAgent(role);
      return;
    }

    // approve — from text command, approves last spawned
    if (lower === "approve") {
      const role = lastSpawnedRef.current;
      if (!role) {
        addSessionMessage("game-director", { type: "system", sender: "SYSTEM", content: "No agent to approve." });
        return;
      }
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: "Approved. Proceed with the task." });
      approveAgent(role);
      return;
    }

    // done <agent>
    if (lower.startsWith("done ")) {
      const role = lower.slice(5).trim();
      addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });

      setSessions((prev) => {
        const session = prev.get(role);
        if (!session) return prev;
        const next = new Map(prev);
        next.set(role, {
          ...session,
          status: "done",
          messages: [...session.messages, {
            id: uid(),
            type: "system" as const,
            sender: "SYSTEM",
            content: "Session closed. Task completed.",
            timestamp: timestamp(),
          }],
        });
        return next;
      });

      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} completed task and despawned.`,
      });
      return;
    }

    // Default: plain message to Game Director via real API
    addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });

    // Call real API
    apiFetch<{ userMessage: ChatMessage; assistantMessage?: ChatMessage; errorMessage?: ChatMessage }>(
      "/api/chat/sessions/game-director/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user",
          sender: "DIRECTOR",
          content: trimmed,
        }),
      }
    )
      .then((result) => {
        if (result.assistantMessage) {
          addSessionMessage("game-director", {
            type: "agent",
            sender: result.assistantMessage.sender,
            content: result.assistantMessage.content,
            showActions: true,
            toolCalls: normalizeToolCalls(result.assistantMessage.toolCalls),
          });
        } else if (result.errorMessage) {
          addSessionMessage("game-director", {
            type: "system",
            sender: "SYSTEM",
            content: result.errorMessage.content,
          });
        }
      })
      .catch((error) => {
        console.error("Failed to send message:", error);
        addSessionMessage("game-director", {
          type: "system",
          sender: "SYSTEM",
          content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
        });
      });
  }, [addSessionMessage, spawnAgent, approveAgent]);

  // Derived state
  const currentMessages = sessions.get(currentSession)?.messages ?? [];
  const activeAgentList = [...sessions.values()].filter((s) => s.role !== "game-director" && s.status === "active");
  const totalProgress = activeAgentList.length > 0
    ? Math.round(activeAgentList.reduce((sum, s) => sum + s.progress, 0) / activeAgentList.length)
    : 0;

  return {
    sessions,
    currentSession,
    currentMessages,
    threadId,
    threadTitle,
    totalProgress,
    executeCommand,
    selectSession: setCurrentSession,
    approveAgent,
    initialized,
  };
}
