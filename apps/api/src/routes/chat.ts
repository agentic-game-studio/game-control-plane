import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { join } from "node:path";
import type { AgentRole, ChatSession, ChatMessage, CreateMessageRequest, CreateChatSessionRequest, ContextUsage, DashboardData, Project, ProjectEngine } from "@game-studio/types";
import { emptyProducerSummarySnapshot, safeIngestProducerSummaryFact } from "../services/producer-summary.js";
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
import { newId } from "../utils/ids.js";
import { heartbeatProgressPct } from "../utils/progress.js";

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
          // Validate field types before returning — the previous version
          // cast everything to `string`/`as QuestionData["options"]`
          // without checking, which let a malformed payload crash the
          // chat UI on `undefined.options.map(...)`.
          if (
            typeof input.questionId === "string" &&
            typeof input.question === "string" &&
            Array.isArray(input.options) &&
            input.options.every(
              (o): o is { id: string; label: string; description?: string } =>
                typeof o === "object" && o !== null &&
                typeof (o as Record<string, unknown>).id === "string" &&
                typeof (o as Record<string, unknown>).label === "string",
            )
          ) {
            return {
              questionId: input.questionId,
              question: input.question,
              options: input.options as QuestionData["options"],
              allowMultiple: typeof input.allowMultiple === "boolean" ? input.allowMultiple : false,
              allowCustomInput: typeof input.allowCustomInput === "boolean" ? input.allowCustomInput : false,
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

  // Skip leading tool messages until we find a non-tool message. A single
  // `slice(1)` was insufficient: parallel tool calls produce a run of
  // `role: "tool"` messages that all share one preceding assistant message,
  // so dropping only the first still leaves an orphan tool_result. The LLM
  // API rejects orphan tool_results with a 400 (tool_use_id not found).
  while (recent.length > 0 && recent[0].role === "tool") {
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
      // 18-M-threadtitle-mismatch: align the backend default with
      // the frontend's DEFAULT_THREAD_TITLE ("Board Room") in
      // useCommandRoom.ts. Two sources of truth for the same field
      // produced a flicker on the first paint: the user's local
      // cached state won, but if cache was empty the backend
      // response overrode it. The frontend default is the one
      // the user actually sees first; the backend default is only
      // shown for a freshly-created chat-state.json (e.g. on a
      // brand-new machine) and is rendered after a fetch round-
      // trip, so matching the frontend constant is the lower-
      // surprise choice.
      threadTitle: "Board Room",
    };
  }
}

let chatStore: ChatState;
const chatStoreReady = loadChatState().then((state) => { chatStore = state; });
export { chatStoreReady };

/** Per-session lock to prevent concurrent agent responses for the same session */
const sessionsResponding = new Set<string>();
// 12-H21: per-session token-usage mutex. The
// `updateSessionTokenUsage` callback mutates `session.contextUsage`
// and `session.cumulativeInput/OutputTokens` and broadcasts a
// `chat:context` event. Without serialization, two concurrent
// onTokenUsage callbacks (e.g., a producer session and a sub-agent
// the producer spawned) can read-modify-write the same session
// object — the read of `cumulativeInputTokens` happens before the
// other callback's +=, and the broadcast carries a stale value
// that the UI then renders as a "context dropped" jump. Chain
// promises per sessionId to serialize.
const tokenUsageLocks = new Map<string, Promise<void>>();
function withTokenUsageLock<T>(sessionId: string, fn: () => T | Promise<T>): Promise<T> {
  const prev = tokenUsageLocks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Swallow rejections in the chain so one failed update doesn't
  // poison the next call's `prev`. The caller still sees the
  // rejection because `next` re-uses the same fn return.
  tokenUsageLocks.set(
    sessionId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  // Bounded cleanup: if the map grows beyond a generous cap
  // (matching SESSIONS_RESPONDING_CAP), drop the oldest entries.
  // In practice this map mirrors the active-session count, so the
  // cap should never bite — but a leak path that forgets to
  // release would otherwise grow the map indefinitely.
  if (tokenUsageLocks.size > SESSIONS_RESPONDING_CAP) {
    const firstKey = tokenUsageLocks.keys().next().value;
    if (firstKey !== undefined) tokenUsageLocks.delete(firstKey);
  }
  return next;
}
/** Tracks /spawn calls in progress for a given sessionId. The duplicate
 * check at the start of /spawn reads `chatStore.sessions[sessionId]` and
 * is not atomic with the assignment of the new session object — two
 * concurrent /spawn requests for the same role can both pass the check
 * and the second will silently overwrite the first. This set serializes
 * the validation phase (sync check + sync add, no awaits between). */
const pendingSpawns = new Set<string>();
// 16-M-pending-spawns-cap: defensive upper bound. The set should
// normally only ever hold sessionIds mid-spawn (a few hundred ms at
// most), so realistic size is ~tens of entries. If an error path
// ever forgets to `delete`, the set grows unbounded — and since the
// set gates every /spawn call, a leak would 409-out the entire API.
// 1000 matches the sibling sessionsResponding cap; a 429 is the
// right shape (the client is asking for more spawns than the
// server can validate concurrently).
const PENDING_SPAWNS_CAP = 1000;
// Defensive upper bound. The lock should only ever hold sessionIds that
// are currently mid-LLM-call, so the set should stay tiny. If a request
// error path ever leaks a sessionId without `delete`, the set can grow
// unbounded — past a few thousand entries something is very wrong, and
// we'd rather reject a new request than OOM the process. 1000 is well
// above the realistic max (one per project + a handful of stragglers).
const SESSIONS_RESPONDING_CAP = 1000;

// Upper bound on the chain of compacted sessions we walk when resolving
// a producer session id. In practice a session is compacted at most a
// few times before becoming inactive; 20 is a defensive ceiling that
// prevents a corrupted `compacted → compacted` chain from looping forever.
const MAX_COMPACTION_CHAIN_DEPTH = 20;

// 18-C-compact-race: per-session compaction lock. The /compact handler
// yields to I/O while building the summary (an LLM call that can run
// 30-60s), and the new-session id is derived deterministically from
// the old session's generation. Two concurrent /compact calls on the
// same base session could both pass the `if (chatStore.sessions[new])`
// existence check, race on the in-memory mutations, and silently
// overwrite each other. The set is checked-and-added synchronously
// at the top of the handler (no await between the check and the add),
// so the second caller observes the first's set entry and gets a 409.
// The cap is a defensive upper bound — the set should only ever hold
// a handful of sessionIds mid-compaction. A leak would 409-out the
// entire /compact endpoint, which is the right behavior (refuse rather
// than corrupt).
const PENDING_COMPACTIONS_CAP = 1000;
const pendingCompactions = new Set<string>();

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

// 17-M-prod-sum-compacted: resolve the active producer session for a
// project, walking the compaction chain. After /compact, the base
// session stays in chatStore.sessions with status="compacted" and a
// new `producer-${projectId}-g${N}` session is created. Callers that
// only look up the base id would write to the compacted (frozen) one
// — producer_update messages would land in a session the UI never
// shows, wasting I/O and confusing operators. Walk the chain and
// return the latest non-compacted session, or null if none exists.
export function resolveActiveProducerSession(
  projectId: string,
): ExtendedChatSession | null {
  const sessionId = producerSessionId(projectId);
  let active: ExtendedChatSession | undefined = chatStore.sessions[sessionId];
  if (!active) return null;
  if (active.status !== "compacted") return active;
  let gen = active.generation ?? 1;
  let depth = 0;
  while (depth < MAX_COMPACTION_CHAIN_DEPTH) {
    const nextGen = gen + 1;
    const next = chatStore.sessions[`${sessionId}-g${nextGen}`] as ExtendedChatSession | undefined;
    if (!next) break;
    active = next;
    gen = nextGen;
    depth++;
    if (active.status !== "compacted") break;
  }
  return active && active.status !== "compacted" ? active : null;
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
  // 16-H-append-message-unhandled-rejection: the previous `await
  // saveChatState()` rethrew on disk-full / EROFS / JSON.parse-fail
  // / etc. The function is called from many fire-and-forget sites
  // (producer summary, autonomous loop, chat) and from `await`
  // sites that don't catch — so a transient write error became an
  // unhandled rejection, which the index.ts unhandledRejection
  // handler routes to fatalExit → process exit. The message is
  // already in the in-memory session.messages array; the on-disk
  // loss is preferable to taking down the whole API.
  try {
    await saveChatState();
  } catch (saveErr) {
    logger.error(
      { err: saveErr instanceof Error ? saveErr.message : String(saveErr), sessionId, event: "chat_state_save_failed" },
      "Failed to persist chat state after appendMessage — continuing with in-memory state",
    );
  }
  broadcast({
    type: "chat:message",
    sessionId,
    message: msg,
  } as WSEvent);
}

/** Update token usage on a session and broadcast to frontend.
 * 12-H21: serialised through `withTokenUsageLock` so two concurrent
 * onTokenUsage callbacks on the same session can't interleave their
 * read-modify-write of `cumulativeInputTokens` / `contextUsage`.
 * The previous fire-and-forget version assumed the callback was
 * reentrant-safe, which it isn't when a producer session and a
 * sub-agent both stream token usage into the same session object. */
function updateSessionTokenUsage(
  session: ExtendedChatSession,
  usage: { input_tokens: number; output_tokens: number },
  model: string,
): Promise<void> {
  return withTokenUsageLock(session.id, () => {
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
  });
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
      // 16-H-launch-godot-fire-forget: launchGodotEditor is now async
      // (plugin install was made async to avoid blocking the event
      // loop). We don't want to await it here because the chat session
      // response shouldn't block on Godot startup — fire-and-forget,
      // log the outcome when the promise settles.
      launchGodotEditor(projectDir).then((launchResult) => {
        if (launchResult.success) {
          logger.info({ projectId, pid: launchResult.pid, event: "godot_editor_launched" }, "Godot editor auto-launched");
        } else {
          logger.warn({ projectId, error: launchResult.error, event: "godot_editor_launch_failed" }, "Could not auto-launch Godot editor");
        }
      }).catch((err) => {
        logger.warn({ projectId, err: err instanceof Error ? err.message : String(err), event: "godot_editor_launch_failed" }, "Could not auto-launch Godot editor");
      });
    }
  }

  const sessionId = producerSessionId(projectId);
  const existing = chatStore.sessions[sessionId];

  // Resolve latest generation if the base session was compacted
  let activeSession = existing;
  if (activeSession && activeSession.status === "compacted") {
    let gen = activeSession.generation ?? 1;
    let depth = 0;
    while (depth < MAX_COMPACTION_CHAIN_DEPTH) {
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
        id: newId("msg"),
        type: "welcome",
        sender: "Producer",
        content: `Welcome to ${project.name}. I'm the Producer, orchestrating our studio's multi-agent game development pipeline for this project.`,
        timestamp: now,
        showActions: false,
      },
      {
        id: newId("msg"),
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

  const sessionId = newId("session");
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
        id: newId("msg"),
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
  // 10-H2: abort any in-flight LLM/tool loop for this session BEFORE
  // removing the AbortController. Without this, an in-flight call would
  // continue to consume Kimi/Z.ai credits and try to write to a session
  // that no longer exists. The next checkpoint broadcast would silently
  // drop on the floor (or worse, write to a different session if the id
  // is later recycled).
  const controller = sessionAbortControllers.get(id);
  if (controller) {
    try { controller.abort(); } catch { /* already aborted */ }
  }
  sessionAbortControllers.delete(id);
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
    id: newId("msg"),
    type: "agent",
    sender: session.role,
    content: `[${roleDisplay} CONSULTATION COMPLETE]\n\n${finalSummary}`,
    timestamp: new Date().toISOString(),
    showActions: false,
  });

  safeIngestProducerSummaryFact(projectId, {
    kind: "consultation_closed",
    at: new Date().toISOString(),
    title: session.role,
    detail: roleDisplay,
  });

  // 18-H-close-no-abort: abort any in-flight LLM call for the
  // consultation before deleting the session. Without this, the
  // LLM can keep streaming tokens after the user has called
  // /close; the response handler would then call
  // `session.messages.push(...)` against the now-orphaned
  // object and the subsequent `saveChatState()` would persist it
  // back into chat-state.json, resurrecting the deleted session
  // on next load. DELETE /sessions/:id has the same wiring at
  // line ~877; /close was added later and missed it.
  const controller = sessionAbortControllers.get(id);
  if (controller) {
    try { controller.abort(); } catch { /* already aborted */ }
  }
  sessionAbortControllers.delete(id);
  cleanupWorkflow(id);

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
// 11-C2: read the validated, type-coerced boolean from the config
// schema instead of the raw env string. The Zod schema transforms
// "true"/"false" into a boolean, and the chat route is the only
// consumer; reading the raw env bypasses the validation and means a
// future env mutation without re-running loadConfig() would silently
// re-enable the test endpoint. Fall back to the env string for
// pre-config module-load callers (loadConfig() is a memoized singleton,
// so this is safe to call on every request).
if (loadConfig().ENABLE_TEST_ENDPOINTS) {
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
          id: newId("msg"),
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

  // Q9-6th: acquire the same per-session lock /messages uses. Without
  // this, a /messages call in flight can append to the cleared message
  // list, leaving the session in a half-cleared state that a subsequent
  // /compact would summarize incorrectly. Reject the clear with 409
  // rather than queueing — the client can retry once the agent finishes.
  if (sessionsResponding.has(id)) {
    res.status(409).json({ success: false, error: "Agent is responding — clear after it finishes" });
    return;
  }
  sessionsResponding.add(id);

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
        id: newId("msg-welcome"),
        type: "welcome" as const,
        sender: "Producer",
        content:
          "Welcome to the Board Room. I'm the Producer, orchestrating our studio's multi-agent game development pipeline.",
        timestamp: new Date().toISOString(),
        showActions: false,
      },
      {
        id: newId("msg-prompt"),
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
      id: newId("msg"),
      type: "system" as const,
      sender: "SYSTEM",
      content: "Session cleared.",
      timestamp: new Date().toISOString(),
      showActions: false,
    },
  } as WSEvent);

  await saveChatState();
  sessionsResponding.delete(id);
  res.json({ success: true });
});

// POST /api/chat/sessions/:id/compact — Compact session into new generation
chatRouter.post("/sessions/:id/compact", async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const session = chatStore.sessions[id];

    if (!session) {
      logger.warn({ requestedId: id, availableIds: Object.keys(chatStore.sessions).slice(0, 10) }, "Compact: session not found");
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // 18-C-compact-race: acquire the per-session compaction lock
    // synchronously. The check+add below is one synchronous step
    // (no await between them) so two concurrent /compact calls
    // cannot both observe an absent entry. The second caller gets
    // a 409 and the client can retry once the first compaction
    // finishes. The set is unregistered in the `finally` block so
    // a thrown error in the summary LLM call doesn't strand the
    // sessionId. The cap is a defensive upper bound — refuse a new
    // request rather than OOM the process on a leak.
    if (pendingCompactions.size >= PENDING_COMPACTIONS_CAP) {
      logger.warn({ pendingCompactions: pendingCompactions.size, cap: PENDING_COMPACTIONS_CAP, event: "compact_lock_cap_hit" },
        "Pending-compactions set at cap — refusing new compaction");
      res.status(429).json({ error: "Too many compactions in flight — try again shortly" });
      return;
    }
    if (pendingCompactions.has(id)) {
      res.status(409).json({ error: "Compaction already in progress for this session" });
      return;
    }
    pendingCompactions.add(id);

    if (session.conversationHistory.length < 4) {
      res.status(400).json({ error: "Not enough history to compact" });
      return;
    }

    // Build summary from conversation history
    const rawConversationText = session.conversationHistory
      .map((m: LLMMessage) => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 3000) : JSON.stringify(m.content).slice(0, 3000)}`)
      .join("\n\n");

    // 11-M2: cap the joined string so the summarizer model can't be
    // overflowed. 200k chars ≈ 50k tokens — well below the glm-4.7-flash
    // 128k window. Keep the tail; prefix a marker so the summary
    // signals it had to be truncated.
    const MAX_COMPACT_INPUT_CHARS = 200_000;
    const conversationText = rawConversationText.length > MAX_COMPACT_INPUT_CHARS
      ? `[...truncated ${rawConversationText.length - MAX_COMPACT_INPUT_CHARS} chars from the head]\n${rawConversationText.slice(-MAX_COMPACT_INPUT_CHARS)}`
      : rawConversationText;

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
    // Q9-10: cap the summary LLM call. Without a timeout, a hung model
    // server would block the /compact request indefinitely — the user
    // has no abort path, and the connection stays open. 60s is generous
    // for a 2048-token summary on haiku but tight enough that a stuck
    // request returns 500 in operator-visible time.
    const summaryResponse = await fetch(`${summaryBaseUrl}/v1/messages`, {
      method: "POST",
      headers: summaryHeaders,
      body: JSON.stringify({
        model: summaryModel,
        max_tokens: 2048,
        messages: [{ role: "user", content: summaryPrompt }],
      }),
      signal: AbortSignal.timeout(60_000),
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
    // 11-H14: rename local `newId` variable to `newSessionId` so it
    // doesn't shadow the imported `newId(prefix)` id helper from
    // utils/ids.ts. The shadow caused the newSession block below to
    // call the string variable as a function, which TypeScript
    // rejected with "Type 'String' has no call signatures" once we
    // migrated the inner `id: \`session-${...}\`` sites to call
    // `newId("session")`.
    const newSessionId = `${id}-g${newGeneration}`;

    // Check new session doesn't already exist
    if (chatStore.sessions[newSessionId]) {
      res.status(409).json({ error: "Compacted session already exists" });
      return;
    }

    const now = new Date().toISOString();

    // Create new session inheriting from old
    const newSession: ExtendedChatSession = {
      ...session,
      // 11-H14: was `id: newId` (passing the function reference as the
      // value, which would stringify the function source as the id).
      // Use a properly-typed 128-bit session id.
      id: newSessionId,
      messages: [
        {
          id: newId("msg"),
          type: "system",
          sender: "SYSTEM",
          content: `Session compacted from generation ${oldGeneration}. Previous context summarized below.`,
          timestamp: now,
          showActions: false,
        },
        {
          id: newId("msg"),
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
    chatStore.sessions[newSessionId] = newSession;
    sessionsResponding.delete(id);

    await saveChatState();

    // Clean up compacted sessions more than 2 generations behind the current one.
    // They're only needed for generation traversal which stops at the first non-compacted session.
    // Use a strict regex on the full session id so e.g. "producer-project1-g2"
    // can't accidentally match "producer-project1x-g3" (project id prefix collision).
    const baseSessionId = id.replace(/-g\d+$/, "");
    const ancestorPattern = new RegExp(`^${escapeRegExp(baseSessionId)}-g\\d+$`);
    for (const [sid, sess] of Object.entries(chatStore.sessions)) {
      if (sid === id || sid === newSessionId) continue;
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
        { err: cleanupSaveErr, oldSessionId: id, newSessionId: newSessionId, event: "compaction_cleanup_save_failed" },
        "Compaction cleanup save failed; stale compacted sessions may persist on disk",
      );
    }

    logger.info({ oldSessionId: id, newSessionId: newSessionId, generation: newGeneration, summaryChars: summaryText.length }, "Session compacted");

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
  } finally {
    // 18-C-compact-race: release the per-session compaction lock
    // on every async exit path. We always release here so a thrown
    // error in the LLM call (or anywhere else) cannot strand the
    // sessionId and permanently 409-out the endpoint for that
    // session. The 404 / 400 / 409 / 429 paths return before the
    // lock is added (the `pendingCompactions.add(id)` line above
    // sits after those early returns), so there's no double-free
    // risk for those responses.
    pendingCompactions.delete(id);
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
  // and be rejected. The lock must be released on every async exit
  // path — including the `await saveChatState()` at line ~1272 that
  // runs before the LLM-call try block — or a disk-full or quota
  // error will leave the session permanently locked.
  let lockHeld = false;
  if (body.type !== "system" && body.type !== "progress" && body.type !== "producer_update") {
    if (sessionsResponding.has(id)) {
      res.status(409).json({ success: false, error: "Agent is already responding — please wait" });
      return;
    }
    if (sessionsResponding.size >= SESSIONS_RESPONDING_CAP) {
      logger.error(
        { size: sessionsResponding.size, cap: SESSIONS_RESPONDING_CAP, event: "sessions_responding_overflow" },
        "sessionsResponding hit the defensive cap — a cleanup path is leaking entries",
      );
      res.status(503).json({ success: false, error: "Server at capacity — try again shortly" });
      return;
    }
    sessionsResponding.add(id);
    lockHeld = true;
  }

  // 12-C8: define the lock release primitive IMMEDIATELY after the
  // lock is acquired. The previous code defined it ~50 lines later
  // (after `await saveChatState()` at line 1326). If that intermediate
  // save threw (disk full, quota, fs permission), the lock leaked
  // permanently — every future POST to this session would return 409
  // until the API restarted.
  const releaseLock = () => {
    if (lockHeld) {
      sessionsResponding.delete(id);
      lockHeld = false;
    }
  };
  const clientDisconnectHandler = () => {
    logger.info({ sessionId: id, event: "chat_client_disconnected_pre_llm" },
      "Client disconnected before LLM call — releasing per-session lock");
    releaseLock();
  };
  req.on("close", clientDisconnectHandler);

  const userMessageId = newId("msg");
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
      // Q19-6th: allowlist image MIME types only. The previous regex
      // accepted any media_type (text/html, application/javascript, etc.),
      // which an attacker who controls a tool output could use to inject
      // HTML/JS as text into the LLM's context. Anthropic's image block
      // rejects non-image media_types at API time, so we'd get a
      // confusing 4xx anyway — better to fail at parse with a clear log.
      const match = imgDataUrl.match(/^data:(image\/(?:png|jpe?g|gif|webp));base64,(.+)$/);
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

  try {
    await saveChatState();
  } catch (preLLMSaveErr) {
    req.off("close", clientDisconnectHandler);
    releaseLock();
    throw preLLMSaveErr;
  }

  // Note: We do NOT broadcast the user message here because the frontend
  // already adds it optimistically. Broadcasting would create a duplicate.

  // If this is a system / orchestration message or no auto-response needed, return early
  if (body.type === "system" || body.type === "progress" || body.type === "producer_update") {
    // 18-H-disconnect-handler-leak: detach the close handler before
    // the early return. The handler itself is a no-op for system
    // messages (lockHeld is false), but the listener keeps the
    // `releaseLock` closure alive in the request's listener map and
    // would fire on a late `req` close — which today is harmless,
    // but if a future maintainer adds a side-effect to
    // releaseLock (e.g. broadcasting chat:aborted), the late fire
    // would be a phantom event for a session that already
    // responded.
    req.off("close", clientDisconnectHandler);
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
  const progressMsgId = newId("msg");
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
    req.off("close", clientDisconnectHandler);
    releaseLock();
    throw saveErr;
  }

  // R1: Declare heartbeat outside try so catch block can clear it
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  // 10-H3: hoist the mid-flight close handler too so the catch path
  // can detach it. Otherwise the listener (and its captured
  // AbortController) leaks on every request that errors.
  let midFlightCloseHandler: (() => void) | undefined;

  try {
    // Set up progress callback for tool execution updates
    const onProgress = makeProgressCallback(id, progressMsgId);

    // 12-H2: track the wall-clock start so the FINAL chat:progress
    // event (sent after the LLM resolves) reports the true elapsed,
    // not the last 2-second tick boundary. Without this, an LLM that
    // completes 1.5s after the last tick reports a 0-2s drift in the
    // final event content, which the frontend renders as a jump from
    // "(44s)" to "complete" with no acknowledgement of the actual
    // 45.5s of work. Capturing startTime here makes the success
    // path's final event accurate.
    const heartbeatStart = Date.now();
    let heartbeatCount = 0;
    // Heartbeat: broadcast periodic progress updates during long API waits
    heartbeat = setInterval(() => {
      heartbeatCount++;
      const elapsed = heartbeatCount * 2;
      // 18-L-progress-dry: shared helper for the heartbeat bar.
      // Cap/base/increment live in utils/progress.ts so the LLM
      // service and this handler can't drift.
      const pct = heartbeatProgressPct(heartbeatCount);
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
    // 10-H3: keep a reference to the mid-flight close handler so we
    // can detach it in the success/error path. Previously the inline
    // arrow function was registered with `req.on("close", ...)` and
    // never `req.off()`'d, so it (and the AbortController closure it
    // captured) leaked per request. The pre-LLM clientDisconnectHandler
    // (installed at line ~1318) was correctly off'd, but this second
    // handler was forgotten.
    const midFlightCloseHandlerImpl = () => {
      if (!clientAbort.signal.aborted) {
        logger.info({ sessionId: id, event: "chat_client_disconnected" },
          "Client disconnected mid-response — cancelling in-flight LLM call");
        clientAbort.abort();
      }
    };
    midFlightCloseHandler = midFlightCloseHandlerImpl;
    // Attach the close listener BEFORE registering in the abort map so
    // a client disconnect that races with the assignment is still
    // caught by the listener and not silently dropped.
    req.on("close", midFlightCloseHandlerImpl);
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
      // 12-H21: updateSessionTokenUsage now returns a Promise<void>
      // (lock serialisation). Swallow rejection here — token usage
      // updates are best-effort; a lock failure should not crash
      // the LLM streaming loop or surface a misleading error to
      // the user (the call is still in flight and the response is
      // being constructed independently).
      updateSessionTokenUsage(session as ExtendedChatSession, usage, model).catch(() => {});
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

    // 12-H2: report the real elapsed in the final progress event.
    // The tick-based `heartbeatCount * 2` is only accurate at tick
    // boundaries; the LLM can complete mid-tick. Use the wall-clock
    // delta from heartbeatStart so the final message reflects the
    // true wait time (rounded to seconds, the precision the UI
    // already shows).
    const finalElapsed = Math.round((Date.now() - heartbeatStart) / 1000);
    broadcast({
      type: "chat:progress",
      sessionId: id,
      progressMsgId,
      progress: 100,
      content: `${agentRole} complete (${finalElapsed}s)`,
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
      id: newId("msg"),
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
    req.off("close", clientDisconnectHandler);
    if (midFlightCloseHandler) req.off("close", midFlightCloseHandler);
    releaseLock();
    sessionAbortControllers.delete(id);
    res.status(201).json({ success: true, data: { userMessage, assistantMessage } });
  } catch (err: unknown) {
    const error = err as Error;

    // R1: Clear heartbeat on error to prevent permanent timer leak
    clearInterval(heartbeat);
    req.off("close", clientDisconnectHandler);
    if (midFlightCloseHandler) req.off("close", midFlightCloseHandler);
    releaseLock();
    sessionAbortControllers.delete(id);

    // Remove the progress placeholder before adding the error message
    const progressIndex = session.messages.findIndex((m) => m.id === progressMsgId);
    if (progressIndex !== -1) {
      session.messages.splice(progressIndex, 1);
    }

    const errorMessage: ChatMessage = {
      id: newId("msg"),
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
    // Don't leak the internal error verbatim — a ZAI API key rejection
    // surfaces "401 Unauthorized: invalid x-api-key", an internal LLM
    // client exception surfaces a stack-trace-shaped message, etc. Send
    // a generic "agent invocation failed" to the client and keep the
    // full text in the message transcript + logger for debugging.
    res.status(500).json({ success: false, error: "Agent invocation failed" });
  } finally {
    // 12-C11: belt-and-suspenders. Success and catch both clear
    // `heartbeat` (lines 1494 + 1602), but any future maintainer adding
    // a new return/throw path that skips the cleanup would leak a
    // 2-second-tick interval per spawn. clearInterval(undefined) is a
    // no-op, so this is idempotent with the explicit clears above.
    if (heartbeat) clearInterval(heartbeat);
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

  const invocationId = newId("invoke");
  const sessionId = role.toLowerCase().replace(/\s+/g, "-");
  const now = new Date().toISOString();
  const agentRole = role as AgentRole;

  // R2 + spawn TOCTOU: Return 409 if session ID is already being spawned
  // or already exists. The check + add below is sync (no await between),
  // so two concurrent /spawn calls for the same role can't both pass.
  if (pendingSpawns.has(sessionId) || chatStore.sessions[sessionId]) {
    res.status(409).json({ success: false, error: `Session ${sessionId} already exists or is being spawned` });
    return;
  }
  if (pendingSpawns.size >= PENDING_SPAWNS_CAP) {
    logger.error(
      { size: pendingSpawns.size, cap: PENDING_SPAWNS_CAP, event: "pending_spawns_overflow" },
      "pendingSpawns hit the defensive cap — a cleanup path is leaking entries",
    );
    res.status(503).json({ success: false, error: "Server at capacity — try again shortly" });
    return;
  }
  pendingSpawns.add(sessionId);
  // Track whether the lock made it to the response. The body has a
  // single success-path return at the very end that sets this; an
  // unexpected throw in the middle would otherwise leave the lock
  // held until the process restarts. The finally always releases.
  let spawnResponded = false;
  try {

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

    // Auto-launch Godot editor (fire-and-forget; see comment at line ~600).
    if (project.workspacePath) {
      const projectDir = resolveProjectWorkspace(project.workspacePath);
      launchGodotEditor(projectDir).then((launchResult) => {
        if (launchResult.success) {
          logger.info({ projectId, pid: launchResult.pid, event: "godot_editor_launched" }, "Godot editor auto-launched for agent spawn");
        }
      }).catch((err) => {
        logger.warn({ projectId, err: err instanceof Error ? err.message : String(err), event: "godot_editor_launch_failed" }, "Could not auto-launch Godot editor for agent spawn");
      });
    }
  }

  // Create session for the spawned agent
  const newSession: ExtendedChatSession = {
    id: sessionId,
    role: agentRole,
    projectId,
    messages: [
      {
        id: newId("msg"),
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
    id: newId("msg"),
    type: "system",
    sender: "SYSTEM",
    content: `${agentRole.toUpperCase()} spawned at ${now} UTC`,
    timestamp: now,
    showActions: false,
  });

  safeIngestProducerSummaryFact(projectId, {
    kind: "agent_spawned",
    at: now,
    agentRole,
    detail: sessionId,
  });

  // If a task is provided, execute it immediately
  let spawnStatus: "completed" | "failed" | "ready" = "ready";
  if (task) {
    // Create a progress message for this invocation
    const progressMsgId = newId("msg");
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
    // 17-H1: install the same mid-flight close handler the messages
    // path uses, so a client disconnect during a long spawn cancels
    // the in-flight LLM call. Without this, a closed browser tab
    // leaves the invokeAgent running for the full 20-min budget
    // and burns tokens the user already gave up on. The handler is
    // also registered in the module-level `sessionAbortControllers`
    // map so external events (project delete, broadcast) can cancel
    // the spawn without depending on the HTTP request lifetime.
    let spawnAbort: AbortController | undefined;
    let midFlightCloseHandler: (() => void) | undefined;
    if (req) {
      spawnAbort = new AbortController();
      const clientAbort = spawnAbort;
      const sessionIdForAbort = sessionId;
      midFlightCloseHandler = () => {
        if (!clientAbort.signal.aborted) {
          logger.info({ sessionId: sessionIdForAbort, event: "spawn_client_disconnected" },
            "Client disconnected mid-spawn — cancelling in-flight LLM call");
          clientAbort.abort();
        }
      };
      req.on("close", midFlightCloseHandler);
      sessionAbortControllers.set(sessionId, spawnAbort);
    }
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
        const pct = heartbeatProgressPct(heartbeatCount);
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
          // 12-H21: see producer-session call site — the lock returns
          // a Promise. Swallow rejection since the spawn is already
          // past its `await continueConversation(...)` and the LLM
          // result is the caller-visible success criterion, not the
          // usage accounting.
          updateSessionTokenUsage(newSession as ExtendedChatSession, usage, spawnModel).catch(() => {});
        },
        spawnAbort?.signal,
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
        id: newId("msg"),
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
        id: newId("msg"),
        type: "agent",
        sender: "producer",
        content: `${agentRole.replace(/-/g, " ")} reports task complete. Session awaiting closure.`,
        timestamp: new Date().toISOString(),
        showActions: true,
      });

      safeIngestProducerSummaryFact(projectId, {
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

      // Sanitize the error before broadcasting over WS. The full text stays
      // in the server log + chat transcript, but a connected UI shouldn't
      // receive an LLM client stack trace or an internal key-rotation
      // message. Truncate to 200 chars as a belt-and-suspenders bound.
      const safeError = error.message.length > 200
        ? `${error.message.slice(0, 200)}…`
        : error.message;
      broadcast({
        type: "agent:failed",
        agentId: invocationId,
        error: safeError,
        sessionId: sessionId,
      } as WSEvent);

      // Persist failure notice on the producer session.
      await appendMessage(producerSessionId(projectId), {
        id: newId("msg"),
        type: "system",
        sender: "SYSTEM",
        content: `${agentRole.toUpperCase()} failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        showActions: false,
      });

      safeIngestProducerSummaryFact(projectId, {
        kind: "spawn_task_failed",
        at: new Date().toISOString(),
        agentRole,
        detail: error.message,
      });

      // Quest Bridge: move ticket back to available on failure
      if (ticketId) {
        await moveQuestTicket(ticketId, "available", agentRole);
      }
    } finally {
      // 12-C11: belt-and-suspenders. The inner try/catch above already
      // clears `heartbeat` on both the success path (line 1849) and the
      // catch path (line 1947), but any future maintainer adding a code
      // path that returns/throws without re-clearing would leak a
      // 2-second-tick interval per spawn. A finally block makes the
      // invariant unconditional and the cleanup idempotent
      // (clearInterval(undefined) is a no-op).
      if (heartbeat) clearInterval(heartbeat);
      // 17-H1: detach the mid-flight close handler and drop the abort
      // controller from the module-level map. Without this, the req.on
      // listener (and its AbortController closure) leak per spawn —
      // and the same id re-used by a future spawn would inherit a
      // stale controller from the previous call.
      if (req && midFlightCloseHandler) req.off("close", midFlightCloseHandler);
      if (sessionAbortControllers.get(sessionId) === spawnAbort) {
        sessionAbortControllers.delete(sessionId);
      }
    }
  }

  await saveChatState();
  res.json({
    success: spawnStatus !== "failed",
    data: { invocationId, role, sessionId, status: spawnStatus },
  });
  spawnResponded = true;
  } finally {
    // 10-H4: ALWAYS release the spawn lock, including on the success
    // path. The previous `if (!spawnResponded)` guard meant a successful
    // spawn left the sessionId in the Set forever — every successful
    // /spawn permanently leaked one entry. (The error path's delete is
    // correct, but the success path needs it too.) A duplicate /spawn
    // for the same id will be caught by the `chatStore.sessions[id]`
    // check at line 1630 instead.
    pendingSpawns.delete(sessionId);
    if (!spawnResponded) {
      // Best-effort 500 — if response was already sent, the socket
      // will close and Express will log the unhandled error.
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Spawn failed unexpectedly" });
      }
    }
  }
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

  const diffId = newId("diff");

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
