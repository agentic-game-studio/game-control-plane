/**
 * LLM Service — orchestrates ZAI API calls with game studio tools.
 * Wires together:
 * - ZAI client (zai-client.ts)
 * - Agent prompts from workspace/.claude/agents/*.md
 * - Tool executor with game studio capabilities
 * - WebSocket broadcasting for real-time updates
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { getAgentSystemPrompt } from "../prompts/agent-prompt-loader.js";
import { callLLMWithTools, GAME_STUDIO_TOOLS, type LLMMessage } from "../llm/zai-client.js";
import { broadcast } from "./websocket.js";
import type { WSEvent, AgentRole } from "@game-studio/types";

/** Helper to broadcast log entries with timestamp */
function logEntry(sessionId: string, level: string, message: string, agent?: AgentRole) {
  broadcast({
    type: "log:entry",
    sessionId,
    level,
    message,
    agent,
    timestamp: new Date().toISOString(),
  } as WSEvent);
}

export interface InvokeResult {
  content: string;
  toolCalls?: { name: string; input: Record<string, unknown> }[];
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Execute game studio tools on behalf of an LLM agent.
 */
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
  agentRole: AgentRole
): Promise<string> {
  const workspaceDir = loadConfig().WORKSPACE_DIR;

  try {
    switch (name) {
      case "Read": {
        const filePath = input.file_path as string;
        if (!filePath) return "Error: file_path is required";
        const content = await fs.readFile(filePath, "utf-8");
        logEntry(sessionId, "info", `[${agentRole}] Read: ${filePath}`, agentRole);
        return content;
      }

      case "Write": {
        const filePath = input.file_path as string;
        const content = input.content as string;
        if (!filePath || content === undefined) return "Error: file_path and content are required";
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        logEntry(sessionId, "info", `[${agentRole}] Wrote: ${filePath}`, agentRole);
        return `Successfully wrote ${content.length} characters to ${filePath}`;
      }

      case "Edit": {
        const filePath = input.file_path as string;
        const oldString = input.old_string as string;
        const newString = input.new_string as string;
        if (!filePath || !oldString || newString === undefined) {
          return "Error: file_path, old_string, and new_string are required";
        }
        const fileContent = await fs.readFile(filePath, "utf-8");
        if (!fileContent.includes(oldString)) {
          return `Error: old_string not found in file. File content preview:\n${fileContent.slice(0, 500)}`;
        }
        const newContent = fileContent.replace(oldString, newString);
        await fs.writeFile(filePath, newContent, "utf-8");
        logEntry(sessionId, "info", `[${agentRole}] Edit: ${filePath}`, agentRole);
        return `Successfully edited ${filePath}`;
      }

      case "Glob": {
        const pattern = input.pattern as string;
        const searchPath = (input.path as string) ?? workspaceDir;
        if (!pattern) return "Error: pattern is required";

        // Simple glob implementation
        const results = await globFiles(searchPath, pattern);
        return results.length > 0
          ? `Found ${results.length} files:\n${results.join("\n")}`
          : "No files found";
      }

      case "Grep": {
        const pattern = input.pattern as string;
        const searchPath = (input.path as string) ?? workspaceDir;
        const globFilter = input.glob as string | undefined;
        const context = (input.context as number) ?? 0;
        if (!pattern) return "Error: pattern is required";

        const results = await grepFiles(searchPath, pattern, globFilter, context);
        return results.length > 0 ? results.join("\n\n") : "No matches found";
      }

      case "Bash": {
        const command = input.command as string;
        const timeout = (input.timeout as number) ?? 60000;
        if (!command) return "Error: command is required";

        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execAsync = promisify(exec);

        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: workspaceDir,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
          });
          logEntry(sessionId, "info", `[${agentRole}] Bash: ${command}`, agentRole);
          return stderr ? `STDOUT:\n${stdout}\nSTDERR:\n${stderr}` : stdout || "Command completed (no output)";
        } catch (err: unknown) {
          const error = err as { stdout?: string; stderr?: string; message?: string };
          return `Error: ${error.message}\nSTDOUT: ${error.stdout ?? ""}\nSTDERR: ${error.stderr ?? ""}`;
        }
      }

      case "Task": {
        const agent = input.agent as AgentRole;
        const task = input.task as string;
        const context = input.context as string | undefined;
        if (!agent || !task) return "Error: agent and task are required";

        logEntry(sessionId, "info", `[${agentRole}] Spawning subagent: ${agent}`, agentRole);

        // Recursively invoke subagent
        const subResult = await invokeAgent(agent, task, sessionId, context);
        return `Subagent ${agent} output:\n${subResult.content}`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    const error = err as Error;
    return `Tool execution error: ${error.message}`;
  }
}

/**
 * Simple glob pattern matching (supports **, *, ?)
 */
async function globFiles(rootPath: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const normalizedPattern = pattern.replace(/^\/+/, "");

  // Handle **/** specially - search recursively
  if (normalizedPattern.includes("**")) {
    const prefix = normalizedPattern.split("**")[0].replace(/\/$/, "");
    const suffix = normalizedPattern.split("**/").slice(1).join("/");
    const searchDir = prefix ? path.join(rootPath, prefix) : rootPath;

    try {
      await walkDir(searchDir, suffix, results);
    } catch {
      // Directory doesn't exist
    }
    return results;
  }

  // Simple pattern matching
  const parts = normalizedPattern.split("/");
  await walkDirSimple(rootPath, parts, 0, results);
  return results;
}

async function walkDir(dir: string, remainingPattern: string, results: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, remainingPattern, results);
      } else if (matchPattern(entry.name, remainingPattern)) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

async function walkDirSimple(dir: string, parts: string[], idx: number, results: string[]): Promise<void> {
  if (idx >= parts.length) {
    results.push(dir);
    return;
  }

  const part = parts[idx];
  const isLast = idx === parts.length - 1;

  if (part === "*") {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !isLast) {
          const fullPath = path.join(dir, entry.name);
          if (isLast) results.push(fullPath);
          else await walkDirSimple(fullPath, parts, idx + 1, results);
        }
      }
    } catch {
      // Skip
    }
  } else {
    const fullPath = path.join(dir, part);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await walkDirSimple(fullPath, parts, idx + 1, results);
      } else if (isLast) {
        results.push(fullPath);
      }
    } catch {
      // Path doesn't exist
    }
  }
}

function matchPattern(filename: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"
  );
  return regex.test(filename);
}

/**
 * Search files for a pattern
 */
async function grepFiles(
  searchPath: string,
  pattern: string,
  globFilter?: string,
  context = 0
): Promise<string[]> {
  const results: string[] = [];
  const regex = new RegExp(pattern, "gi");

  async function searchDir(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.name === "node_modules" || entry.name === ".git") continue;

        if (entry.isDirectory()) {
          await searchDir(fullPath);
        } else if (entry.isFile()) {
          if (globFilter && !matchPattern(entry.name, globFilter.replace(/^\*\./, ""))) {
            continue;
          }

          try {
            const content = await fs.readFile(fullPath, "utf-8");
            const lines = content.split("\n");
            const matches: string[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                regex.lastIndex = 0;
                if (context > 0) {
                  const start = Math.max(0, i - context);
                  const end = Math.min(lines.length - 1, i + context);
                  matches.push(
                    `${fullPath}:${i + 1}:${lines.slice(start, end + 1).join("\n")}`
                  );
                } else {
                  matches.push(`${fullPath}:${i + 1}: ${lines[i].trim()}`);
                }
              }
            }

            if (matches.length > 0) {
              results.push(matches.join("\n"));
            }
          } catch {
            // Skip binary/unreadable files
          }
        }
      }
    } catch {
      // Skip inaccessible directories
    }
  }

  await searchDir(searchPath);
  return results;
}

/**
 * Invoke an agent with a task using the ZAI API.
 */
export async function invokeAgent(
  agentRole: AgentRole,
  task: string,
  sessionId: string,
  context?: string,
  conversationHistory?: LLMMessage[]
): Promise<InvokeResult> {
  const invocationId = `invoke-${Date.now()}`;

  broadcast({
    type: "agent:spawned",
    agentId: invocationId,
    agent: agentRole,
    sessionId,
  } as WSEvent);

  try {
    // Load agent's system prompt from MD file
    const systemPrompt = await getAgentSystemPrompt(agentRole);

    // Build initial messages
    const messages: LLMMessage[] = [];

    // Add conversation history if provided
    if (conversationHistory && conversationHistory.length > 0) {
      messages.push(...conversationHistory);
    }

    // Add context if provided
    let userMessage = task;
    if (context) {
      userMessage = `CONTEXT:\n${context}\n\nTASK:\n${task}`;
    }

    messages.push({ role: "user", content: userMessage });

    // Call ZAI API with tools
    const response = await callLLMWithTools(
      {
        agentRole,
        messages,
        tools: GAME_STUDIO_TOOLS,
        systemPrompt,
      },
      (name, input) => executeTool(name, input, sessionId, agentRole)
    );

    broadcast({
      type: "agent:completed",
      agentId: invocationId,
      output: response.content,
      sessionId,
    } as WSEvent);

    return {
      content: response.content,
      toolCalls: response.tool_calls?.map((tc) => ({ name: tc.name, input: tc.input })),
      usage: response.usage,
    };
  } catch (err: unknown) {
    const error = err as Error;
    broadcast({
      type: "agent:failed",
      agentId: invocationId,
      error: error.message,
      sessionId,
    } as WSEvent);
    return {
      content: `Error invoking agent: ${error.message}`,
    };
  }
}

/**
 * Continue a conversation with an agent.
 */
export async function continueConversation(
  agentRole: AgentRole,
  messages: LLMMessage[],
  sessionId: string
): Promise<InvokeResult> {
  const invocationId = `invoke-${Date.now()}`;

  try {
    const systemPrompt = await getAgentSystemPrompt(agentRole);

    const response = await callLLMWithTools(
      {
        agentRole,
        messages,
        tools: GAME_STUDIO_TOOLS,
        systemPrompt,
      },
      (name, input) => executeTool(name, input, sessionId, agentRole)
    );

    return {
      content: response.content,
      toolCalls: response.tool_calls?.map((tc) => ({ name: tc.name, input: tc.input })),
      usage: response.usage,
    };
  } catch (err: unknown) {
    const error = err as Error;
    return {
      content: `Error: ${error.message}`,
    };
  }
}
