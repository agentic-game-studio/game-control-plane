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
import { CHARS_PER_TOKEN_ESTIMATE, getModelForTier, getModelContextWindow } from "../config/model-mapping.js";

/** Simple async semaphore for ZAI API concurrency control.
 *
 * `acquireCount` tracks the number of outstanding acquires so a stray
 * `release()` (e.g. from a bug in the caller's error path) can never
 * push `permits` above the configured limit and silently break
 * concurrency control. Without this guard, a single double-release
 * would let two callers in past the cap, then a third release would
 * let three in, and so on. The previous implementation assumed every
 * release had a matching acquire — a brittle invariant the type system
 * couldn't enforce. */
class Semaphore {
  private permits: number;
  private readonly limit: number;
  private acquireCount = 0;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.limit = permits;
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    this.acquireCount++;
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.acquireCount === 0) {
      // Stray release with no matching acquire. Log and ignore so a
      // bug in caller code can't inflate the permit pool. Without this
      // guard, permits could grow past `limit` and silently lift
      // concurrency control.
      logger.warn(
        { event: "semaphore_stray_release", permits: this.permits, limit: this.limit },
        "Semaphore.release() called without a matching acquire — ignoring",
      );
      return;
    }
    this.acquireCount--;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
      // The permit is transferred to the next waiter; do not increment.
    } else {
      this.permits++;
    }
  }
}

/**
 * Per-model concurrency limits.
 * Kimi K2.6 supports 10 concurrent requests.
 * Legacy GLM limits kept for backward compatibility.
 */
const MODEL_CONCURRENCY_LIMITS: Record<string, number> = {
  "kimi-for-coding": 10,
  "kimi-k2.6": 10,
  "kimi-k2.5": 5,
  "kimi-k2-turbo-preview": 2,
  "glm-5.1": 10,
  "glm-5": 2,
  "glm-4.7": 2,
  "glm-4.7-flash": 1,
};

const DEFAULT_CONCURRENCY_LIMIT = 2;

/** Per-model semaphores — keyed by model name.
 *
 * Capped at MAX_TRACKED_MODELS to prevent unbounded growth if a caller
 * passes an arbitrary model string (e.g., from user-supplied config or
 * a future feature that takes a model name from the wire). The cap is
 * generous because the supported set is small (~6 models). When the
 * cap is hit, the least-recently-used entry is evicted — eviction is
 * safe because an in-flight semaphore has callers waiting on it, and
 * once they all release the entries would be empty anyway. The risk
 * would be evicting an entry with active waiters, so we check the
 * waitQueue length before dropping. */
const MAX_TRACKED_MODELS = 32;

const modelSemaphores = new Map<string, Semaphore>();

function getSemaphore(model: string): Semaphore {
  const existing = modelSemaphores.get(model);
  if (existing) {
    // Refresh LRU position by re-inserting (Map preserves insertion order).
    modelSemaphores.delete(model);
    modelSemaphores.set(model, existing);
    return existing;
  }

  if (modelSemaphores.size >= MAX_TRACKED_MODELS) {
    // Evict the oldest entry that has no waiters. If all entries have
    // waiters, refuse the eviction and just grow past the cap — losing
    // a semaphore mid-acquire would deadlock the waiter.
    let evicted = false;
    for (const [key, sem] of modelSemaphores) {
      if ((sem as unknown as { waitQueue: unknown[] }).waitQueue.length === 0) {
        modelSemaphores.delete(key);
        evicted = true;
        break;
      }
    }
    if (!evicted) {
      logger.warn(
        { event: "model_semaphore_overflow", model, tracked: modelSemaphores.size },
        "modelSemaphores hit cap and all entries have waiters — growing past cap",
      );
    }
  }

  const limit = MODEL_CONCURRENCY_LIMITS[model] ?? DEFAULT_CONCURRENCY_LIMIT;
  const sem = new Semaphore(limit);
  modelSemaphores.set(model, sem);
  return sem;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: string;
    data: string;
  };
}

export type MessageContent = string | Array<TextContent | ImageContent>;

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent;
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
  /** Optional abort signal to cancel the HTTP request */
  signal?: AbortSignal;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

/** Tool importance for pruning (higher = more important) */
const TOOL_IMPORTANCE: Record<string, number> = {
  Read: 100,
  Glob: 60,
  Grep: 60,
  Bash: 30,
  Write: 20,
  Edit: 20,
  Task: 10,
  GodotCLI: 50,
};
const DEFAULT_TOOL_IMPORTANCE = 40;
const MAX_TOOL_RESULT_BYTES = 15_000;
const KEEP_RECENT_MESSAGES = 10;       // Never prune last N messages

function getFetchTimeoutMs(): number {
  try {
    const config = loadConfig();
    return config.API_TIMEOUT_MS;
  } catch {
    return 120_000;
  }
}

async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES, externalSignal?: AbortSignal): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    // Combine timeout signal with optional external abort signal
    const signals: AbortSignal[] = [AbortSignal.timeout(getFetchTimeoutMs())];
    if (externalSignal) signals.push(externalSignal);
    const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    try {
      const response = await fetch(url, {
        ...options,
        signal: combinedSignal,
      });
      if (response.status === 429 && attempt < retries) {
        // Rate limit — use longer delay (5s, 10s, 20s) to avoid hammering
        const delay = 5000 * Math.pow(2, attempt) + Math.random() * 2000;
        logger.warn({ status: 429, attempt, delayMs: Math.round(delay), event: "rate_limit_retry" }, "Rate limited — backing off");
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
      // Don't retry if the external abort signal fired — caller intentionally cancelled
      if (externalSignal?.aborted) throw lastError;
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

// Exploration tools legitimately call many different files/patterns in a row.
// Only flag them as looping when the exact same call repeats (identical args).
const EXPLORATION_TOOLS = new Set(["Read", "Glob", "Grep"]);

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

  // Check for same tool name 6+ times — skip exploration tools since reading
  // many different files or globbing many patterns is normal.
  const toolCounts = new Map<string, number>();
  for (const call of recentCalls) {
    if (EXPLORATION_TOOLS.has(call.name)) continue;
    toolCounts.set(call.name, (toolCounts.get(call.name) || 0) + 1);
  }
  const maxCount = Math.max(...Array.from(toolCounts.values()));
  if (maxCount >= MAX_CONSECUTIVE_SAME_TOOL_CALLS) {
    const mostFrequent = Array.from(toolCounts.entries()).find(([, c]) => c === maxCount)?.[0] ?? "";
    return {
      detected: true,
      message: `Tool "${mostFrequent}" called ${maxCount} times in last ${recentCalls.length} iterations. Progress may be stalled.`,
    };
  }

  return { detected: false };
}

/** Count total characters in messages (images estimated at ~1k chars each for token counting) */
function countMessageChars(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    if (typeof m.content === "string") return sum + m.content.length;
    return sum + m.content.reduce((cSum, c) => cSum + (c.type === "text" ? c.text.length : 1000), 0);
  }, 0);
}

/** Rough token estimate from messages (pre-emptive check before API call) */
function estimateMessageTokens(messages: LLMMessage[]): number {
  return Math.ceil(countMessageChars(messages) / CHARS_PER_TOKEN_ESTIMATE);
}

/** Summarize old messages when context exceeds threshold */
async function summarizeOldMessages(messages: LLMMessage[], summarizeThreshold: number): Promise<string | null> {
  if (estimateMessageTokens(messages) <= summarizeThreshold) return null;

  // Separate system, recent, and old messages
  const systemMsgs = messages.filter(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");
  const recentMsgs = nonSystem.slice(-KEEP_RECENT_MESSAGES);
  const oldMsgs = nonSystem.slice(0, -KEEP_RECENT_MESSAGES);

  if (oldMsgs.length === 0) return null;

  // Build summary prompt
  const conversationText = oldMsgs
    .map(m => {
      if (typeof m.content === "string") return `${m.role}: ${m.content.slice(0, 2000)}`;
      const textParts = m.content.filter((c): c is TextContent => c.type === "text").map(c => c.text).join(" ");
      const hasImage = m.content.some(c => c.type === "image");
      return `${m.role}: ${textParts.slice(0, 2000)}${hasImage ? " [image attached]" : ""}`;
    })
    .join("\n");

  const summaryPrompt = `Summarize this conversation history concisely.
Keep: key decisions, important facts, active tasks, code snippets.
Remove: greetings, small talk, redundant explanations.

Conversation to summarize (${oldMsgs.length} messages):
${conversationText}

Respond ONLY with the summary, nothing else. Max 2000 characters.`;

  // Use a lightweight model for summarization to save costs
  const config = loadConfig();
  const summaryModel = getModelForTier("haiku"); // glm-4.7-flash — cheap summarization
  const summaryProvider = resolveProviderConfig(config, summaryModel);
  const summarySemaphore = getSemaphore(summaryModel);
  try {
    await summarySemaphore.acquire();
    let summaryResponse: Response;
    try {
      summaryResponse = await fetchWithRetry(
        `${summaryProvider.baseUrl}/v1/messages`,
        {
          method: "POST",
          headers: summaryProvider.headers,
          body: JSON.stringify({
            model: summaryModel,
            max_tokens: 1024,
            messages: [{ role: "user", content: summaryPrompt }],
          }),
        }
      );
    } finally {
      summarySemaphore.release();
    }

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

function pruneMessages(messages: LLMMessage[], maxTokens: number): LLMMessage[] {
  if (estimateMessageTokens(messages) <= maxTokens) return messages;

  const result: LLMMessage[] = [];
  let usedTokens = 0;

  // Keep system messages
  for (const msg of messages) {
    if (msg.role === "system") {
      result.push(msg);
      usedTokens += Math.ceil((typeof msg.content === "string" ? msg.content.length : 0) / CHARS_PER_TOKEN_ESTIMATE);
    }
  }

  const nonSystem = messages.filter((m) => m.role !== "system");

  const recentCount = 50;
  let recent = nonSystem.slice(-recentCount);

  // Skip orphaned tool result messages at the start — they need a preceding assistant message
  while (recent.length > 0 && recent[0].role === "user" && typeof recent[0].content === "string" && recent[0].content.startsWith("[Tool:")) {
    recent = recent.slice(1);
  }
  // Skip any other orphaned user messages before the first assistant message
  // (safeStart is just the index of the first assistant message)
  const safeStart = recent.findIndex((m) => m.role === "assistant");
  if (safeStart > 0) {
    recent = recent.slice(safeStart);
  }

  for (let i = 0; i < recent.length; i++) {
    const msg = recent[i];
    const charCount = typeof msg.content === "string"
      ? msg.content.length
      : msg.content.reduce((s, c) => s + (c.type === "text" ? c.text.length : 1000), 0);
    const tokenCount = Math.ceil(charCount / CHARS_PER_TOKEN_ESTIMATE);

    // Don't split assistant+tool pairs: if this message has tool_calls, the next
    // message (tool results) MUST be kept too — otherwise the LLM sees orphaned calls
    if (usedTokens + tokenCount <= maxTokens) {
      result.push(msg);
      usedTokens += tokenCount;
    } else {
      // If the PREVIOUS kept message has tool_calls, drop it too — orphaned tool calls
      // without results will confuse the LLM
      const prevKept = result[result.length - 1];
      if (prevKept && prevKept.role === "assistant" && (prevKept as any).tool_calls) {
        result.pop();
      }

      const remainingTokens = maxTokens - usedTokens;
      const remainingChars = remainingTokens * CHARS_PER_TOKEN_ESTIMATE;
      if (remainingChars > 100) {
        if (typeof msg.content === "string") {
          result.push({ ...msg, content: truncate(msg.content, remainingChars) });
        } else {
          const truncated = msg.content.map((c) =>
            c.type === "text" ? { type: "text" as const, text: truncate(c.text, remainingChars) } : c
          );
          result.push({ ...msg, content: truncated });
        }
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
        const first = m.content[0] as unknown as ToolResultContent | undefined;
        if (first?.type === "tool_result") {
          return {
            role: "tool" as const,
            tool_call_id: first.tool_use_id,
            content: first.content,
          };
        }
        // Multimodal content (text + images) — pass through to API as-is
        return {
          role: m.role as "user" | "assistant",
          content: m.content,
        };
      }
      return {
        role: m.role as "user" | "assistant",
        content: m.content,
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

  const provider = resolveProviderConfig(config, model);
  const url = `${provider.baseUrl}/v1/messages`;
  const modelSem = getSemaphore(model);
  await modelSem.acquire();
  let response: Response;
  try {
    response = await fetchWithRetry(url, {
      method: "POST",
      headers: provider.headers,
      body: JSON.stringify(body),
    }, MAX_RETRIES, request.signal);
  } finally {
    modelSem.release();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    id: string;
    model?: string;
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const respText = data.content?.find((c) => c.type === "text")?.text ?? "";
  logger.debug({ model: data.model ?? "unknown", preview: respText.slice(0, 100), event: "llm_response" }, "LLM response received");

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

/** Resolve provider config (base URL, API key, headers) from model name */
function resolveProviderConfig(config: ReturnType<typeof loadConfig>, model: string) {
  const isKimi = model.startsWith("kimi-");
  if (isKimi && !config.KIMI_API_KEY?.trim()) {
    throw new Error(`KIMI_API_KEY is required for model "${model}". Set it in .env or switch DEFAULT_MODEL to a GLM model.`);
  }
  if (!isKimi && !config.ZAI_API_KEY?.trim()) {
    throw new Error(`ZAI_API_KEY is required for model "${model}". Set it in .env or use Kimi with KIMI_API_KEY.`);
  }
  const baseUrl = isKimi ? config.KIMI_BASE_URL : config.ZAI_BASE_URL;
  const apiKey = isKimi ? config.KIMI_API_KEY : config.ZAI_API_KEY;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (isKimi) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    headers["x-api-key"] = apiKey;
  }
  logger.debug({ provider: isKimi ? "Kimi" : "Z.ai", model, baseUrl, event: "llm_provider_config" }, "LLM provider config resolved");
  return { baseUrl, apiKey, headers };
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

/** Callback for real-time token usage updates from API responses */
export type TokenUsageCallback = (usage: { input_tokens: number; output_tokens: number }) => void;

/** Detect if LLM text indicates intent to act but no tool was called */
function looksLikeIntentToAct(text: string): boolean {
  const lower = text.toLowerCase();
  const intentPhrases = [
    "i'll", "i will", "let me", "let's", "starting", "updating", "creating",
    "writing", "editing", "reading", "checking", "generating", "building",
    "implementing", "fixing", "adding", "removing", "proceeding",
    "ผมจะ", "ฉันจะ", "เริ่ม", "ต่อ", "กำลัง", "จะทำ", "จะอัพเดต",
    "จะสร้าง", "จะแก้ไข", "จะอ่าน", "จะเขียน", "จะเพิ่ม", "จะลบ",
    "now i", "next i", "first i", "then i", "okay i", "sure i",
  ];
  return intentPhrases.some((p) => lower.includes(p));
}

/** Call LLM with tool execution loop */
export async function callLLMWithTools(
  request: LLMRequest,
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>,
  onProgress?: ProgressCallback,
  sessionId?: string,
  onFileOperation?: FileOperationCallback,
  onTokenUsage?: TokenUsageCallback,
  signal?: AbortSignal
): Promise<LLMResponse> {
  const config = loadConfig();
  const maxTools = config.MAX_TOOL_CALLS;
  const checkpointInterval = config.TOOL_CHECKPOINT_INTERVAL || 30;

  let iteration = 0;
  let totalTools = 0;
  let lastCheckpointIteration = 0;
  let messages = [...request.messages];
  let recentToolCalls: Array<{ name: string; inputHash: string }> = [];
  let noToolRetries = 0;
  const MAX_NO_TOOL_RETRIES = 2;

  // Phase enforcement: track read vs write balance to prevent read loops
  const READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
  const WRITE_TOOLS = new Set(["Write", "Edit"]);
  let readCount = 0;
  let writeCount = 0;
  let readWarningInjected = false;
  let buildGateTriggeredAt = 0;

  // Per-model context limits (use 80% of window as max, 50% as summarize threshold)
  const contextWindow = getModelContextWindow(request.model ?? "");
  const maxContextTokens = Math.floor(contextWindow * 0.8);
  const summarizeThreshold = Math.floor(contextWindow * 0.5);

  while (iteration < 200) {
    iteration++;

    // Log checkpoint at intervals
    if (iteration - lastCheckpointIteration >= checkpointInterval) {
      lastCheckpointIteration = iteration;
      logger.info({ iteration, totalTools, event: "checkpoint" }, `Checkpoint at iteration ${iteration}, ${totalTools} total tools`);
    }

    const response = await callZAI({ ...request, messages, signal });
    if (response.usage) onTokenUsage?.(response.usage);
    onProgress?.({ iteration, totalTools, phase: "thinking", thinking: response.content.slice(0, 500) });

    if (!response.tool_calls || response.tool_calls.length === 0) {
      // If the LLM says it will do something but doesn't call a tool, nudge it to act
      if (looksLikeIntentToAct(response.content) && noToolRetries < MAX_NO_TOOL_RETRIES) {
        noToolRetries++;
        logger.info({ iteration, noToolRetries, event: "nudge_tool_call" }, "LLM indicated intent but emitted no tools — nudging");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `You indicated you would take action but did not call any tools. Please proceed with the tool call now. Do not explain — just act.`,
        });
        continue;
      }
      onProgress?.({ iteration, totalTools, phase: "responding", thinking: response.content.slice(0, 500) });
      return response;
    }
    noToolRetries = 0; // Reset on successful tool call

    totalTools += response.tool_calls.length;
    if (totalTools >= maxTools) {
      messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
      messages.push({
        role: "user",
        content: `You have reached the maximum of ${maxTools} tool calls. Output your final response now.`,
      });
      const final = await callZAI({ ...request, messages, signal });
      if (final.usage) onTokenUsage?.(final.usage);
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

      // Phase enforcement: track read vs write balance
      if (READ_TOOLS.has(tc.name)) readCount++;
      if (WRITE_TOOLS.has(tc.name)) writeCount++;

      // READ LOOP GATE: Too many reads, no writes — force implementation
      if (readCount >= 5 && writeCount === 0 && !readWarningInjected) {
        readWarningInjected = true;
        toolResults.push(
          `[SYSTEM PHASE GATE] You have read ${readCount} files but written 0. ` +
          `You are stuck in a read loop. STOP READING. You have enough context. ` +
          `Enter IMPLEMENT phase now: write ALL files needed for the current task. ` +
          `Do not read any more files — use what you already know. ` +
          `Produce working code, then verify it builds.`
        );
      } else if (readCount >= 10 && writeCount === 0 && readWarningInjected) {
        // Second warning — even stronger
        toolResults.push(
          `[SYSTEM HARD GATE] Still reading after warning! ${readCount} reads, ${writeCount} writes. ` +
          `WRITE CODE NOW. You will be stopped if you read again without writing.`
        );
      }

      // BUILD GATE: After every 5 writes, inject verification prompt
      if (writeCount > 0 && writeCount % 5 === 0 && writeCount !== buildGateTriggeredAt) {
        buildGateTriggeredAt = writeCount;
        toolResults.push(
          `[SYSTEM BUILD GATE] You've written ${writeCount} files. ` +
          `VERIFY BEFORE CONTINUING: Run GodotCLI(command=check) to validate all GDScripts. ` +
          `Fix any errors before writing more files. ` +
          `Current feature MUST build clean before starting new work.`
        );
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
          const final = await callZAI({ ...request, messages, signal });
          if (final.usage) onTokenUsage?.(final.usage);
          return { ...final, tool_calls: undefined };
        }

        continue; // Skip normal append — warning already injected
      }
    }

    messages.push({ role: "assistant", content: response.content, tool_calls: response.tool_calls });
    // Cap total tool results to prevent context explosion from many/large results
    const MAX_TOTAL_TOOL_RESULTS = 60_000;
    let toolContent = toolResults.join("\n\n");
    if (toolContent.length > MAX_TOTAL_TOOL_RESULTS) {
      toolContent = toolContent.slice(0, MAX_TOTAL_TOOL_RESULTS) + "\n\n[... additional tool results truncated]";
    }
    messages.push({ role: "user", content: toolContent });

    // Context management: prune if approaching token limit
    const currentTokens = estimateMessageTokens(messages);
    if (currentTokens > maxContextTokens) {
      logger.info({ iteration, tokens: currentTokens, limit: maxContextTokens, event: "context_pruning" },
        `Pruning messages: ${currentTokens} tokens exceeds limit ${maxContextTokens}`);
      messages = pruneMessages(messages, maxContextTokens);
    } else if (currentTokens > summarizeThreshold) {
      const summary = await summarizeOldMessages(messages, summarizeThreshold);
      if (summary) {
        const systemMsg = messages.find((m) => m.role === "system");
        messages = [
          ...(systemMsg ? [systemMsg] : []),
          { role: "user", content: `[Previous Context Summary]\n${summary}` },
          ...messages.filter((m) => m.role !== "system").slice(-20),
        ];
        logger.info({ iteration, tokensBefore: currentTokens, tokensAfter: estimateMessageTokens(messages), event: "context_summarized" },
          "Summarized old messages to reduce context");
      }
    }
  }

  // Max iterations — return last response
  const last = await callZAI({ ...request, messages, signal });
  if (last.usage) onTokenUsage?.(last.usage);
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
        replace_all: { type: "boolean", description: "Replace all occurrences of old_string (default: false). Set true only when old_string appears multiple times and all should be replaced." },
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
      "For MVPs and prototypes, prefer quick pixel-art placeholder/concept assets through this Python pipeline before committing to final art direction. " +
      "For sprite sheets, set spriteSheet=true with cols/rows.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Detailed image generation prompt describing the game asset. For MVP placeholders, explicitly say pixel art / retro / low-detail if that is the intended direction." },
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
    name: "RunGodotHeadless",
    description:
      "Run Godot Engine in headless mode (no GUI) for CI/testing. " +
      "Detects the godot binary automatically via GODOT_BIN env var or common install paths. " +
      "Commands: check (--check-only validates GDScripts), script (runs a .gd file), export (exports via preset), gut (runs GUT test runner). " +
      "Returns JSON with success, returnCode, stdout, stderr, elapsed_ms. " +
      "Use for: automated-playtest validation, export-godot-project, run-godot-headless skill.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Absolute path to the Godot project directory (containing project.godot)" },
        command: { type: "string", description: "Command: check | script | export | gut", enum: ["check", "script", "export", "gut"] },
        script: { type: "string", description: "Absolute path to .gd script to run (required when command=script)" },
        preset: { type: "string", description: "Export preset name e.g. 'Windows Desktop' (required when command=export)" },
        output: { type: "string", description: "Output file path for export (required when command=export)" },
        godotBin: { type: "string", description: "Path to godot binary (optional, auto-detected)" },
      },
      required: ["project", "command"],
    },
  },
  {
    name: "CreateTicket",
    description:
      "Create a ticket on the Kanban board (tickets.json). " +
      "Use to break GDD content into actionable items, file bugs, or queue features. " +
      "The ticket is placed in the 'Available' column and can be picked up by the autonomous-production-loop. " +
      "Returns the created ticket ID.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Ticket title — concise, imperative (e.g. 'Implement player dash ability')" },
        description: { type: "string", description: "Detailed description: acceptance criteria, GDD reference, implementation notes" },
        agentRole: { type: "string", description: "Target agent role: godot-specialist, writer, art-director, qa-tester, etc." },
        area: { type: "string", description: "Broad area: engineering, content, qa, design" },
        subarea: { type: "string", description: "Sub-area: gameplay, ui, audio, narrative, etc." },
      },
      required: ["title", "description", "agentRole", "area"],
    },
  },
  {
    name: "TilemapSplit",
    description:
      "Split a packed tileset image into individual tile PNGs. " +
      "Reads a tileset image (e.g. 256x256 with 16x16 tiles), extracts each tile, and writes them to an output directory with an atlas.json metadata file. " +
      "Use when: implementing levels, need individual tile assets from a spritesheet, preparing TileSet resources for Godot. " +
      "Supports margin, spacing, and optional square padding per tile.",
    input_schema: {
      type: "object",
      properties: {
        input: { type: "string", description: "Absolute path to the input tileset PNG image" },
        outputDir: { type: "string", description: "Absolute path to output directory (created if not exists)" },
        tileWidth: { type: "integer", description: "Width of each tile in pixels", minimum: 1 },
        tileHeight: { type: "integer", description: "Height of each tile in pixels", minimum: 1 },
        margin: { type: "integer", description: "Outer edge margin in source image (pixels)", default: 0 },
        spacing: { type: "integer", description: "Gap between tiles in source image (pixels)", default: 0 },
        pad: { type: "integer", description: "Square cell size to pad each tile to (e.g. 16 pads each tile to 16x16)", default: 0 },
        namePrefix: { type: "string", description: "Prefix for output tile filenames", default: "tile" },
      },
      required: ["input", "outputDir", "tileWidth", "tileHeight"],
    },
  },
  {
    name: "SpritePack",
    description:
      "Pack individual sprite frame PNGs from a directory into a sprite sheet image. " +
      "Arrange frames in a rows×cols grid with optional padding between cells. " +
      "Use when: preparing animation assets for Godot, combining individual frames into a texture atlas, building character animation sheets. " +
      "Outputs a .png sprite sheet + .json atlas with per-frame coordinates.",
    input_schema: {
      type: "object",
      properties: {
        inputDir: { type: "string", description: "Absolute path to directory containing individual .png frame files" },
        output: { type: "string", description: "Absolute path for output sprite sheet .png" },
        columns: { type: "integer", description: "Number of columns in the sprite sheet grid", minimum: 1, default: 4 },
        padding: { type: "integer", description: "Pixel gap between frames in the sheet", default: 0 },
        pad: { type: "integer", description: "Square cell size (frames centered in pad×pad cells)", default: 0 },
      },
      required: ["inputDir", "output"],
    },
  },
  {
    name: "GenerateAudio",
    description:
      "Synthesize retro 2D game sound effects using pure Python (no external audio deps — uses stdlib wave module). " +
      "Types: jump, coin, shoot, explosion, hit, death, powerup, levelup, menu_select, menu_move, footstep, damage. " +
      "Each type has a tuned synthesizer. " +
      "Use for: quick prototyping SFX without external audio tools, generating placeholder sounds for playtesting. " +
      "Output is a .wav file + manifest entry.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", description: "Sound type: jump | coin | shoot | explosion | hit | death | powerup | levelup | menu_select | menu_move | footstep | damage" },
        output: { type: "string", description: "Absolute path for output .wav file (parent dir created if needed)" },
        duration: { type: "number", description: "Override duration in seconds (optional, each type has a default)" },
      },
      required: ["type", "output"],
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
  {
    name: "GodotCLI",
    description:
      "Local Godot CLI for project management — all operations run locally, no cloud. " +
      "Commands: init (scaffold new project), detect (get project info as JSON), export-presets (generate export_presets.cfg), " +
      "build (local headless export via godot --headless), check (validate GDScripts), test (run GUT tests), " +
      "validate (full project health check), templates (check/install export templates), package (create distributable .dmg/.zip/.tar.gz). " +
      "Use for: project scaffolding, export preset generation, local builds, script validation, packaging. " +
      "Requires Godot installed locally (GODOT_BIN env var or auto-detected).",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          enum: ["init", "detect", "export-presets", "build", "check", "test", "validate", "templates", "package"],
          description: "CLI command to run",
        },
        name: { type: "string", description: "Project name (for init command)" },
        platforms: { type: "string", description: "Comma-separated platforms for export-presets: web,windows,linux,macos,android,ios,all" },
        platform: { type: "string", description: "Target platform for build/package commands" },
        all: { type: "boolean", description: "Build/package all platforms (for build and package commands)" },
        output: { type: "string", description: "Output file path for build/package commands" },
        install: { type: "boolean", description: "Install templates (for templates command)" },
        script: { type: "string", description: "Test script path (for test command, bypasses GUT)" },
      },
      required: ["command"],
    },
  },
  {
    name: "ShipThisExport",
    description:
      "Export game to mobile stores via ShipThis CLI (App Store / Google Play cloud builds). " +
      "Requires cli-main/ vendored and SHIPTHIS_CLI_PATH or default detection. " +
      "Use after local Godot export presets are configured.",
    input_schema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["android", "ios"], description: "Target mobile platform" },
      },
      required: ["platform"],
    },
  },
];

/** Pre-load agent prompts on module init */
loadAgentPrompts().catch((err) => logger.error({ error: err?.message ?? String(err), event: "prompt_load_error" }, "Failed to load agent prompts"));