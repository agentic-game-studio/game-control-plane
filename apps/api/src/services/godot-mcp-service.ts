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

import { spawn, ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync } from "node:fs";
import type { LLMTool } from "../llm/zai-client.js";
import { logger } from "../utils/logger.js";

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

/** Tool name set for membership checking */
const GODOT_MCP_TOOL_NAMES = new Set([
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
]);

/** Check if a tool name is a known Godot MCP tool */
export function isGodotMCPTool(name: string): boolean {
  return GODOT_MCP_TOOL_NAMES.has(name);
}

/** Get all Godot MCP tool definitions (for LLM injection) */
export function getGodotMCPToolDefinitions(): LLMTool[] {
  return Array.from(GODOT_MCP_TOOL_NAMES).map((name) => ({
    name,
    description: `[Godot MCP] Tool: ${name} — see Godot MCP Pro documentation for details`,
    input_schema: { type: "object", properties: {}, required: [] },
  }));
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

    // Wait briefly for server to initialize
    await new Promise((r) => setTimeout(r, 1000));
    this.isRunning = true;
    this.initialized = true;

    logger.info({ mode: this.mode, event: "godot_mcp_start" }, "Service started");
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

      // Write JSON-RPC request to stdin
      const data = JSON.stringify(request) + "\n";
      this.process!.stdin!.write(data);
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

    // Kill the MCP server process
    if (this.process) {
      this.process.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }) + "\n");
      this.process.kill("SIGTERM");
      this.process = null;
    }

    this.isRunning = false;
    logger.info({ event: "godot_mcp_stopped" }, "Service stopped");
  }

  private cleanup() {
    this.isRunning = false;
    this.process = null;
  }
}

// Singleton registry for per-project Godot MCP services
// Keyed by projectId so all sessions (producer + spawned agents) share one MCP server
// The MCP server bridges to Godot via WebSocket — multiple connections are fine
const activeServices = new Map<string, GodotMCPService>();

/** Get or create a Godot MCP service for a project */
export async function getOrCreateGodotMCPService(
  projectId: string,
  options?: GodotMCPServiceOptions
): Promise<GodotMCPService> {
  let service = activeServices.get(projectId);

  if (!service) {
    service = new GodotMCPService(options);
    await service.start();
    activeServices.set(projectId, service);
  }

  return service;
}

/** Stop and remove a Godot MCP service for a project */
export async function removeGodotMCPService(projectId: string): Promise<void> {
  const service = activeServices.get(projectId);
  if (service) {
    await service.stop();
    activeServices.delete(projectId);
  }
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
      // Use rmSync if available (Node 14.14+), otherwise skip
      try {
        const { rmSync } = require("node:fs");
        rmSync(projectPluginDir, { recursive: true, force: true });
      } catch {
        // Fallback: skip removal, just overwrite
      }
    }

    // Copy the plugin files
    cpSync(sourcePath, projectPluginDir, { recursive: true });
    result.pluginCopied = true;
    logger.info({ sourcePath, destPath: projectPluginDir }, "Godot MCP plugin copied");

    // Enable the plugin in project.godot
    const projectGodotPath = join(projectDir, "project.godot");
    if (existsSync(projectGodotPath)) {
      let projectGodotContent = readFileSync(projectGodotPath, "utf-8");

      // Check if plugin is already enabled
      if (projectGodotContent.includes('"Godot MCP Pro"')) {
        // Update existing entry to enable it
        projectGodotContent = projectGodotContent.replace(
          /\[plugins\][\s\S]*?"Godot MCP Pro"\/enable="[^"]*"/,
          '[plugins]\n\n"Godot MCP Pro"/enable="On"'
        );
        // If pattern didn't match, try alternate approach
        if (!projectGodotContent.includes('"Godot MCP Pro"/enable="On"')) {
          projectGodotContent = projectGodotContent.replace(
            /"Godot MCP Pro"\/enable="[^"]*"/,
            '"Godot MCP Pro"/enable="On"'
          );
        }
      } else {
        // Add new plugin entry
        const pluginEntry = '\n[plugins]\n\n"Godot MCP Pro"/enable="On"\n';
        projectGodotContent += pluginEntry;
      }

      writeFileSync(projectGodotPath, projectGodotContent, "utf-8");
      result.pluginEnabled = true;
      logger.info({ projectGodotPath }, "Godot MCP plugin enabled in project.godot");
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
  return content.includes('"Godot MCP Pro"/enable="On"');
}

// ─── Godot Editor Launch ──────────────────────────────────────────────────

/**
 * Launch the Godot editor with a specific project.
 *
 * Searches for the Godot binary in common locations, then spawns it
 * as a detached process with --path pointing to the project directory.
 * The plugin must already be installed and enabled in project.godot
 * (handled by installGodotMCPPlugin).
 */
export function launchGodotEditor(projectDir: string): { success: boolean; pid?: number; error?: string } {
  const candidates = [
    // macOS .app bundle
    "/Applications/Godot.app/Contents/MacOS/Godot",
    // Homebrew
    "/usr/local/bin/godot",
    "/opt/homebrew/bin/godot",
    // Linux
    "/usr/bin/godot",
    "/usr/local/bin/godot",
    // Snap/Flatpak
    "/snap/bin/godot",
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

import { execSync } from "node:child_process";

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
        execSync("npm install", {
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
        execSync("npm run build", {
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