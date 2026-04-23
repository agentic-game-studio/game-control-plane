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

  // Keep initial messages
  const initial = messages.filter((m) => m.role !== "system").slice(0, 10);
  for (const msg of initial) {
    if (typeof msg.content === "string" && usedChars + msg.content.length <= MAX_CONTEXT_CHARS * 0.4) {
      result.push(msg);
      usedChars += msg.content.length;
    }
  }

  // Keep recent messages
  const recent = messages.filter((m) => m.role !== "system").slice(-30);
  for (const msg of recent) {
    if (typeof msg.content === "string" && usedChars + msg.content.length <= MAX_CONTEXT_CHARS) {
      result.push(msg);
      usedChars += msg.content.length;
    } else if (typeof msg.content === "string") {
      const remaining = MAX_CONTEXT_CHARS - usedChars;
      if (remaining > 100) {
        result.push({ ...msg, content: truncate(msg.content, remaining) });
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

  const messages = request.messages.map((m) => {
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
    if (m.role === "system") {
      const existingSystem = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return {
        role: "system" as const,
        content: systemPrompt ? `${systemPrompt}\n\n${existingSystem}` : existingSystem,
      };
    }
    return {
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    };
  });

  // Add system prompt if provided but no system message exists
  if (systemPrompt && !messages.some((m) => m.role === "system")) {
    messages.unshift({ role: "system", content: systemPrompt });
  }

  const body: Record<string, unknown> = {
    model,
    max_tokens: request.maxTokens ?? 8192,
    temperature: request.temperature ?? 1.0,
    messages,
  };

  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));
  }

  const url = `${config.ZAI_BASE_URL}/messages`;
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
          id: c.id ?? `tool-${Date.now()}`,
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

/** Call LLM with tool execution loop */
export async function callLLMWithTools(
  request: LLMRequest,
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<string>
): Promise<LLMResponse> {
  const config = loadConfig();
  const maxTools = config.MAX_TOOL_CALLS;

  let iteration = 0;
  let totalTools = 0;
  let messages = [...request.messages];

  while (iteration < 200) {
    iteration++;

    const response = await callZAI({ ...request, messages });

    if (!response.tool_calls || response.tool_calls.length === 0) {
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
      const result = await toolExecutor(tc.name, tc.input);
      toolResults.push(`[Tool: ${tc.name}]\n${truncate(result, MAX_TOOL_RESULT_BYTES)}`);
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
];

/** Pre-load agent prompts on module init */
loadAgentPrompts().catch(console.error);