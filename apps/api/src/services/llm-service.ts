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
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { getAgentSystemPrompt, loadAgentPrompts } from "../prompts/agent-prompt-loader.js";
import { callLLMWithTools, GAME_STUDIO_TOOLS, type LLMMessage, type ProgressCallback, type FileOperationCallback } from "../llm/zai-client.js";
import { broadcast, broadcastSessionUpdate } from "./websocket.js";
import { readData, writeData, broadcastEvent } from "./data-store.js";
import { getModelForTier } from "../config/model-mapping.js";
import type { WSEvent, AgentRole, GameAsset, AssetsData, AssetGenerationMeta } from "@game-studio/types";
import {
  GodotMCPService,
  getGodotMCPService,
  getOrCreateGodotMCPService,
  removeGodotMCPService,
  isGodotMCPTool,
  getGodotMCPToolDefinitions,
  type GodotMCPServiceOptions,
} from "./godot-mcp-service.js";
import { triggerVerification } from "./verification-service.js";

export interface ProjectContext {
  name: string;
  description: string;
  engine: string | null;
  workspacePath: string | null;
  projectId?: string;
}

/** Detect engine from workspace files */
export async function detectEngineFromWorkspace(workspacePath: string): Promise<string | null> {
  const { resolveProjectWorkspace } = await import("../utils/workspace.js");
  const fullPath = resolveProjectWorkspace(workspacePath);

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
import { ingestProducerSummaryFromSession } from "./producer-summary.js";

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

/** Validate that a resolved path stays within the workspace boundary */
function safePath(inputPath: string, baseDir: string): string {
  const workspaceDir = loadConfig().WORKSPACE_DIR;
  const resolvedWorkspaceDir = path.resolve(workspaceDir);
  const base = path.resolve(baseDir);

  // If the input path is already absolute and inside the base directory, allow it
  if (path.isAbsolute(inputPath)) {
    const resolved = path.resolve(inputPath);
    if (resolved.startsWith(base + path.sep) || resolved === base) {
      return resolved;
    }
    if (resolved.startsWith(resolvedWorkspaceDir + path.sep) || resolved === resolvedWorkspaceDir) {
      return resolved;
    }
  }

  // For relative paths or paths outside the base, apply normalization
  let workingPath = inputPath;

  // Strip leading "./workspace/" or "/workspace/" prefix if present
  const workspacePattern = /^\.?\/?workspace\//;
  if (workspacePattern.test(inputPath)) {
    const pathAfterWorkspace = inputPath.replace(workspacePattern, "");
    workingPath = path.join(workspaceDir, pathAfterWorkspace);
  }

  // Handle absolute paths to projects that are mirrored in the workspace
  const homeDir = process.env.HOME || "";
  const godotPathMatch = inputPath.match(new RegExp(`^${homeDir.replace("/", "\\/")}\/([^\/]+)(\/.*)?$`));
  if (godotPathMatch && godotPathMatch[2]) {
    const projectName = godotPathMatch[1];
    const relativePath = godotPathMatch[2].substring(1);
    workingPath = path.join(workspaceDir, projectName, relativePath);
  }

  const normalizedResolved = path.resolve(workingPath);

  // Allow paths within the base directory or the global workspace directory
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
      // Broadcast tool execution progress so frontend shows activity
      broadcast({
        type: "chat:progress",
        sessionId,
        progressMsgId,
        progress: Math.min(85, 10 + info.iteration * 2),
        content: `${info.currentTool} (iteration ${info.iteration})`,
      } as WSEvent);
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
    ? resolveProjectWorkspace(projectContext.workspacePath)
    : loadConfig().WORKSPACE_DIR;

  // Shared subprocess utility for all tool cases
  const { execFile: execFileTool } = await import("node:child_process");
  const { promisify: promisifyTool } = await import("node:util");
  const execFileAsyncTool = promisifyTool(execFileTool);

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

        // Broadcast subagent spawn so frontend sidebar can show it
        broadcast({
          type: "subagent:spawned",
          agentRole: agent,
          parentSessionId: sessionId,
          ticketId,
          task: task.slice(0, 80),
        } as WSEvent);

        void ingestProducerSummaryFromSession(sessionId, {
          kind: "subagent_spawned",
          at: new Date().toISOString(),
          agentRole: agent,
          title: task.slice(0, 80),
          ticketId,
        });

        // Recursively invoke subagent (don't broadcast events — subagent runs inline within parent session)
        let subResult: InvokeResult;
        try {
          subResult = await invokeAgent(agent, task, sessionId, context, undefined, undefined, false, _depth + 1, undefined, onFileOperation);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          broadcast({
            type: "subagent:failed",
            agentRole: agent,
            parentSessionId: sessionId,
            ticketId,
            error: errorMsg,
          } as WSEvent);

          void ingestProducerSummaryFromSession(sessionId, {
            kind: "subagent_failed",
            at: new Date().toISOString(),
            agentRole: agent,
            ticketId,
            detail: errorMsg,
          });

          throw err;
        }

        // Broadcast subagent completion
        broadcast({
          type: "subagent:completed",
          agentRole: agent,
          parentSessionId: sessionId,
          ticketId,
          output: subResult.content.slice(0, 200),
        } as WSEvent);

        void ingestProducerSummaryFromSession(sessionId, {
          kind: "subagent_completed",
          at: new Date().toISOString(),
          agentRole: agent,
          ticketId,
        });

        // Quest Bridge: move ticket to QA and trigger auto-verification
        await moveQuestTicket(ticketId, "qa", agent);
        triggerVerification(ticket, subResult.content);

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

      case "GenerateAsset": {
        const assetPrompt = input.prompt as string;
        const assetName = input.name as string;
        if (!assetPrompt || !assetName) return "Error: prompt and name are required";

        logEntry(sessionId, "info", `[${agentRole}] Generating asset: ${assetName}`, agentRole);

        const { execFile: execFileTool } = await import("node:child_process");
        const { promisify: promisifyTool } = await import("node:util");
        const execFileAsyncTool = promisifyTool(execFileTool);

        // Resolve Python binary with pipeline dependencies (Pillow, rembg, etc.)
        const PYTHON_BIN = process.env.PIPELINE_PYTHON ?? "/usr/local/bin/python3";

        const scriptDir = path.resolve(process.cwd(), "..", "..", "scripts", "asset-pipeline");
        const outputDir = projectContext?.workspacePath
          ? path.join(resolveProjectWorkspace(projectContext.workspacePath), "assets")
          : path.join(loadConfig().WORKSPACE_DIR, "assets");

        const genArgs = [
          path.join(scriptDir, "asset-pipeline.py"),
          "--prompt", assetPrompt,
          "--name", assetName,
          "--type", (input.type as string) ?? "2d",
          "--category", (input.category as string) ?? "prop",
          "--width", String(input.width ?? 512),
          "--height", String(input.height ?? 512),
          "--steps", String(input.steps ?? 4),
          "--output-dir", outputDir,
          "--workspace-dir", workspaceDir,
        ];

        if (input.seed) genArgs.push("--seed", String(input.seed));
        if (input.removeBg === false) genArgs.push("--no-remove-bg");
        if (input.negativePrompt) genArgs.push("--negative-prompt", input.negativePrompt as string);
        if (input.gridSize) genArgs.push("--grid-size", String(input.gridSize));
        if (input.spriteSheet) genArgs.push("--sprite-sheet");
        if (input.spriteCols) genArgs.push("--sprite-cols", String(input.spriteCols));
        if (input.spriteRows) genArgs.push("--sprite-rows", String(input.spriteRows));
        const tags = input.tags as string[] | undefined;
        if (tags?.length) genArgs.push("--tags", ...tags);

        // Also handle batch mode via presets
        if (input.presetsFile) {
          genArgs.length = 0; // reset
          genArgs.push(
            path.join(scriptDir, "asset-pipeline.py"),
            "--presets", input.presetsFile as string,
            "--output-dir", outputDir,
            "--workspace-dir", workspaceDir,
          );
        }

        try {
          const { stdout, stderr } = await execFileAsyncTool(PYTHON_BIN, genArgs, {
            cwd: scriptDir,
            timeout: 600_000,
            maxBuffer: 10 * 1024 * 1024,
          });

          // Parse the manifest to get result details
          const manifestPath = path.join(outputDir, "asset-manifest.json");
          let manifestInfo = "";
          const isBatch = !!input.presetsFile;
          try {
            const raw = await fs.readFile(manifestPath, "utf-8");
            const manifest: Record<string, unknown>[] = JSON.parse(raw);
            const entries = isBatch ? manifest : manifest.length > 0 ? [manifest[manifest.length - 1]] : [];

            if (entries.length > 0) {
              const data = await readData<AssetsData>("assets.json");
              const existingIds = new Set(data.assets.map((a: GameAsset) => a.id));
              const registered: string[] = [];

              for (const entry of entries) {
                if (existingIds.has(entry.id as string)) continue;
                const newAsset: GameAsset = {
                  id: entry.id as string,
                  filename: entry.filename as string,
                  type: entry.type as GameAsset["type"],
                  category: entry.category as GameAsset["category"],
                  sizeBytes: (entry.sizeBytes as number) ?? 0,
                  tags: (entry.tags as string[]) ?? [],
                  path: entry.path as string | undefined,
                  rawPath: entry.rawPath as string | undefined,
                  thumbnailPath: entry.thumbnailPath as string | undefined,
                  generatedWith: entry.generatedWith as AssetGenerationMeta | undefined,
                  createdAt: entry.createdAt as string,
                  updatedAt: entry.updatedAt as string,
                };
                data.assets.push(newAsset);
                existingIds.add(newAsset.id);
                registered.push(newAsset.filename);
                broadcastEvent({ type: "asset:created", asset: newAsset } as WSEvent);
              }

              if (registered.length > 0) {
                await writeData("assets.json", data);
                manifestInfo = isBatch
                  ? `\nBatch generated ${registered.length} assets: ${registered.join(", ")}`
                  : `\nGenerated: ${registered[0]} (${entries[0].type}/${entries[0].category})\nPath: ${entries[0].path}`;
                manifestInfo += "\nRegistered in asset inventory with full generation metadata.";
              }
            }
          } catch {
            // manifest may not exist
          }

          logEntry(sessionId, "info", `[${agentRole}] Asset generated: ${assetName}`, agentRole);
          return `Asset generation complete.${manifestInfo}\n\nLog:\n${stdout.slice(-500)}${stderr ? `\nStderr: ${stderr.slice(-200)}` : ""}`;
        } catch (genError: unknown) {
          const err = genError as { message?: string; stderr?: string };
          return `Error: Asset generation failed: ${err.stderr || err.message}`;
        }
      }

      case "TilemapSplit": {
        const _input = input.input as string;
        const _outputDir = input.outputDir as string;
        const _tileWidth = input.tileWidth as number;
        const _tileHeight = input.tileHeight as number;
        const _margin = (input.margin as number | undefined) ?? 0;
        const _spacing = (input.spacing as number | undefined) ?? 0;
        const _pad = (input.pad as number | undefined) ?? 0;
        const _namePrefix = (input.namePrefix as string | undefined) ?? "tile";

        if (!_input || !_outputDir || !_tileWidth || !_tileHeight) {
          return "Error: input, outputDir, tileWidth, and tileHeight are required";
        }

        const config = loadConfig();
        const scriptDir = path.join(config.WORKSPACE_DIR, "scripts", "asset-pipeline");
        const pythonBin = process.env.PIPELINE_PYTHON ?? "python3";

        const args = [
          pythonBin,
          path.join(scriptDir, "tilemap_split.py"),
          "--input", _input,
          "--output-dir", _outputDir,
          "--tile-width", String(_tileWidth),
          "--tile-height", String(_tileHeight),
        ];
        if (_margin) args.push("--margin", String(_margin));
        if (_spacing) args.push("--spacing", String(_spacing));
        if (_pad) args.push("--pad", String(_pad));
        if (_namePrefix !== "tile") args.push("--name-prefix", _namePrefix);

        try {
          const { stdout, stderr } = await execFileAsyncTool(pythonBin, args, {
            cwd: scriptDir,
            timeout: 120_000,
          });
          const summary = stdout.slice(-300);
          logEntry(sessionId, "info", `[${agentRole}] TilemapSplit: ${_input} -> ${_outputDir}`, agentRole);
          return `Tilemap split complete.\n${summary}${stderr ? `\nStderr: ${stderr.slice(-200)}` : ""}`;
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return `Error: TilemapSplit failed: ${error.stderr || error.message}`;
        }
      }

      case "SpritePack": {
        const _inputDir = input.inputDir as string;
        const _output = input.output as string;
        const _columns = (input.columns as number | undefined) ?? 4;
        const _padding = (input.padding as number | undefined) ?? 0;
        const _pad = (input.pad as number | undefined) ?? 0;

        if (!_inputDir || !_output) {
          return "Error: inputDir and output are required";
        }

        const config = loadConfig();
        const scriptDir = path.join(config.WORKSPACE_DIR, "scripts", "asset-pipeline");
        const pythonBin = process.env.PIPELINE_PYTHON ?? "python3";

        const args = [
          pythonBin,
          path.join(scriptDir, "sprite_pack.py"),
          "--input-dir", _inputDir,
          "--output", _output,
          "--columns", String(_columns),
        ];
        if (_padding) args.push("--padding", String(_padding));
        if (_pad) args.push("--pad", String(_pad));

        try {
          const { stdout, stderr } = await execFileAsyncTool(pythonBin, args, {
            cwd: scriptDir,
            timeout: 120_000,
          });
          const summary = stdout.slice(-300);
          logEntry(sessionId, "info", `[${agentRole}] SpritePack: ${_inputDir} -> ${_output}`, agentRole);
          return `Sprite pack complete.\n${summary}${stderr ? `\nStderr: ${stderr.slice(-200)}` : ""}`;
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return `Error: SpritePack failed: ${error.stderr || error.message}`;
        }
      }

      case "GenerateAudio": {
        const _sfxType = input.type as string;
        const _outputPath = input.output as string;
        const _duration = input.duration as number | undefined;

        if (!_sfxType || !_outputPath) {
          return "Error: type and output are required";
        }

        const config = loadConfig();
        const scriptDir = path.join(config.WORKSPACE_DIR, "scripts", "asset-pipeline");
        const pythonBin = process.env.PIPELINE_PYTHON ?? "python3";

        const args = [
          pythonBin,
          path.join(scriptDir, "generate_audio.py"),
          "--type", _sfxType,
          "--output", _outputPath,
        ];
        if (_duration !== undefined) args.push("--duration", String(_duration));

        try {
          const { stdout, stderr } = await execFileAsyncTool(pythonBin, args, {
            cwd: scriptDir,
            timeout: 60_000,
          });
          const summary = stdout.slice(-200);
          logEntry(sessionId, "info", `[${agentRole}] GenerateAudio: ${_sfxType} -> ${_outputPath}`, agentRole);
          return `Audio generated.\n${summary}${stderr ? `\nStderr: ${stderr.slice(-200)}` : ""}`;
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return `Error: GenerateAudio failed: ${error.stderr || error.message}`;
        }
      }

      case "StartConsultation": {
        const role = input.role as string;
        const brief = input.brief as string | undefined;

        if (!role) return "Error: role is required";

        const directorRoles = ["creative-director", "technical-director", "art-director", "narrative-director", "audio-director"];
        if (!directorRoles.includes(role)) {
          return `Error: '${role}' is not a director-level role. Valid roles: ${directorRoles.join(", ")}`;
        }

        const projectId = projectContext?.projectId;
        if (!projectId) {
          return "Error: StartConsultation requires a project context. Ensure this is called within a project session.";
        }

        // Lazy import to avoid circular dependency (chat.ts imports from llm-service.ts)
        const chatModule = await import("../routes/chat.js");
        await chatModule.chatStoreReady;
        const store = chatModule.chatStore;

        const sessionId = `consultation-${role.toLowerCase().replace(/\s+/g, "-")}`;

        // Check if session already exists
        if (store.sessions[sessionId]) {
          return `${role} consultation session is already active (${sessionId}). The user can switch to that tab.`;
        }

        // Load agent system prompt for welcome message
        let welcomeContent = `${role} consultation session initialized.`;
        try {
          const systemPrompt = await getAgentSystemPrompt(role as AgentRole);
          welcomeContent = systemPrompt.split("\n")[0] ?? welcomeContent;
        } catch {
          // Use default
        }

        const now = new Date().toISOString();
        const newSession = {
          id: sessionId,
          role,
          projectId,
          messages: [
            {
              id: `msg-${crypto.randomUUID().slice(0, 8)}`,
              type: "system" as const,
              sender: "SYSTEM",
              content: brief ? `${welcomeContent}\n\n**Brief:** ${brief}` : welcomeContent,
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

        // Atomic check-and-set to prevent concurrent creation of same session
        if (store.sessions[sessionId]) {
          return `${role} consultation session was just created by another process (${sessionId}).`;
        }
        store.sessions[sessionId] = newSession;

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
        });

        // Persist state
        const { writeData } = await import("../services/data-store.js");
        await writeData("chat-state.json", store);

        logEntry(sessionId, "info", `[${agentRole}] Started consultation: ${role}`, agentRole);

        return `${role} consultation session started (${sessionId}). The user can now switch to the ${role} tab to chat directly.`;
      }

      case "RunGodotHeadless": {
        const project = input.project as string;
        const command = input.command as string;
        const script = input.script as string | undefined;
        const preset = input.preset as string | undefined;
        const output = input.output as string | undefined;
        const godotBin = input.godotBin as string | undefined;

        if (!project) return "Error: project path is required";

        const config = loadConfig();
        const scriptDir = path.join(config.WORKSPACE_DIR, "scripts", "godot");
        const pythonBin = process.env.PIPELINE_PYTHON ?? "python3";

        const args: string[] = [pythonBin, path.join(scriptDir, "run_godot_headless.py"), "--project", project, "--command", command];
        if (script) args.push("--script", script);
        if (preset) args.push("--preset", preset);
        if (output) args.push("--output", output);
        if (godotBin) args.push("--godot-bin", godotBin);

        try {
          const { stdout, stderr } = await execFileAsyncTool(pythonBin, args, {
            cwd: scriptDir,
            timeout: 360_000, // 6 min for export
            maxBuffer: 10 * 1024 * 1024,
          });

          // The script outputs JSON — try to parse it for a structured result
          let resultMsg = "";
          try {
            const parsed = JSON.parse(stdout.trim());
            resultMsg = `Godot headless ${command} completed.\nReturn code: ${parsed.returnCode}\nElapsed: ${parsed.elapsed_ms}ms\nStdout:\n${(parsed.stdout || "").slice(-500)}`;
            if (parsed.stderr) resultMsg += `\nStderr:\n${parsed.stderr.slice(-500)}`;
            resultMsg += `\nSuccess: ${parsed.success}`;
          } catch {
            resultMsg = `Output:\n${stdout.slice(-500)}${stderr ? `\nStderr: ${stderr.slice(-200)}` : ""}`;
          }

          logEntry(sessionId, "info", `[${agentRole}] RunGodotHeadless: ${command} on ${project}`, agentRole);
          return resultMsg;
        } catch (err: unknown) {
          const error = err as { stderr?: string; message?: string };
          return `Error: RunGodotHeadless failed: ${error.stderr || error.message}`;
        }
      }

      case "CreateTicket": {
        const title = input.title as string;
        const description = input.description as string;
        const agentRole = input.agentRole as string;
        const area = input.area as string;
        const subarea = (input.subarea as string | undefined) ?? area;

        if (!title || !description || !agentRole || !area) {
          return "Error: title, description, agentRole, and area are required";
        }

        const { createQuestTicket } = await import("../services/quest-bridge.js");
        const ticket = await createQuestTicket(sessionId, title, agentRole as AgentRole, description, area, subarea);

        logEntry(sessionId, "info", `[${agentRole}] Created ticket: ${ticket.id} — ${title}`, agentRole as AgentRole);
        return `Ticket created:\nID: ${ticket.id}\nTitle: ${ticket.title}\nStatus: ${ticket.status}\nAssignee: ${ticket.assignee}\nArea: ${ticket.area}/${ticket.subarea}`;
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
  onTokenUsage?: import("../llm/zai-client.js").TokenUsageCallback,
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
    const model = getModelForTier(modelTier);

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
      onFileOperation,
      onTokenUsage
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
    // Re-throw so the autonomous loop can handle it properly
    throw error;
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
  onTokenUsage?: import("../llm/zai-client.js").TokenUsageCallback,
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
    const model = getModelForTier(modelTier);

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
      onFileOperation,
      onTokenUsage
    );

    return {
      content: response.content,
      toolCalls: response.tool_calls?.map((tc) => ({ name: tc.name, input: tc.input })),
      usage: response.usage,
    };
  } catch (err: unknown) {
    const error = err as Error;
    throw error;
  }
}
