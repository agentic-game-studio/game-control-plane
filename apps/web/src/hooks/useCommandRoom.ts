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
  tool: string;
  status: "pending" | "success" | "error";
  input?: string;
  output?: string;
  duration?: number;
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
  diffBlocks?: DiffBlock[];
  toolCalls?: ToolCall[];
  thinking?: string;
  navigate?: { targetSession: string; label: string };
}

export interface AgentSession {
  role: string;
  messages: ChatMessage[];
  status: "active" | "done";
  progress: number;
  spawnedAt: string;
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
          { id: uid(), type: "agent", sender: role, content: GREETINGS[role] ?? DEFAULT_GREETING, timestamp: timestamp(), showActions: true },
        ],
        status: "active",
        progress: 0,
        spawnedAt: timestamp(),
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
        messages: [...session.messages, {
          id: uid(),
          type: "system" as const,
          sender: "SYSTEM",
          content: `Task completed: ${event.output}`,
          timestamp: timestamp(),
        }],
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
  const addSessionMessageRef = useRef<(role: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void | undefined>(undefined);

  // Initialize on client by fetching from API
  useEffect(() => {
    const init = async () => {
      try {
        const data = await apiFetch<{
          sessions: Record<string, AgentSession>;
          currentSessionId: string;
          threadId: string;
          threadTitle: string;
        }>("/api/chat/sessions");

        const sessionsMap = new Map(Object.entries(data.sessions));
        setSessions(sessionsMap);
        setCurrentSession(data.currentSessionId);
        setThreadId(data.threadId);
        setThreadTitle(data.threadTitle);
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
  }, []);

  useWebSocket(onWSEvent);

  const spawnAgent = useCallback((role: string) => {
    const r = role.toLowerCase().trim();

    // Create agent session locally
    setSessions((prev) => {
      if (prev.has(r)) return prev;
      const next = new Map(prev);
      next.set(r, {
        role: r,
        messages: [
          { id: uid(), type: "system", sender: "SYSTEM", content: `${r.toUpperCase()} session initialized.`, timestamp: timestamp() },
          { id: uid(), type: "agent", sender: r, content: GREETINGS[r] ?? DEFAULT_GREETING, timestamp: timestamp(), showActions: true },
        ],
        status: "active",
        progress: 0,
        spawnedAt: timestamp(),
      });
      return next;
    });

    lastSpawnedRef.current = r;

    // Notify Game Director
    addSessionMessage("game-director", {
      type: "system",
      sender: "SYSTEM",
      content: `${r.toUpperCase()} spawned at ${timestamp()} UTC`,
    });
    addSessionMessage("game-director", {
      type: "agent",
      sender: "game-director",
      content: `I've brought ${r.replace(/-/g, " ")} online. They're ready for tasks. You can view their session in the sidebar.`,
      showActions: false,
    });

    if (threadTitle === "Board Room") {
      setThreadTitle(`Session: ${r.replace(/-/g, " ")}`);
    }

    // Broadcast to backend via API
    apiFetch<{ invocationId: string; role: string }>("/api/chat/spawn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: r }),
    }).catch((error) => {
      console.error("Failed to spawn agent via API:", error);
    });
  }, [addSessionMessage, threadTitle]);

  // Approve agent — called from decision buttons, does NOT auto-switch view
  const approveAgent = useCallback((role: string) => {
    let progress = 15;

    setSessions((prev) => {
      const next = new Map(prev);
      const session = next.get(role);
      if (!session || session.status !== "active") return prev;
      next.set(role, {
        ...session,
        progress: 15,
        messages: [...session.messages, {
          id: uid(),
          type: "progress" as const,
          sender: role,
          content: "Commencing work on the assigned task...",
          timestamp: timestamp(),
          progress: 15,
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

    // Local progress simulation
    const interval = setInterval(() => {
      progress += Math.floor(Math.random() * 20 + 5);
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setSessions((prev) => {
          const next = new Map(prev);
          const session = next.get(role);
          if (session) {
            next.set(role, {
              ...session,
              progress: 100,
              status: "done",
              messages: [...session.messages, {
                id: uid(),
                type: "system" as const,
                sender: "SYSTEM",
                content: "Task completed successfully.",
                timestamp: timestamp(),
              }],
            });
          }
          return next;
        });
        // Notify Game Director
        addSessionMessage("game-director", {
          type: "agent",
          sender: "game-director",
          content: `${role.replace(/-/g, " ")} reports task complete.`,
          showActions: false,
        });
      } else {
        setSessions((prev) => {
          const next = new Map(prev);
          const session = next.get(role);
          if (session) {
            next.set(role, { ...session, progress });
          }
          return next;
        });
      }
    }, 1500);
  }, [addSessionMessage]);

  const executeCommand = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const lower = trimmed.toLowerCase();

    // Always switch to GD view for typed commands
    setCurrentSession("game-director");

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

    // /clear - clear chat history
    if (lower === "/clear" || lower === "clear") {
      addSessionMessage("game-director", {
        type: "system",
        sender: "SYSTEM",
        content: "Chat history cleared.",
      });
      return;
    }

    // /help - show help
    if (lower === "/help" || lower === "help") {
      addSessionMessage("game-director", {
        type: "agent",
        sender: "game-director",
        content: `Available commands:
• spawn <agent> — Bring an agent online
• approve — Approve last agent's request
• done <agent> — Complete agent task
• /clear — Clear chat history
• /cost — Show estimated costs`,
        showActions: false,
      });
      return;
    }

    // Default: plain message to Game Director
    addSessionMessage("game-director", { type: "user", sender: "DIRECTOR", content: trimmed });

    setTimeout(() => {
      addSessionMessage("game-director", {
        type: "agent",
        sender: "game-director",
        content: `Acknowledged. I'll coordinate the appropriate team members. Use \`spawn <agent-role>\` to bring a specialist online if needed.`,
        showActions: false,
      });
    }, 500);
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
