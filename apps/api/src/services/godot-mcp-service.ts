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

  // 2. Try relative to project root
  const cwd = process.cwd();
  const candidates = [
    `${cwd}/godot-mcp-pro-v1.11.0/server/build/index.js`,
    `${cwd}/../godot-mcp-pro-v1.11.0/server/build/index.js`,
    `${cwd}/godot-mcp-pro/server/build/index.js`,
  ];

  for (const p of candidates) {
    try {
      // Sync check — ok for startup
      require("fs").accessSync(p);
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

  constructor(options?: GodotMCPServiceOptions) {
    this.serverPath = options?.serverPath ?? resolveServerPath();
    this.mode = options?.mode ?? "lite";
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  /** Start the MCP server (stdio mode) */
  async start(): Promise<void> {
    if (this.isRunning) return;

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
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        if (!line.includes("[MCP]")) continue; // Skip debug noise
        logger.warn({ line, event: "godot_mcp_stderr" }, "MCP stderr");
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
      if (!line.trim() || !line.startsWith("{")) continue;
      try {
        const msg = JSON.parse(line) as MCPResponse;
        if (msg.id && this.pendingRequests.has(msg.id)) {
          const pending = this.pendingRequests.get(msg.id)!;
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  /** Send a JSON-RPC request to the MCP server via stdin */
  private async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error("MCP server process not running");
    }

    const id = randomUUID();
    const request: MCPRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request '${method}' timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Write JSON-RPC request to stdin
      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    });
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
            parts.push(item.text ?? "");
          } else if (item.type === "image" && item.data) {
            const sizeKB = Math.round(item.data.length * 0.75 / 1024);
            parts.push(`[Image: ${sizeKB}KB, mime=${item.mimeType ?? "image/png"}]`);
          }
        }

        return parts.join("\n") || JSON.stringify(result);
      }

      return typeof result === "string" ? result : JSON.stringify(result, null, 2);
    } catch (err) {
      const error = err as Error;
      return `Error: ${error.message}`;
    }
  }

  /** Check if the service is running */
  running(): boolean {
    return this.isRunning;
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