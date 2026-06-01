"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { apiFetch } from "@/lib/api";
import { useWebSocket } from "./useWebSocket";
import { useProject } from "@/contexts/ProjectContext";
import type { WSEvent, ContextUsage } from "@game-studio/types";

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
  type: "system" | "agent" | "user" | "progress" | "welcome" | "diff" | "navigate" | "question" | "plan" | "workflow" | "producer_update";
  sender: string;
  content: string;
  timestamp: string;
  showActions?: boolean;
  progress?: number;
  codeBlock?: string;
  toolCalls?: ToolCall[];
  logs?: string[];
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
  status: "active" | "done" | "completed";
  progress: number;
  spawnedAt: string;
  fileOps?: FileOp[];
}

export interface ProducerUIState {
  mode: "thinking" | "delegated" | "available";
  label: string;
  detail: string;
  activeDelegatedSessions: number;
  activeDelegatedSubagents: number;
}

export interface ActivityItem {
  id: string;
  kind: "spawned" | "completed" | "failed" | "status";
  title: string;
  detail: string;
  timestamp: string;
}

export interface SubagentInfo {
  id: string;
  role: string;
  parentSessionId: string;
  ticketId: string;
  task: string;
  status: "active" | "completed" | "failed";
  output?: string;
  error?: string;
  spawnedAt: string;
}

interface QueuedMessage {
  input: string;
  images?: string[];
  targetSessionId?: string;
}

/* ─── localStorage Cache ─── */

const CACHE_VERSION = 5;
const CACHE_KEY_PREFIX = "chat-cache-v";
const CACHE_PURGE_MARKER = `chat-cache-purged-v${CACHE_VERSION}`;

interface CachedChatData {
  version: number;
  sessions: Array<[string, AgentSession]>;
  /** Task-tool subagents — no chat session row; persisted so sidebar survives navigation */
  subagents?: Array<[string, SubagentInfo]>;
  currentSession: string;
  threadId: string;
  threadTitle: string;
  /** Persist loading state so "thinking" indicator survives page navigation */
  isLoading?: boolean;
  /** Persist message queue so queued messages survive page navigation */
  messageQueue?: QueuedMessage[];
  cachedAt: string;
}

function getCacheKey(projectId: string): string {
  return `${CACHE_KEY_PREFIX}${CACHE_VERSION}-${projectId}`;
}

function purgeStaleCacheKeys(): void {
  try {
    if (localStorage.getItem(CACHE_PURGE_MARKER)) return;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith("chat-cache-v") || key.startsWith("chat-sub-"))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    if (keysToRemove.length > 0) {
      // Dev-time visibility only. Removing this would lose signal in
      // troubleshooting but keeping it as console.log floods production
      // devtools. The cache-purge marker is the persistent artifact; this
      // log is best-effort.
      if (process.env.NODE_ENV !== "production") {
        console.log("[Cache] Purged", keysToRemove.length, "stale keys");
      }
    }
    localStorage.setItem(CACHE_PURGE_MARKER, "1");
  } catch { /* ignore */ }
}

function loadCache(projectId: string): CachedChatData | null {
  try {
    purgeStaleCacheKeys();
    const raw = localStorage.getItem(getCacheKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedChatData;
    if (parsed.version !== CACHE_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCache(projectId: string, data: CachedChatData): void {
  try {
    localStorage.setItem(getCacheKey(projectId), JSON.stringify(data));
  } catch {
    // localStorage may be full — silently fail
  }
}

function clearCache(projectId: string): void {
  try {
    localStorage.removeItem(getCacheKey(projectId));
  } catch {
    // ignore
  }
}

/** Cache all messages including progress (with toolCalls + logs for activity persistence) */
function serializeForCache(sessions: Map<string, AgentSession>): Array<[string, AgentSession]> {
  const out: Array<[string, AgentSession]> = [];
  for (const [id, session] of sessions) {
    // Cap messages per session to last 200 to avoid localStorage quota issues
    const cappedMessages = session.messages.length > 200
      ? session.messages.slice(-200)
      : session.messages;
    out.push([id, { ...session, messages: cappedMessages }]);
  }
  return out;
}

function deserializeFromCache(entries: Array<[string, AgentSession]>): Map<string, AgentSession> {
  return new Map(entries);
}

function subagentsForProjectParents(
  subagents: Map<string, SubagentInfo>,
  allowedParentSessionIds: Set<string>
): Array<[string, SubagentInfo]> {
  const out: Array<[string, SubagentInfo]> = [];
  for (const [id, sa] of subagents) {
    if (allowedParentSessionIds.has(sa.parentSessionId)) {
      out.push([id, sa]);
    }
  }
  return out;
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

function longerText(a?: string, b?: string): string | undefined {
  const al = a?.length ?? 0;
  const bl = b?.length ?? 0;
  if (bl > al) return b;
  return a ?? b;
}

function pickLongerArray<T>(a?: T[], b?: T[]): T[] | undefined {
  const la = a?.length ?? 0;
  const lb = b?.length ?? 0;
  if (lb > la) return b;
  return a ?? b;
}

/** Same logical message from API + cache — keep streaming fields from whichever copy is richer. */
function mergeRicherChatMessage(server: ChatMessage, cached: ChatMessage): ChatMessage {
  if (server.id !== cached.id || server.type !== cached.type) {
    return new Date(server.timestamp).getTime() >= new Date(cached.timestamp).getTime() ? server : cached;
  }
  const out: ChatMessage = { ...server };
  if (server.type === "progress") {
    out.thinking = longerText(server.thinking, cached.thinking);
    out.content = longerText(server.content, cached.content) ?? out.content;
    out.progress = Math.max(server.progress ?? 0, cached.progress ?? 0);
    out.toolCalls = pickLongerArray(server.toolCalls, cached.toolCalls) ?? out.toolCalls;
    out.logs = pickLongerArray(server.logs, cached.logs) ?? out.logs;
    out.timestamp =
      new Date(server.timestamp) >= new Date(cached.timestamp) ? server.timestamp : cached.timestamp;
    return out;
  }
  out.content = longerText(server.content, cached.content) ?? out.content;
  out.timestamp =
    new Date(server.timestamp) >= new Date(cached.timestamp) ? server.timestamp : cached.timestamp;
  return out;
}

/** Optimistic UI uses uid(); API uses msg-<uuid> — collapse same logical user/system/welcome line after merge. */
function semanticDedupeKey(m: ChatMessage): string | null {
  if (m.type === "user" || m.type === "system" || m.type === "welcome") {
    return `${m.type}:${m.sender}:${(m.content ?? "").trim()}`;
  }
  return null;
}

function preferDuplicateByBackendSource(a: ChatMessage, b: ChatMessage, backendIds: Set<string>): ChatMessage {
  const aBack = backendIds.has(a.id);
  const bBack = backendIds.has(b.id);
  if (aBack && !bBack) return a;
  if (!aBack && bBack) return b;
  return new Date(a.timestamp).getTime() <= new Date(b.timestamp).getTime() ? a : b;
}

function dedupeSemanticDuplicateMessages(sorted: ChatMessage[], backendIds: Set<string>): ChatMessage[] {
  const keyToWinner = new Map<string, ChatMessage>();
  for (const m of sorted) {
    const k = semanticDedupeKey(m);
    if (!k) continue;
    const cur = keyToWinner.get(k);
    keyToWinner.set(k, cur ? preferDuplicateByBackendSource(cur, m, backendIds) : m);
  }

  const out: ChatMessage[] = [];
  const emitted = new Set<string>();

  for (const m of sorted) {
    const k = semanticDedupeKey(m);
    if (!k) {
      out.push(m);
      continue;
    }
    const win = keyToWinner.get(k)!;
    if (m.id !== win.id) continue;
    if (emitted.has(k)) continue;
    emitted.add(k);
    out.push(win);
  }
  return out;
}

/**
 * When returning to Comms after navigation, API payloads can lag behind localStorage
 * (thinking, logs, system lines not persisted yet). Union by message id and sort by time.
 */
function mergeCachedMessagesIntoBackendSession(
  backendMessages: ChatMessage[],
  cachedMessages: ChatMessage[]
): ChatMessage[] {
  const backendIds = new Set(backendMessages.map((m) => m.id));
  const byId = new Map<string, ChatMessage>();
  for (const m of backendMessages) {
    byId.set(m.id, { ...m });
  }
  for (const cm of cachedMessages) {
    const existing = byId.get(cm.id);
    byId.set(cm.id, existing ? mergeRicherChatMessage(existing, cm) : { ...cm });
  }
  const sorted = [...byId.values()].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  return dedupeSemanticDuplicateMessages(sorted, backendIds);
}

function handleWSEvent(event: WSEvent, sessions: Map<string, AgentSession>, producerSessionId: string, recentApiMessages?: Set<string>): WSHandlerResult {
  const messages: WSHandlerResult["messages"] = [];
  switch (event.type) {
    case "agent:spawned": {
      const sid = event.sessionId;
      if (sessions.has(sid)) return { sessions: null, messages };
      const next = new Map(sessions);
      next.set(sid, {
        role: event.agent,
        messages: [
          { id: uid(), type: "system", sender: "SYSTEM", content: `${event.agent.toUpperCase()} session initialized.`, timestamp: timestamp() },
          { id: uid(), type: "progress", sender: event.agent, content: "Initializing...", timestamp: timestamp(), progress: 0 },
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
    case "chat:session:created": {
      const sid = event.session.id;
      if (sessions.has(sid)) return { sessions: null, messages };
      const next = new Map(sessions);
      next.set(sid, {
        role: event.session.role,
        messages: (event.session.messages as ChatMessage[]) ?? [],
        status: (event.session.status as "active" | "done") ?? "active",
        progress: event.session.progress ?? 0,
        spawnedAt: event.session.spawnedAt ?? timestamp(),
        fileOps: [],
      });
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

      // Fallback: append to progress message logs instead of creating system message
      const logContent = `[${event.level.toUpperCase()}] ${event.message}`;
      const progressIndex = session.messages.findIndex((m) => m.type === "progress");
      if (progressIndex !== -1) {
        const next = new Map(sessions);
        const progressMsg = session.messages[progressIndex];
        const existingLogs = progressMsg.logs ?? [];
        // Deduplicate: skip if same log already in last 10 entries
        if (!existingLogs.slice(-10).includes(logContent)) {
          next.set(targetSession, {
            ...session,
            messages: session.messages.map((m, idx) =>
              idx === progressIndex
                ? { ...m, logs: [...existingLogs, logContent] }
                : m
            ),
          });
          return { sessions: next, messages };
        }
        return { sessions: null, messages };
      }

      // No progress message — add as system message as last resort
      messages.push({ sessionRole: targetSession, msg: {
        type: "system",
        sender: "SYSTEM",
        content: logContent,
      }});
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
      const logContent = `[LOOP DETECTED] ${event.message}`;
      const session = sessions.get(event.sessionId);
      if (session) {
        const progressIndex = session.messages.findIndex((m) => m.type === "progress");
        if (progressIndex !== -1) {
          const next = new Map(sessions);
          const progressMsg = session.messages[progressIndex];
          const existingLogs = progressMsg.logs ?? [];
          if (!existingLogs.slice(-10).includes(logContent)) {
            next.set(event.sessionId, {
              ...session,
              messages: session.messages.map((m, idx) =>
                idx === progressIndex
                  ? { ...m, logs: [...existingLogs, logContent] }
                  : m
              ),
            });
            return { sessions: next, messages };
          }
          return { sessions: null, messages };
        }
      }
      // No progress message — add as system message as last resort
      messages.push({
        sessionRole: event.sessionId,
        msg: {
          type: "system",
          sender: "SYSTEM",
          content: logContent,
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
      logs: m.logs,
    })),
    status: s.status as "active" | "done" | "completed",
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
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const [subagents, setSubagents] = useState<Map<string, SubagentInfo>>(new Map());
  const [contextUsageMap, setContextUsageMap] = useState<Map<string, ContextUsage>>(new Map());
  const [contextPressure, setContextPressure] = useState<Map<string, number>>(new Map());
  const [compactingSessionId, setCompactingSessionId] = useState<string | null>(null);
  const [activityFeed, setActivityFeed] = useState<ActivityItem[]>([]);
  const [toastNotifications, setToastNotifications] = useState<ActivityItem[]>([]);
  const lastSpawnedRef = useRef<string | null>(null);
  const activityLogRef = useRef<string[]>([]);
  const addSessionMessageRef = useRef<(role: string, msg: Omit<ChatMessage, "id" | "timestamp">) => void | undefined>(undefined);
  const recentApiMessagesRef = useRef<Set<string>>(new Set());
  // Ref for latest sessions to flush cache on unmount / navigation
  const latestSessionsRef = useRef<Map<string, AgentSession>>(new Map());
  const latestSubagentsRef = useRef<Map<string, SubagentInfo>>(new Map());
  // F2: Ref for currentSession to avoid stale closures in async callbacks
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  const producerSessionIdRef = useRef(producerSessionId);
  producerSessionIdRef.current = producerSessionId;
  const sessionsRef = useRef<Map<string, AgentSession>>(new Map());
  const subagentsRef = useRef<Map<string, SubagentInfo>>(new Map());
  const contextUsageMapRef = useRef(contextUsageMap);
  contextUsageMapRef.current = contextUsageMap;
  const contextPressureRef = useRef(contextPressure);
  contextPressureRef.current = contextPressure;
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const messageQueueRef = useRef(messageQueue);
  messageQueueRef.current = messageQueue;
  // Refs for cache-flush values on unmount. These are read by the
  // `[]`-deps unmount-only effect (see the second localStorage save effect
  // below) which captures stale state on first render; the refs let the
  // cleanup see the latest values.
  const currentProjectIdRef = useRef(currentProjectId);
  currentProjectIdRef.current = currentProjectId;
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;
  const threadTitleRef = useRef(threadTitle);
  threadTitleRef.current = threadTitle;
  // Ref for executeCommand to avoid stale closures when dequeuing
  const executeCommandRef = useRef<(input: string, images?: string[], targetSessionId?: string) => void>(() => {});
  // Refs for queue-drain timers so we can cancel them on unmount. The three
  // setTimeouts at lines 2069, 2123, 2142 all schedule a recursive
  // executeCommand call 100ms after the previous response/error. Without
  // tracking them, navigating away mid-queue leaves dangling timers that
  // will call apiFetch on an unmounted component.
  const queueDrainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Local-storage save timer — debounced 500ms. The save itself runs in the
  // effect, the ref just lets us clear and reschedule from multiple sites.
  const cacheSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  latestSessionsRef.current = sessions;
  latestSubagentsRef.current = subagents;
  sessionsRef.current = sessions;
  subagentsRef.current = subagents;

  // Flush cache immediately on page unload to avoid losing recent messages
  useEffect(() => {
    if (!currentProjectId) return;
    const handler = () => {
      const sess = latestSessionsRef.current;
      saveCache(currentProjectId, {
        version: CACHE_VERSION,
        sessions: serializeForCache(sess),
        subagents: subagentsForProjectParents(latestSubagentsRef.current, new Set(sess.keys())),
        currentSession,
        threadId,
        threadTitle,
        isLoading: isLoadingRef.current,
        messageQueue: messageQueueRef.current,
        cachedAt: new Date().toISOString(),
      });
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [currentProjectId, sessions, currentSession, threadId, threadTitle]);

  // Fetch all sessions and ensure the producer session for the current
  // project exists (lazy-create via the dedicated endpoint).
  useEffect(() => {
    if (!currentProjectId) {
      setInitialized(true);
      return;
    }

    // Try loading from cache first for instant render
    const cached = loadCache(currentProjectId);
    if (cached) {
      const sessionMap = deserializeFromCache(cached.sessions);
      setAllSessions(sessionMap);
      // Reconstruct project ID map: all cached sessions belong to current project
      const projectIdMap = new Map<string, string | null>();
      for (const id of sessionMap.keys()) {
        projectIdMap.set(id, currentProjectId);
      }
      setAllSessionProjectIds(projectIdMap);
      setCurrentSession(cached.currentSession);
      setThreadId(cached.threadId);
      setThreadTitle(cached.threadTitle);
      if (cached.subagents?.length) {
        const allowedParents = new Set(sessionMap.keys());
        setSubagents(new Map(subagentsForProjectParents(new Map(cached.subagents), allowedParents)));
      }
      // Restore loading state and queue so they survive navigation
      if (cached.isLoading) {
        setIsLoading(true);
      }
      if (cached.messageQueue?.length) {
        setMessageQueue(cached.messageQueue);
      }
      setInitialized(true); // Show cached data immediately
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

        // Merge: for active sessions, union cached messages with API by id so streaming
        // fields (thinking, logs, toolCalls) and lines not yet persisted survive navigation.
        const cachedForMerge = loadCache(currentProjectId);
        if (cachedForMerge) {
          const cachedMap = deserializeFromCache(cachedForMerge.sessions);
          for (const [id, backendSession] of sessionMap) {
            const cachedSession = cachedMap.get(id);
            if (cachedSession && backendSession.status !== "done" && backendSession.status !== "completed") {
              const mergedMessages = mergeCachedMessagesIntoBackendSession(
                backendSession.messages,
                cachedSession.messages
              );
              sessionMap.set(id, { ...backendSession, messages: mergedMessages });
            }
          }
        }

        setAllSessions(sessionMap);
        setAllSessionProjectIds(projectIdMap);
        const restoredTab =
          cachedForMerge?.currentSession && sessionMap.has(cachedForMerge.currentSession)
            ? cachedForMerge.currentSession
            : producerSession.id;
        setCurrentSession(restoredTab);
        setThreadId(`#${Math.floor(Math.random() * 9000 + 1000)}`);
        setThreadTitle("BOARD_ROOM");

        if (cachedForMerge?.subagents?.length) {
          const allowedParents = new Set(sessionMap.keys());
          const fromCache = subagentsForProjectParents(new Map(cachedForMerge.subagents), allowedParents);
          setSubagents((prev) => {
            const next = new Map(prev);
            for (const [id, sa] of fromCache) {
              if (!next.has(id)) next.set(id, sa);
            }
            return next;
          });
        }

        // Reset isLoading if no session has an active progress message (agent finished while away)
        const anyProgress = [...sessionMap.values()].some(
          (s) => s.messages.some((m) => m.type === "progress")
        );
        if (!anyProgress) {
          setIsLoading(false);
          setMessageQueue([]);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch chat sessions:", error);
        // If API fails and we have no cached data, we're already initialized with empty state
      } finally {
        if (!cancelled) setInitialized(true);
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  // Debounced cache save — serialize all messages including progress with toolCalls + logs.
  // We debounce so a stream of WS events doesn't trigger a synchronous
  // localStorage write per message. The previous implementation also did a
  // full sync write in the cleanup, which ran on every dep change — that's
  // the same write the debounce was trying to avoid, so the cleanup now only
  // clears the pending timer. The final save on unmount/navigation is done
  // in a separate `[]`-deps effect below.
  useEffect(() => {
    if (!currentProjectId || !initialized) return;

    if (cacheSaveTimerRef.current) clearTimeout(cacheSaveTimerRef.current);
    cacheSaveTimerRef.current = setTimeout(() => {
      saveCache(currentProjectId, {
        version: CACHE_VERSION,
        sessions: serializeForCache(sessions),
        subagents: subagentsForProjectParents(subagents, new Set(sessions.keys())),
        currentSession,
        threadId,
        threadTitle,
        isLoading,
        messageQueue,
        cachedAt: new Date().toISOString(),
      });
    }, 500);

    return () => {
      if (cacheSaveTimerRef.current) {
        clearTimeout(cacheSaveTimerRef.current);
        cacheSaveTimerRef.current = null;
      }
    };
  }, [sessions, subagents, currentSession, threadId, threadTitle, currentProjectId, initialized, isLoading, messageQueue]);

  // Unmount-only flush. Reads the latest values from refs (set in
  // parallel with the state, see lines around 805) so we always save the
  // freshest data even if the cleanup fires before the debounced effect had
  // a chance to run.
  useEffect(() => {
    return () => {
      const projectId = currentProjectIdRef.current;
      if (!projectId) return;
      const sess = latestSessionsRef.current;
      saveCache(projectId, {
        version: CACHE_VERSION,
        sessions: serializeForCache(sess),
        subagents: subagentsForProjectParents(latestSubagentsRef.current, new Set(sess.keys())),
        currentSession: currentSessionRef.current,
        threadId: threadIdRef.current,
        threadTitle: threadTitleRef.current,
        isLoading: isLoadingRef.current,
        messageQueue: messageQueueRef.current,
        cachedAt: new Date().toISOString(),
      });
    };
  }, []);

  useEffect(() => {
    setActivityFeed([]);
    setToastNotifications([]);
  }, [currentProjectId]);

  // Cancel any pending queue-drain or cache-save timer on unmount. The
  // queue-drain timer would otherwise fire executeCommand on an unmounted
  // component if the user navigates away within 100ms of a response. The
  // cache-save timer is a no-op on its own (the debounced effect re-runs
  // when deps change), but clearing it avoids a stale write right before
  // teardown.
  useEffect(() => {
    return () => {
      if (queueDrainTimerRef.current) {
        clearTimeout(queueDrainTimerRef.current);
        queueDrainTimerRef.current = null;
      }
      if (cacheSaveTimerRef.current) {
        clearTimeout(cacheSaveTimerRef.current);
        cacheSaveTimerRef.current = null;
      }
    };
  }, []);

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
    const recordActivity = (item: Omit<ActivityItem, "id" | "timestamp">, toast = false) => {
      const entry: ActivityItem = {
        id: uid(),
        timestamp: timestamp(),
        ...item,
      };
      setActivityFeed((prev) => [entry, ...prev].slice(0, 24));
      if (toast) {
        setToastNotifications((prev) => [entry, ...prev].slice(0, 4));
      }
    };

    // Specialist chat sessions — avoid brief filter gap before chat:session:created arrives
    if (event.type === "agent:spawned") {
      const pid = event.projectId;
      if (pid) {
        setAllSessionProjectIds((prev) => {
          const next = new Map(prev);
          next.set(event.sessionId, pid);
          return next;
        });
      }
    }

    // Handle subagent events separately (they don't create full sessions)
    switch (event.type) {
      case "subagent:spawned": {
        recordActivity({
          kind: "spawned",
          title: `${event.agentRole} started`,
          detail: event.task,
        });
        setSubagents((prev) => {
          const next = new Map(prev);
          next.set(event.ticketId, {
            id: event.ticketId,
            role: event.agentRole,
            parentSessionId: event.parentSessionId,
            ticketId: event.ticketId,
            task: event.task,
            status: "active",
            spawnedAt: timestamp(),
          });
          return next;
        });
        break;
      }
      case "subagent:completed": {
        recordActivity({
          kind: "completed",
          title: `${event.agentRole} completed`,
          detail: event.output || "Subagent finished its task.",
        }, true);
        setSubagents((prev) => {
          const existing = prev.get(event.ticketId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(event.ticketId, {
            ...existing,
            status: "completed",
            output: event.output,
          });
          return next;
        });
        break;
      }
      case "subagent:failed": {
        recordActivity({
          kind: "failed",
          title: `${event.agentRole} failed`,
          detail: event.error,
        }, true);
        setSubagents((prev) => {
          const existing = prev.get(event.ticketId);
          if (!existing) return prev;
          const next = new Map(prev);
          next.set(event.ticketId, {
            ...existing,
            status: "failed",
            error: event.error,
          });
          return next;
        });
        break;
      }

      // ── Autonomous loop events ────────────────────────────────────────────
      case "autonomous:iteration:started": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "status",
            title: `Loop iteration ${event.iteration}`,
            detail: `${event.agentRole} started ${event.title}`,
          });
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Iteration ${event.iteration} started — ${event.agentRole} is working on: ${event.title}`,
        });
        break;
      }
      case "autonomous:iteration:completed": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "completed",
            title: `Loop iteration ${event.iteration} completed`,
            detail: `${event.agentRole} finished ticket ${event.ticketId}`,
          }, true);
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Iteration ${event.iteration} done — ${event.agentRole} completed ticket ${event.ticketId}. Total done: ${event.completedCount}`,
        });
        break;
      }
      case "autonomous:iteration:failed": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "failed",
            title: `Loop iteration ${event.iteration} failed`,
            detail: `${event.agentRole} on ${event.ticketId}: ${event.error}`,
          }, true);
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Iteration ${event.iteration} failed — ${event.agentRole} on ${event.ticketId}: ${event.error}`,
        });
        break;
      }
      case "autonomous:completed": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "completed",
            title: "Autonomous loop finished",
            detail: `${event.completedCount} completed, ${event.failedCount} failed`,
          }, true);
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Autonomous loop finished. Completed: ${event.completedCount}, Failed: ${event.failedCount}, Total: ${event.totalIterations}`,
        });
        break;
      }
      case "autonomous:stopped": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "status",
            title: "Autonomous loop stopped",
            detail: `${event.completedCount} completed, ${event.failedCount} failed`,
          });
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Autonomous loop stopped by user. Completed: ${event.completedCount}, Failed: ${event.failedCount}`,
        });
        break;
      }
      case "autonomous:error": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "failed",
            title: "Autonomous loop error",
            detail: event.error,
          }, true);
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[Loop] Error: ${event.error}`,
        });
        break;
      }

      // ── GDD ingestion event ─────────────────────────────────────────────────
      case "gdd:ingested": {
        const targetSessionId = event.sessionId;
        const isCurrentProjectEvent = targetSessionId === producerSessionIdRef.current;
        if (isCurrentProjectEvent) {
          recordActivity({
            kind: "status",
            title: "GDD ingested",
            detail: `${event.created} tickets created, ${event.skipped} skipped`,
          });
        }
        addSessionMessage(targetSessionId, {
          type: "system",
          sender: "SYSTEM",
          content: `[GDD] Ingested ${event.total} items — created ${event.created} tickets, skipped ${event.skipped} duplicates.`,
        });
        break;
      }
    }

    // Handle chat:context — real-time token usage from API
    if (event.type === "chat:context") {
      setContextUsageMap((prev) => {
        const next = new Map(prev);
        next.set(event.sessionId, event.contextUsage);
        return next;
      });
    }

    // Handle chat:context-pressure — context window filling up
    if (event.type === "chat:context-pressure") {
      setContextPressure((prev) => {
        const next = new Map(prev);
        next.set(event.sessionId, event.fillPercent);
        return next;
      });
    }

    // Handle chat:session:compacted — session compacted into new generation
    if (event.type === "chat:session:compacted") {
      // Switch to the new session
      setCurrentSession(event.newSession.id);
      // Clear pressure for the old session
      setContextPressure((prev) => {
        const next = new Map(prev);
        next.delete(event.oldSessionId);
        return next;
      });
    }

    // Handle chat:session:created to update projectId mapping (for sessions created by other clients or after refresh)
    if (event.type === "chat:session:created" && event.session?.id) {
      const sid = event.session.id;
      const pid = event.session.projectId ?? null;
      setAllSessionProjectIds((prev) => {
        if (prev.get(sid) === pid) return prev;
        const next = new Map(prev);
        next.set(sid, pid);
        return next;
      });
    }

    setAllSessions((prevSessions) => {
      const updated = handleWSEvent(event, prevSessions, producerSessionIdRef.current, recentApiMessagesRef.current);
      // Build a single new map instead of reassigning the prevSessions
      // parameter — reassigning the React updater argument is an anti-pattern
      // (Strict Mode invokes the updater twice in dev) and on a fast event
      // stream can lose intermediate messages. Start from the handler's
      // result if it produced one; otherwise from prevSessions.
      let next = updated.sessions ?? prevSessions;
      for (const { sessionRole, msg } of updated.messages) {
        const session = next.get(sessionRole);
        if (session) {
          const merged = new Map(next);
          merged.set(sessionRole, {
            ...session,
            messages: [...session.messages, { ...msg, id: uid(), timestamp: timestamp() }],
          });
          next = merged;
        }
      }
      return next;
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
    // Also map the new session to the current project so it passes the session filter
    setAllSessionProjectIds((prev) => {
      const next = new Map(prev);
      next.set(r, projectId);
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

  const executeCommand = useCallback((input: string, images?: string[], targetSessionId?: string) => {
    let trimmed = input.trim();
    if (!trimmed && (!images || images.length === 0)) return;
    // Backend requires non-empty content; attach placeholder when only images are sent
    if (!trimmed && images && images.length > 0) {
      trimmed = "[Image attached]";
    }

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
          }).catch((err) => {
            // Silently ignore if session already gone
            if (err instanceof Error && err.message.includes("Session not found")) return;
            console.error("Failed to clear session:", err);
          });

          setAllSessions((prev) => {
            const next = new Map(prev);
            const session = next.get(targetSession);
            if (session) {
              next.set(targetSession, { ...session, messages: [] });
            }
            return next;
          });
          // Clear localStorage cache when chat is cleared
          if (currentProjectId) {
            clearCache(currentProjectId);
          }
          addSessionMessage(targetSession, { type: "system", sender: "SYSTEM", content: "Chat cleared." });
          return;
        }
        case "stop": {
          const queueCount = messageQueueRef.current.length;
          setMessageQueue([]);
          setIsLoading(false);
          addSessionMessage(producerSessionIdRef.current, {
            type: "system",
            sender: "SYSTEM",
            content: queueCount > 0
              ? `Stopped. Cleared ${queueCount} queued message(s).`
              : "Stopped. No queued messages.",
          });
          return;
        }
        case "help": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          addSessionMessage(producerSessionIdRef.current, {
            type: "agent",
            sender: "producer",
            content: `Available commands:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Production:
  /autonomous          — Start autonomous production loop
  /autonomous stop     — Stop the loop
  /plan <query>        — Create execution plan
  /sprint              — Summarize current sprint
  /verify [ticket]     — Run auto-verification
  /inject <text>       — Inject context into producer

Orchestration:
  /spawn <agent>       — Manually spawn an agent
  /approve             — Approve last agent request
  /done <agent>        — Complete agent task
  /consult <director>  — Consult a director
  /tree                — Show agent hierarchy

Session:
  /clear               — Clear the chat
  /stop                — Stop processing + clear queue
  /compact             — Compact into new generation
  /context             — Show context window usage
  /cost                — Show token usage (legacy)
  /export              — Export session as markdown

Workflows:
  /ralphloop <task>    — Run research→plan→code→verify loop

Production:
  /plan [query]        — Create execution plan
  /sprint              — Summarize current sprint
  /verify [ticket]     — Run auto-verification
  /inject <text>       — Inject context into producer

Utilities:
  /diff                — Show recent changes
  /help                — Show this message
  /mcp                 — Check Godot MCP status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Also: spawn <agent>, approve, done <agent>`,
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
          const usage = contextUsageMap.get(producerSessionIdRef.current);
          if (usage) {
            const pct = Math.round((usage.lastInputTokens / usage.contextWindowTokens) * 100);
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: `Token Usage (API-reported):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Last Input:    ${usage.lastInputTokens.toLocaleString()} tokens
Last Output:   ${usage.lastOutputTokens.toLocaleString()} tokens
Cumulative In: ${usage.cumulativeInputTokens.toLocaleString()} tokens
Cumulative Out:${usage.cumulativeOutputTokens.toLocaleString()} tokens
Context Fill:  ${pct}% (${usage.lastInputTokens.toLocaleString()} / ${usage.contextWindowTokens.toLocaleString()})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              showActions: false,
            });
          } else {
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: "No token usage data yet. Send a message to start tracking.",
              showActions: false,
            });
          }
          return;
        }
        case "compact": {
          const sid = producerSessionIdRef.current;
          if (!sid) return;
          addSessionMessage(sid, { type: "user", sender: "DIRECTOR", content: trimmed });
          compactSession(sid);
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
        case "context": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          const usage = contextUsageMapRef.current.get(producerSessionIdRef.current);
          const pressure = contextPressureRef.current.get(producerSessionIdRef.current);
          if (usage) {
            const pct = Math.round((usage.lastInputTokens / usage.contextWindowTokens) * 100);
            const pressurePct = pressure ?? 0;
            const filled = Math.round(pressurePct / 5);
            const pressureBar = "█".repeat(filled) + "░".repeat(20 - filled);
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: `Context Window Usage\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nLast Input:    ${usage.lastInputTokens.toLocaleString()} tokens\nLast Output:   ${usage.lastOutputTokens.toLocaleString()} tokens\nCumulative In: ${usage.cumulativeInputTokens.toLocaleString()} tokens\nCumulative Out:${usage.cumulativeOutputTokens.toLocaleString()} tokens\nContext Fill:  ${pct}% (${usage.lastInputTokens.toLocaleString()} / ${usage.contextWindowTokens.toLocaleString()})\nPressure:      ${pressurePct}% [${pressureBar}]\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
              showActions: false,
            });
          } else {
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: "No context usage data yet. Send a message to start tracking.",
              showActions: false,
            });
          }
          return;
        }
        case "tree": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          const sess = sessionsRef.current;
          const subs = subagentsRef.current;
          let tree = "Agent Hierarchy\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";
          const producer = [...sess.values()].find((s) => isProducerSession(s.role));
          if (producer) {
            tree += `📋 ${producer.role.toUpperCase()} (${producer.status})\n`;
          }
          const agents = [...sess.values()].filter((s) => !isProducerSession(s.role));
          if (agents.length > 0) {
            tree += "\nActive Sessions:\n";
            for (const a of agents) {
              tree += `  🤖 ${a.role} — ${a.progress}% (${a.status})\n`;
            }
          }
          if (subs.size > 0) {
            tree += "\nSub-agents:\n";
            for (const [, sa] of subs) {
              tree += `  ⚡ ${sa.role} — ${sa.status} [${sa.ticketId}]\n`;
            }
          }
          if (agents.length === 0 && subs.size === 0) {
            tree += "\nNo active agents or sub-agents.";
          }
          tree += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
          addSessionMessage(producerSessionIdRef.current, {
            type: "agent",
            sender: "producer",
            content: tree,
            showActions: false,
          });
          return;
        }
        case "autonomous": {
          const pid = currentProjectId;
          if (!pid) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "No project selected." });
            return;
          }
          const sid = producerSessionIdRef.current;
          if (args.trim() === "stop") {
            addSessionMessage(sid, { type: "user", sender: "DIRECTOR", content: trimmed });
            apiFetch<{ success: boolean; data?: { status: string } }>("/api/autonomous/stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId: sid }),
            })
              .then((result) => {
                addSessionMessage(sid, {
                  type: "system",
                  sender: "SYSTEM",
                  content: result.success ? "Autonomous loop stopped." : `Failed to stop: ${JSON.stringify(result.data)}`,
                });
              })
              .catch((err) => {
                addSessionMessage(sid, { type: "system", sender: "SYSTEM", content: `Stop failed: ${err instanceof Error ? err.message : "Unknown error"}` });
              });
            return;
          }
          addSessionMessage(sid, { type: "user", sender: "DIRECTOR", content: trimmed });
          setIsLoading(true);
          apiFetch<{ success: boolean; data?: { status: string; maxIterations: number } }>("/api/autonomous/start", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId: sid, projectId: pid, maxIterations: 50 }),
          })
            .then((result) => {
              setIsLoading(false);
              if (result.success) {
                addSessionMessage(sid, {
                  type: "system",
                  sender: "SYSTEM",
                  content: `Autonomous production loop started. Max iterations: ${result.data?.maxIterations ?? 50}. The Producer will now orchestrate the pipeline without human intervention.`,
                });
              } else {
                addSessionMessage(sid, { type: "system", sender: "SYSTEM", content: `Autonomous loop already running or failed to start.` });
              }
            })
            .catch((err) => {
              setIsLoading(false);
              addSessionMessage(sid, { type: "system", sender: "SYSTEM", content: `Failed to start autonomous loop: ${err instanceof Error ? err.message : "Unknown error"}` });
            });
          return;
        }
        case "consult": {
          if (!args) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: /consult <director-role> (e.g., /consult creative-director)" });
            return;
          }
          const director = args.trim().toLowerCase();
          const validDirectors = ["creative-director", "technical-director", "art-director", "narrative-director", "audio-director"];
          if (!validDirectors.includes(director)) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: `Unknown director: ${director}. Valid: ${validDirectors.join(", ")}` });
            return;
          }
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          spawnAgent(director, "Consultation session — awaiting director's expertise.");
          return;
        }
        case "mcp": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          const pid = currentProjectId;
          if (!pid) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "No project selected." });
            return;
          }
          apiFetch<{ success: boolean; data: { status: string; projectInfo?: { name: string; version: string }; error?: string } }>(
            `/api/dashboard/projects/${pid}/mcp-health`
          )
            .then((result) => {
              const data = result.data;
              let msg = `Godot MCP Status\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
              msg += `Status: ${data.status.toUpperCase()}\n`;
              if (data.projectInfo) {
                msg += `Project: ${data.projectInfo.name} (${data.projectInfo.version})\n`;
              }
              if (data.error) {
                msg += `Error: ${data.error}\n`;
              }
              msg += "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
              addSessionMessage(producerSessionIdRef.current, { type: "agent", sender: "producer", content: msg, showActions: false });
            })
            .catch((err) => {
              addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: `MCP check failed: ${err instanceof Error ? err.message : "Unknown error"}` });
            });
          return;
        }
        case "export": {
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          const targetSession = currentSessionRef.current;
          const session = sessionsRef.current.get(targetSession);
          if (!session || session.messages.length === 0) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "No messages to export in current session." });
            return;
          }
          let md = `# Chat Export — ${session.role}\n\n`;
          md += `Generated: ${new Date().toISOString()}\n\n`;
          md += `---\n\n`;
          for (const m of session.messages) {
            const time = new Date(m.timestamp).toLocaleString();
            md += `**${m.sender}** — ${time}\n\n`;
            md += `${m.content}\n\n`;
            md += `---\n\n`;
          }
          navigator.clipboard.writeText(md).then(() => {
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: `Exported ${session.messages.length} messages to clipboard as markdown.`,
              showActions: false,
            });
          }).catch(() => {
            addSessionMessage(producerSessionIdRef.current, {
              type: "agent",
              sender: "producer",
              content: `Export ready (${session.messages.length} messages):\n\n\`\`\`markdown\n${md.slice(0, 2000)}${md.length > 2000 ? "\n... (truncated)" : ""}\n\`\`\``,
              showActions: false,
            });
          });
          return;
        }
        case "plan":
        case "sprint":
        case "verify":
        case "inject": {
          const sid = producerSessionIdRef.current;
          let prompt = "";
          if (cmd === "plan") {
            if (!args) {
              addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: /plan <query> — e.g., /plan design a combat system" });
              return;
            }
            prompt = `[PLAN REQUEST] ${args}`;
          } else if (cmd === "sprint") {
            prompt = "[SPRINT SUMMARY] Summarize the current sprint progress, active tickets, and recent completions.";
          } else if (cmd === "verify") {
            prompt = `[VERIFY REQUEST] Run auto-verification on ticket: ${args || "all pending"}`;
          } else if (cmd === "inject") {
            if (!args) {
              addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: /inject <context-text> — inject custom context into the producer prompt" });
              return;
            }
            prompt = `[CONTEXT INJECTION] ${args}`;
          }
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          setIsLoading(true);
          apiFetch<{ assistantMessage?: { content: string; type: string; sender: string } }>(
            `/api/chat/sessions/${sid}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "user", sender: "DIRECTOR", content: prompt }),
            }
          )
            .then((result) => {
              setIsLoading(false);
              if (result.assistantMessage) {
                addSessionMessage(sid, {
                  type: result.assistantMessage.type as ChatMessage["type"],
                  sender: result.assistantMessage.sender,
                  content: result.assistantMessage.content,
                  showActions: false,
                });
              }
            })
            .catch((err) => {
              setIsLoading(false);
              addSessionMessage(sid, { type: "system", sender: "SYSTEM", content: `/${cmd} failed: ${err instanceof Error ? err.message : "Unknown error"}` });
            });
          return;
        }
        case "ralphloop": {
          const sid = producerSessionIdRef.current;
          if (!args) {
            addSessionMessage(producerSessionIdRef.current, { type: "system", sender: "SYSTEM", content: "Usage: /ralphloop <task> — e.g., /ralphloop implement player combat system" });
            return;
          }
          addSessionMessage(producerSessionIdRef.current, { type: "user", sender: "DIRECTOR", content: trimmed });
          setIsLoading(true);
          const prompt = `[RALPHLOOP REQUEST] ${args}`;
          apiFetch<{ assistantMessage?: { content: string; type: string; sender: string } }>(
            `/api/chat/sessions/${sid}/messages`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "user", sender: "DIRECTOR", content: prompt }),
            }
          )
            .then((result) => {
              setIsLoading(false);
              if (result.assistantMessage) {
                addSessionMessage(sid, {
                  type: result.assistantMessage.type as ChatMessage["type"],
                  sender: result.assistantMessage.sender,
                  content: result.assistantMessage.content,
                  showActions: false,
                });
              }
            })
            .catch((err) => {
              setIsLoading(false);
              addSessionMessage(sid, { type: "system", sender: "SYSTEM", content: `/ralphloop failed: ${err instanceof Error ? err.message : "Unknown error"}` });
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
    const session = targetSessionId ?? currentSessionRef.current;

    // If already processing, queue the message instead of sending immediately
    if (isLoadingRef.current) {
      setMessageQueue((prev) => [...prev, { input: trimmed, images, targetSessionId }]);
      addSessionMessage(session, {
        type: "system",
        sender: "SYSTEM",
        content: `Queued (${messageQueueRef.current.length + 1}): "${trimmed.slice(0, 40)}${trimmed.length > 40 ? "..." : ""}"`,
      });
      return;
    }

    addSessionMessage(session, { type: "user", sender: "DIRECTOR", content: trimmed, images });

    setIsLoading(true);

    // Safety timeout — unlock input after 5 minutes even if LLM loop hangs
    const loadingTimeout = setTimeout(() => {
      setIsLoading(false);
      addSessionMessage(session, {
        type: "system",
        sender: "SYSTEM",
        content: "Response is still processing in the background. You can send another message.",
      });
      // Process next in queue after timeout
      const queue = messageQueueRef.current;
      if (queue.length > 0) {
        const [next, ...rest] = queue;
        setMessageQueue(rest);
        if (queueDrainTimerRef.current) clearTimeout(queueDrainTimerRef.current);
        queueDrainTimerRef.current = setTimeout(
          () => executeCommandRef.current(next.input, next.images, next.targetSessionId),
          100,
        );
      }
    }, 5 * 60 * 1000);

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
        clearTimeout(loadingTimeout);
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
        // Process next in queue
        const queue = messageQueueRef.current;
        if (queue.length > 0) {
          const [next, ...rest] = queue;
          setMessageQueue(rest);
          if (queueDrainTimerRef.current) clearTimeout(queueDrainTimerRef.current);
          queueDrainTimerRef.current = setTimeout(
            () => executeCommandRef.current(next.input, next.images, next.targetSessionId),
            100,
          );
        }
      })
      .catch((error) => {
        clearTimeout(loadingTimeout);
        setIsLoading(false);
        if (!(error instanceof Error && error.message.includes("Session not found"))) {
          console.error("Failed to send message:", error);
        }
        addSessionMessage(session, {
          type: "system",
          sender: "SYSTEM",
          content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
        });
        // Process next in queue even on error
        const queue = messageQueueRef.current;
        if (queue.length > 0) {
          const [next, ...rest] = queue;
          setMessageQueue(rest);
          if (queueDrainTimerRef.current) clearTimeout(queueDrainTimerRef.current);
          queueDrainTimerRef.current = setTimeout(
            () => executeCommandRef.current(next.input, next.images, next.targetSessionId),
            100,
          );
        }
      });
  }, [addSessionMessage, spawnAgent, approveAgent]);

  // Keep ref updated for queue processing
  executeCommandRef.current = executeCommand;

  const requestProducerAction = useCallback((input: string) => {
    const sid = producerSessionIdRef.current;
    if (!sid) return;
    executeCommandRef.current(input, undefined, sid);
  }, []);

  const closeSession = useCallback((role: string) => {
    // Delete from backend so it doesn't reappear on refresh
    apiFetch(`/api/chat/sessions/${role}`, { method: "DELETE" }).catch((err) => {
      // Silently ignore if session already gone — stale cache or already closed
      if (err instanceof Error && err.message.includes("Session not found")) return;
      console.error("Failed to delete session:", err);
    });
    setAllSessions((prev) => {
      const next = new Map(prev);
      next.delete(role);
      return next;
    });
    // Switch back to producer if we closed the current session
    setCurrentSession((current) => (current === role ? producerSessionIdRef.current : current));
  }, []);

  /** Close a director consultation session and forward summary to producer */
  const closeConsultation = useCallback(async (sessionId: string, summary?: string) => {
    try {
      const result = await apiFetch<{ success: boolean; summary?: string }>(
        `/api/chat/sessions/${sessionId}/close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary }),
        }
      );

      // Switch back to producer if this was the current session
      // The WebSocket chat:session:deleted event will remove the session from the map
      setCurrentSession((current) =>
        current === sessionId ? producerSessionIdRef.current : current
      );

      return result;
    } catch (err) {
      // 404 = session already gone — treat as success
      if (err instanceof Error && (err.message.includes("404") || err.message.includes("Session not found"))) {
        setCurrentSession((current) =>
          current === sessionId ? producerSessionIdRef.current : current
        );
        return { success: true, summary: "Already closed" };
      }
      console.error("Failed to close consultation:", err);
      throw err;
    }
  }, []);

  // Derived state — memoized to avoid unnecessary re-renders
  const currentMessages = useMemo(() => sessions.get(currentSession)?.messages ?? [], [sessions, currentSession]);
  const totalProgress = useMemo(() => {
    const active = [...sessions.values()].filter((s) => s.role !== "producer" && s.status === "active");
    return active.length > 0
      ? Math.round(active.reduce((sum, s) => sum + s.progress, 0) / active.length)
      : 0;
  }, [sessions]);

  const visibleSubagents = useMemo(() => {
    const allowedParents = new Set(sessions.keys());
    const out = new Map<string, SubagentInfo>();
    for (const [id, sa] of subagents) {
      if (allowedParents.has(sa.parentSessionId)) out.set(id, sa);
    }
    return out;
  }, [subagents, sessions]);

  const producerUIState = useMemo<ProducerUIState>(() => {
    const activeDelegatedSessions = [...sessions.entries()].filter(
      ([id, session]) => !isProducerSession(id) && session.status === "active"
    ).length;
    const activeDelegatedSubagents = [...visibleSubagents.values()].filter(
      (subagent) => subagent.status === "active"
    ).length;
    const producerThinking = currentSession === producerSessionId && isLoading;

    if (producerThinking) {
      return {
        mode: "thinking",
        label: "Producer Thinking",
        detail: "The board room is actively reasoning right now. You can keep typing and your next message will queue.",
        activeDelegatedSessions,
        activeDelegatedSubagents,
      };
    }

    if (activeDelegatedSessions > 0 || activeDelegatedSubagents > 0) {
      const parts: string[] = [];
      if (activeDelegatedSessions > 0) {
        parts.push(`${activeDelegatedSessions} agent session${activeDelegatedSessions === 1 ? "" : "s"}`);
      }
      if (activeDelegatedSubagents > 0) {
        parts.push(`${activeDelegatedSubagents} subagent${activeDelegatedSubagents === 1 ? "" : "s"}`);
      }
      return {
        mode: "delegated",
        label: "Delegated Work In Flight",
        detail: `Producer is available while ${parts.join(" and ")} continue in the background.`,
        activeDelegatedSessions,
        activeDelegatedSubagents,
      };
    }

    return {
      mode: "available",
      label: "Producer Available",
      detail: "No active producer reasoning loop and no delegated work currently running.",
      activeDelegatedSessions,
      activeDelegatedSubagents,
    };
  }, [sessions, visibleSubagents, currentSession, producerSessionId, isLoading]);

  const compactSession = useCallback(async (sessionId: string) => {
    if (process.env.NODE_ENV !== "production") {
      console.log("[Compact] Requested for sessionId:", sessionId, "producerRef:", producerSessionIdRef.current);
    }
    setCompactingSessionId(sessionId);
    addSessionMessage(producerSessionIdRef.current, {
      type: "system",
      sender: "SYSTEM",
      content: "Compacting session...",
    });
    try {
      const result = await apiFetch<{ session: { id: string; generation?: number }; oldSessionId: string }>(
        `/api/chat/sessions/${encodeURIComponent(sessionId)}/compact`,
        { method: "POST" },
      );
      if (result.session) {
        addSessionMessage(result.session.id, {
          type: "system",
          sender: "SYSTEM",
          content: `Session compacted to generation ${result.session.generation ?? 2}. Context reset.`,
        });
      }
    } catch (err) {
      addSessionMessage(producerSessionIdRef.current, {
        type: "system",
        sender: "SYSTEM",
        content: `Compact failed: ${(err as Error).message}`,
      });
    } finally {
      setCompactingSessionId(null);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToastNotifications((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  return {
    sessions,
    subagents: visibleSubagents,
    currentSession,
    currentMessages,
    contextUsageMap,
    contextPressure,
    compactSession,
    compactingSessionId,
    threadId,
    threadTitle,
    totalProgress,
    executeCommand,
    requestProducerAction,
    selectSession: setCurrentSession,
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
  };
}
