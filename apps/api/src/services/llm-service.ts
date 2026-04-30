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
import { getAgentSystemPrompt, loadAgentPrompts } from "../prompts/agent-prompt-loader.js";
import { callLLMWithTools, GAME_STUDIO_TOOLS, type LLMMessage, type ProgressCallback, type FileOperationCallback } from "../llm/zai-client.js";
import { broadcast, broadcastSessionUpdate } from "./websocket.js";
import { getZaiModel } from "../config/model-mapping.js";
import type { WSEvent, AgentRole } from "@game-studio/types";
import {
  GodotMCPService,
  getGodotMCPService,
  getOrCreateGodotMCPService,
  removeGodotMCPService,
  isGodotMCPTool,
  getGodotMCPToolDefinitions,
  type GodotMCPServiceOptions,
} from "./godot-mcp-service.js";

export interface ProjectContext {
  name: string;
  description: string;
  engine: string | null;
  workspacePath: string | null;
  projectId?: string;
}

/** Detect engine from workspace files */
export async function detectEngineFromWorkspace(workspacePath: string): Promise<string | null> {
  const config = loadConfig();
  const fullPath = path.resolve(config.WORKSPACE_DIR, workspacePath);

  // Check for Godot (project.godot file)
  try {
    await fs.access(path.join(fullPath, "project.godot"));
    return "godot";
  } catch {
    // Not a Godot project
  }

  // Check for Unreal (*.uproject file)
  try {
    const entries = await fs.readdir(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".uproject")) {
        return "unreal";
      }
    }
  } catch {
    // Can't read directory
  }

  // Check for Unity (Assembly-CSharp.csproj or ProjectSettings/ProjectVersion.txt)
  try {
    await fs.access(path.join(fullPath, "ProjectSettings", "ProjectVersion.txt"));
    return "unity";
  } catch {
    // Not Unity
  }

  return null;
}

function appendProjectContext(systemPrompt: string, project: ProjectContext): string {
  const base = `${systemPrompt}

# Active Project Context
- Name: ${project.name}
- Description: ${project.description || "(no description)"}
- Engine: ${project.engine ?? "TBD"}
- Workspace: ${project.workspacePath ?? "default"}`;

  // Inject Godot MCP instructions for godot projects
  if (project.engine === "godot") {
    const godotInstructionsPath = path.join(
      process.cwd(),
      "godot-mcp-pro-v1.11.0",
      "instructions",
      "CLAUDE.md"
    );
    try {
      // Load synchronously since this is a hot path
      const godotInstructions = require("fs").readFileSync(godotInstructionsPath, "utf-8");
      return `${base}

# Godot MCP Pro — Use These Tools Instead of File I/O

For Godot projects, you have access to 169 MCP tools that control the Godot editor directly.
When interacting with a Godot project:

- **NEVER** use Read/Write/Edit on .gd, .tscn, .tres, or project.godot files directly
- **ALWAYS** use Godot MCP tools instead:
  - Scripts: use create_script, read_script, edit_script, attach_script
  - Scenes: use create_scene, open_scene, save_scene, get_scene_tree, add_node, batch_add_nodes
  - Properties: use update_property, get_node_properties (inspector-driven, not code)
  - Testing: use play_scene, simulate_key, capture_frames, assert_node_state, run_stress_test
  - Audio: use add_audio_player, set_audio_bus, add_audio_bus_effect
  - Animation: use create_animation, add_animation_track, set_animation_keyframe
  - Tilemap: use tilemap_set_cell, tilemap_fill_rect, tilemap_get_info
  - Physics: use setup_physics_body, setup_collision, set_physics_layers
  - Navigation: use setup_navigation_region, setup_navigation_agent, bake_navigation_mesh
  - Shaders: use create_shader, edit_shader, assign_shader_material, set_shader_param

**Important**: Godot MCP Pro connects to the Godot editor via WebSocket. The editor must be running with the Godot MCP Pro plugin enabled for runtime tools (play_scene, simulate_key, capture_frames, etc.) to work.

${godotInstructions}`;
    } catch {
      // Godot MCP instructions not found — skip injection
    }
  }

  return base;
}
import { getWorkflow, createQuestTicket, moveQuestTicket } from "./quest-bridge.js";

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

/** Validate that a resolved path stays within the workspace boundary (S1) */
function safePath(inputPath: string, baseDir: string): string {
  const workspaceDir = loadConfig().WORKSPACE_DIR;
  const resolvedWorkspaceDir = path.resolve(workspaceDir);

  // If the input path is already inside the resolved workspace directory, use it as-is
  // This handles paths like /Users/.../workspace/godot-test-1/... that are already correct
  if (inputPath.startsWith(resolvedWorkspaceDir + "/")) {
    // Verify no path traversal
    const resolved = path.resolve(inputPath);
    if (resolved.startsWith(resolvedWorkspaceDir)) {
      return resolved;
    }
    throw new Error(`Path outside workspace is not allowed: ${inputPath}`);
  }

  // For paths outside workspace, apply normalization

  // Strip leading "./workspace/" or "/workspace/" prefix if present
  let workingPath = inputPath;
  const workspacePattern = /^\.?\/?workspace\//;
  if (workspacePattern.test(inputPath)) {
    const pathAfterWorkspace = inputPath.replace(workspacePattern, "");
    workingPath = path.join(workspaceDir, pathAfterWorkspace);
  }

  // Handle absolute paths to Godot projects that are mirrored in the workspace
  // Godot returns paths like /Users/choguun/godot-test-1/project.godot
  const homeDir = process.env.HOME || "";
  const godotPathMatch = inputPath.match(new RegExp(`^${homeDir.replace("/", "\\/")}\/([^\/]+)(\/.*)?$`));
  if (godotPathMatch && godotPathMatch[2]) {
    const projectName = godotPathMatch[1];
    const relativePath = godotPathMatch[2].substring(1);
    workingPath = path.join(workspaceDir, projectName, relativePath);
  }

  // Handle project-relative paths like "godot-test-1/gdd/..."
  // Resolve relative to WORKSPACE_DIR
  const normalizedResolved = path.resolve(workingPath);
  const base = path.resolve(baseDir);

  // Allow paths that resolve to either:
  // 1. Within the base directory (project workspace)
  // 2. Within the global workspace directory (for shared files like design docs)
  if (normalizedResolved.startsWith(base + path.sep) || normalizedResolved === base) {
    return normalizedResolved;
  }
  if (normalizedResolved.startsWith(resolvedWorkspaceDir + path.sep) || normalizedResolved === resolvedWorkspaceDir) {
    return normalizedResolved;
  }

  throw new Error(`Path outside workspace is not allowed: ${inputPath}`);
}

export interface InvokeResult {
  content: string;
  toolCalls?: { name: string; input: Record<string, unknown> }[];
  usage?: { input_tokens: number; output_tokens: number };
}

/** Create a progress callback that broadcasts chat:progress events with thinking content */
export function makeProgressCallback(sessionId: string, progressMsgId: string): ProgressCallback {
  let lastBroadcastProgress = 0;
  return (info) => {
    if (info.phase === "executing" && info.currentTool) {
      logEntry(sessionId, "info", `[TOOL] ${info.currentTool} (iteration ${info.iteration})`);
    }
    // Broadcast thinking content updates with special progress value -1
    if (info.thinking) {
      broadcast({
        type: "chat:progress",
        sessionId,
        progressMsgId,
        progress: -1, // Special value to indicate thinking update
        content: info.thinking.slice(0, 100),
        thinking: info.thinking.slice(0, 2000),
      } as WSEvent);
    }
    // Broadcast progress updates (every ~20 iterations = 20% progress)
    if (info.iteration > 0 && info.iteration % 20 === 0 && info.iteration !== lastBroadcastProgress) {
      lastBroadcastProgress = info.iteration;
      const progressPct = Math.min(90, Math.round((info.iteration / 100) * 100));
      broadcastSessionUpdate(sessionId, { progress: progressPct });
    }
  };
}

/**
 * Execute game studio tools on behalf of an LLM agent.
 */
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  sessionId: string,
  agentRole: AgentRole,
  projectContext?: ProjectContext,
  _depth = 0,
  onFileOperation?: FileOperationCallback,
): Promise<string> {
  // Use project's workspacePath if available, otherwise fall back to global config
  const workspaceDir = projectContext?.workspacePath
    ? path.resolve(loadConfig().WORKSPACE_DIR, projectContext.workspacePath)
    : loadConfig().WORKSPACE_DIR;

  try {
    switch (name) {
      case "Read": {
        const rawPath = input.file_path as string;
        if (!rawPath) return "Error: file_path is required";
        const filePath = safePath(rawPath, workspaceDir);
        // Q5: Reject files larger than 1MB
        const stat = await fs.stat(filePath);
        if (stat.size > 1_048_576) return `Error: File too large (${Math.round(stat.size / 1024)}KB). Maximum is 1MB.`;
        const content = await fs.readFile(filePath, "utf-8");
        logEntry(sessionId, "info", `[${agentRole}] Read: ${filePath}`, agentRole);
        onFileOperation?.({ tool: "Read", path: filePath, result: "success" });
        return content;
      }

      case "Write": {
        const rawPath = input.file_path as string;
        const content = input.content as string;
        if (!rawPath || content === undefined) return "Error: file_path and content are required";
        const filePath = safePath(rawPath, workspaceDir);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        logEntry(sessionId, "info", `[${agentRole}] Wrote: ${filePath}`, agentRole);
        onFileOperation?.({ tool: "Write", path: filePath, result: "success" });
        return `Successfully wrote ${content.length} characters to ${filePath}`;
      }

      case "Edit": {
        const rawPath = input.file_path as string;
        const oldString = input.old_string as string;
        const newString = input.new_string as string;
        if (!rawPath || !oldString || newString === undefined) {
          return "Error: file_path, old_string, and new_string are required";
        }
        const filePath = safePath(rawPath, workspaceDir);
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
        // Q6: Cap results at 200
        const capped = results.slice(0, 200);
        return capped.length > 0
          ? `Found ${results.length > 200 ? `${results.length} (showing first 200)` : results.length} files:\n${capped.join("\n")}`
          : "No files found";
      }

      case "Grep": {
        const pattern = input.pattern as string;
        const searchPath = (input.path as string) ?? workspaceDir;
        const globFilter = input.glob as string | undefined;
        const context = (input.context as number) ?? 0;
        if (!pattern) return "Error: pattern is required";

        // S3: ReDoS prevention — cap pattern length, reject nested quantifiers
        if (pattern.length > 200) return "Error: Pattern too long (max 200 characters)";
        if (/\([^)]*[*+][^)]*\)[*+]/.test(pattern)) {
          return "Error: Pattern contains nested quantifiers which may cause performance issues";
        }

        const results = await grepFiles(searchPath, pattern, globFilter, context);
        // Q6: Cap results at 100 matches
        const capped = results.slice(0, 100);
        return capped.length > 0
          ? (results.length > 100 ? `[Showing first 100 of ${results.length} matches]\n\n` : "") + capped.join("\n\n")
          : "No matches found";
      }

      case "Bash": {
        const command = input.command as string;
        if (!command) return "Error: command is required";

        // S2: Sandbox — reject command chaining/pipe patterns to prevent injection
        if (/[|`]|&&|;|\$\(|\$\{|\n/.test(command)) {
          return `Error: Command chaining/pipe not allowed (|, &&, ;, $(), backticks). Run commands individually.`;
        }

        // Cap timeout at server-side maximum (120s)
        const timeout = Math.min((input.timeout as number) ?? 60000, 120_000);

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

        // R4: Limit subagent recursion depth
        if (_depth >= 3) return "Error: Maximum subagent recursion depth (3) exceeded. Simplify the task hierarchy.";

        logEntry(sessionId, "info", `[${agentRole}] Spawning subagent: ${agent}`, agentRole);

        // Quest Bridge: always create a ticket for subagent tasks
        const ticket = await createQuestTicket(
          sessionId,
          task.slice(0, 80),
          agent,
          task,
          "WORKFLOW",
          agentRole,
        );
        const ticketId = ticket.id;
        await moveQuestTicket(ticketId, "in_progress", agent);

        // Recursively invoke subagent (don't broadcast events — subagent runs inline within parent session)
        const subResult = await invokeAgent(agent, task, sessionId, context, undefined, undefined, false, _depth + 1, undefined, onFileOperation);

        // Quest Bridge: move ticket to QA
        await moveQuestTicket(ticketId, "qa", agent);

        return `Subagent ${agent} output:\n${subResult.content}`;
      }

      case "AskUserQuestion": {
        const questionId = input.questionId as string;
        const question = input.question as string;
        const options = input.options as Array<{ id: string; label: string; description?: string }>;
        const allowMultiple = input.allowMultiple as boolean | undefined;
        const allowCustomInput = input.allowCustomInput as boolean | undefined;

        if (!questionId || !question || !options) {
          return "Error: questionId, question, and options are required";
        }

        logEntry(sessionId, "info", `[${agentRole}] Asking question: ${questionId}`, agentRole);

        // Return special marker that tells callLLMWithTools to STOP and return the question
        // This prevents the LLM from seeing the question data and responding with "Waiting..."
        return "__ASK_USER_QUESTION__" + JSON.stringify({
          __QUESTION__: true,
          questionId,
          question,
          options,
          allowMultiple: allowMultiple ?? false,
          allowCustomInput: allowCustomInput ?? false,
        });
      }

      case "ProposePlan": {
        const planId = input.planId as string;
        const title = input.title as string;
        const phases = input.phases as Array<{
          id: string;
          label: string;
          description?: string;
          estimatedEffort?: string;
        }>;

        if (!planId || !title || !phases) {
          return "Error: planId, title, and phases are required";
        }

        logEntry(sessionId, "info", `[${agentRole}] Proposing plan: ${title}`, agentRole);

        // Return special marker that tells callLLMWithTools to STOP and return the plan
        return "__PROPOSE_PLAN__" + JSON.stringify({
          __PLAN__: true,
          planId,
          title,
          phases,
        });
      }

      default:
        // Check if this is a Godot MCP tool and route to the MCP service
        if (isGodotMCPTool(name)) {
          // Use projectId from ProjectContext to lookup the service (shared across sessions)
          const projectId = projectContext?.projectId;
          logEntry(sessionId, "info", `[${agentRole}] Godot MCP lookup: projectId=${projectId}`, agentRole);
          const godotService = projectId ? getGodotMCPService(projectId) : null;
          if (godotService?.running()) {
            logEntry(sessionId, "info", `[${agentRole}] Godot MCP: ${name}`, agentRole);
            const result = await godotService.executeTool(name, input);
            return result;
          } else {
            logEntry(sessionId, "info", `[${agentRole}] Godot MCP service not running for projectId=${projectId}`, agentRole);
            return `Error: Godot MCP tool '${name}' called but Godot MCP service is not running for this project. ` +
              `Ensure project engine is "godot" and the Godot editor is running with the MCP plugin enabled.`;
          }
        }
        return `Unknown tool: ${name}`;
    }
  } catch (err: unknown) {
    const error = err as Error;
    logEntry(sessionId, "error", `[TOOL ERROR: ${name}] ${error.message}`, agentRole);
    return `[TOOL ERROR: ${name}] ${error.message}`;
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
  conversationHistory?: LLMMessage[],
  onProgress?: ProgressCallback,
  broadcastEvents = true,
  _depth = 0,
  projectContext?: ProjectContext,
  onFileOperation?: FileOperationCallback,
): Promise<InvokeResult> {
  const invocationId = `invoke-${crypto.randomUUID().slice(0, 8)}`;

  if (broadcastEvents) {
    broadcast({
      type: "agent:spawned",
      agentId: invocationId,
      agent: agentRole,
      sessionId,
    } as WSEvent);
  }

  try {
    // Load agent's system prompt and model tier from MD file
    const [rawSystemPrompt, prompts] = await Promise.all([
      getAgentSystemPrompt(agentRole),
      loadAgentPrompts(),
    ]);

    const systemPrompt = projectContext
      ? appendProjectContext(rawSystemPrompt, projectContext)
      : rawSystemPrompt;

    // Get model tier and map to Z.ai model
    const agentPrompt = prompts.get(agentRole);
    const modelTier = agentPrompt?.model ?? "sonnet";
    const model = getZaiModel(modelTier);

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

    // Build tool list — inject Godot MCP tools for godot projects
    const godotTools = projectContext?.engine === "godot"
      ? getGodotMCPToolDefinitions()
      : [];
    const allTools = [...GAME_STUDIO_TOOLS, ...godotTools];

    const toolExecutor = async (name: string, input: Record<string, unknown>): Promise<string> => {
      return executeTool(name, input, sessionId, agentRole, projectContext, _depth, onFileOperation);
    };

    // Call ZAI API with tools
    const response = await callLLMWithTools(
      {
        agentRole,
        messages,
        tools: allTools,
        systemPrompt,
        model,
      },
      toolExecutor,
      onProgress,
      sessionId,
      onFileOperation
    );

    if (broadcastEvents) {
      broadcast({
        type: "agent:completed",
        agentId: invocationId,
        output: response.content,
        sessionId,
      } as WSEvent);
    }

    return {
      content: response.content,
      toolCalls: response.tool_calls?.map((tc) => ({ name: tc.name, input: tc.input })),
      usage: response.usage,
    };
  } catch (err: unknown) {
    const error = err as Error;
    if (broadcastEvents) {
      broadcast({
        type: "agent:failed",
        agentId: invocationId,
        error: error.message,
        sessionId,
      } as WSEvent);
    }
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
  sessionId: string,
  onProgress?: ProgressCallback,
  _depth = 0,
  projectContext?: ProjectContext,
  onFileOperation?: FileOperationCallback,
  continuationContext?: string,
): Promise<InvokeResult> {
  try {
    // Inject continuation context temporarily (not persisted to session)
    const effectiveMessages = continuationContext
      ? [...messages, { role: "user" as const, content: continuationContext }]
      : messages;

    // Load agent's system prompt and model tier from MD file
    const [rawSystemPrompt, prompts] = await Promise.all([
      getAgentSystemPrompt(agentRole),
      loadAgentPrompts(),
    ]);

    const systemPrompt = projectContext
      ? appendProjectContext(rawSystemPrompt, projectContext)
      : rawSystemPrompt;

    // Get model tier and map to Z.ai model
    const agentPrompt = prompts.get(agentRole);
    const modelTier = agentPrompt?.model ?? "sonnet";
    const model = getZaiModel(modelTier);

    // Build tool list — inject Godot MCP tools for godot projects
    const godotTools = projectContext?.engine === "godot"
      ? getGodotMCPToolDefinitions()
      : [];
    const allTools = [...GAME_STUDIO_TOOLS, ...godotTools];

    const toolExecutor = async (name: string, input: Record<string, unknown>): Promise<string> => {
      return executeTool(name, input, sessionId, agentRole, projectContext, _depth, onFileOperation);
    };

    const response = await callLLMWithTools(
      {
        agentRole,
        messages: effectiveMessages,
        tools: allTools,
        systemPrompt,
        model,
      },
      toolExecutor,
      onProgress,
      sessionId,
      onFileOperation
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
