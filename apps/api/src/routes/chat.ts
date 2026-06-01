import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { join } from "node:path";
import type { AgentRole, ChatSession, ChatMessage, CreateMessageRequest, CreateChatSessionRequest, ContextUsage, DashboardData, Project, ProjectEngine } from "@game-studio/types";
import { emptyProducerSummarySnapshot, ingestProducerSummaryFact } from "../services/producer-summary.js";
import type { LLMMessage } from "../llm/zai-client.js";
import { broadcastEvent, readData, writeData } from "../services/data-store.js";
import { invokeAgent, continueConversation, type ProjectContext, detectEngineFromWorkspace } from "../services/llm-service.js";
import { makeProgressCallback } from "../services/llm-service.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import type { WSEvent } from "@game-studio/types";
import { broadcast } from "../services/websocket.js";
import { startWorkflow, advanceStage, completeWorkflow, cleanupWorkflow, getWorkflow, createQuestTicket, moveQuestTicket } from "../services/quest-bridge.js";
import { triggerVerification } from "../services/verification-service.js";
import { getOrCreateGodotMCPService, removeGodotMCPService, launchGodotEditor, type GodotMCPServiceOptions } from "../services/godot-mcp-service.js";
import { logger } from "../utils/logger.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { loadConfig } from "../config.js";
import { getModelContextWindow, getModelForTier, MAX_CONTEXT_TOKENS, CHARS_PER_TOKEN_ESTIMATE } from "../config/model-mapping.js";

export const chatRouter: Router = Router();

// Ensure chatStore is loaded before any route handler runs
chatRouter.use((_req: Request, _res: Response, next: NextFunction) => {
  chatStoreReady.then(() => next()).catch(next);
});

/** Parse question data from tool call results */
interface QuestionData {
  questionId: string;
  question: string;
  options: { id: string; label: string; description?: string }[];
  allowMultiple: boolean;
  allowCustomInput: boolean;
}

function parseQuestionFromToolResult(toolCalls?: { name: string; input: Record<string, unknown> }[]): QuestionData | null {
  if (!toolCalls) return null;
  for (const tc of toolCalls) {
    if (tc.name === "AskUserQuestion" && tc.input) {
      try {
        // The tool returns JSON string in the input field
        const inputStr = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input);
        const parsed = JSON.parse(inputStr);
        if (parsed.__QUESTION__) {
          return {
            questionId: parsed.questionId,
            question: parsed.question,
            options: parsed.options,
            allowMultiple: parsed.allowMultiple,
            allowCustomInput: parsed.allowCustomInput,
          };
        }
      } catch {
        // Try parsing from raw input
        if (typeof tc.input === "object") {
          const input = tc.input as Record<string, unknown>;
          if (input.questionId && input.question && input.options) {
            return {
              questionId: input.questionId as string,
              question: input.question as string,
              options: input.options as QuestionData["options"],
              allowMultiple: (input.allowMultiple as boolean) ?? false,
              allowCustomInput: (input.allowCustomInput as boolean) ?? false,
            };
          }
        }
      }
    }
  }
  return null;
}

interface PlanPhase {
  id: string;
  label: string;
  description?: string;
  status: "pending" | "active" | "completed";
  estimatedEffort?: string;
}

function parsePlanPhasesFromToolResult(toolCalls?: { name: string; input: Record<string, unknown> }[]): PlanPhase[] | null {
  if (!toolCalls) return null;
  for (const tc of toolCalls) {
    if (tc.name === "ProposePlan" && tc.input) {
      try {
        const inputStr = typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input);
        const parsed = JSON.parse(inputStr);
        if (parsed.__PLAN__) {
          return parsed.phases.map((p: { id: string; label: string; description?: string; estimatedEffort?: string }) => ({
            id: p.id,
            label: p.label,
            description: p.description,
            status: "pending" as const,
            estimatedEffort: p.estimatedEffort,
          }));
        }
      } catch {
        // Try parsing from raw input
        if (typeof tc.input === "object") {
          const input = tc.input as Record<string, unknown>;
          if (input.planId && input.phases) {
            const phases = input.phases as Array<{ id: string; label: string; description?: string; estimatedEffort?: string }>;
            return phases.map((p) => ({
              id: p.id,
              label: p.label,
              description: p.description,
              status: "pending" as const,
              estimatedEffort: p.estimatedEffort,
            }));
          }
        }
      }
    }
  }
  return null;
}

// In-memory store for chat sessions with conversation history
interface ExtendedChatSession extends ChatSession {
  conversationHistory: LLMMessage[];
  // Execution state for long-running tasks
  fileOperations: Array<{ tool: string; path?: string; result: "success" | "failed"; timestamp: string }>;
  completedPhases: string[];
  currentTask: string;
  // Token tracking
  cumulativeInputTokens: number;
  cumulativeOutputTokens: number;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const CHAT_STATE_FILE = "chat-state.json";

/**
 * Migrate the legacy singleton "producer" session to "producer-legacy".
 * The platform now uses per-project producer sessions keyed by
 * "producer-<projectId>", so the unscoped "producer" key is preserved
 * (history is not lost) under a new id and hidden from the UI.
 *
 * Idempotent: running multiple times is a no-op once the rename has
 * happened.
 */
function migrateLegacyProducer(state: ChatState): boolean {
  const legacy = state.sessions["producer"];
  if (!legacy) return false;

  const renamed: ExtendedChatSession = {
    ...(legacy as ExtendedChatSession),
    id: "producer-legacy",
    projectId: null,
  };
  delete state.sessions["producer"];
  state.sessions["producer-legacy"] = renamed;
  if (state.currentSessionId === "producer") {
    state.currentSessionId = "producer-legacy";
  }
  return true;
}

/** Prune conversation history to stay within context limits (token-aware) */
function pruneConversationHistory(history: LLMMessage[]): LLMMessage[] {
  if (!history || history.length === 0) return history;

  const estTokens = Math.ceil(
    history.reduce((sum, m) => {
      if (typeof m.content === "string") return sum + m.content.length;
      return sum + m.content.reduce((s, c) => s + (c.type === "text" ? c.text.length : 1000), 0);
    }, 0) / CHARS_PER_TOKEN_ESTIMATE
  );
  if (estTokens <= MAX_CONTEXT_TOKENS) return history;

  // Keep recent messages as atomic groups (assistant+tool pairs must not be split)
  // Increased from 30 to 50 to preserve more context for long-running tasks
  const recentCount = 50;
  let recent = history.slice(-recentCount);

  // If slice starts with tool result, skip it (incomplete pair)
  if (recent.length > 0 && recent[0].role === "tool") {
    recent = recent.slice(1);
  }

  return recent;
}

/**
 * Build continuation context for active sessions to preserve execution state.
 * This helps agents continue long-running tasks without losing context.
 */
function buildContinueContext(session: ExtendedChatSession): string {
  if (session.status !== "active" || session.fileOperations.length === 0) {
    return "";
  }

  const writeOps = session.fileOperations.filter((o) => o.tool === "Write");
  const readOps = session.fileOperations.filter((o) => o.tool === "Read");

  return `CONTINUATION CONTEXT:
- You are continuing this session after a tool execution loop
- Files written so far: ${writeOps.map((o) => o.path).filter(Boolean).join(", ") || "none"}
- Files read so far: ${readOps.map((o) => o.path).filter(Boolean).join(", ") || "none"}
- Total operations completed: ${session.fileOperations.length}
- Current phase: ${session.currentTask || "in progress"}
- Completed phases: ${session.completedPhases.join(", ") || "none"}

Continue executing the plan. Do NOT re-propose the same plan. Update completedPhases and currentTask as you make progress.`;
}

async function loadChatState(): Promise<ChatState> {
  try {
    const state = await readData<ChatState>(CHAT_STATE_FILE);
    // R5: Filter out stale progress messages + hydrate extended fields
    // Also clean up old compacted sessions that accumulated before cleanup logic existed
    let compactedCleaned = 0;
    for (const [key, s] of Object.entries(state.sessions)) {
      const session = s as ExtendedChatSession;
      // Only filter progress for completed sessions (crash recovery cleanup).
      // Keep progress for active sessions so they can resume with accumulated toolCalls.
      if (session.status === "completed") {
        session.messages = session.messages.filter((m) => m.type !== "progress");
      }
      // Hydrate fields that may be missing from older persisted sessions
      if (!session.conversationHistory) session.conversationHistory = [];
      if (!session.fileOperations) session.fileOperations = [];
      if (!session.completedPhases) session.completedPhases = [];
      if (!session.currentTask) session.currentTask = "";
      if (session.cumulativeInputTokens === undefined) session.cumulativeInputTokens = 0;
      if (session.cumulativeOutputTokens === undefined) session.cumulativeOutputTokens = 0;
      if (!session.producerSummary) {
        session.producerSummary = emptyProducerSummarySnapshot();
      }
      // Remove compacted sessions older than 2 generations behind the latest
      if (session.status === "compacted" && session.generation !== undefined) {
        const baseId = key.replace(/-g\d+$/, "");
        let maxGen = session.generation;
        for (const [sid2, s2] of Object.entries(state.sessions)) {
          if (sid2.startsWith(baseId + "-g")) {
            const m = sid2.match(/-g(\d+)$/);
            if (m) maxGen = Math.max(maxGen, parseInt(m[1], 10));
          }
        }
        if (session.generation < maxGen - 1) {
          delete state.sessions[key];
          compactedCleaned++;
          continue;
        }
      }
      state.sessions[key] = session;
    }
    if (compactedCleaned > 0) {
      logger.info({ compactedCleaned, event: "startup_compacted_cleanup" },
        `Cleaned up ${compactedCleaned} old compacted sessions on startup`);
    }
    if (migrateLegacyProducer(state)) {
      // Persist the migration so it doesn't run again on next boot.
      await writeData(CHAT_STATE_FILE, state);
    }
    return state;
  } catch {
    // File doesn't exist yet — start with an empty session map.
    // Per-project producer sessions are lazy-created via
    // GET /api/chat/sessions/producer/:projectId on first chat visit.
    return {
      sessions: {},
      currentSessionId: "",
      threadId: "thread-001",
      threadTitle: "Producer Session",
    };
  }
}

let chatStore: ChatState;
const chatStoreReady = loadChatState().then((state) => { chatStore = state; });
export { chatStoreReady };

/** Per-session lock to prevent concurrent agent responses for the same session */
const sessionsResponding = new Set<string>();

/**
 * Per-session AbortController for the in-flight LLM call. Registered when the
 * LLM fetch starts and unregistered when it settles, so external events
 * (project delete, broadcast) can cancel the call without depending on the
 * HTTP request lifetime. The registry is the only place outside the request
 * handler that can reach into an ongoing LLM call.
 */
const sessionAbortControllers = new Map<string, AbortController>();

/** Abort the in-flight LLM for every session tied to a project. Called
 *  from `dashboard.deleteProject` BEFORE orphaning so an orphan session
 *  can't continue to write to a project that's about to be gone. */
export function cancelSessionsForProject(projectId: string): number {
  let cancelled = 0;
  for (const [sessionId, session] of Object.entries(chatStore.sessions)) {
    if (session.projectId === projectId) {
      const controller = sessionAbortControllers.get(sessionId);
      if (controller && !controller.signal.aborted) {
        controller.abort();
        cancelled++;
      }
    }
  }
  return cancelled;
}

async function saveChatState(): Promise<void> {
  await writeData(CHAT_STATE_FILE, chatStore);
}

/** Persist chat store (for producer summary and other orchestration fields). */
export async function persistChatStore(): Promise<void> {
  await saveChatState();
}

export function producerSessionId(projectId: string): string {
  return `producer-${projectId}`;
}

function toProjectContext(project: Project): ProjectContext {
  return {
    name: project.name,
    description: project.description,
    engine: project.engine,
    workspacePath: project.workspacePath ?? project.id,
    projectId: project.id,
  };
}

async function getProjectContextForSession(session: ExtendedChatSession): Promise<ProjectContext | undefined> {
  if (!session.projectId) return undefined;
  const project = await getProjectById(session.projectId);
  if (!project) return undefined;

  // Auto-detect engine if not set
  let engine: ProjectEngine | null = project.engine;
  const effectiveWorkspacePath = project.workspacePath ?? project.id;
  if (!engine && effectiveWorkspacePath) {
    const detected = await detectEngineFromWorkspace(effectiveWorkspacePath);
    if (detected) {
      engine = detected as ProjectEngine;
      // Update project with detected engine
      await updateProjectEngine(project.id, engine);
    }
  }

  return {
    name: project.name,
    description: project.description,
    engine,
    workspacePath: effectiveWorkspacePath,
    projectId: project.id,
  };
}

async function getProjectById(projectId: string): Promise<Project | null> {
  const data = await readData<DashboardData>("dashboard.json");
  return data.projects.find((p) => p.id === projectId) ?? null;
}

async function updateProjectEngine(projectId: string, engine: ProjectEngine): Promise<void> {
  const data = await readData<DashboardData>("dashboard.json");
  const idx = data.projects.findIndex((p) => p.id === projectId);
  if (idx !== -1) {
    data.projects[idx].engine = engine as Project["engine"];
    data.projects[idx].updatedAt = new Date().toISOString();
    await writeData("dashboard.json", data);
    // Broadcast update
    broadcast({
      type: "project:updated",
      project: data.projects[idx],
    } as WSEvent);
  }
}

/**
 * Append a message to a session in memory + persist + broadcast.
 * No-op if the session doesn't exist. Used to record orchestration
 * events (spawn, completion) on the producer session so they survive
 * page navigation.
 */
export async function appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
  const session = chatStore.sessions[sessionId];
  if (!session) return;
  session.messages.push(msg);
  await saveChatState();
  broadcast({
    type: "chat:message",
    sessionId,
    message: msg,
  } as WSEvent);
}

/** Update token usage on a session and broadcast to frontend */
function updateSessionTokenUsage(
  session: ExtendedChatSession,
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): void {
  session.cumulativeInputTokens += usage.input_tokens;
  session.cumulativeOutputTokens += usage.output_tokens;

  const contextUsage: ContextUsage = {
    lastInputTokens: usage.input_tokens,
    lastOutputTokens: usage.output_tokens,
    cumulativeInputTokens: session.cumulativeInputTokens,
    cumulativeOutputTokens: session.cumulativeOutputTokens,
    contextWindowTokens: getModelContextWindow(model),
    lastUpdated: new Date().toISOString(),
  };
  session.contextUsage = contextUsage;

  broadcast({
    type: "chat:context",
    sessionId: session.id,
    contextUsage,
  } as WSEvent);

  // Context pressure detection — use current turn's input tokens (actual context window usage),
  // not cumulative (which never resets after compaction)
  const fillPercent = Math.round((usage.input_tokens / contextUsage.contextWindowTokens) * 100);
  if (fillPercent >= 80) {
    broadcast({
      type: "chat:context-pressure",
      sessionId: session.id,
      fillPercent,
    } as WSEvent);
  }
}

/**
 * Orphan all chat sessions associated with the given project. Sets
 * projectId to null on each matching session and persists the chat
 * state. History is preserved but the sessions become hidden from the
 * project-scoped UI.
 */
export async function orphanProjectSessions(projectId: string): Promise<number> {
  await chatStoreReady;
  let orphaned = 0;
  for (const session of Object.values(chatStore.sessions)) {
    if (session.projectId === projectId) {
      session.projectId = null;
      orphaned++;
    }
  }
  if (orphaned > 0) {
    await saveChatState();
  }
  return orphaned;
}

interface ChatState {
  sessions: Record<string, ExtendedChatSession>;
  currentSessionId: string;
  threadId: string;
  threadTitle: string;
}

// GET /api/chat/sessions — Get all sessions
chatRouter.get("/sessions", (_req: Request, res: Response) => {
  const sessionsData = Object.values(chatStore.sessions).map((s) => ({
    id: s.id,
    role: s.role,
    projectId: s.projectId,
    messages: s.messages,
    status: s.status,
    progress: s.progress,
    spawnedAt: s.spawnedAt,
    contextUsage: s.contextUsage,
  }));
  res.json({ success: true, data: { sessions: sessionsData, currentSessionId: chatStore.currentSessionId } });
});

// GET /api/chat/sessions/producer/:projectId — Get-or-create producer session for a project
chatRouter.get("/sessions/producer/:projectId", async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);

  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }

  const project = await getProjectById(projectId);
  if (!project) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  // Start Godot MCP service for godot projects (even if session exists)
  if (project.engine === "godot") {
    const mcpOptions: GodotMCPServiceOptions = {
      projectPath: project.workspacePath ?? undefined,
      mode: "lite",
    };
    logger.info({ projectId, projectName: project.name, workspacePath: project.workspacePath, event: "godot_mcp_starting" }, "Starting Godot MCP service for project");
    getOrCreateGodotMCPService(projectId, mcpOptions).then((service) => {
      logger.info({ projectId, running: service.running(), event: "godot_mcp_started" }, "Godot MCP service started");
    }).catch((err) => {
      logger.error({ projectId, error: err.message, event: "godot_mcp_start_error" }, "Failed to start Godot MCP service");
    });

    // Auto-launch Godot editor
    if (project.workspacePath) {
      const projectDir = resolveProjectWorkspace(project.workspacePath);
      const launchResult = launchGodotEditor(projectDir);
      if (launchResult.success) {
        logger.info({ projectId, pid: launchResult.pid, event: "godot_editor_launched" }, "Godot editor auto-launched");
      } else {
        logger.warn({ projectId, error: launchResult.error, event: "godot_editor_launch_failed" }, "Could not auto-launch Godot editor");
      }
    }
  }

  const sessionId = producerSessionId(projectId);
  const existing = chatStore.sessions[sessionId];

  // Resolve latest generation if the base session was compacted
  let activeSession = existing;
  if (activeSession && activeSession.status === "compacted") {
    let gen = activeSession.generation ?? 1;
    let depth = 0;
    const MAX_GEN_DEPTH = 20;
    while (depth < MAX_GEN_DEPTH) {
      const nextGen = gen + 1;
      const nextId = `${sessionId}-g${nextGen}`;
      const next = chatStore.sessions[nextId];
      if (!next) break;
      activeSession = next;
      gen = nextGen; // Always increment consistently, don't read from session
      depth++;
      if (activeSession.status !== "compacted") break;
    }
  }

  if (activeSession && activeSession.status !== "compacted") {
    res.json({ success: true, data: activeSession });
    return;
  }

  // If the base session exists but was compacted and no generation found,
  // return it anyway — the frontend should handle compacted status by triggering a new compaction
  if (activeSession) {
    res.json({ success: true, data: activeSession });
    return;
  }

  const now = new Date().toISOString();
  const newSession: ExtendedChatSession = {
    id: sessionId,
    role: "producer",
    projectId,
    messages: [
      {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "welcome",
        sender: "Producer",
        content: `Welcome to ${project.name}. I'm the Producer, orchestrating our studio's multi-agent game development pipeline for this project.`,
        timestamp: now,
        showActions: false,
      },
      {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "system",
        sender: "SYSTEM",
        content: `Active project: ${project.name}${project.engine ? ` (${project.engine})` : ""}. Type a command to spawn an agent or request a task. Use /spawn <role> to bring in a specialist.`,
        timestamp: now,
        showActions: false,
      },
    ],
    status: "active",
    progress: 0,
    spawnedAt: now,
    conversationHistory: [],
    fileOperations: [],
    completedPhases: [],
    currentTask: "",
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    generation: 1,
    producerSummary: emptyProducerSummarySnapshot(),
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      projectId: newSession.projectId,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  await saveChatState();
  res.status(201).json({ success: true, data: newSession });
});

// GET /api/chat/sessions/:id — Get session by ID
chatRouter.get("/sessions/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }
  res.json({ success: true, data: session });
});

// POST /api/chat/sessions — Create new specialist session
chatRouter.post("/sessions", async (req: Request, res: Response) => {
  const body = req.body as CreateChatSessionRequest;

  const role = (body.role ?? "agent") as AgentRole;

  // Producer sessions go through GET /sessions/producer/:projectId, not this endpoint
  if (role === "producer") {
    res.status(400).json({
      success: false,
      error: "Use GET /api/chat/sessions/producer/:projectId to create a producer session",
    });
    return;
  }

  if (!body.projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }

  const project = await getProjectById(body.projectId);
  if (!project) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const sessionId = `session-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();

  // Load the agent's system prompt for the welcome message
  let welcomeContent = `${role} session initialized.`;
  try {
    const systemPrompt = await getAgentSystemPrompt(role);
    welcomeContent = systemPrompt.split("\n")[0]; // First line as welcome
  } catch {
    // Use default
  }

  const newSession: ExtendedChatSession = {
    id: sessionId,
    role,
    projectId: body.projectId,
    messages: [
      {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "system",
        sender: "SYSTEM",
        content: welcomeContent,
        timestamp: now,
        showActions: false,
      },
    ],
    status: "active",
    progress: 0,
    spawnedAt: now,
    conversationHistory: [],
    fileOperations: [],
    completedPhases: [],
    currentTask: "",
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      projectId: newSession.projectId,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  await saveChatState();
  res.status(201).json({ success: true, data: newSession });
});

// DELETE /api/chat/sessions/:id — Delete session
chatRouter.delete("/sessions/:id", async (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Prevent deleting any producer session (legacy "producer" or per-project "producer-<id>")
  if (id === "producer" || id.startsWith("producer-")) {
    res.status(400).json({ success: false, error: "Cannot delete producer session" });
    return;
  }

  if (!chatStore.sessions[id]) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  delete chatStore.sessions[id];
  sessionsResponding.delete(id);
  cleanupWorkflow(id);
  // Note: Godot MCP service is keyed by projectId, not sessionId.
  // It will be cleaned up when the project is deleted or session ends.
  // We don't stop it here because other sessions (producer) may still need it.

  broadcast({
    type: "chat:session:deleted",
    sessionId: id,
  } as WSEvent);

  await saveChatState();
  res.json({ success: true });
});

// POST /api/chat/sessions/:id/close — Close a consultation session and forward summary to producer
chatRouter.post("/sessions/:id/close", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { summary } = req.body as { summary?: string };

  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  // Prevent closing producer sessions
  if (id === "producer" || id.startsWith("producer-")) {
    res.status(400).json({ success: false, error: "Cannot close producer session via this endpoint" });
    return;
  }

  // Restrict to consultation sessions only — this endpoint is not for regular spawned agents
  if (!id.startsWith("consultation-")) {
    res.status(400).json({ success: false, error: "This endpoint can only close consultation sessions" });
    return;
  }

  const projectId = session.projectId;
  if (!projectId) {
    res.status(400).json({ success: false, error: "Session has no associated project" });
    return;
  }

  // Verify producer session exists before we try to append
  const pid = producerSessionId(projectId);
  if (!chatStore.sessions[pid]) {
    res.status(400).json({ success: false, error: "Producer session not found" });
    return;
  }

  // Generate summary if not provided: collect last 3 agent/system messages
  // (skip the initial welcome system message which contains "consultation session initialized")
  let finalSummary = summary;
  if (!finalSummary) {
    const assistantMessages = session.messages
      .filter((m) => (m.type === "agent" || m.type === "system") && !m.content.includes("consultation session initialized"))
      .slice(-3);
    if (assistantMessages.length > 0) {
      finalSummary = assistantMessages.map((m) => m.content).join("\n\n---\n\n");
    } else {
      finalSummary = "No summary available.";
    }
  }

  // Post summary to producer session
  const roleDisplay = session.role.replace(/-/g, " ").toUpperCase();
  await appendMessage(pid, {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    type: "agent",
    sender: session.role,
    content: `[${roleDisplay} CONSULTATION COMPLETE]\n\n${finalSummary}`,
    timestamp: new Date().toISOString(),
    showActions: false,
  });

  void ingestProducerSummaryFact(projectId, {
    kind: "consultation_closed",
    at: new Date().toISOString(),
    title: session.role,
    detail: roleDisplay,
  });

  // Delete the consultation session after forwarding summary
  delete chatStore.sessions[id];

  broadcast({
    type: "chat:session:deleted",
    sessionId: id,
  } as WSEvent);

  await saveChatState();
  res.json({ success: true, summary: finalSummary });
});

// POST /api/chat/sessions/consultation/test-create — Test helper: create a consultation session
// Only available when ENABLE_TEST_ENDPOINTS is set. Used by E2E tests to create
// consultation sessions without invoking the LLM.
if (process.env.ENABLE_TEST_ENDPOINTS === "true") {
  chatRouter.post("/sessions/consultation/test-create", async (req: Request, res: Response) => {
    const { role, projectId, brief } = req.body as { role?: string; projectId?: string; brief?: string };

    if (!role || !projectId) {
      res.status(400).json({ success: false, error: "role and projectId are required" });
      return;
    }

    const project = await getProjectById(projectId);
    if (!project) {
      res.status(404).json({ success: false, error: "Project not found" });
      return;
    }

    const sessionId = `consultation-${role.toLowerCase().replace(/\s+/g, "-")}`;

    if (chatStore.sessions[sessionId]) {
      res.status(409).json({ success: false, error: `Consultation session ${sessionId} already exists` });
      return;
    }

    const now = new Date().toISOString();
    const newSession: ExtendedChatSession = {
      id: sessionId,
      role,
      projectId,
      messages: [
        {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          type: "system" as const,
          sender: "SYSTEM",
          content: brief ? `${role} consultation session initialized.\n\n**Brief:** ${brief}` : `${role} consultation session initialized.`,
          timestamp: now,
          showActions: false,
        },
      ],
      status: "active" as const,
      progress: 0,
      spawnedAt: now,
      conversationHistory: [],
      fileOperations: [],
      completedPhases: [],
      currentTask: "",
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
    };

    chatStore.sessions[sessionId] = newSession;
    await saveChatState();

    broadcast({
      type: "chat:session:created",
      session: {
        id: newSession.id,
        role: newSession.role,
        projectId: newSession.projectId,
        messages: newSession.messages,
        status: newSession.status,
        progress: newSession.progress,
        spawnedAt: newSession.spawnedAt,
      },
    } as WSEvent);

    res.status(201).json({ success: true, data: newSession });
  });
}

// POST /api/chat/sessions/:id/clear — Clear all messages in a session
chatRouter.post("/sessions/:id/clear", async (req: Request, res: Response) => {
  const id = String(req.params.id);

  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  session.conversationHistory = [];
  (session as ExtendedChatSession).fileOperations = [];
  (session as ExtendedChatSession).completedPhases = [];
  (session as ExtendedChatSession).currentTask = "";
  (session as ExtendedChatSession).cumulativeInputTokens = 0;
  (session as ExtendedChatSession).cumulativeOutputTokens = 0;
  session.contextUsage = undefined;
  session.progress = 0;
  session.status = "active";

  // Reset producer session with welcome message; other sessions start empty
  if (id === "producer" || id.startsWith("producer-")) {
    session.messages = [
      {
        id: `msg-welcome-${crypto.randomUUID().slice(0, 8)}`,
        type: "welcome" as const,
        sender: "Producer",
        content:
          "Welcome to the Board Room. I'm the Producer, orchestrating our studio's multi-agent game development pipeline.",
        timestamp: new Date().toISOString(),
        showActions: false,
      },
      {
        id: `msg-prompt-${crypto.randomUUID().slice(0, 8)}`,
        type: "system" as const,
        sender: "SYSTEM",
        content:
          "Type a command to spawn an agent or request a task. Use /spawn <role> to bring in a specialist.",
        timestamp: new Date().toISOString(),
        showActions: false,
      },
    ];
  } else {
    session.messages = [];
  }

  broadcast({
    type: "chat:message",
    sessionId: id,
    message: {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      type: "system" as const,
      sender: "SYSTEM",
      content: "Session cleared.",
      timestamp: new Date().toISOString(),
      showActions: false,
    },
  } as WSEvent);

  await saveChatState();
  res.json({ success: true });
});

// POST /api/chat/sessions/:id/compact — Compact session into new generation
chatRouter.post("/sessions/:id/compact", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const session = chatStore.sessions[id];

    if (!session) {
      logger.warn({ requestedId: id, availableIds: Object.keys(chatStore.sessions).slice(0, 10) }, "Compact: session not found");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    if (session.conversationHistory.length < 4) {
      res.status(400).json({ error: "Not enough history to compact" });
      return;
    }

    // Build summary from conversation history
    const conversationText = session.conversationHistory
      .map((m: LLMMessage) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 3000) : JSON.stringify(m.content).slice(0, 3000)}`)
      .join("\n\n");

    const summaryPrompt = `Summarize this agent conversation session concisely.
Structure your summary with these sections:

## Key Decisions
- Important decisions made and their rationale

## Active Tasks
- What was being worked on, current progress, what remains

## Code & File State
- Key files created/modified, important code patterns

## Context
- Project context, constraints, dependencies

Remove: greetings, small talk, verbose explanations, repeated content.
Keep: specific facts, numbers, file paths, function names, architecture decisions.

Conversation (${session.conversationHistory.length} messages):
${conversationText}

Max 4000 characters. Respond ONLY with the summary.`;

    const config = loadConfig();
    const summaryModel = getModelForTier("haiku"); // Use lightweight model for summarization
    const isKimi = summaryModel.startsWith("kimi-");
    if (isKimi && !config.KIMI_API_KEY?.trim()) {
      throw new Error(`KIMI_API_KEY is required for model "${summaryModel}". Set it in .env or switch DEFAULT_MODEL to a GLM model.`);
    }
    if (!isKimi && !config.ZAI_API_KEY?.trim()) {
      throw new Error(`ZAI_API_KEY is required for model "${summaryModel}". Set it in .env or use Kimi with KIMI_API_KEY.`);
    }
    const summaryBaseUrl = isKimi ? config.KIMI_BASE_URL : config.ZAI_BASE_URL;
    const summaryApiKey = isKimi ? config.KIMI_API_KEY : config.ZAI_API_KEY;
    const summaryHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (isKimi) {
      summaryHeaders["Authorization"] = `Bearer ${summaryApiKey}`;
    } else {
      summaryHeaders["x-api-key"] = summaryApiKey;
    }
    const summaryResponse = await fetch(`${summaryBaseUrl}/v1/messages`, {
      method: "POST",
      headers: summaryHeaders,
      body: JSON.stringify({
        model: summaryModel,
        max_tokens: 2048,
        messages: [{ role: "user", content: summaryPrompt }],
      }),
    });

    let summaryText = "";
    if (summaryResponse.ok) {
      const data = await summaryResponse.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      summaryText = data.content?.find((c) => c.type === "text")?.text ?? "";
    } else {
      const errText = await summaryResponse.text();
      logger.error({ status: summaryResponse.status, body: errText.slice(0, 200) }, "Compact summary LLM call failed");
      res.status(500).json({ error: "Failed to generate summary" });
      return;
    }

    if (!summaryText) {
      res.status(500).json({ error: "Summary was empty" });
      return;
    }

    const oldGeneration = session.generation ?? 1;
    const newGeneration = oldGeneration + 1;
    const newId = `${id}-g${newGeneration}`;

    // Check new session doesn't already exist
    if (chatStore.sessions[newId]) {
      res.status(409).json({ error: "Compacted session already exists" });
      return;
    }

    const now = new Date().toISOString();

    // Create new session inheriting from old
    const newSession: ExtendedChatSession = {
      ...session,
      id: newId,
      messages: [
        {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          type: "system",
          sender: "SYSTEM",
          content: `Session compacted from generation ${oldGeneration}. Previous context summarized below.`,
          timestamp: now,
          showActions: false,
        },
        {
          id: `msg-${crypto.randomUUID().slice(0, 8)}`,
          type: "agent",
          sender: session.role,
          content: `[Previous Context Summary]\n\n${summaryText}`,
          timestamp: now,
          showActions: false,
        },
      ],
      status: "active",
      progress: 0,
      conversationHistory: [
        { role: "user", content: `[Previous Context Summary — Generation ${oldGeneration}]\n\n${summaryText}` },
      ],
      fileOperations: [],
      completedPhases: [],
      currentTask: "",
      cumulativeInputTokens: 0,
      cumulativeOutputTokens: 0,
      contextUsage: undefined,
      compactedFrom: id,
      generation: newGeneration,
    };

    // Archive old session + register new one as a single atomic write.
    // The previous order was: mutate old.status → add new to map → cleanup
    // old generations → save. A crash between mutate and save left the
    // old session marked "compacted" with no successor on disk, breaking
    // generation traversal forever. Now: stage the critical mutations,
    // save, then perform the (re-runnable) cleanup.
    session.status = "compacted";
    chatStore.sessions[newId] = newSession;
    sessionsResponding.delete(id);

    await saveChatState();

    // Clean up compacted sessions more than 2 generations behind the current one.
    // They're only needed for generation traversal which stops at the first non-compacted session.
    // Use a strict regex on the full session id so e.g. "producer-project1-g2"
    // can't accidentally match "producer-project1x-g3" (project id prefix collision).
    const baseSessionId = id.replace(/-g\d+$/, "");
    const ancestorPattern = new RegExp(`^${escapeRegExp(baseSessionId)}-g\\d+$`);
    for (const [sid, sess] of Object.entries(chatStore.sessions)) {
      if (sid === id || sid === newId) continue;
      if (sess.status === "compacted" && ancestorPattern.test(sid)) {
        const genMatch = sid.match(/-g(\d+)$/);
        if (genMatch) {
          const gen = parseInt(genMatch[1], 10);
          if (gen < newGeneration - 1) {
            delete chatStore.sessions[sid];
            sessionsResponding.delete(sid);
          }
        }
      }
    }

    // Best-effort second save after cleanup. If this fails, the only impact
    // is stale compacted sessions in disk (a non-critical leak that the next
    // successful compaction on the same baseSessionId will GC).
    try {
      await saveChatState();
    } catch (cleanupSaveErr) {
      logger.warn(
        { err: cleanupSaveErr, oldSessionId: id, newSessionId: newId, event: "compaction_cleanup_save_failed" },
        "Compaction cleanup save failed; stale compacted sessions may persist on disk",
      );
    }

    logger.info({ oldSessionId: id, newSessionId: newId, generation: newGeneration, summaryChars: summaryText.length }, "Session compacted");

    broadcast({
      type: "chat:session:compacted",
      oldSessionId: id,
      newSession,
    } as WSEvent);

    // Also broadcast session:created so frontend adds it to tabs
    broadcast({
      type: "chat:session:created",
      session: newSession,
    } as WSEvent);

    res.json({ session: newSession, oldSessionId: id });
  } catch (err) {
    logger.error({ err }, "Compact endpoint error");
    res.status(500).json({ error: "Compaction failed" });
  }
});

// POST /api/chat/sessions/:id/messages — Add message and get LLM response
chatRouter.post("/sessions/:id/messages", async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as CreateMessageRequest;

  if (!body.content) {
    res.status(400).json({ success: false, error: "content is required" });
    return;
  }

  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  // Acquire per-session lock BEFORE any async work. The previous
  // version did `if (sessionsResponding.has(id)) return 409` first
  // and added the id later — that created a TOCTOU window: two
  // concurrent requests could both pass the has() check before
  // either added the id, then both would proceed to call the LLM
  // concurrently. By installing the lock right after the check and
  // before any await, the second request will see the id present
  // and be rejected.
  if (body.type !== "system" && body.type !== "progress" && body.type !== "producer_update") {
    if (sessionsResponding.has(id)) {
      res.status(409).json({ success: false, error: "Agent is already responding — please wait" });
      return;
    }
    sessionsResponding.add(id);
  }

  const userMessageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  const userMessage: ChatMessage = {
    id: userMessageId,
    type: body.type ?? "user",
    sender: body.sender ?? "USER",
    content: body.content,
    timestamp: new Date().toISOString(),
    showActions: body.showActions,
    progress: body.progress,
    codeBlock: body.codeBlock,
    images: body.images,
  };

  session.messages.push(userMessage);

  // Add to conversation history (with images as multimodal content if present)
  const userHistoryMessage: LLMMessage = { role: "user", content: body.content };
  if (body.images && body.images.length > 0) {
    const contentBlocks: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [
      { type: "text", text: body.content },
    ];
    for (const imgDataUrl of body.images) {
      const match = imgDataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        });
      }
    }
    userHistoryMessage.content = contentBlocks;
  }
  session.conversationHistory.push(userHistoryMessage);

  await saveChatState();

  // Note: We do NOT broadcast the user message here because the frontend
  // already adds it optimistically. Broadcasting would create a duplicate.

  // If this is a system / orchestration message or no auto-response needed, return early
  if (body.type === "system" || body.type === "progress" || body.type === "producer_update") {
    broadcast({
      type: "chat:message",
      sessionId: id,
      message: userMessage,
    } as WSEvent);
    res.status(201).json({ success: true, data: userMessage });
    return;
  }

  // Get response from LLM
  const agentRole = session.role as AgentRole;

  // Add thinking/progress message
  const progressMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
  const progressMessage: ChatMessage = {
    id: progressMsgId,
    type: "progress",
    sender: agentRole,
    content: `${agentRole} is thinking...`,
    timestamp: new Date().toISOString(),
    showActions: false,
    progress: 0,
  };
  session.messages.push(progressMessage);
  broadcast({
    type: "chat:message",
    sessionId: id,
    message: progressMessage,
  } as WSEvent);

  try {
    await saveChatState();
  } catch (saveErr) {
    sessionsResponding.delete(id);
    throw saveErr;
  }

  // R1: Declare heartbeat outside try so catch block can clear it
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  try {
    // Set up progress callback for tool execution updates
    const onProgress = makeProgressCallback(id, progressMsgId);

    // Heartbeat: broadcast periodic progress updates during long API waits
    let heartbeatCount = 0;
    heartbeat = setInterval(() => {
      heartbeatCount++;
      const elapsed = heartbeatCount * 2;
      // Smooth progress: start at 10%, climb by 3% each tick, cap at 85%
      const pct = Math.min(85, 10 + heartbeatCount * 3);
      broadcast({
        type: "chat:progress",
        sessionId: id,
        progressMsgId,
        progress: pct,
        content: `${agentRole} is thinking... (${elapsed}s)`,
      } as WSEvent);
    }, 2000);

    // Wire the HTTP request's "close" event to an AbortController so that
    // when the client disconnects mid-LLM-call (browser tab closed, page
    // reload, network drop), the in-flight LLM fetch is cancelled. Without
    // this, an orphaned client can keep an LLM request running for the full
    // fetch timeout (60s+) and burn tokens the user already gave up on.
    // The signal is also passed to continueConversation → callLLMWithTools
    // so the fetch itself sees the abort. The controller is also registered
    // in the module-level `sessionAbortControllers` map so external events
    // (project delete, broadcast) can cancel the call without depending on
    // the HTTP request lifetime.
    const clientAbort = new AbortController();
    // Attach the close listener BEFORE registering in the abort map so
    // a client disconnect that races with the assignment is still
    // caught by the listener and not silently dropped.
    req.on("close", () => {
      if (!clientAbort.signal.aborted) {
        logger.info({ sessionId: id, event: "chat_client_disconnected" },
          "Client disconnected mid-response — cancelling in-flight LLM call");
        clientAbort.abort();
      }
    });
    sessionAbortControllers.set(id, clientAbort);

    // Call the LLM with progress callback
    const projectContext = await getProjectContextForSession(session);

    // Build continuation context (passed as temp context, not persisted)
    const continueCtx = buildContinueContext(session as ExtendedChatSession);

    // Track file operations back into session state
    const onFileOperation = (op: { tool: string; path?: string; result: "success" | "failed" }) => {
      const extSession = session as ExtendedChatSession;
      extSession.fileOperations.push({
        ...op,
        timestamp: new Date().toISOString(),
      });
      // Cap at 200 operations to prevent unbounded growth
      if (extSession.fileOperations.length > 200) {
        extSession.fileOperations = extSession.fileOperations.slice(-200);
      }
    };

    // Track token usage from API responses
    const model = getModelForTier(agentRole);
    const onTokenUsage = (usage: { input_tokens: number; output_tokens: number }) => {
      updateSessionTokenUsage(session as ExtendedChatSession, usage, model);
    };

    const result = await continueConversation(
      agentRole,
      session.conversationHistory,
      id,
      onProgress,
      0,
      projectContext,
      onFileOperation,
      continueCtx || undefined,
      onTokenUsage,
      clientAbort.signal,
    );

    // Stop heartbeat
    clearInterval(heartbeat);

    // Broadcast final progress before removing (so frontend can clean up)
    broadcast({
      type: "chat:progress",
      sessionId: id,
      progressMsgId,
      progress: 100,
      content: `${agentRole} complete`,
    } as WSEvent);

    // Remove the progress placeholder before adding the real response
    // Capture toolCalls first so they survive into the assistant message
    const progressIndex = session.messages.findIndex((m) => m.id === progressMsgId);
    let progressToolCalls: ChatMessage["toolCalls"] = undefined;
    if (progressIndex !== -1) {
      progressToolCalls = session.messages[progressIndex].toolCalls;
      session.messages.splice(progressIndex, 1);
    }

    // Add assistant response to conversation
    // Handle empty content
    if (!result.content || result.content.trim() === "") {
      logger.warn({ event: "continue_empty_content", agentRole, sessionId: id }, `Agent ${agentRole} returned empty content`);
    }
    session.conversationHistory.push({
      role: "assistant",
      content: result.content || `[${agentRole} returned no content]`,
    });

    // Check if LLM asked a question via AskUserQuestion tool
    const questionData = parseQuestionFromToolResult(result.toolCalls);

    // Check if LLM proposed a plan via ProposePlan tool
    const planPhases = parsePlanPhasesFromToolResult(result.toolCalls);

    // Workflow stage detection
    if (planPhases && !getWorkflow(id)) {
      // Plan proposed → start workflow and advance to decompose
      startWorkflow(id);
      advanceStage(id, "decompose");
    }
    if (result.toolCalls?.some((tc) => tc.name === "Task")) {
      advanceStage(id, "execute");
    }

    // Determine message type: question > plan > agent
    let messageType: "question" | "plan" | "agent" = "agent";
    if (questionData) messageType = "question";
    else if (planPhases) messageType = "plan";

    // Create assistant message
    // Handle empty content — use question text for questions, otherwise placeholder
    let messageContent = result.content;
    if (!messageContent || messageContent.trim() === "") {
      messageContent = questionData
        ? questionData.question
        : `${agentRole} completed but returned no content`;
      logger.warn({ event: "message_empty_content", agentRole, messageType, sessionId: id }, `Agent ${agentRole} message has empty content`);
    }

    const assistantMessage: ChatMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      type: messageType,
      sender: agentRole,
      content: messageContent,
      timestamp: new Date().toISOString(),
      showActions: false,
      progress: 100,
      toolCalls: (result.toolCalls?.length || progressToolCalls?.length)
        ? [
            ...(progressToolCalls ?? []),
            ...(result.toolCalls?.map((tc) => ({
              tool: tc.name,
              args: tc.input,
              status: "success" as const,
            })) ?? []),
          ]
        : undefined,
      question: questionData ?? undefined,
      planPhases: planPhases ?? undefined,
    };

    session.messages.push(assistantMessage);

    // Update session progress
    session.progress = Math.min(100, session.progress + 10);
    if (session.progress >= 100) {
      session.status = "completed";
    }

    // Broadcast assistant response
    broadcast({
      type: "chat:message",
      sessionId: id,
      message: assistantMessage,
    } as WSEvent);

    await saveChatState();
    sessionsResponding.delete(id);
    sessionAbortControllers.delete(id);
    res.status(201).json({ success: true, data: { userMessage, assistantMessage } });
  } catch (err: unknown) {
    const error = err as Error;

    // R1: Clear heartbeat on error to prevent permanent timer leak
    clearInterval(heartbeat);
    sessionsResponding.delete(id);
    sessionAbortControllers.delete(id);

    // Remove the progress placeholder before adding the error message
    const progressIndex = session.messages.findIndex((m) => m.id === progressMsgId);
    if (progressIndex !== -1) {
      session.messages.splice(progressIndex, 1);
    }

    const errorMessage: ChatMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      type: "system",
      sender: "SYSTEM",
      content: `Error: ${error.message}`,
      timestamp: new Date().toISOString(),
      showActions: false,
    };
    session.messages.push(errorMessage);

    broadcast({
      type: "chat:message",
      sessionId: id,
      message: errorMessage,
    } as WSEvent);

    await saveChatState();
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/chat/spawn — Spawn an agent with real ZAI API
chatRouter.post("/spawn", async (req: Request, res: Response) => {
  const { role, task, projectId } = req.body as { role?: string; task?: string; projectId?: string };

  if (!role) {
    res.status(400).json({ success: false, error: "role is required" });
    return;
  }

  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }

  const project = await getProjectById(projectId);
  if (!project) {
    res.status(404).json({ success: false, error: "Project not found" });
    return;
  }

  const invocationId = `invoke-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = role.toLowerCase().replace(/\s+/g, "-");
  const now = new Date().toISOString();
  const agentRole = role as AgentRole;

  // R2: Return 409 if session ID already exists
  if (chatStore.sessions[sessionId]) {
    res.status(409).json({ success: false, error: `Session ${sessionId} already exists` });
    return;
  }

  // Start Godot MCP service for godot projects (if not already running)
  if (project.engine === "godot") {
    const mcpOptions: GodotMCPServiceOptions = {
      projectPath: project.workspacePath ?? undefined,
      mode: "lite",
    };
    logger.info({ projectId, projectName: project.name, role: agentRole, event: "godot_mcp_spawn_check" }, "Checking Godot MCP for agent spawn");
    getOrCreateGodotMCPService(projectId, mcpOptions).then((service) => {
      logger.info({ projectId, role: agentRole, running: service.running(), event: "godot_mcp_spawn_ready" }, "Godot MCP service ready for agent");
    }).catch((err) => {
      logger.error({ projectId, role: agentRole, error: err.message, event: "godot_mcp_spawn_error" }, "Failed to start Godot MCP for agent");
    });

    // Auto-launch Godot editor
    if (project.workspacePath) {
      const projectDir = resolveProjectWorkspace(project.workspacePath);
      const launchResult = launchGodotEditor(projectDir);
      if (launchResult.success) {
        logger.info({ projectId, pid: launchResult.pid, event: "godot_editor_launched" }, "Godot editor auto-launched for agent spawn");
      }
    }
  }

  // Create session for the spawned agent
  const newSession: ExtendedChatSession = {
    id: sessionId,
    role: agentRole,
    projectId,
    messages: [
      {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "system",
        sender: "SYSTEM",
        content: `${role.toUpperCase()} session initialized.`,
        timestamp: now,
        showActions: false,
      },
    ],
    status: "active",
    progress: 0,
    spawnedAt: now,
    conversationHistory: [],
    fileOperations: [],
    completedPhases: [],
    currentTask: "",
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: agentRole,
    sessionId,
    projectId,
  } as WSEvent);

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      projectId: newSession.projectId,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  await saveChatState();

  // Record the spawn on the project's producer session so the entry
  // survives page navigation (frontend was previously holding this
  // message in local state only).
  await appendMessage(producerSessionId(projectId), {
    id: `msg-${crypto.randomUUID().slice(0, 8)}`,
    type: "system",
    sender: "SYSTEM",
    content: `${agentRole.toUpperCase()} spawned at ${now} UTC`,
    timestamp: now,
    showActions: false,
  });

  void ingestProducerSummaryFact(projectId, {
    kind: "agent_spawned",
    at: now,
    agentRole,
    detail: sessionId,
  });

  // If a task is provided, execute it immediately
  let spawnStatus: "completed" | "failed" | "ready" = "ready";
  if (task) {
    // Create a progress message for this invocation
    const progressMsgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    newSession.messages.push({
      id: progressMsgId,
      type: "progress",
      sender: agentRole,
      content: `${agentRole} is working...`,
      timestamp: new Date().toISOString(),
      showActions: false,
      progress: 5,
    });
    broadcast({
      type: "chat:message",
      sessionId,
      message: newSession.messages[newSession.messages.length - 1],
    } as WSEvent);

    await saveChatState();

    const onProgress = makeProgressCallback(sessionId, progressMsgId);

    // Quest Bridge: create ticket for spawned agent task
    let ticketId: string | undefined;
    let agentTicket: import("@game-studio/types").Ticket | undefined;
    if (task) {
      agentTicket = await createQuestTicket(sessionId, task.slice(0, 80), agentRole, task, "AGENT", "spawn");
      ticketId = agentTicket.id;
      await moveQuestTicket(ticketId, "in_progress", agentRole);
    }

    let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      // Don't broadcast agent events from invokeAgent — we handle them ourselves here
      const projectContext = toProjectContext(project);
      const spawnModel = getModelForTier(agentRole);
      logger.info({ event: "spawn_invoke_start", agentRole, taskLength: task?.length ?? 0, sessionId }, `Invoking agent ${agentRole}`);

      // Heartbeat: broadcast periodic progress updates during long agent runs
      let heartbeatCount = 0;
      heartbeat = setInterval(() => {
        heartbeatCount++;
        const elapsed = heartbeatCount * 2;
        const pct = Math.min(85, 10 + heartbeatCount * 3);
        broadcast({
          type: "chat:progress",
          sessionId,
          progressMsgId,
          progress: pct,
          content: `${agentRole} is working... (${elapsed}s)`,
        } as WSEvent);
      }, 2000);

      const result = await invokeAgent(
        agentRole,
        task,
        sessionId,
        undefined,
        [],
        onProgress,
        false,
        0,
        projectContext,
        (op) => {
          newSession.fileOperations.push({ ...op, timestamp: new Date().toISOString() });
          if (newSession.fileOperations.length > 200) {
            newSession.fileOperations = newSession.fileOperations.slice(-200);
          }
        },
        (usage) => {
          updateSessionTokenUsage(newSession as ExtendedChatSession, usage, spawnModel);
        },
      );

      clearInterval(heartbeat);
      logger.info({ event: "spawn_invoke_complete", agentRole, contentLength: result.content.length, sessionId }, `Agent ${agentRole} completed with ${result.content.length} chars`);

      // Handle empty content
      if (!result.content || result.content.trim() === "") {
        logger.warn({ event: "spawn_empty_content", agentRole, sessionId }, `Agent ${agentRole} returned empty content`);
      }

      // Remove progress placeholder, preserving toolCalls
      const idx = newSession.messages.findIndex((m) => m.id === progressMsgId);
      let spawnProgressToolCalls: ChatMessage["toolCalls"] = undefined;
      if (idx !== -1) {
        spawnProgressToolCalls = newSession.messages[idx].toolCalls;
        newSession.messages.splice(idx, 1);
      }

      // Use placeholder if content is empty
      const effectiveContent = (result.content && result.content.trim() !== "")
        ? result.content
        : `${agentRole} completed task but returned no content. Please check the agent's output.`;

      const responseMessage: ChatMessage = {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "agent",
        sender: role,
        content: effectiveContent,
        timestamp: new Date().toISOString(),
        showActions: true,
        progress: 100,
        toolCalls: (result.toolCalls?.length || spawnProgressToolCalls?.length)
          ? [
              ...(spawnProgressToolCalls ?? []),
              ...(result.toolCalls?.map((tc) => ({
                tool: tc.name,
                args: tc.input,
                status: "success" as const,
              })) ?? []),
            ]
          : undefined,
      };

      newSession.messages.push(responseMessage);
      newSession.conversationHistory.push({ role: "assistant", content: result.content });
      newSession.conversationHistory = pruneConversationHistory(newSession.conversationHistory);

      broadcast({
        type: "chat:message",
        sessionId,
        message: responseMessage,
      } as WSEvent);

      broadcast({
        type: "agent:completed",
        agentId: invocationId,
        output: result.content,
        sessionId: sessionId,
      } as WSEvent);

      // Persist completion notice on the producer session.
      await appendMessage(producerSessionId(projectId), {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "agent",
        sender: "producer",
        content: `${agentRole.replace(/-/g, " ")} reports task complete. Session awaiting closure.`,
        timestamp: new Date().toISOString(),
        showActions: true,
      });

      void ingestProducerSummaryFact(projectId, {
        kind: "spawn_task_complete",
        at: new Date().toISOString(),
        agentRole,
        title: task?.slice(0, 120),
      });

      // Update agent session status to done
      newSession.progress = 100;
      newSession.status = "completed";
      spawnStatus = "completed";
      broadcast({
        type: "chat:session:updated",
        sessionId,
        session: {
          id: newSession.id,
          role: newSession.role,
          progress: newSession.progress,
          status: newSession.status,
        },
      } as WSEvent);

      // Quest Bridge: move ticket to verify for auto-verification
      if (ticketId) {
        await moveQuestTicket(ticketId, "qa", agentRole);
        if (agentTicket) {
          triggerVerification(agentTicket, result.content);
        }
      }
    } catch (err: unknown) {
      clearInterval(heartbeat);
      spawnStatus = "failed";
      const error = err as Error;
      logger.error({ event: "spawn_failed", agentRole, sessionId, error: error.message, stack: error.stack }, `Agent ${agentRole} failed: ${error.message}`);

      broadcast({
        type: "agent:failed",
        agentId: invocationId,
        error: error.message,
        sessionId: sessionId,
      } as WSEvent);

      // Persist failure notice on the producer session.
      await appendMessage(producerSessionId(projectId), {
        id: `msg-${crypto.randomUUID().slice(0, 8)}`,
        type: "system",
        sender: "SYSTEM",
        content: `${agentRole.toUpperCase()} failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        showActions: false,
      });

      void ingestProducerSummaryFact(projectId, {
        kind: "spawn_task_failed",
        at: new Date().toISOString(),
        agentRole,
        detail: error.message,
      });

      // Quest Bridge: move ticket back to available on failure
      if (ticketId) {
        await moveQuestTicket(ticketId, "available", agentRole);
      }
    }
  }

  await saveChatState();
  res.json({
    success: spawnStatus !== "failed",
    data: { invocationId, role, sessionId, status: spawnStatus },
  });
});

// POST /api/chat/approve — Approve agent action
chatRouter.post("/approve", (req: Request, res: Response) => {
  const { invocationId } = req.body as { invocationId?: string };

  if (!invocationId) {
    res.status(400).json({ success: false, error: "invocationId is required" });
    return;
  }

  res.json({ success: true, data: { invocationId, status: "approved" } });
});

// POST /api/chat/diff — Save or retrieve diffs
chatRouter.post("/diff", (req: Request, res: Response) => {
  const { sessionId, diffBlocks } = req.body as { sessionId?: string; diffBlocks?: unknown[] };

  const diffId = `diff-${crypto.randomUUID().slice(0, 8)}`;

  broadcast({
    type: "chat:message",
    sessionId: sessionId ?? "producer",
    message: {
      id: diffId,
      type: "diff" as const,
      sender: "SYSTEM",
      content: "Diff generated",
      timestamp: new Date().toISOString(),
      diffBlocks: diffBlocks as import("@game-studio/types").DiffBlock[],
    },
  } as WSEvent);

  res.json({ success: true, data: { diffId, diffBlocks } });
});

// GET /api/chat/diff/:id — Get diff by ID
chatRouter.get("/diff/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  res.json({ success: true, data: { id, diffBlocks: [] } });
});

// Export for use by other routes
export { chatStore };
