/**
 * ZAI LLM Client — Anthropic-compatible API wrapper.
 * Based on bounty-hunter/src/lib/orchestrator/llm-provider.ts patterns.
 *
 * Key differences from the reference:
 * - Game studio tools (Read, Write, Edit, Glob, Grep, Bash, Task)
 * - Session-scoped tool execution
 * - Agent prompts loaded from workspace/.claude/agents/*.md files
 */

import { loadConfig } from "../config.js";
import { getAgentSystemPrompt, loadAgentPrompts } from "../prompts/agent-prompt-loader.js";
import { logger } from "../utils/logger.js";
import { broadcast } from "../services/websocket.js";

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ToolResultContent[];
  tool_calls?: LLMToolCall[];
  tool_call_id?: string;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  id?: string;
  content: string;
  tool_calls?: LLMToolCall[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface LLMRequest {
  model?: string;
  messages: LLMMessage[];
  tools?: LLMTool[];
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  /** Agent role — automatically loads system prompt from workspace/.claude/agents/ */
  agentRole?: string;
}

const MAX_RETRIES = 10;
const RETRY_DELAY_MS = 2000;

/** Tool importance for pruning (higher = more important) */
const TOOL_IMPORTANCE: Record<string, number> = {
  Read: 100,
  Glob: 60,
  Grep: 60,
  Bash: 30,
  Write: 20,
  Edit: 20,
  Task: 10,
};
const DEFAULT_TOOL_IMPORTANCE = 40;
const MAX_CONTEXT_CHARS = 500_000;
const MAX_TOOL_RESULT_BYTES = 15_000;
const SUMMARIZE_THRESHOLD = 400_000;  // Trigger summary when context exceeds this
const KEEP_RECENT_MESSAGES = 10;       // Never prune last N messages

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429 && attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if (response.status >= 500 && attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error as Error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError ?? new Error("Max retries exceeded");
}

function truncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + `\n\n[... TRUNCATED ${content.length - maxChars} chars ...]`;
}

const MAX_CONSECUTIVE_SAME_TOOL_CALLS = 6;
const MAX_REPETITION_WINDOW = 30;

function hashToolInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, Object.keys(input).sort());
  } catch {
    return String(input);
  }
}

function detectRepetitiveLoop(recentCalls: Array<{ name: string; inputHash: string }>): { detected: boolean; message?: string } {
  if (recentCalls.length < MAX_CONSECUTIVE_SAME_TOOL_CALLS) return { detected: false };

  const lastN = recentCalls.slice(-MAX_CONSECUTIVE_SAME_TOOL_CALLS);
  const allSame = lastN.every(
    (call) => call.name === lastN[0].name && call.inputHash === lastN[0].inputHash
  );

  if (allSame) {
    return {
      detected: true,
      message: `Same tool call "${lastN[0].name}" repeated ${MAX_CONSECUTIVE_SAME_TOOL_CALLS} times with identical arguments. Consider a different approach.`,
    };
  }

  // Check for same tool name 4+ times
  const toolCounts = new Map<string, number>();
  for (const call of recentCalls) {
    toolCounts.set(call.name, (toolCounts.get(call.name) || 0) + 1);
  }
  const maxCount = Math.max(...toolCounts.values());
  if (maxCount >= MAX_CONSECUTIVE_SAME_TOOL_CALLS) {
    const mostFrequent = [...toolCounts.entries()].find(([, c]) => c === maxCount)?.[0] ?? "";
    return {
      detected: true,
      message: `Tool "${mostFrequent}" called ${maxCount} times in last ${recentCalls.length} iterations. Progress may be stalled.`,
    };
  }

  return { detected: false };
}

/** Count total characters in messages */
function countMessageChars(messages: LLMMessage[]): number {
  return messages.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
}

/** Summarize old messages when context exceeds threshold */
async function summarizeOldMessages(messages: LLMMessage[]): Promise<string | null> {
  const totalChars = countMessageChars(messages);
  if (totalChars <= SUMMARIZE_THRESHOLD) return null;

  // Separate system, recent, and old messages
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  const recentMsgs = nonSystem.slice(-KEEP_RECENT_MESSAGES);
  const oldMsgs = nonSystem.slice(0, -KEEP_RECENT_MESSAGES);

  if (oldMsgs.length === 0) return null;

  // Build summary prompt
  const conversationText = oldMsgs
    .map(m => `${m.role}: ${typeof m.content === "string" ? m.content.slice(0, 2000) : "[tool content]"}`)
    .join("\n");

  const summaryPrompt = `Summarize this conversation history concisely.
Keep: key decisions, important facts, active tasks, code snippets.
Remove: greetings, small talk, redundant explanations.

Conversation to summarize (${oldMsgs.length} messages):
${conversationText}

Respond ONLY with the summary, nothing else. Max 2000 characters.`;

  // Use a lightweight model for summarization (haiku)
  const config = loadConfig();
  try {
    const summaryResponse = await fetchWithRetry(
      `${config.ZAI_BASE_URL}/v1/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.ZAI_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "glm-4.7-flash",
          max_tokens: 1024,
          messages: [{ role: "user", content: summaryPrompt }],
        }),
      }
    );

    if (summaryResponse.ok) {
      const data = await summaryResponse.json() as {
        content?: Array<{ type: string; text?: string }>;
      };
      const summaryText = data.content?.find(c => c.type === "text")?.text ?? "";
      return summaryText.slice(0, 2000);
    }
  } catch {
    // Summarization failed — continue without it
    logger.warn({ event: "summarization_failed" }, "Failed to summarize old messages");
  }

  return null;
}

function pruneMessages(messages: LLMMessage[]): LLMMessage[] {
  let totalChars = messages.reduce(
    (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0),
    0
  );
  if (totalChars <= MAX_CONTEXT_CHARS) return messages;

  const result: LLMMessage[] = [];
  let usedChars = 0;

  // Keep system messages
  for (const msg of messages) {
    if (msg.role === "system") {
      result.push(msg);
      usedChars += typeof msg.content === "string" ? msg.content.length : 0;
    }
  }

  // R3: Keep recent messages as atomic groups (assistant+tool pairs must not be split)
  const nonSystem = messages.filter((m) => m.role !== "system");

  const recentCount = 50;
  let recent = nonSystem.slice(-recentCount);

  // If the slice starts with a tool result (meaning its assistant was cut off), skip it
  if (recent.length > 0 && recent[0].role === "tool") {
    recent = recent.slice(1);
  }

  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    const charCount = typeof msg.content === "string" ? msg.content.length : 0;

    if (usedChars + charCount <= MAX_CONTEXT_CHARS) {
      result.push(msg);
      usedChars += charCount;
    } else {
      const remaining = MAX_CONTEXT_CHARS - usedChars;
      if (remaining > 100) {
        result.push({ ...msg, content: truncate(typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content), remaining) });
      }
      break;
    }
  }

  return result;
}

/** Call ZAI API (Anthropic-compatible endpoint) */
export async function callZAI(request: LLMRequest): Promise<LLMResponse> {
  const config = loadConfig();
  const model = request.model ?? config.DEFAULT_MODEL;

  // Load agent system prompt if agentRole is provided
  let systemPrompt = request.systemPrompt ?? "";
  if (request.agentRole) {
    try {
      const agentPrompt = await getAgentSystemPrompt(request.agentRole);
      systemPrompt = systemPrompt ? `${agentPrompt}\n\n${systemPrompt}` : agentPrompt;
    } catch {
      // Fall back to provided systemPrompt or empty
    }
  }

  // Filter out system messages from the array (they go in the separate system field)
  const messages = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (Array.isArray(m.content)) {
        const toolResult = m.content[0] as ToolResultContent | undefined;
        if (toolResult?.type === "tool_result") {
          return {
            role: "tool" as const,
            tool_call_id: toolResult.tool_use_id,
            content: toolResult.content,
          };
        }
      }
      return {
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
    });

  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 8192,
    temperature: request.temperature ?? 1.0,
    messages,
  };

  // Add system prompt as separate field (ZAI API format)
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  const url = `${config.ZAI_BASE_URL}/v1/messages`;
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.ZAI_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ZAI API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    id: string;
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  let content = "";
  const toolCalls: LLMToolCall[] = [];
  if (data.content) {
    for (const c of data.content) {
      if (c.type === "text" && c.text) {
        content += c.text;
      } else if (c.type === "tool_use" && c.name && c.input) {
        toolCalls.push({
          id: c.id ?? `tool-${crypto.randomUUID().slice(0, 8)}`,
          name: c.name,
          input: c.input,
        });
      }
    }
  }

  return {
    id: data.id,
    content,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    usage: data.usage ?? undefined,
  } as LLMResponse;
}

/** Progress callback for tool execution loop */
export type ProgressCallback = (info: {
  iteration: number;
  totalTools: number;
  currentTool?: string;
  phase: "thinking" | "executing" | "responding";
  thinking?: string;
}) => void;

/** Callback to track file operations for long-running task context */
export type FileOperationCallback = (op: { tool: string; path?: string; result: "success" | "failed" }) => void;

/** Call LLM with tool execution loop */
export async function callLLMWithTools(
  request: LLMRequest,
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
  onProgress?: ProgressCallback,
  sessionId?: string,
  onFileOperation?: FileOperationCallback
): Promise<LLMResponse> {
  const config = loadConfig();
  const maxTools = config.MAX_TOOL_CALLS;
  const checkpointInterval = config.TOOL_CHECKPOINT_INTERVAL || 30;

  let iteration = 0;
  let totalTools = 0;
  let lastCheckpointIteration = 0;
  let messages = [...request.messages];
  let recentToolCalls: Array<{ name: string; inputHash: string }> = [];
  let summarizedThisContext = false;

  while (iteration < 200) {
    iteration++;

    // Log checkpoint at intervals
    if (iteration - lastCheckpointIteration >= checkpointInterval) {
      lastCheckpointIteration = iteration;
      logger.info({ iteration, totalTools, event: "checkpoint" }, `Checkpoint at iteration ${iteration}, ${totalTools} total tools`);
    }

    // Check if we need to summarize old messages to stay within context
    if (!summarizedThisContext && countMessageChars(messages) > SUMMARIZE_THRESHOLD) {
      const summary = await summarizeOldMessages(messages);
      if (summary) {
        // Get system messages to preserve
        const systemMsgs = messages.filter(m => m.role === "system");
        const nonSystem = messages.filter(m => m.role !== "system");
        const recentMsgs = nonSystem.slice(-KEEP_RECENT_MESSAGES);

        // Replace messages with: system + summary + recent
        messages = [
          ...systemMsgs,
          { role: "user", content: `[Previous Context Summary — Do not repeat this information verbatim, but use it for continuity]\n${summary}` },
          ...recentMsgs,
        ];
        summarizedThisContext = true;
        logger.info({ event: "context_summarized", originalChars: countMessageChars(messages), summaryChars: summary.length }, "Context summarized");
      }
    }

    const response = await callZAI({ ...request, messages });
    onProgress?.({ iteration, totalTools, phase: "thinking", thinking: response.content.slice(0, 500) });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      onProgress?.({ iteration, totalTools, phase: "responding", thinking: response.content.slice(0, 500) });
      return response;
    }

    totalTools += response.tool_calls.length;
    if (totalTools >= maxTools) {
      messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
      messages.push({
        role: "user",
        content: `You have reached the maximum of ${maxTools} tool calls. Output your final response now.`,
      });
      const final = await callZAI({ ...request, messages });
      return { ...final, tool_calls: undefined };
    }

    // Execute tool calls
    const toolResults: string[] = [];
    for (const tc of response.tool_calls) {
      onProgress?.({ iteration, totalTools, currentTool: tc.name, phase: "executing" });
      const result = await toolExecutor(tc.name, tc.input);
      // Track file operations for long-running task context
      const filePath = (tc.input?.file_path ?? tc.input?.path) as string | undefined;
      const isFileOp = ["Read", "Write", "Edit", "Glob", "Grep", "Bash"].includes(tc.name);
      if (isFileOp) {
        onFileOperation?.({ tool: tc.name, path: filePath, result: result.startsWith("Error:") ? "failed" : "success" });
      }

      // Special case: AskUserQuestion should stop the loop and return the question
      if (result.startsWith("__ASK_USER_QUESTION__")) {
        const questionJson = result.substring("__ASK_USER_QUESTION__".length);
        const questionData = JSON.parse(questionJson);
        return {
          content: questionData.question,
          tool_calls: [{
            id: tc.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            input: questionData,
          }],
          usage: response.usage ?? undefined,
        };
      }

      // Special case: ProposePlan should stop the loop and return the plan
      if (result.startsWith("__PROPOSE_PLAN__")) {
        const planJson = result.substring("__PROPOSE_PLAN__".length);
        const planData = JSON.parse(planJson);
        return {
          content: planData.title,
          tool_calls: [{
            id: tc.id ?? `call_${crypto.randomUUID().slice(0, 8)}`,
            name: tc.name,
            input: planData,
          }],
          usage: response.usage ?? undefined,
        };
      }

      toolResults.push(`[Tool: ${tc.name}]\n${truncate(result, MAX_TOOL_RESULT_BYTES)}`);

      // Track tool calls for loop detection
      recentToolCalls.push({ name: tc.name, inputHash: hashToolInput(tc.input) });
      if (recentToolCalls.length > MAX_REPETITION_WINDOW) {
        recentToolCalls.shift();
      }

      // Check for repetitive loop
      const loopCheck = detectRepetitiveLoop(recentToolCalls);
      if (loopCheck.detected && loopCheck.message) {
        // Broadcast loop detection to frontend
        broadcast({
          type: "agent:loop:detected",
          sessionId: sessionId ?? "",
          toolName: tc.name,
          iterations: iteration,
          message: loopCheck.message,
        } as any);

        // Inject enhanced warning into context with continuation reminder
        messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
        messages.push({
          role: "user",
          content: `[SYSTEM WARNING] ${loopCheck.message}

IMPORTANT: If you have been making progress on a task, do NOT restart or re-propose the same plan. Instead:
1. Summarize what you have already completed
2. Identify what remains to be done
3. Continue from where you left off

Use "Now implementing..." to indicate you're continuing work rather than starting over.`,
        });

        // Force stop after 25 iterations if still looping
        if (iteration > 25) {
          const final = await callZAI({ ...request, messages });
          return { ...final, tool_calls: undefined };
        }
      }
    }

    messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
    messages.push({ role: "user", content: toolResults.join("\n\n") });

    // Prune if too many messages
    if (messages.length > 80) {
      messages = pruneMessages(messages);
    }
  }

  // Max iterations — return last response
  const last = await callZAI({ ...request, messages });
  return { ...last, tool_calls: undefined };
}

/** Game studio tool definitions for the LLM */
export const GAME_STUDIO_TOOLS: LLMTool[] = [
  {
    name: "Read",
    description: "Read the contents of a file from the filesystem. Returns full file contents.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to read" },
      },
      required: ["file_path"],
    },
  },
  {
    name: "Write",
    description: "Create or overwrite a file with the given contents.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to write" },
        content: { type: "string", description: "The content to write to the file" },
      },
      required: ["file_path", "content"],
    },
  },
  {
    name: "Edit",
    description: "Make a targeted edit to an existing file using exact string replacement.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to the file to edit" },
        old_string: { type: "string", description: "The exact string to find and replace" },
        new_string: { type: "string", description: "The replacement string" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
  },
  {
    name: "Glob",
    description: "Find files matching a glob pattern.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern to match (e.g. '**/*.ts')" },
        path: { type: "string", description: "Root directory to search from" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Grep",
    description: "Search for a pattern within files.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for" },
        path: { type: "string", description: "Directory or file to search in" },
        glob: { type: "string", description: "Filter by file pattern (e.g. '*.ts')" },
        context: { type: "number", description: "Number of context lines" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "Bash",
    description: "Execute a shell command.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 60000)" },
      },
      required: ["command"],
    },
  },
  {
    name: "Task",
    description: "Spawn a subagent to work on a specific subtask. Use for parallel work.",
    input_schema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "The agent role to spawn (e.g. 'game-designer')" },
        task: { type: "string", description: "Detailed description of the task" },
        context: { type: "string", description: "Relevant context and files to pass" },
      },
      required: ["agent", "task"],
    },
  },
  {
    name: "AskUserQuestion",
    description: "Present a question with selectable options to the user. Use when you need user input to proceed.",
    input_schema: {
      type: "object",
      properties: {
        questionId: { type: "string", description: "Unique identifier for this question" },
        question: { type: "string", description: "The question to ask the user" },
        options: {
          type: "array",
          description: "Available options for the user to select",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique option identifier" },
              label: { type: "string", description: "Short label (1-5 words)" },
              description: { type: "string", description: "Brief description explaining the trade-off" },
            },
            required: ["id", "label"],
          },
        },
        allowMultiple: { type: "boolean", description: "Whether user can select multiple options (default: false for single-select)" },
        allowCustomInput: { type: "boolean", description: "Set to true when you want the user to be able to type their own free-text answer in addition to selecting options. Use this when none of the predefined options fully capture the user's intent, or when you need open-ended input (e.g., 'What should we name this feature?', 'Describe your vision', 'Any other requirements?'). Default: false" },
      },
      required: ["questionId", "question", "options"],
    },
  },
  {
    name: "ProposePlan",
    description: "Propose a structured execution plan with phases. Use when presenting a multi-step approach to the user that they can execute.",
    input_schema: {
      type: "object",
      properties: {
        planId: { type: "string", description: "Unique identifier for this plan" },
        title: { type: "string", description: "Brief title for the plan" },
        phases: {
          type: "array",
          description: "Ordered list of execution phases",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Unique phase identifier (e.g., 'phase-1')" },
              label: { type: "string", description: "Short label (e.g., 'Phase 1 — Foundation')" },
              description: { type: "string", description: "Brief description of what this phase does" },
              estimatedEffort: { type: "string", description: "Estimated time/effort (e.g., '~2 hours', '1 day')" },
            },
            required: ["id", "label", "description"],
          },
        },
      },
      required: ["planId", "title", "phases"],
    },
  },
  {
    name: "GenerateAsset",
    description:
      "Generate a 2D game asset image using AI (mflux/FLUX2 Klein on Apple Silicon). " +
      "The pipeline: AI image generation -> background removal -> post-processing -> Godot-ready PNG. " +
      "Returns the file path and auto-registers in the asset inventory. " +
      "Use for: UI icons, character sprites, props, textures, VFX sprites. " +
      "For sprite sheets, set spriteSheet=true with cols/rows.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed image generation prompt describing the game asset" },
        name: { type: "string", description: "Asset name, slug-safe (e.g. 'health-potion')" },
        type: { type: "string", description: "Asset type: 2d, 3d, vfx, audio, texture (default: 2d)" },
        category: { type: "string", description: "Category: prop, character, env, weapon, ui, tex, sfx, music (default: prop)" },
        width: { type: "number", description: "Image width in pixels (default: 512)" },
        height: { type: "number", description: "Image height in pixels (default: 512)" },
        steps: { type: "number", description: "Generation steps, higher=more quality (default: 4)" },
        seed: { type: "number", description: "Random seed for reproducibility (optional)" },
        removeBg: { type: "boolean", description: "Remove background for transparent PNG (default: true)" },
        negativePrompt: { type: "string", description: "What to avoid in generation (optional)" },
        gridSize: { type: "number", description: "Pad to grid tile size e.g. 128 for 128x128 (optional)" },
        spriteSheet: { type: "boolean", description: "Enable sprite-sheet auto-slicing (default: false)" },
        spriteCols: { type: "number", description: "Columns in sprite sheet (default: 1)" },
        spriteRows: { type: "number", description: "Rows in sprite sheet (default: 1)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags for asset inventory" },
        presetsFile: { type: "string", description: "YAML presets filename for batch generation (e.g. 'presets.yaml')" },
      },
      required: ["prompt", "name"],
    },
  },
  {
    name: "StartConsultation",
    description:
      "Start a director consultation session. Creates a new chat session where the user can have a direct back-and-forth conversation with a director-level agent. " +
      "Use this when the user needs to discuss high-level creative or technical direction before work begins. " +
      "Valid roles: creative-director, technical-director, art-director, narrative-director, audio-director. " +
      "The user will see a new tab appear and can chat directly with the director.",
    input_schema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Director role to consult with. Must be a director-level role: creative-director, technical-director, art-director, narrative-director, audio-director.",
        },
        brief: {
          type: "string",
          description: "Optional brief context to include in the session welcome message (e.g. 'Discussing art style for a dark fantasy RPG').",
        },
      },
      required: ["role"],
    },
  },
];

/** Pre-load agent prompts on module init */
loadAgentPrompts().catch((err) => logger.error({ error: err?.message ?? String(err), event: "prompt_load_error" }, "Failed to load agent prompts"));