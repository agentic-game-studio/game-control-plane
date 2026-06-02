/**
 * GodotMCPService — Lifecycle management for the godot-mcp-pro MCP server.
 *
 * Spawns the godot-mcp-pro Node.js server as a child process with stdio transport.
 * Communicates via JSON-RPC over stdin/stdout. The MCP server internally connects
 * to the Godot editor via WebSocket (ports 6505-6514).
 *
 * Architecture:
 *   LLM tool call → this.executeTool()
 *     → JSON-RPC request written to MCP server stdin
 *     → MCP server forwards to Godot via WebSocket
 *     → Response read from MCP server stdout
 */

import { spawn, execFileSync, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, globSync, rmSync } from "node:fs";
import type { LLMTool } from "../llm/zai-client.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";
import { resolveHomeDir } from "../utils/paths.js";

// Re-export tool type for consumers
export type { LLMTool } from "../llm/zai-client.js";

interface MCPRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: {
    type: "object";
    properties?: Record<string, { description?: string; type?: string }>;
    required?: string[];
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface GodotMCPServiceOptions {
  /** Path to the godot-mcp-pro server entry point (auto-detected if not provided) */
  serverPath?: string;
  /** Path to the Godot project directory */
  projectPath?: string;
  /** MCP server mode: full, lite, minimal (default: lite for lower tool count) */
  mode?: "full" | "lite" | "minimal";
  /** Timeout for tool calls in ms (default: 30000) */
  timeout?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Auto-detect MCP server path from env var or relative paths */
function resolveServerPath(): string {
  // 1. Explicit env var (highest priority)
  if (process.env.GODOT_MCP_SERVER_PATH) {
    return process.env.GODOT_MCP_SERVER_PATH;
  }

  // 2. Try relative to API root (apps/api) and project root
  // API runs from apps/api, MCP server is in project root
  const cwd = process.cwd();
  const candidates = [
    // From project root (cwd = game-control-plane)
    `${cwd}/godot-mcp-pro-v1.11.0/server/build/index.js`,
    // From apps/api (cwd = game-control-plane/apps/api), go up 2 levels
    `${cwd}/../../godot-mcp-pro-v1.11.0/server/build/index.js`,
    // From apps/api (cwd = game-control-plane/apps/api), go up 1 level
    `${cwd}/../godot-mcp-pro-v1.11.0/server/build/index.js`,
  ];

  for (const p of candidates) {
    try {
      // Sync check — ok for startup
      accessSync(p);
      return p;
    } catch {
      // Try next candidate
    }
  }

  // 3. Return first candidate — spawn will fail with clear error
  return candidates[0];
}

/** Tool name set for membership checking. The set is built once at module
 * load from a static literal, then frozen so a future tool-author who
 * accidentally adds a `.add()` or `.delete()` somewhere (e.g. inside a
 * hot-reload branch) can't silently mutate the registry. */
const GODOT_MCP_TOOL_NAMES: ReadonlySet<string> = Object.freeze(new Set([
  // Project tools
  "get_project_info", "get_filesystem_tree", "search_files", "get_project_settings",
  "set_project_setting", "uid_to_project_path", "project_path_to_uid",
  // Scene tools
  "get_scene_tree", "get_scene_file_content", "create_scene", "open_scene",
  "delete_scene", "add_scene_instance", "play_scene", "stop_scene", "save_scene", "get_scene_exports",
  // Node tools
  "add_node", "delete_node", "duplicate_node", "move_node", "rename_node", "update_property",
  "get_node_properties", "add_resource", "set_anchor_preset", "connect_signal", "disconnect_signal",
  "get_node_groups", "set_node_groups", "find_nodes_in_group",
  // Script tools
  "list_scripts", "read_script", "create_script", "edit_script", "attach_script",
  "get_open_scripts", "validate_script", "search_in_files",
  // Editor tools
  "get_editor_errors", "get_editor_screenshot", "get_game_screenshot", "execute_editor_script",
  "clear_output", "get_signals", "reload_plugin", "reload_project", "get_output_log",
  // Input tools
  "simulate_key", "simulate_mouse_click", "simulate_mouse_move", "simulate_action",
  "simulate_sequence", "get_input_actions", "set_input_action",
  // Runtime tools
  "get_game_scene_tree", "get_game_node_properties", "set_game_node_property", "execute_game_script",
  "capture_frames", "record_frames", "monitor_properties", "start_recording", "stop_recording",
  "replay_recording", "find_nodes_by_script", "get_autoload", "batch_get_properties",
  "find_ui_elements", "click_button_by_text", "wait_for_node", "find_nearby_nodes",
  "navigate_to", "move_to",
  // Animation tools
  "list_animations", "create_animation", "add_animation_track", "set_animation_keyframe",
  "get_animation_info", "remove_animation",
  // Tilemap tools
  "tilemap_get_info", "tilemap_set_cell", "tilemap_get_cell", "tilemap_fill_rect",
  "tilemap_clear", "tilemap_get_used_cells",
  // Theme tools
  "create_theme", "get_theme_info", "set_theme_color", "set_theme_font_size",
  "set_theme_constant", "set_theme_stylebox",
  // Profiling tools
  "get_performance_monitors", "get_editor_performance",
  // Batch tools
  "find_nodes_by_type", "find_signal_connections", "batch_set_property", "find_node_references",
  "get_scene_dependencies", "cross_scene_set_property", "find_script_references",
  "detect_circular_dependencies",
  // Shader tools
  "create_shader", "read_shader", "edit_shader", "assign_shader_material",
  "get_shader_params", "set_shader_param",
  // Export tools
  "list_export_presets", "get_export_info", "export_project",
  // Resource tools
  "read_resource", "edit_resource", "create_resource", "get_resource_preview",
  "add_autoload", "remove_autoload",
  // Physics tools
  "setup_physics_body", "setup_collision", "set_physics_layers", "get_physics_layers",
  "get_collision_info", "add_raycast",
  // 3D tools
  "add_mesh_instance", "setup_environment", "setup_lighting", "setup_camera_3d",
  "set_material_3d", "add_gridmap",
  // Particle tools
  "create_particles", "set_particle_material", "set_particle_color_gradient",
  "apply_particle_preset", "get_particle_info",
  // Navigation tools
  "setup_navigation_region", "setup_navigation_agent", "bake_navigation_mesh",
  "set_navigation_layers", "get_navigation_info",
  // Audio tools
  "add_audio_player", "add_audio_bus", "add_audio_bus_effect", "set_audio_bus",
  "get_audio_bus_layout", "get_audio_info",
  // AnimationTree tools
  "create_animation_tree", "get_animation_tree_structure", "add_state_machine_state",
  "add_state_machine_transition", "remove_state_machine_state", "remove_state_machine_transition",
  "set_blend_tree_node", "set_tree_parameter",
  // Analysis tools
  "analyze_scene_complexity", "analyze_signal_flow",
  "find_unused_resources", "get_project_statistics",
  // Testing tools
  "run_test_scenario", "assert_node_state", "assert_screen_text", "compare_screenshots",
  "run_stress_test", "get_test_report",
]));

/** Check if a tool name is a known Godot MCP tool */
export function isGodotMCPTool(name: string): boolean {
  return GODOT_MCP_TOOL_NAMES.has(name);
}

/** Get all Godot MCP tool definitions (for LLM injection). Cached at
 * module load — the registry is frozen, so the array is identical for
 * the lifetime of the process. */
const GODOT_MCP_TOOL_DEFINITIONS: ReadonlyArray<LLMTool> = Object.freeze(
  Array.from(GODOT_MCP_TOOL_NAMES).map((name) => ({
    name,
    description: `[Godot MCP] Tool: ${name} — see Godot MCP Pro documentation for details`,
    input_schema: { type: "object", properties: {}, required: [] },
  })),
);

export function getGodotMCPToolDefinitions(): LLMTool[] {
  return GODOT_MCP_TOOL_DEFINITIONS as LLMTool[];
}

/** Godot MCP Service — manages the MCP server lifecycle */
export class GodotMCPService {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isRunning = false;
  private mode: "full" | "lite" | "minimal";
  private timeout: number;
  private serverPath: string;
  private initialized = false;
  private stdoutBuffer = "";
  private readonly MAX_STDOUT_BUFFER = 1024 * 1024; // 1MB cap to prevent OOM
  /** Absolute path of the Godot project (detected from MCP responses) */
  private godotProjectDir: string | null = null;
  /** Workspace-relative path for rewriting Godot paths */
  private workspaceRelativePath: string | null = null;

  constructor(options?: GodotMCPServiceOptions) {
    this.serverPath = options?.serverPath ?? resolveServerPath();
    this.mode = options?.mode ?? "lite";
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    // Store workspace-relative path (e.g., "godot-test-1")
    this.workspaceRelativePath = options?.projectPath ?? null;
  }

  /** Start the MCP server (stdio mode) */
  async start(): Promise<void> {
    if (this.isRunning) return;

    // Auto-setup: install dependencies and build if needed
    const setupResult = setupGodotMCPServer();
    if (!setupResult.success) {
      throw new Error(`Failed to setup Godot MCP server: ${setupResult.error}`);
    }

    const modeArgs: string[] = [];
    if (this.mode === "minimal") modeArgs.push("--minimal");
    else if (this.mode === "lite") modeArgs.push("--lite");

    // Spawn MCP server with stdio transport
    this.process = spawn("node", [this.serverPath, ...modeArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Handle stdout — read JSON-RPC responses
    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      // Cap buffer to prevent OOM from runaway MCP output. Slice at the last
      // newline before the cap so we never throw away the start of an
      // in-flight JSON-RPC message. The previous implementation sliced at a
      // raw byte offset, which could straddle a message boundary and silently
      // drop a response.
      if (this.stdoutBuffer.length > this.MAX_STDOUT_BUFFER) {
        const excess = this.stdoutBuffer.length - this.MAX_STDOUT_BUFFER;
        const lastNewline = this.stdoutBuffer.indexOf("\n", excess);
        if (lastNewline === -1) {
          // No newline found in the excess — fall back to dropping the
          // entire pre-excess region as malformed input (better than OOM).
          this.stdoutBuffer = this.stdoutBuffer.slice(excess);
          logger.warn({ excess, event: "godot_mcp_buffer_overflow_no_newline" }, "MCP stdout buffer overflow with no newline — dropped pre-excess data");
        } else {
          this.stdoutBuffer = this.stdoutBuffer.slice(lastNewline + 1);
          logger.warn({ droppedBytes: lastNewline, event: "godot_mcp_buffer_overflow" }, "MCP stdout buffer overflow — dropped data up to last newline");
        }
      }
      this.processStdout();
    });

    // Handle stderr — log MCP server output
    this.process.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes("[MCP]")) {
        logger.info({ line: text, event: "godot_mcp_stderr" }, "MCP stderr");
      }
    });

    // Handle process exit
    this.process.on("exit", (code, signal) => {
      logger.warn({ code, signal, event: "godot_mcp_exit" }, "MCP server exited");
      this.cleanup();
    });

    this.process.on("error", (err) => {
      logger.error({ error: err.message, event: "godot_mcp_error" }, "MCP process error");
    });

    // Wait for the MCP `initialize` JSON-RPC handshake to actually complete
    // before flipping isRunning. The previous 1-second setTimeout was a
    // best-effort guess — the server may take longer to import modules, and
    // `executeTool` calls in the meantime could race with init and receive
    // "method not found" responses. We send the standard MCP initialize
    // request and await the result, with a generous timeout.
    try {
      await this.sendInitializeHandshake();
      this.initialized = true;
    } catch (initErr) {
      logger.warn(
        { error: initErr instanceof Error ? initErr.message : String(initErr), event: "godot_mcp_init_failed" },
        "MCP initialize handshake did not complete — service will start in degraded mode",
      );
    }
    this.isRunning = true;

    logger.info({ mode: this.mode, event: "godot_mcp_start" }, "Service started");
  }

  /** Send the standard MCP `initialize` JSON-RPC request and await the
   * server's `result` (which contains its protocol version and capabilities).
   * This replaces the previous "sleep 1s and hope" pattern. */
  private sendInitializeHandshake(): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = `init-${Date.now()}`;
      const timer = setTimeout(
        () => reject(new Error("MCP initialize handshake timed out after 5s")),
        5000,
      );
      this.pendingRequests.set(id, {
        resolve: (val) => { clearTimeout(timer); resolve(val); },
        reject: (err) => { clearTimeout(timer); reject(err); },
        // Store the real timer so the centralized timeout-clear path
        // (when a response arrives) clears the right handle.
        timeout: timer,
      });
      const initRequest = {
        jsonrpc: "2.0" as const,
        id,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "game-control-plane", version: "0.1.0" },
        },
      };
      try {
        this.process?.stdin?.write(JSON.stringify(initRequest) + "\n");
      } catch (writeErr) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(writeErr);
      }
    });
  }

  private processStdout() {
    // MCP protocol: each line is a JSON-RPC message
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.startsWith("{")) {
        // Log non-JSON output (debug info, etc.)
        if (line.includes("[MCP]") || line.includes("error") || line.includes("Error")) {
          logger.info({ line, event: "godot_mcp_stdout" }, `MCP stdout: ${line}`);
        }
        continue;
      }
      try {
        const msg = JSON.parse(line) as MCPResponse;
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            logger.error({ error: msg.error, id: msg.id, event: "godot_mcp_response_error" }, `MCP error response: ${JSON.stringify(msg.error)}`);
            pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          } else {
            logger.info({ id: msg.id, event: "godot_mcp_response" }, `MCP response received for id: ${msg.id}`);
            pending.resolve(msg.result);
          }
        }
      } catch (err) {
        // Not JSON — ignore
      }
    }
  }

  /** Send a JSON-RPC request to the MCP server via stdin */
  private async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process?.stdin || !this.process?.stdout) {
      throw new Error("MCP server process not running (stdin/stdout not available)");
    }

    const id = randomUUID();
    const request: MCPRequest = { jsonrpc: "2.0", id, method, params };

    // Log the request for debugging
    logger.info({ method, id, event: "godot_mcp_request" }, `Sending MCP request: ${method}`);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        logger.error({ method, id, event: "godot_mcp_timeout" }, `MCP request timed out: ${method}`);
        reject(new Error(`Request '${method}' timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Write JSON-RPC request to stdin. If the MCP server's stdin has
      // been closed (server died, but the `exit` event hasn't fired yet),
      // Node raises EPIPE synchronously here. Without the try/catch that
      // bubbles up as an unhandled promise rejection, leaving the
      // pending request in the Map until the timeout eventually fires.
      // Rejecting eagerly keeps the error visible at the request site
      // and frees the id for the next caller.
      const data = JSON.stringify(request) + "\n";
      try {
        this.process!.stdin!.write(data);
      } catch (err) {
        clearTimeout(timeout);
        this.pendingRequests.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Rewrite absolute file paths from Godot to workspace-relative paths.
   * Godot returns absolute paths like /Users/cursor/some-folder/godot-test-1/scene.gd
   * We rewrite these to ./workspace/godot-test-1/scene.gd for the LLM.
   */
  private rewritePaths(result: string): string {
    // Detect the Godot project directory from the result
    // Godot typically returns paths containing the project directory name
    if (!this.godotProjectDir && this.workspaceRelativePath) {
      // Look for the project name in absolute paths like /Users/xxx/.../project-name/
      // Match up to the project directory and capture the full path prefix
      const escapedProjectName = this.workspaceRelativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const projectMatch = result.match(new RegExp(`(/Users/[^/]+/[^/]+/${escapedProjectName}/)`));
      if (projectMatch) {
        this.godotProjectDir = projectMatch[1].replace(/\/$/, "");
        logger.info(
          { godotDir: this.godotProjectDir, workspaceRelative: this.workspaceRelativePath },
          "Detected Godot project directory"
        );
      }
    }

    if (!this.godotProjectDir || !this.workspaceRelativePath) {
      return result;
    }

    // Replace the absolute Godot path prefix with workspace-relative path
    // e.g., /Users/choguun/Documents/cursor/godot-test-1 → ./workspace/godot-test-1
    const relativeWorkspace = `./workspace/${this.workspaceRelativePath}`;
    return result.split(this.godotProjectDir).join(relativeWorkspace);
  }

  /** Execute a Godot MCP tool and return the result as a string */
  async executeTool(name: string, params: Record<string, unknown>): Promise<string> {
    if (!this.isRunning) {
      return `Error: GodotMCPService is not running. Call start() first.`;
    }

    try {
      // MCP tool call: tools/call with { name, arguments }
      const result = await this.sendRequest("tools/call", {
        name,
        arguments: params,
      });

      // Log raw result for debugging
      logger.info({ tool: name, event: "godot_mcp_result" }, `Got result for ${name}: ${String(result).slice(0, 200)}`);

      // Format result for LLM consumption
      if (result === undefined || result === null) {
        return JSON.stringify({ success: true });
      }

      // Handle MCP response format { content: [...] }
      if (typeof result === "object" && result !== null && "content" in result) {
        const mcpResult = result as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
        const parts: string[] = [];

        for (const item of mcpResult.content) {
          if (item.type === "text") {
            // Rewrite absolute paths to workspace-relative paths
            parts.push(this.rewritePaths(item.text ?? ""));
          } else if (item.type === "image" && item.data) {
            const sizeKB = Math.round(item.data.length * 0.75 / 1024);
            parts.push(`[Image: ${sizeKB}KB, mime=${item.mimeType ?? "image/png"}]`);
          }
        }

        return parts.join("\n") || JSON.stringify(result);
      }

      const formattedResult = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return this.rewritePaths(formattedResult);
    } catch (err) {
      const error = err as Error;
      logger.error({ tool: name, error: error.message, event: "godot_mcp_tool_error" }, `MCP tool error: ${error.message}`);
      return `Error: ${error.message}`;
    }
  }

  /** Check if the service is running */
  running(): boolean {
    return this.isRunning;
  }

  /** Get MCP server status */
  getStatus(): { running: boolean; connected: boolean; mode: string } {
    return {
      running: this.isRunning,
      connected: this.isRunning,
      mode: this.mode,
    };
  }

  /**
   * Health check - verify the MCP server and Godot editor connection.
   * Returns details about the connection status.
   */
  async healthCheck(): Promise<{
    serverRunning: boolean;
    godotConnected: boolean;
    projectInfo?: Record<string, unknown>;
    error?: string;
  }> {
    const result: {
      serverRunning: boolean;
      godotConnected: boolean;
      projectInfo?: Record<string, unknown>;
      error?: string;
    } = {
      serverRunning: this.isRunning,
      godotConnected: false,
    };

    if (!this.isRunning) {
      result.error = "MCP server is not running";
      return result;
    }

    try {
      // Try to get project info to verify Godot connection
      const projectInfo = await this.executeTool("get_project_info", {});
      if (projectInfo.startsWith("Error:")) {
        result.error = projectInfo;
        return result;
      }
      result.godotConnected = true;
      try {
        result.projectInfo = JSON.parse(projectInfo);
      } catch {
        // Not JSON, but connection worked
      }
      return result;
    } catch (err) {
      result.error = (err as Error).message;
      return result;
    }
  }

  /** Stop the MCP server and clean up resources */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info({ event: "godot_mcp_stop" }, "Stopping service");

    // Clear pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Service stopped"));
    }
    this.pendingRequests.clear();

    // Kill the MCP server process — try graceful shutdown, then force kill
    if (this.process) {
      const proc = this.process;
      this.process.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }) + "\n");
      proc.kill("SIGTERM");
      this.process = null;

      // Force kill if SIGTERM didn't work within 5s. Track the handle on
      // the proc so the process-exit path can clearTimeout it — otherwise
      // a process that dies within 5s of SIGTERM leaves a phantom timer
      // whose callback fires and tries to kill a PID that's been reused.
      const forceKillTimer = setTimeout(() => {
        try {
          if (proc.pid) {
            process.kill(proc.pid, "SIGKILL");
            logger.warn({ pid: proc.pid, event: "godot_mcp_force_kill" }, "Force-killed hung MCP server process");
          }
        } catch { /* already dead */ }
      }, 5000);
      forceKillTimer.unref();
      (proc as { _forceKillTimer?: ReturnType<typeof setTimeout> })._forceKillTimer = forceKillTimer;
      proc.once("exit", () => {
        const t = (proc as { _forceKillTimer?: ReturnType<typeof setTimeout> })._forceKillTimer;
        if (t) clearTimeout(t);
      });
    }

    this.isRunning = false;
    logger.info({ event: "godot_mcp_stopped" }, "Service stopped");
  }

  private cleanup() {
    this.isRunning = false;
    this.process = null;
    // Reject any pending requests that will never get a response
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP server process exited"));
    }
    this.pendingRequests.clear();
  }
}

// Singleton registry for per-project Godot MCP services
// Keyed by projectId so all sessions (producer + spawned agents) share one MCP server
// The MCP server bridges to Godot via WebSocket — multiple connections are fine
const activeServices = new Map<string, GodotMCPService>();
const pendingCreations = new Map<string, Promise<GodotMCPService>>();

/** Get or create a Godot MCP service for a project */
export async function getOrCreateGodotMCPService(
  projectId: string,
  options?: GodotMCPServiceOptions
): Promise<GodotMCPService> {
  const existing = activeServices.get(projectId);
  if (existing) return existing;

  // Deduplicate concurrent creation attempts for the same project
  const pending = pendingCreations.get(projectId);
  if (pending) return pending;

  const creationPromise = (async () => {
    try {
      const service = new GodotMCPService(options);
      await service.start();
      activeServices.set(projectId, service);
      return service;
    } finally {
      pendingCreations.delete(projectId);
    }
  })();

  pendingCreations.set(projectId, creationPromise);
  return creationPromise;
}

/** Stop and remove a Godot MCP service for a project */
export async function removeGodotMCPService(projectId: string): Promise<void> {
  const service = activeServices.get(projectId);
  if (service) {
    await service.stop();
    activeServices.delete(projectId);
  }
}

/** Stop all active MCP services (for graceful shutdown) */
export async function shutdownAllMCPServices(): Promise<void> {
  const entries = [...activeServices.entries()];
  activeServices.clear();
  await Promise.allSettled(entries.map(([, service]) => service.stop()));
}

/** Get the active service for a project (null if not running) */
export function getGodotMCPService(projectId: string): GodotMCPService | null {
  return activeServices.get(projectId) ?? null;
}

// ─── Plugin Auto-Installation ──────────────────────────────────────────

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

/** Result of a plugin installation attempt */
export interface InstallPluginResult {
  success: boolean;
  pluginCopied: boolean;
  pluginEnabled: boolean;
  error?: string;
}

/**
 * Automatically install the Godot MCP Pro plugin into a Godot project.
 *
 * This function:
 * 1. Copies the godot_mcp addons folder to the project's addons/ directory
 * 2. Enables the plugin in project.godot
 *
 * @param projectDir - Absolute path to the Godot project directory
 * @param workspaceDir - The workspace directory (for finding godot-mcp-pro)
 */
export function installGodotMCPPlugin(
  projectDir: string,
  workspaceDir: string
): InstallPluginResult {
  const result: InstallPluginResult = {
    success: false,
    pluginCopied: false,
    pluginEnabled: false,
  };

  try {
    // Find the godot-mcp-pro addons folder - check multiple possible locations
    const possiblePaths = [
      // Next to workspace (common setup)
      resolve(workspaceDir, "..", "godot-mcp-pro-v1.11.0", "addons", "godot_mcp"),
      // Inside workspace
      resolve(workspaceDir, "godot-mcp-pro-v1.11.0", "addons", "godot_mcp"),
      // Current working directory
      resolve(process.cwd(), "godot-mcp-pro-v1.11.0", "addons", "godot_mcp"),
      // Parent of current working directory
      resolve(process.cwd(), "..", "godot-mcp-pro-v1.11.0", "addons", "godot_mcp"),
      // Parent of workspace parent
      resolve(workspaceDir, "..", "..", "godot-mcp-pro-v1.11.0", "addons", "godot_mcp"),
    ];

    let sourcePath: string | null = null;
    for (const candidate of possiblePaths) {
      if (existsSync(candidate)) {
        sourcePath = candidate;
        logger.info({ sourcePath: candidate }, "Found Godot MCP plugin");
        break;
      }
    }

    if (!sourcePath) {
      result.error = `Godot MCP plugin not found. Searched:\n${possiblePaths.map(p => `  - ${p}`).join("\n")}\n\nMake sure godot-mcp-pro-v1.11.0 is in the project root.`;
      logger.error({ searched: possiblePaths }, "Godot MCP plugin source not found");
      return result;
    }

    // Create project's addons directory if it doesn't exist
    const projectAddonsDir = join(projectDir, "addons");
    if (!existsSync(projectAddonsDir)) {
      mkdirSync(projectAddonsDir, { recursive: true });
    }

    // Copy the godot_mcp folder to the project's addons directory
    const projectPluginDir = join(projectAddonsDir, "godot_mcp");

    // Remove existing plugin folder if it exists (for clean reinstall)
    if (existsSync(projectPluginDir)) {
      rmSync(projectPluginDir, { recursive: true, force: true });
    }

    // Copy the plugin files
    cpSync(sourcePath, projectPluginDir, { recursive: true });
    result.pluginCopied = true;
    logger.info({ sourcePath, destPath: projectPluginDir }, "Godot MCP plugin copied");

    // Enable the plugin in project.godot (Godot 4 format)
    const projectGodotPath = join(projectDir, "project.godot");
    if (existsSync(projectGodotPath)) {
      let projectGodotContent = readFileSync(projectGodotPath, "utf-8");
      const pluginCfgPath = "res://addons/godot_mcp/plugin.cfg";

      // Check if already enabled in Godot 4 format ([editor_plugins])
      if (projectGodotContent.includes(pluginCfgPath)) {
        result.pluginEnabled = true;
      } else {
        // Remove any Godot 3 format [plugins] entries
        projectGodotContent = projectGodotContent.replace(
          /\[plugins\][^\[]*?"Godot MCP Pro"\/enable="[^"]*"[^\[]*?\n/g,
          ""
        );

        if (projectGodotContent.includes("[editor_plugins]")) {
          // Append to existing [editor_plugins] section
          projectGodotContent = projectGodotContent.replace(
            /\[editor_plugins\]\s*\nenabled=PackedStringArray\(([^)]*)\)/,
            (_, existing: string) => {
              if (existing.includes(pluginCfgPath)) return `enabled=PackedStringArray(${existing})`;
              return `enabled=PackedStringArray(${existing}, "${pluginCfgPath}")`;
            }
          );
          // Fallback: if regex didn't match the PackedStringArray pattern, just add after section header
          if (!projectGodotContent.includes(pluginCfgPath)) {
            projectGodotContent = projectGodotContent.replace(
              /\[editor_plugins\]/,
              `[editor_plugins]\n\nenabled=PackedStringArray("${pluginCfgPath}")`
            );
          }
        } else {
          // Add new [editor_plugins] section
          const pluginEntry = `\n[editor_plugins]\n\nenabled=PackedStringArray("${pluginCfgPath}")\n`;
          projectGodotContent += pluginEntry;
        }

        writeFileSync(projectGodotPath, projectGodotContent, "utf-8");
        result.pluginEnabled = true;
        logger.info({ projectGodotPath }, "Godot MCP plugin enabled in project.godot (Godot 4 format)");
      }
    } else {
      result.error = `project.godot not found at ${projectGodotPath}`;
      return result;
    }

    result.success = true;
  } catch (err) {
    const error = err as Error;
    result.error = error.message;
    logger.error({ error: error.message }, "Failed to install Godot MCP plugin");
  }

  return result;
}

/**
 * Check if the Godot MCP plugin is installed and enabled in a project.
 *
 * @param projectDir - Absolute path to the Godot project directory
 */
export function isGodotMCPPluginInstalled(projectDir: string): boolean {
  const pluginDir = join(projectDir, "addons", "godot_mcp");
  const pluginCfg = join(pluginDir, "plugin.cfg");
  return existsSync(pluginCfg);
}

/**
 * Check if the Godot MCP plugin is enabled in project.godot.
 *
 * @param projectDir - Absolute path to the Godot project directory
 */
export function isGodotMCPPluginEnabled(projectDir: string): boolean {
  const projectGodotPath = join(projectDir, "project.godot");
  if (!existsSync(projectGodotPath)) return false;

  const content = readFileSync(projectGodotPath, "utf-8");
  // Check Godot 4 format ([editor_plugins] with plugin.cfg path)
  return content.includes("res://addons/godot_mcp/plugin.cfg");
}

// ─── Godot Editor Launch ──────────────────────────────────────────────────

/**
 * Launch the Godot editor with a specific project.
 *
 * Ensures the MCP plugin is installed and enabled in project.godot
 * before launching. Uses Godot 4 [editor_plugins] format.
 */
export function launchGodotEditor(projectDir: string): { success: boolean; pid?: number; error?: string } {
  const platform = process.platform; // "darwin" | "linux" | "win32"

  // Ensure plugin is installed and enabled before launching
  if (!isGodotMCPPluginInstalled(projectDir) || !isGodotMCPPluginEnabled(projectDir)) {
    const config = loadConfig();
    const installResult = installGodotMCPPlugin(projectDir, config.WORKSPACE_DIR);
    if (!installResult.success) {
      logger.warn({ projectDir, error: installResult.error }, "Could not install/enable Godot MCP plugin before launch");
    }
  }

  // Check if Godot is already running
  const isAlreadyRunning = (): number | null => {
    try {
      if (platform === "win32") {
        // Windows: use tasklist
        const output = execFileSync("tasklist", ["/FI", "IMAGENAME eq Godot.exe", "/NH"], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        const match = output.match(/Godot\.exe\s+(\d+)/);
        if (match) return parseInt(match[1], 10);
      } else {
        // macOS / Linux: use pgrep. -x matches the exact process name
        // (not a substring), so a system process that happens to contain
        // "Godot" in its full command line doesn't get matched.
        const output = execFileSync("pgrep", ["-xi", "Godot"], { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
        if (output) return parseInt(output.split("\n")[0], 10);
      }
    } catch {
      // Process not found — proceed to launch
    }
    return null;
  };

  const existingPid = isAlreadyRunning();
  if (existingPid) {
    logger.info({ projectDir, existingPid }, "Godot editor already running, skipping launch");
    return { success: true, pid: existingPid };
  }

  // Find Godot binary — platform-specific candidates
  const localAppData = process.env.LOCALAPPDATA ?? "";
  const home = resolveHomeDir() ?? "";
  const candidates: string[] = platform === "win32" ? [
    // Windows: Program Files, user installs, Steam
    "C:\\Program Files\\Godot\\Godot.exe",
    "C:\\Program Files (x86)\\Godot\\Godot.exe",
    ...globSync("C:/Program Files/Godot*/Godot*.exe"),
    ...(localAppData ? globSync(`${localAppData}/Programs/Godot*/Godot*.exe`) : []),
    ...(home ? globSync(`${home}/AppData/Local/Programs/Godot*/Godot*.exe`) : []),
    ...globSync("C:/Program Files (x86)/Steam/steamapps/common/Godot*/Godot*.exe"),
  ] : platform === "darwin" ? [
    // macOS: .app bundle, Homebrew
    "/Applications/Godot.app/Contents/MacOS/Godot",
    ...globSync("/Applications/Godot*.app/Contents/MacOS/Godot"),
    "/usr/local/bin/godot",
    "/opt/homebrew/bin/godot",
  ] : [
    // Linux: standard paths, Snap, Flatpak, AppImage
    "/usr/bin/godot",
    "/usr/local/bin/godot",
    "/opt/homebrew/bin/godot",
    "/snap/bin/godot",
    ...globSync("/usr/local/bin/godot*"),
    ...(home ? globSync(`${home}/Applications/Godot*.AppImage`) : []),
    ...(home ? globSync(`${home}/.local/bin/godot*`) : []),
  ];

  // Check env var override first (highest priority)
  let godotBin: string | null = process.env.GODOT_EDITOR_PATH ?? null;

  // Auto-detect if no env override
  if (!godotBin) {
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        godotBin = candidate;
        break;
      }
    }
  }

  if (!godotBin) {
    return { success: false, error: "Godot editor not found. Set GODOT_EDITOR_PATH env var or install Godot." };
  }

  try {
    const proc = spawn(godotBin, ["--path", projectDir], {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();

    logger.info({ godotBin, projectDir, pid: proc.pid }, "Godot editor launched");
    return { success: true, pid: proc.pid };
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, godotBin, projectDir }, "Failed to launch Godot editor");
    return { success: false, error: error.message };
  }
}

// ─── Server Auto-Setup ─────────────────────────────────────────────────

/** Result of server setup attempt */
export interface SetupServerResult {
  success: boolean;
  installed: boolean;
  built: boolean;
  error?: string;
}

/**
 * Find the godot-mcp-pro server directory.
 * Returns the server directory (containing package.json and build/).
 */
export function findServerDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    // API runs from apps/api, so go up to project root
    resolve(cwd, "..", "..", "godot-mcp-pro-v1.11.0", "server"),
    resolve(cwd, "godot-mcp-pro-v1.11.0", "server"),
    resolve(cwd, "..", "godot-mcp-pro-v1.11.0", "server"),
    resolve(cwd, "godot-mcp-pro", "server"),
    resolve(cwd, "..", "godot-mcp-pro", "server"),
    resolve(cwd, "..", "..", "godot-mcp-pro", "server"),
    // From project root
    resolve(cwd, "godot-mcp-pro-v1.11.0", "server"),
    resolve(cwd, "..", "godot-mcp-pro-v1.11.0", "server"),
  ];

  for (const candidate of candidates) {
    const packageJson = join(candidate, "package.json");
    if (existsSync(packageJson)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Check if the Godot MCP server is built (build/index.js exists).
 */
export function isServerBuilt(serverDir: string): boolean {
  return existsSync(join(serverDir, "build", "index.js"));
}

/**
 * Check if npm dependencies are installed (node_modules exists).
 */
export function isDependenciesInstalled(serverDir: string): boolean {
  return existsSync(join(serverDir, "node_modules"));
}

/**
 * Auto-setup the Godot MCP server: install dependencies and build if needed.
 *
 * This function:
 * 1. Finds the godot-mcp-pro server directory
 * 2. Runs `npm install` if node_modules doesn't exist
 * 3. Runs `npm run build` if build/ directory doesn't exist
 *
 * @param onProgress - Optional callback to report progress
 */
export function setupGodotMCPServer(
  onProgress?: (stage: string) => void
): SetupServerResult {
  const result: SetupServerResult = {
    success: false,
    installed: false,
    built: false,
  };

  try {
    const serverDir = findServerDir();
    if (!serverDir) {
      result.error = `Could not find godot-mcp-pro server directory.\nSearched in:\n  - ${process.cwd()}/godot-mcp-pro-v1.11.0/server\n  - ${process.cwd()}/../godot-mcp-pro-v1.11.0/server\n\nMake sure godot-mcp-pro-v1.11.0 is in the project root.`;
      logger.error({ searched: [process.cwd(), resolve(process.cwd(), "..")] }, "Godot MCP server not found");
      return result;
    }

    logger.info({ serverDir }, "Found Godot MCP server");

    // Step 1: Install dependencies if needed
    if (!isDependenciesInstalled(serverDir)) {
      onProgress?.("Installing npm dependencies...");
      logger.info({ serverDir }, "Installing npm dependencies");
      try {
        // execFileSync passes argv as a vector — no shell interpolation.
        // `execSync` would route through a shell, which is unnecessary
        // here and is a (small) attack-surface for any environment that
        // can write into serverDir.
        execFileSync("npm", ["install"], {
          cwd: serverDir,
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
        });
        result.installed = true;
        logger.info({ serverDir }, "npm install completed");
      } catch (err) {
        result.error = `npm install failed: ${(err as Error).message}`;
        logger.error({ error: result.error, serverDir }, "npm install failed");
        return result;
      }
    } else {
      result.installed = true;
    }

    // Step 2: Build if needed
    if (!isServerBuilt(serverDir)) {
      onProgress?.("Building TypeScript...");
      logger.info({ serverDir }, "Building TypeScript");
      try {
        execFileSync("npm", ["run", "build"], {
          cwd: serverDir,
          stdio: "pipe",
          timeout: 120000, // 2 minute timeout
        });
        result.built = true;
        logger.info({ serverDir }, "npm run build completed");
      } catch (err) {
        result.error = `npm run build failed: ${(err as Error).message}`;
        logger.error({ error: result.error, serverDir }, "npm run build failed");
        return result;
      }
    } else {
      result.built = true;
    }

    result.success = true;
  } catch (err) {
    result.error = (err as Error).message;
    logger.error({ error: result.error }, "Server setup failed");
  }

  return result;
}