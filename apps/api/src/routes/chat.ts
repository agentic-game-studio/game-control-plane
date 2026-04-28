import { Router } from "express";
import type { Request, Response } from "express";
import type { AgentRole, ChatSession, ChatMessage, CreateMessageRequest, CreateChatSessionRequest } from "@game-studio/types";
import type { LLMMessage } from "../llm/zai-client.js";
import { broadcastEvent, readData, writeData } from "../services/data-store.js";
import { invokeAgent, continueConversation } from "../services/llm-service.js";
import { makeProgressCallback } from "../services/llm-service.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import type { WSEvent } from "@game-studio/types";
import { broadcast } from "../services/websocket.js";
import { startWorkflow, advanceStage, completeWorkflow, cleanupWorkflow, getWorkflow, createQuestTicket, moveQuestTicket } from "../services/quest-bridge.js";

export const chatRouter: Router = Router();

/** Parse question data from tool call results */
interface QuestionData {
  questionId: string;
  question: string;
  options: { id: string; label: string; description?: string }[];
  allowMultiple: boolean;
  allowCustomInput: boolean;
}

function parseQuestionFromContent(content: string): QuestionData | null {
  // Now the question data is in toolCalls, not content
  // This function is kept for backwards compatibility but will rarely match
  return null;
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
}

const CHAT_STATE_FILE = "chat-state.json";

function loadChatState(): ChatState {
  try {
    return readData<ChatState>(CHAT_STATE_FILE);
  } catch {
    // File doesn't exist yet, return default with producer session
    return {
      sessions: {
        producer: {
          id: "producer",
          role: "producer",
          messages: [
            {
              id: "msg-welcome",
              type: "welcome" as const,
              sender: "Producer",
              content:
                "Welcome to the Board Room. I'm the Producer, orchestrating our studio's multi-agent game development pipeline.",
              timestamp: new Date().toISOString(),
              showActions: false,
            },
            {
              id: "msg-prompt",
              type: "system" as const,
              sender: "SYSTEM",
              content:
                "Type a command to spawn an agent or request a task. Use /spawn <role> to bring in a specialist.",
              timestamp: new Date().toISOString(),
              showActions: false,
            },
          ],
          status: "active" as const,
          progress: 0,
          spawnedAt: new Date().toISOString(),
          conversationHistory: [],
        },
      },
      currentSessionId: "producer",
      threadId: "thread-001",
      threadTitle: "Producer Session",
    };
  }
}

const chatStore: ChatState = loadChatState();

function saveChatState(): void {
  writeData(CHAT_STATE_FILE, chatStore);
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
    messages: s.messages,
    status: s.status,
    progress: s.progress,
    spawnedAt: s.spawnedAt,
  }));
  res.json({ success: true, data: { sessions: sessionsData, currentSessionId: chatStore.currentSessionId } });
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

// POST /api/chat/sessions — Create new session
chatRouter.post("/sessions", async (req: Request, res: Response) => {
  const body = req.body as CreateChatSessionRequest;

  const sessionId = `session-${Date.now()}`;
  const now = new Date().toISOString();
  const role = (body.role ?? "agent") as AgentRole;

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
    messages: [
      {
        id: `msg-${Date.now()}-1`,
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
  };

  chatStore.sessions[sessionId] = newSession;

  broadcast({
    type: "chat:session:created",
    session: {
      id: newSession.id,
      role: newSession.role,
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  saveChatState();
  res.status(201).json({ success: true, data: newSession });
});

// DELETE /api/chat/sessions/:id — Delete session
chatRouter.delete("/sessions/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);

  // Prevent deleting producer
  if (id === "producer") {
    res.status(400).json({ success: false, error: "Cannot delete producer session" });
    return;
  }

  if (!chatStore.sessions[id]) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  delete chatStore.sessions[id];
  cleanupWorkflow(id);

  broadcast({
    type: "chat:session:deleted",
    sessionId: id,
  } as WSEvent);

  saveChatState();
  res.json({ success: true });
});

// POST /api/chat/sessions/:id/clear — Clear all messages in a session
chatRouter.post("/sessions/:id/clear", (req: Request, res: Response) => {
  const id = String(req.params.id);

  const session = chatStore.sessions[id];
  if (!session) {
    res.status(404).json({ success: false, error: "Session not found" });
    return;
  }

  session.conversationHistory = [];
  session.progress = 0;
  session.status = "active";

  // Reset producer session with welcome message; other sessions start empty
  if (id === "producer") {
    session.messages = [
      {
        id: `msg-welcome-${Date.now()}`,
        type: "welcome" as const,
        sender: "Producer",
        content:
          "Welcome to the Board Room. I'm the Producer, orchestrating our studio's multi-agent game development pipeline.",
        timestamp: new Date().toISOString(),
        showActions: false,
      },
      {
        id: `msg-prompt-${Date.now()}`,
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
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "system" as const,
      sender: "SYSTEM",
      content: "Session cleared.",
      timestamp: new Date().toISOString(),
      showActions: false,
    },
  } as WSEvent);

  saveChatState();
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

  const userMessageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  saveChatState();

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
  const progressMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

  saveChatState();

  try {
    // Set up progress callback for tool execution updates
    const onProgress = makeProgressCallback(id, progressMsgId);

    // Heartbeat: broadcast periodic progress updates during long API waits
    let heartbeatCount = 0;
    const heartbeat = setInterval(() => {
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
    const result = await continueConversation(agentRole, session.conversationHistory, id, onProgress);

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
    session.conversationHistory.push({
      role: "assistant",
      content: result.content,
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
    const assistantMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: messageType,
      sender: agentRole,
      // For questions, use the question text as content (not the raw tool result)
      content: questionData ? questionData.question : result.content,
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

    saveChatState();
    res.status(201).json({ success: true, data: { userMessage, assistantMessage } });
  } catch (err: unknown) {
    const error = err as Error;

    // Remove the progress placeholder before adding the error message
    const progressIndex = session.messages.findIndex((m) => m.id === progressMsgId);
    if (progressIndex !== -1) {
      session.messages.splice(progressIndex, 1);
    }

    const errorMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

    saveChatState();
    res.status(201).json({ success: true, data: { userMessage, errorMessage } });
  }
});

// POST /api/chat/spawn — Spawn an agent with real ZAI API
chatRouter.post("/spawn", async (req: Request, res: Response) => {
  const { role, task } = req.body as { role?: string; task?: string };

  if (!role) {
    res.status(400).json({ success: false, error: "role is required" });
    return;
  }

  const invocationId = `invoke-${Date.now()}`;
  const sessionId = role.toLowerCase().replace(/\s+/g, "-");
  const now = new Date().toISOString();
  const agentRole = role as AgentRole;

  // Create session for the spawned agent
  const newSession: ExtendedChatSession = {
    id: sessionId,
    role: agentRole,
    messages: [
      {
        id: `msg-${Date.now()}-1`,
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
      messages: newSession.messages,
      status: newSession.status,
      progress: newSession.progress,
      spawnedAt: newSession.spawnedAt,
    },
  } as WSEvent);

  saveChatState();

  // If a task is provided, execute it immediately
  if (task) {
    // Create a progress message for this invocation
    const progressMsgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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

    saveChatState();

    const onProgress = makeProgressCallback(sessionId, progressMsgId);

    // Quest Bridge: create ticket for spawned agent task
    let ticketId: string | undefined;
    if (task) {
      const ticket = createQuestTicket(sessionId, task.slice(0, 80), agentRole, task, "AGENT", "spawn");
      ticketId = ticket.id;
      moveQuestTicket(ticketId, "in_progress", agentRole);
    }

    try {
      // Don't broadcast agent events from invokeAgent — we handle them ourselves here
      const result = await invokeAgent(agentRole, task, sessionId, undefined, [], onProgress, false);

      // Remove progress placeholder
      const idx = newSession.messages.findIndex((m) => m.id === progressMsgId);
      if (idx !== -1) newSession.messages.splice(idx, 1);

      const responseMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        type: "agent",
        sender: role,
        content: result.content,
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

      // Quest Bridge: move ticket to completed
      if (ticketId) {
        moveQuestTicket(ticketId, "completed", agentRole);
      }
    } catch (err: unknown) {
      const error = err as Error;

      broadcast({
        type: "agent:failed",
        agentId: invocationId,
        error: error.message,
        sessionId: sessionId,
      } as WSEvent);

      // Quest Bridge: move ticket back to available on failure
      if (ticketId) {
        moveQuestTicket(ticketId, "available", agentRole);
      }
    }
  }

  saveChatState();
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

  const diffId = `diff-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
