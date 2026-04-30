import { Router } from "express";
import type { Request, Response } from "express";
import { join } from "node:path";
import type { AgentRole, ChatSession, ChatMessage, CreateMessageRequest, CreateChatSessionRequest, DashboardData, Project, ProjectEngine } from "@game-studio/types";
import type { LLMMessage } from "../llm/zai-client.js";
import { broadcastEvent, readData, writeData } from "../services/data-store.js";
import { invokeAgent, continueConversation, type ProjectContext, detectEngineFromWorkspace } from "../services/llm-service.js";
import { makeProgressCallback } from "../services/llm-service.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import type { WSEvent } from "@game-studio/types";
import { broadcast } from "../services/websocket.js";
import { startWorkflow, advanceStage, completeWorkflow, cleanupWorkflow, getWorkflow, createQuestTicket, moveQuestTicket } from "../services/quest-bridge.js";
import { getOrCreateGodotMCPService, removeGodotMCPService, launchGodotEditor, type GodotMCPServiceOptions } from "../services/godot-mcp-service.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";

export const chatRouter: Router = Router();

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

/** Prune conversation history to stay within context limits */
const MAX_CONTEXT_CHARS = 500_000;

function pruneConversationHistory(history: LLMMessage[]): LLMMessage[] {
  const totalChars = history.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
  if (totalChars <= MAX_CONTEXT_CHARS) return history;

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
    for (const [key, s] of Object.entries(state.sessions)) {
      const session = s as ExtendedChatSession;
      session.messages = session.messages.filter((m) => m.type !== "progress");
      // Hydrate fields that may be missing from older persisted sessions
      if (!session.conversationHistory) session.conversationHistory = [];
      if (!session.fileOperations) session.fileOperations = [];
      if (!session.completedPhases) session.completedPhases = [];
      if (!session.currentTask) session.currentTask = "";
      state.sessions[key] = session;
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
loadChatState().then((state) => { chatStore = state; });

async function saveChatState(): Promise<void> {
  await writeData(CHAT_STATE_FILE, chatStore);
}

function producerSessionId(projectId: string): string {
  return `producer-${projectId}`;
}

function toProjectContext(project: Project): ProjectContext {
  return {
    name: project.name,
    description: project.description,
    engine: project.engine,
    workspacePath: project.workspacePath,
    projectId: project.id,
  };
}

async function getProjectContextForSession(session: ExtendedChatSession): Promise<ProjectContext | undefined> {
  if (!session.projectId) return undefined;
  const project = await getProjectById(session.projectId);
  if (!project) return undefined;

  // Auto-detect engine if not set
  let engine: ProjectEngine | null = project.engine;
  if (!engine && project.workspacePath) {
    const detected = await detectEngineFromWorkspace(project.workspacePath);
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
    workspacePath: project.workspacePath,
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
async function appendMessage(sessionId: string, msg: ChatMessage): Promise<void> {
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

/**
 * Orphan all chat sessions associated with the given project. Sets
 * projectId to null on each matching session and persists the chat
 * state. History is preserved but the sessions become hidden from the
 * project-scoped UI.
 */
export async function orphanProjectSessions(projectId: string): Promise<number> {
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
      const config = loadConfig();
      const projectDir = join(config.WORKSPACE_DIR, project.workspacePath);
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
  if (existing) {
    res.json({ success: true, data: existing });
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
  session.progress = 0;
  session.status = "active";

  // Reset producer session with welcome message; other sessions start empty
  if (id === "producer") {
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

  // Add to conversation history
  session.conversationHistory.push({
    role: "user",
    content: body.content,
  });

  await saveChatState();

  // Note: We do NOT broadcast the user message here because the frontend
  // already adds it optimistically. Broadcasting would create a duplicate.

  // If this is a system message or no auto-response needed, return early
  if (body.type === "system" || body.type === "progress") {
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

  await saveChatState();

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

    const result = await continueConversation(
      agentRole,
      session.conversationHistory,
      id,
      onProgress,
      0,
      projectContext,
      onFileOperation,
      continueCtx || undefined,
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
    const progressIndex = session.messages.findIndex((m) => m.id === progressMsgId);
    if (progressIndex !== -1) {
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

    // Prune conversation history to stay within context limits
    session.conversationHistory = pruneConversationHistory(session.conversationHistory);

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
      toolCalls: result.toolCalls?.map((tc) => ({
        tool: tc.name,
        args: tc.input,
        status: "success",
      })),
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
    res.status(201).json({ success: true, data: { userMessage, assistantMessage } });
  } catch (err: unknown) {
    const error = err as Error;

    // R1: Clear heartbeat on error to prevent permanent timer leak
    clearInterval(heartbeat);

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
      const config = loadConfig();
      const projectDir = join(config.WORKSPACE_DIR, project.workspacePath);
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
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: agentRole,
    sessionId: sessionId,
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

  // If a task is provided, execute it immediately
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
    if (task) {
      const ticket = await createQuestTicket(sessionId, task.slice(0, 80), agentRole, task, "AGENT", "spawn");
      ticketId = ticket.id;
      await moveQuestTicket(ticketId, "in_progress", agentRole);
    }

    try {
      // Don't broadcast agent events from invokeAgent — we handle them ourselves here
      const projectContext = toProjectContext(project);
      logger.info({ event: "spawn_invoke_start", agentRole, taskLength: task?.length ?? 0, sessionId }, `Invoking agent ${agentRole}`);
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
      );
      logger.info({ event: "spawn_invoke_complete", agentRole, contentLength: result.content.length, sessionId }, `Agent ${agentRole} completed with ${result.content.length} chars`);

      // Handle empty content
      if (!result.content || result.content.trim() === "") {
        logger.warn({ event: "spawn_empty_content", agentRole, sessionId }, `Agent ${agentRole} returned empty content`);
      }

      // Remove progress placeholder
      const idx = newSession.messages.findIndex((m) => m.id === progressMsgId);
      if (idx !== -1) newSession.messages.splice(idx, 1);

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
        toolCalls: result.toolCalls?.map((tc) => ({
          tool: tc.name,
          args: tc.input,
          status: "success",
        })),
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

      // Update agent session status to done
      newSession.progress = 100;
      newSession.status = "completed";
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

      // Quest Bridge: move ticket to completed
      if (ticketId) {
        await moveQuestTicket(ticketId, "completed", agentRole);
      }
    } catch (err: unknown) {
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

      // Quest Bridge: move ticket back to available on failure
      if (ticketId) {
        await moveQuestTicket(ticketId, "available", agentRole);
      }
    }
  }

  await saveChatState();
  res.json({
    success: true,
    data: { invocationId, role, sessionId, status: task ? "completed" : "ready" },
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
