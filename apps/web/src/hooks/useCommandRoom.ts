"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useProject } from "@/contexts/ProjectContext";
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
  type: "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate" | "question" | "plan" | "workflow";
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
  images?: string[];
  workflow?: {
    workflowId: string;
    steps: Array<{
      stage: string;
      label: string;
      ticketId?: string;
      agentRole?: string;
      status: "pending" | "active" | "completed" | "failed";
    }>;
    currentStage: string;
  };
  question?: {
    questionId: string;
    question: string;
    options: { id: string; label: string; description?: string }[];
    allowMultiple?: boolean;
    allowCustomInput?: boolean;
  };
  planPhases?: {
    id: string;
    label: string;
    description?: string;
    status: "pending" | "active" | "completed";
    estimatedEffort?: string;
  }[];
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
  return new Date().toISOString();
}

function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

interface WSHandlerResult {
  sessions: Map<string, AgentSession> | null;
  messages: Array<{ sessionRole: string; msg: Omit<ChatMessage, "id" | "timestamp"> }>;
}

function isProducerSession(id: string): boolean {
  return id === "producer" || id.startsWith("producer-");
}

function handleWSEvent(event: WSEvent, sessions: Map<string, AgentSession>, producerSessionId: string, recentApiMessages?: Set<string>): WSHandlerResult {
  const messages: WSHandlerResult["messages"] = [];
  switch (event.type) {
    case "agent:spawned": {
      const role = event.agent;
      if (sessions.has(role)) return { sessions: null, messages };
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
      // Producer "<role> spawned at ..." is appended by backend /spawn
      // handler and arrives via chat:message — no local push here.
      return { sessions: next, messages };
    }
    case "agent:completed": {
      const role = event.sessionId;
      // Producer sessions are orchestrators — never mark them as "completed" via agent events
      if (isProducerSession(role)) return { sessions: null, messages };
      let session = sessions.get(role);
      // Fallback: try agentId field if session not found by sessionId
      if (!session && event.agentId) {
        session = sessions.get(event.agentId);
      }
      if (!session) return { sessions: null, messages };
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
            content: "Back to Producer",
            timestamp: timestamp(),
            navigate: { targetSession: producerSessionId, label: "Back to Producer" },
          },
        ],
      });
      // Producer "reports task complete" is appended by backend /spawn
      // handler and arrives via chat:message — do not duplicate here.
      return { sessions: next, messages };
    }
    case "agent:failed": {
      const role = event.sessionId;
      const session = sessions.get(role);
      if (!session) return { sessions: null, messages };
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
      // Producer "<role> failed" is appended by backend and arrives
      // via chat:message — do not duplicate here.
      return { sessions: next, messages };
    }
    case "chat:session:updated": {
      const sessionId = event.sessionId;
      const session = sessions.get(sessionId);
      if (!session) return { sessions: null, messages };
      const next = new Map(sessions);
      next.set(sessionId, {
        ...session,
        progress: event.session.progress ?? session.progress,
        status: (event.session.status as "active" | "done") ?? session.status,
      });
      return { sessions: next, messages };
    }
    case "chat:message": {
      const sessionId = event.sessionId;
      const message = event.message;
      if (!message) return { sessions: null, messages };
      const session = sessions.get(sessionId);
      if (!session) return { sessions: null, messages };
      // Deduplicate: skip if message ID already exists
      if (message.id && session.messages.some((m) => m.id === message.id)) {
        return { sessions: null, messages };
      }
      // Deduplicate: skip if this message was already added via API response (ref-based, race-condition proof)
      const msgContent = (message.content ?? "").trim();
      const msgSig = `${message.type}:${message.sender}:${msgContent}`;
      if (recentApiMessages?.has(msgSig)) {
        recentApiMessages.delete(msgSig);
        return { sessions: null, messages };
      }
      // Deduplicate: skip if last message in session already matches (catches WS-before-API race)
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && lastMsg.type === message.type && lastMsg.sender === message.sender && (lastMsg.content ?? "").trim() === msgContent) {
        return { sessions: null, messages };
      }
      const next = new Map(sessions);

      // Clean up stale progress messages when a real response arrives
      const shouldCleanProgress = message.type !== "progress" && message.type !== "system";
      const baseMessages = shouldCleanProgress
        ? session.messages.filter((m) => m.type !== "progress")
        : session.messages;

      next.set(sessionId, {
        ...session,
        messages: [...baseMessages, {
          id: message.id || uid(),
          type: message.type,
          sender: message.sender,
          content: message.content,
          timestamp: message.timestamp || timestamp(),
          showActions: message.showActions,
          progress: message.progress,
          toolCalls: normalizeToolCalls(message.toolCalls),
          question: message.question as ChatMessage["question"],
          planPhases: message.planPhases as ChatMessage["planPhases"],
          thinking: message.thinking,
          navigate: message.navigate,
        }],
        progress: message.progress ?? session.progress,
        status: message.type === "agent" || message.type === "question" || message.type === "plan" ? "done" : session.status,
      });
      return { sessions: next, messages };
    }
    case "chat:progress": {
      // Update existing progress message in place, or remove if complete
      const sessionId = event.sessionId;
      const session = sessions.get(sessionId);
      if (!session) return { sessions: null, messages };

      // If progress is -1, this is a thinking content update
      if (event.progress === -1 && event.thinking) {
        const next = new Map(sessions);
        const progressIndex = session.messages.findIndex((m) => m.type === "progress");
        if (progressIndex !== -1) {
          next.set(sessionId, {
            ...session,
            messages: session.messages.map((m, idx) =>
              idx === progressIndex
                ? { ...m, thinking: event.thinking }
                : m
            ),
          });
        }
        return { sessions: next, messages };
      }

      const next = new Map(sessions);

      // If progress is 100, remove the progress message
      if (event.progress >= 100) {
        next.set(sessionId, {
          ...session,
          messages: session.messages.filter((m) => m.id !== event.progressMsgId),
          progress: 100,
        });
        return { sessions: next, messages };
      }

      next.set(sessionId, {
        ...session,
        messages: session.messages.map((m) =>
          m.id === event.progressMsgId
            ? { ...m, progress: event.progress, content: event.content }
            : m
        ),
        progress: event.progress,
      });
      return { sessions: next, messages };
    }
    case "skill:phase:complete": {
      messages.push({ sessionRole: "producer", msg: {
        type: "system",
        sender: "SYSTEM",
        content: `Skill phase ${event.phase}: ${(event.output as string)?.slice(0, 100) ?? "complete"}...`,
      }});
      return { sessions: null, messages };
    }
    case "log:entry": {
      // Prefer event.sessionId, fall back to agent role lookup, then current producer
      const targetSession = sessions.has(event.sessionId)
        ? event.sessionId
        : event.agent && sessions.has(event.agent)
        ? event.agent
        : producerSessionId;
      if (!targetSession) return { sessions: null, messages };
      const session = sessions.get(targetSession);
      if (!session) return { sessions: null, messages };

      // Parse tool call from log message, e.g. "[producer] Read: /path/to/file"
      const toolMatch = event.message.match(/^\[([^\]]+)\]\s+(\w+):\s*(.+)$/);
      if (toolMatch) {
        const [, , toolName, toolArg] = toolMatch;
        const next = new Map(sessions);
        const progressIndex = session.messages.findIndex((m) => m.type === "progress");
        if (progressIndex !== -1) {
          const progressMsg = session.messages[progressIndex];
          const existingToolCalls = progressMsg.toolCalls ?? [];
          // Avoid duplicate tool calls (same name + arg within last 5)
          const isDuplicate = existingToolCalls.slice(-5).some(
            (tc) => tc.name === toolName && Object.values(tc.args)[0] === toolArg
          );
          if (!isDuplicate) {
            next.set(targetSession, {
              ...session,
              messages: session.messages.map((m, idx) =>
                idx === progressIndex
                  ? {
                      ...m,
                      toolCalls: [
                        ...existingToolCalls,
                        {
                          name: toolName,
                          args: { [toolName === "Bash" ? "command" : "file_path"]: toolArg },
                          status: "success",
                        },
                      ],
                    }
                  : m
              ),
            });
            return { sessions: next, messages };
          }
        }
      }

      // Fallback: add as system message if no progress message or couldn't parse
      // Deduplicate: skip if same log message already exists in recent messages
      const logContent = `[${event.level.toUpperCase()}] ${event.message}`;
      const recentMessages = session.messages.slice(-10);
      if (!recentMessages.some((m) => m.type === "system" && m.content === logContent)) {
        messages.push({ sessionRole: targetSession, msg: {
          type: "system",
          sender: "SYSTEM",
          content: logContent,
        }});
      }
      return { sessions: null, messages };
    }
    case "chat:session:deleted": {
      const sid = event.sessionId;
      if (!sessions.has(sid)) return { sessions: null, messages };
      const next = new Map(sessions);
      next.delete(sid);
      return { sessions: next, messages };
    }
    case "workflow:stage": {
      const { sessionId, workflowId, stage, ticketId, agentRole } = event;
      const stages: Array<{ stage: string; label: string }> = [
        { stage: "plan", label: "Planning" },
        { stage: "decompose", label: "Decomposing tasks" },
        { stage: "execute", label: "Executing" },
        { stage: "verify", label: "Verifying" },
        { stage: "fix", label: "Fixing" },
      ];
      const steps = stages.map((s) => ({
        stage: s.stage,
        label: s.label,
        ticketId: s.stage === stage ? ticketId : undefined,
        agentRole: s.stage === stage ? agentRole : undefined,
        status: stages.findIndex((x) => x.stage === stage) > stages.findIndex((x) => x.stage === s.stage)
          ? "completed" as const
          : s.stage === stage ? "active" as const : "pending" as const,
      }));
      messages.push({ sessionRole: sessionId, msg: {
        type: "workflow",
        sender: "SYSTEM",
        content: `Pipeline: ${stage.toUpperCase()}`,
        workflow: {
          workflowId,
          steps,
          currentStage: stage as "plan" | "decompose" | "execute" | "verify" | "fix",
        },
      }});
      return { sessions: null, messages };
    }
    case "quest:linked": {
      messages.push({ sessionRole: event.sessionId, msg: {
        type: "system",
        sender: "SYSTEM",
        content: `Quest ${event.ticketId.replace("ticket-", "#")} assigned to ${event.agentRole.replace(/-/g, " ")}`,
      }});
      return { sessions: null, messages };
    }
    case "workflow:complete": {
      messages.push({ sessionRole: event.sessionId, msg: {
        type: "system",
        sender: "SYSTEM",
        content: `Workflow ${event.success ? "completed successfully" : "failed"}`,
      }});
      return { sessions: null, messages };
    }
    case "agent:loop:detected": {
      messages.push({
        sessionRole: event.sessionId,
        msg: {
          type: "system",
          sender: "SYSTEM",
          content: `[LOOP DETECTED] ${event.message}`,
        },
      });
      return { sessions: null, messages };
    }
    default:
      return { sessions: null, messages };
  }
}

interface BackendSession {
  id: string;
  role: string;
  projectId: string | null;
  messages: ChatMessage[];
  status: string;
  progress: number;
  spawnedAt: string;
}

function backendSessionToAgentSession(s: BackendSession): AgentSession {
  return {
    role: s.role,
    messages: s.messages.map((m) => ({
      ...m,
      type: m.type === "progress" && m.progress === 100 ? ("agent" as const) : m.type,
      toolCalls: normalizeToolCalls(m.toolCalls),
    })),
    status: s.status as "active" | "done",
    progress: s.progress,
    spawnedAt: s.spawnedAt,
    fileOps: [],
  };
}

export function useCommandRoom() {
  const { currentProjectId } = useProject();
  const producerSessionId = currentProjectId ? `producer-${currentProjectId}` : "";

  // Stores ALL fetched sessions from backend (across projects) keyed by id.
  // Sessions for other projects are filtered out at the consumer level.
  const [allSessions, setAllSessions] = useState<Map<string, AgentSession>>(new Map());
  const [allSessionProjectIds, setAllSessionProjectIds] = useState<Map<string, string | null>>(new Map());
  const [currentSession, setCurrentSession] = useState("");
  const [threadId, setThreadId] = useState("");
  const [threadTitle, setThreadTitle] = useState("Board Room");
  const [initialized, setInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const lastSpawnedRef = useRef<string | null>(null);
  const activityLogRef = useRef<string[]>([]);
  const addSessionMessageRef = useRef<(role: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void | undefined>(undefined);
  const recentApiMessagesRef = useRef<Set<string>>(new Set());
  // F2: Ref for currentSession to avoid stale closures in async callbacks
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const producerSessionIdRef = useRef(producerSessionId);
  producerSessionIdRef.current = producerSessionId;

  // Filter sessions visible for the active project. The producer session
  // for the current project plus any specialist sessions tagged with
  // currentProjectId. Legacy "producer-legacy" and other projects'
  // sessions are hidden.
  const sessions = useMemo(() => {
    if (!currentProjectId) return new Map<string, AgentSession>();
    const out = new Map<string, AgentSession>();
    for (const [id, sess] of allSessions) {
      if (id === producerSessionId) {
        out.set(id, sess);
        continue;
      }
      if (id === "producer" || id === "producer-legacy" || id.startsWith("producer-")) continue;
      if (allSessionProjectIds.get(id) === currentProjectId) {
        out.set(id, sess);
      }
    }
    return out;
  }, [allSessions, allSessionProjectIds, currentProjectId, producerSessionId]);

  // Fetch all sessions and ensure the producer session for the current
  // project exists (lazy-create via the dedicated endpoint).
  useEffect(() => {
    if (!currentProjectId) {
      setInitialized(true);
      return;
    }
    let cancelled = false;
    const init = async () => {
      try {
        const [allResp, producerSession] = await Promise.all([
          apiFetch<{ sessions: BackendSession[]; currentSessionId: string }>("/api/chat/sessions"),
          apiFetch<BackendSession>(`/api/chat/sessions/producer/${currentProjectId}`),
        ]);
        if (cancelled) return;

        const sessionMap = new Map<string, AgentSession>();
        const projectIdMap = new Map<string, string | null>();
        for (const s of allResp.sessions) {
          sessionMap.set(s.id, backendSessionToAgentSession(s));
          projectIdMap.set(s.id, s.projectId ?? null);
        }
        // Ensure the lazy-created producer session is included.
        sessionMap.set(producerSession.id, backendSessionToAgentSession(producerSession));
        projectIdMap.set(producerSession.id, producerSession.projectId ?? null);

        setAllSessions(sessionMap);
        setAllSessionProjectIds(projectIdMap);
        setCurrentSession(producerSession.id);
        setThreadId(`#${Math.floor(Math.random() * 9000 + 1000)}`);
        setThreadTitle("BOARD_ROOM");
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch chat sessions:", error);
      } finally {
        if (!cancelled) setInitialized(true);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  const addSessionMessage = useCallback((sessionRole: string, msg: Omit<ChatMessage, "id" | "timestamp">) => {
    setAllSessions((prev) => {
      const session = prev.get(sessionRole);
      if (!session) return prev;

      // Deduplicate: skip if same type+sender+content already exists as the last message
      const lastMsg = session.messages[session.messages.length - 1];
      if (lastMsg && lastMsg.type === msg.type && lastMsg.sender === msg.sender && (lastMsg.content ?? "").trim() === (msg.content ?? "").trim()) {
        return prev;
      }

      const next = new Map(prev);
      const shouldCleanProgress = msg.type !== "progress" && msg.type !== "system";
      next.set(sessionRole, {
        ...session,
        messages: [
          ...(shouldCleanProgress ? session.messages.filter((m) => m.type !== "progress") : session.messages),
          { ...msg, id: uid(), timestamp: timestamp() },
        ],
      });
      return next;
    });
  }, []);

  // Keep ref updated for WebSocket handler
  addSessionMessageRef.current = addSessionMessage;

  // WebSocket integration — use functional update to avoid stale closure
  const onWSEvent = useCallback((event: WSEvent) => {
    setAllSessions((prevSessions) => {
      const updated = handleWSEvent(event, prevSessions, producerSessionIdRef.current, recentApiMessagesRef.current);
      // Process any messages that were generated by the handler
      updated.messages.forEach(({ sessionRole, msg }) => {
        const session = prevSessions.get(sessionRole);
        if (session) {
          const next = new Map(prevSessions);
          next.set(sessionRole, {
            ...session,
            messages: [...session.messages, { ...msg, id: uid(), timestamp: timestamp() }],
          });
          prevSessions = next;
        }
      });
      return updated.sessions ?? prevSessions;
    });
  }, []);

  const { connected } = useWebSocket(onWSEvent);

  const spawnAgent = useCallback(async (role: string, task?: string) => {
    const r = role.toLowerCase().trim();
    const projectId = currentProjectId;

    if (!projectId) {
      addSessionMessage(producerSessionIdRef.current, {
        type: "system",
        sender: "SYSTEM",
        content: "Cannot spawn agent: no project selected.",
      });
      return;
    }

    // Create agent session locally
    setAllSessions((prev) => {
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

    // Note: the "<role> spawned at ..." system message is appended to
    // the producer session by the backend /api/chat/spawn handler and
    // arrives over the WebSocket. We do NOT add it locally here, so it
    // survives page navigation.

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
          body: JSON.stringify({ role: r, task: task ?? "What can you help me with?", projectId }),
        }
      );

      // Update session with initial greeting
      setAllSessions((prev) => {
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
      addSessionMessage(producerSessionIdRef.current, {
        type: "agent",
        sender: "producer",
        content: `${r.replace(/-/g, " ")} is online and processing your request...`,
        showActions: false,
      });
    } catch (error) {
      console.error("Failed to spawn agent via API:", error);
      addSessionMessage(producerSessionIdRef.current, {
        type: "system",
        sender: "SYSTEM",
        content: `Failed to spawn ${r}: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }, [addSessionMessage, threadTitle, currentProjectId]);

  // Approve agent — send approval via API and wait for response
  const approveAgent = useCallback(async (role: string) => {
    const progressMsgId = uid();
    activityLogRef.current = [];

    setAllSessions((prev) => {
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
        setAllSessions((prev) => {
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
                content: "Back to Producer",
                timestamp: timestamp(),
                navigate: { targetSession: producerSessionIdRef.current, label: "Back to Producer" },
              },
            ],
          });
          return next;
        });

        addSessionMessage(producerSessionIdRef.current, {
          type: "agent",
          sender: "producer",
          content: `${role.replace(/-/g, " ")} completed the task.`,
          showActions: false,
        });
      }
    } catch (error) {
      console.error("Failed to continue agent task:", error);
      setAllSessions((prev) => {
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

  const executeCommand = useCallback((input: string, images?: string[]) => {
    const trimmed = input.trim();
    if (!trimmed && (!images || images.length === 0)) return;

    const lower = trimmed.toLowerCase();

    // Slash commands — always route through producer
    if (lower.startsWith("/")) {
      setCurrentSession(producerSessionIdRef.current);
      const parts = lower.slice(1).split(" ");
      const cmd = parts[0];
      const args = parts.slice(1).join(" ");

      switch (cmd) {
        case "clear": {
          const targetSession = currentSession;
          // Clear backend first
          apiFetch(`/api/chat/sessions/${targetSession}/clear`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }).catch((err) => console.error("Failed to clear session:", err));

          setAllSessions((prev) => {
            const next = new Map(prev);
            const session = next.get(targetSession);
            if (session) {
              next.set(targetSession, { ...session, messages: [] });
            }
            return next;
          });
          addSessionMessage(targetSession, { type: "system", sender: "SYSTEM", content: "Chat cleared." });
          return;
        }
        case "help": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage(producerSessionIdRef.current, {
            type: "agent",
            sender: "producer",
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
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: /spawn <agent-role>" });
            return;
          }
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          spawnAgent(args);
          return;
        }
        case "cost": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage(producerSessionIdRef.current, {
            type: "agent",
            sender: "producer",
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
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage(producerSessionIdRef.current, {
            type: "diff",
            sender: "producer",
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
          addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: `Unknown command: /${cmd}. Type /help for available commands.` });
          return;
        }
      }
    }

    // spawn <agent> — orchestration command
    if (lower.startsWith("spawn ")) {
      setCurrentSession(producerSessionIdRef.current);
      const role = lower.slice(6).trim();
      if (!role) {
        addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: spawn <agent-role>" });
        return;
      }
      addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
      spawnAgent(role);
      return;
    }

    // approve — orchestration command
    if (lower === "approve") {
      setCurrentSession(producerSessionIdRef.current);
      const role = lastSpawnedRef.current;
      if (!role) {
        addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "No agent to approve." });
        return;
      }
      addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: "Approved. Proceed with the task." });
      approveAgent(role);
      return;
    }

    // done <agent> — orchestration command
    if (lower.startsWith("done ")) {
      setCurrentSession(producerSessionIdRef.current);
      const role = lower.slice(5).trim();
      addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });

      setAllSessions((prev) => {
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

      addSessionMessage(producerSessionIdRef.current, {
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} completed task and despawned.`,
      });
      return;
    }

    // Default: normal message routed to current session
    // F2: Capture ref value for async callbacks
    const session = currentSessionRef.current;
    addSessionMessage(session, { type: "user", sender: "DIRECTOR", content: trimmed, images });

    setIsLoading(true);

    // Call real API for current session
    apiFetch<{ userMessage: ChatMessage; assistantMessage?: ChatMessage; errorMessage?: ChatMessage }>(
      `/api/chat/sessions/${session}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "user",
          sender: "DIRECTOR",
          content: trimmed,
          images,
        }),
      }
    )
      .then((result) => {
        setIsLoading(false);
        if (result.assistantMessage) {
          const msgType = result.assistantMessage.type as ChatMessage["type"];
          const msgSender = result.assistantMessage.sender;
          const msgContent = result.assistantMessage.content;
          // Track signature for WebSocket deduplication
          recentApiMessagesRef.current.add(`${msgType}:${msgSender}:${msgContent.trim()}`);
          // F3: Cap at 100 entries, trim to 50 when exceeded
          if (recentApiMessagesRef.current.size > 100) {
            const entries = [...recentApiMessagesRef.current];
            recentApiMessagesRef.current = new Set(entries.slice(-50));
          }
          addSessionMessage(session, {
            type: msgType,
            sender: msgSender,
            content: msgContent,
            showActions: false,
            progress: result.assistantMessage.progress,
            toolCalls: normalizeToolCalls(result.assistantMessage.toolCalls),
            question: result.assistantMessage.question as ChatMessage["question"],
            planPhases: result.assistantMessage.planPhases as ChatMessage["planPhases"],
          });
        } else if (result.errorMessage) {
          addSessionMessage(session, {
            type: "system",
            sender: "SYSTEM",
            content: result.errorMessage.content,
          });
        }
      })
      .catch((error) => {
        setIsLoading(false);
        console.error("Failed to send message:", error);
        addSessionMessage(session, {
          type: "system",
          sender: "SYSTEM",
          content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
        });
      });
  }, [addSessionMessage, spawnAgent, approveAgent, currentSession]);

  const closeSession = useCallback((role: string) => {
    // Delete from backend so it doesn't reappear on refresh
    apiFetch(`/api/chat/sessions/${role}`, { method: "DELETE" }).catch((err) =>
      console.error("Failed to delete session:", err)
    );
    setAllSessions((prev) => {
      const next = new Map(prev);
      next.delete(role);
      return next;
    });
    // Switch back to producer if we closed the current session
    setCurrentSession((current) => (current === role ? producerSessionIdRef.current : current));
  }, []);

  // Derived state — memoized to avoid unnecessary re-renders
  const currentMessages = useMemo(() => sessions.get(currentSession)?.messages ?? [], [sessions, currentSession]);
  const totalProgress = useMemo(() => {
    const active = [...sessions.values()].filter((s) => s.role !== "producer" && s.status === "active");
    return active.length > 0
      ? Math.round(active.reduce((sum, s) => sum + s.progress, 0) / active.length)
      : 0;
  }, [sessions]);

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
    closeSession,
    initialized,
    connected,
    isLoading,
    producerSessionId,
  };
}
