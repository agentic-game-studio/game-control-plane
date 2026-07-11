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

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname as pathDirname, join, resolve } from "node:path";
// 29-H-godot-mcp-dead-imports: the previous import list had
// `execFileSync`, `rmSync`, `readFileSync`, `readdirSync` — all
// dead. They were never called; the 27th/28th passes migrated
// every sync I/O site to fs/promises but left the imports in
// place. Drop them so `rg "Sync$" apps/api/src` returns only
// the live sync sites (accessSync at startup, existsSync /
// globSync on the binary-detect path).
import { accessSync, globSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import type { LLMTool } from "../llm/zai-client.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";
import { resolveHomeDir } from "../utils/paths.js";
import {
  startMCPBridge,
  stopMCPBridge,
  getMCPBridge,
  type MCPBridge,
} from "./mcp-lifecycle-manager.js";

// 28-H-godot-mcp-async-exec: hoist a promisified execFile to module
// scope. The 27th pass converted the same pattern in qa-gate-service
// for runSmokePlaytestGate / runBootCheckGate / runGUTGate; this
// file's `pgrep` / `tasklist` / `npm install` / `npm run build` calls
// were missed. execFileSync blocks the event loop for the duration
// of the subprocess — `npm install` is up to 2 minutes — and the
// launch/setup route handlers are awaited directly, freezing every
// WebSocket broadcast and SSE stream on the process.
const execFileAsync = promisify(execFile);

// Re-export tool type for consumers
export type { LLMTool } from "../llm/zai-client.js";

export interface GodotMCPServiceOptions {
  /** Project identifier used to key the underlying MCP bridge. */
  projectId?: string;
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

// 19-M-version-const: hoist the godot-mcp-pro package version to a single
// module-level constant. Previously the literal "v1.11.0" was duplicated
// across 14+ path candidates and 2 user-facing error messages, so a
// version bump required an audit pass and a missed edit silently broke
// the installer (resolveServerPath would always return a non-existent
// path and the spawn would die with ENOENT). One source of truth: bump
// here and every probe/lookup/error message follows.
const GODOT_MCP_PRO_VERSION = "v1.11.0";

// 20-L-cwd: derive the search root from this file's location, not
// process.cwd(). The dev server starts in `apps/api/`, the Docker
// image starts in `/app/`, and a `pnpm dev` from the repo root
// lands somewhere else again. `godot-mcp-pro-${VERSION}/` always
// lives at the repo root, which is 3 levels up from this file. The
// same pattern was applied to llm-service.ts:36 (19-M) and
// shipthis-service.ts:13 (19-L) — extend it here too so all three
// path resolvers agree about where the repo is. Without this, the
// findServerDir fallback at L1172 always returned a path that
// doesn't exist in Docker, and the user's "Setup Godot MCP" button
// in production showed a useless ENOENT error.
const THIS_FILE_DIR = pathDirname(fileURLToPath(import.meta.url));
const REPO_ROOT_FROM_THIS_FILE = resolve(THIS_FILE_DIR, "..", "..", "..");

// Module-level cache for the Godot MCP Pro instructions file. It is a static
// file shipped with the godot-mcp-pro package and never changes during a
// server's lifetime. Read it once at module load and reuse.
let cachedGodotInstructions: string | null | undefined;
export function getGodotInstructions(): string | null {
  if (cachedGodotInstructions !== undefined) return cachedGodotInstructions;
  const instructionsPath = join(REPO_ROOT_FROM_THIS_FILE, "godot-mcp-pro-v1.11.0", "instructions", "CLAUDE.md");
  try {
    cachedGodotInstructions = readFileSync(instructionsPath, "utf-8");
  } catch {
    cachedGodotInstructions = null;
  }
  return cachedGodotInstructions;
}

/** Auto-detect MCP server path from env var or relative paths */
function resolveServerPath(): string {
  // 1. Explicit env var (highest priority).
  // 24-M-env-var-drift: read GODOT_MCP_SERVER_PATH from the
  // Zod-validated config instead of `process.env.GODOT_MCP_SERVER_PATH`
  // directly. The 23rd pass added GODOT_MCP_SERVER_PATH to the env
  // schema (config.ts:60) but didn't migrate this consumer. A future
  // Zod transform (e.g. `z.string().transform(s => path.resolve(s))`)
  // applied to the schema would silently not take effect here.
  const configGodotMcp = loadConfig().GODOT_MCP_SERVER_PATH;
  if (configGodotMcp) {
    return configGodotMcp;
  }

  // 2. Try relative to API root (apps/api) and project root
  // API runs from apps/api, MCP server is in project root. Anchor
  // the search at the repo root derived from this file's location
  // (REPO_ROOT_FROM_THIS_FILE) rather than process.cwd() so the dev
  // server and the Docker image agree about where the package is.
  const candidates = [
    join(REPO_ROOT_FROM_THIS_FILE, `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "server", "build", "index.js"),
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

// 12-H10: tools/list cache. The static GODOT_MCP_TOOL_NAMES set is
// good enough for membership checks (isGodotMCPTool), but the
// authoritative tool list lives on the MCP server. If a future
// refactor switches to dynamic discovery (sending `tools/list` to
// the server instead of using the static set), this cache is where
// the result should land so each service.start() doesn't refetch.
// The shape is: projectId -> { tools, fetchedAt }. Stale entries
// (older than TOOLS_CACHE_TTL_MS) are dropped on read.
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// 26-M-tools-cache-cap: hard cap on cache size. TTL pruning runs
// only on read, so a server that creates many projects over its
// lifetime (e.g. a multi-tenant test rig that spins up 10k projects
// in a few hours, each calling setCachedToolsForProject once) can
// grow the map without bound between reads. Cap at 200 — well above
// any realistic single-tenant project count, and low enough that the
// map stays well under V8's Map performance cliff.
const MAX_TOOLS_CACHE_ENTRIES = 200;
const toolsCache = new Map<string, { tools: LLMTool[]; fetchedAt: number }>();

export function getCachedToolsForProject(projectId: string): LLMTool[] | null {
  const entry = toolsCache.get(projectId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > TOOLS_CACHE_TTL_MS) {
    toolsCache.delete(projectId);
    return null;
  }
  return entry.tools;
}

export function setCachedToolsForProject(projectId: string, tools: LLMTool[]): void {
  toolsCache.set(projectId, { tools, fetchedAt: Date.now() });
  // Cap enforcement: drop oldest entries (Map preserves insertion
  // order) until we're under the limit. Avoids an O(n) pass on
  // every call by checking the size once and short-circuiting on
  // the common case where the cap isn't hit.
  if (toolsCache.size > MAX_TOOLS_CACHE_ENTRIES) {
    const toDrop = toolsCache.size - MAX_TOOLS_CACHE_ENTRIES;
    let dropped = 0;
    for (const key of toolsCache.keys()) {
      if (dropped >= toDrop) break;
      toolsCache.delete(key);
      dropped++;
    }
  }
}

export function clearCachedToolsForProject(projectId: string): void {
  toolsCache.delete(projectId);
}

/** Godot MCP Service — manages the MCP server lifecycle */
export class GodotMCPService {
  private projectId: string;
  private projectPath: string | null = null;
  private serverPath: string;
  private mode: "full" | "lite" | "minimal";
  private timeout: number;
  /** Absolute path of the Godot project (detected from MCP responses) */
  private godotProjectDir: string | null = null;
  /** Workspace-relative path for rewriting Godot paths */
  private workspaceRelativePath: string | null = null;

  constructor(options?: GodotMCPServiceOptions) {
    this.projectId = options?.projectId ?? randomUUID();
    this.projectPath = options?.projectPath ?? null;
    this.workspaceRelativePath = options?.projectPath ?? null;
    this.serverPath = options?.serverPath ?? resolveServerPath();
    this.mode = options?.mode ?? "lite";
    this.timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  private get bridge(): MCPBridge | undefined {
    return getMCPBridge(this.projectId);
  }

  /** Start the MCP server (stdio mode) */
  async start(): Promise<void> {
    if (this.running()) return;

    // Auto-setup: install dependencies and build if needed
    const setupResult = await setupGodotMCPServer();
    if (!setupResult.success) {
      throw new Error(`Failed to setup Godot MCP server: ${setupResult.error}`);
    }

    const modeArgs: string[] = [];
    if (this.mode === "minimal") modeArgs.push("--minimal");
    else if (this.mode === "lite") modeArgs.push("--lite");

    // Spawn MCP server with stdio transport.
    // 12-C13: do NOT inherit the full parent env. The MCP server is a
    // Godot-editor bridge — it only needs to resolve `node` and the
    // Godot binary on PATH. Inheriting the full env leaks the parent
    // process's secrets into a child process.
    const childEnv: NodeJS.ProcessEnv = {};
    if (process.env.PATH) childEnv.PATH = process.env.PATH;
    if (process.env.HOME) childEnv.HOME = process.env.HOME;
    if (process.platform === "win32" && process.env.SYSTEMROOT) {
      childEnv.SYSTEMROOT = process.env.SYSTEMROOT;
    }

    await startMCPBridge(this.projectId, this.projectPath ?? "", {
      command: "node",
      args: [this.serverPath, ...modeArgs],
      env: childEnv,
    });

    logger.info({ mode: this.mode, event: "godot_mcp_start" }, "Service started");
  }

  /** Execute a Godot MCP tool and return the result as a string */
  async executeTool(name: string, params: Record<string, unknown>): Promise<string> {
    if (!this.running()) {
      return `Error: GodotMCPService is not running. Call start() first.`;
    }
    if (!this.bridge?.bridgeInitialized()) {
      return `Error: GodotMCPService is starting up — initialize handshake has not completed. Retry shortly.`;
    }

    try {
      const raw = await this.bridge.executeTool(name, params);
      return this.rewritePaths(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tool: name, error: message, event: "godot_mcp_tool_error" }, `MCP tool error: ${message}`);
      return `Error: ${message}`;
    }
  }

  /** Check if the service is running */
  running(): boolean {
    return this.bridge?.running() ?? false;
  }

  /** Get MCP server status */
  getStatus(): { running: boolean; connected: boolean; mode: string } {
    return {
      running: this.running(),
      connected: this.bridge?.bridgeInitialized() ?? false,
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
      serverRunning: this.running(),
      godotConnected: false,
    };

    if (!result.serverRunning) {
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
      result.error = err instanceof Error ? err.message : String(err);
      return result;
    }
  }

  /** Stop the MCP server and clean up resources */
  async stop(): Promise<void> {
    if (!this.running()) return;

    logger.info({ event: "godot_mcp_stop" }, "Stopping service");
    await stopMCPBridge(this.projectId);
    this.godotProjectDir = null;
    logger.info({ event: "godot_mcp_stopped" }, "Service stopped");
  }

  /**
   * Rewrite absolute file paths from Godot to workspace-relative paths.
   * Godot returns absolute paths like
   *   /Users/cursor/some-folder/godot-test-1/scene.gd        (macOS)
   *   /home/ci-runner/some-folder/godot-test-1/scene.gd      (Linux)
   *   C:\Users\ci-runner\some-folder\godot-test-1\scene.gd   (Windows)
   * We rewrite these to ./workspace/godot-test-1/scene.gd for the LLM.
   */
  private rewritePaths(result: string): string {
    // 10-C7: detect the project directory regardless of host platform.
    // The previous regex was hardcoded to `/Users/...` which only
    // matched macOS. On Linux (Railway, CI) and Windows the regex
    // never matched, so `godotProjectDir` was never set, and the
    // path-rewriter silently no-op'd. Use the home directory from
    // os.homedir() (works on all platforms) as the prefix anchor.
    if (!this.godotProjectDir && this.workspaceRelativePath) {
      const homeDir = os.homedir();
      const escapedHome = homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedProjectName = this.workspaceRelativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Match either POSIX or Windows separators inside the captured prefix.
      // The trailing segment is the project-name; everything before the
      // project-name is the prefix we want to substitute.
      const projectMatch = result.match(
        new RegExp(`(?:${escapedHome}[/\\][^/\\]+(?:[/\\][^/\\]+)*[/\\]${escapedProjectName})[/\\]`),
      );
      if (projectMatch) {
        this.godotProjectDir = projectMatch[0].replace(/[/\\]$/, "");
        logger.info(
          { godotDir: this.godotProjectDir, workspaceRelative: this.workspaceRelativePath, event: "godot_project_dir_detected" },
          "Detected Godot project directory",
        );
      }
    }

    if (!this.godotProjectDir || !this.workspaceRelativePath) {
      return result;
    }

    // Replace the absolute Godot path prefix with workspace-relative path
    // e.g., /home/ci-runner/.../godot-test-1 → ./workspace/godot-test-1
    const relativeWorkspace = `./workspace/${this.workspaceRelativePath}`;
    return result.split(this.godotProjectDir).join(relativeWorkspace);
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
  // 15-H-shutdown-race: short-circuit any race that fires AFTER
  // shutdownAllMCPServices. The shutdown clears both maps but a
  // request in flight that hits the route handler at the wrong
  // moment would still try to spawn a new child. The flag is the
  // belt; the map clear is the suspenders.
  if (shuttingDown) {
    throw new Error("MCP services are shutting down — cannot create new services");
  }
  const existing = activeServices.get(projectId);
  if (existing) return existing;

  // Deduplicate concurrent creation attempts for the same project
  const pending = pendingCreations.get(projectId);
  if (pending) return pending;

  const creationPromise = (async () => {
    try {
      const service = new GodotMCPService({ ...options, projectId });
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
  // 12-H12: also clear the tools cache. Without this, a project
  // that was deleted and re-created with the same id would inherit
  // a stale tools list from the previous instance. The cache TTL
  // (5 minutes) would eventually clear it, but the user would see
  // "tool not found" errors until then. Eager cleanup is cheap.
  clearCachedToolsForProject(projectId);
}

/** Stop all active MCP services (for graceful shutdown) */
export async function shutdownAllMCPServices(): Promise<void> {
  // 15-H-shutdown-race: set the backstop flag FIRST so any in-flight
  // getOrCreate that races past the map check below still throws.
  shuttingDown = true;
  // 15-H-shutdown-race: clear AFTER awaiting the stops, not before.
  // The previous order (clear → await stop) let a concurrent
  // getOrCreateGodotMCPService see an empty map during the stop
  // window, spawn a new child process, and call activeServices.set
  // — leaving two MCP servers running for the same projectId. Now:
  // mark intent first, then await, then clear.
  //
  // 15-H-pending-creations: pendingCreations entries that resolve
  // AFTER shutdown would call activeServices.set on a torn-down map,
  // creating a zombie service that never gets stopped. Drain
  // pendingCreations too so a creation that fires during shutdown
  // doesn't escape.
  const entries = [...activeServices.entries()];
  for (const [, service] of entries) {
    // Best-effort: the service may already be stopping; ignore the
    // race (stop() is idempotent thanks to intentionalStop).
    void service.stop();
  }
  await Promise.allSettled(entries.map(([, service]) => service.stop()));
  // Clear both registries AFTER the await. A getOrCreate that races
  // after this point sees an empty map and would re-spawn; guard
  // against that with the shutdown flag below.
  activeServices.clear();
  pendingCreations.clear();
}

// 15-H-shutdown-race: a getOrCreate call that races AFTER the await
// but BEFORE this function returns would see an empty map and spawn
// a new service. The flag is a belt-and-suspenders backstop — the
// real fix is to clear maps last, but the flag also covers
// pendingCreations that resolve mid-shutdown.
let shuttingDown = false;
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/** Get the active service for a project (null if not running) */
export function getGodotMCPService(projectId: string): GodotMCPService | null {
  return activeServices.get(projectId) ?? null;
}

// ─── Plugin Auto-Installation ──────────────────────────────────────────

import * as fsp from "node:fs/promises";

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
// 16-H-install-plugin-async: previously this used `cpSync` / `readFileSync`
// / `writeFileSync` / `rmSync` synchronously. The Godot MCP plugin folder
// contains 50+ small files; `cpSync` of all of them blocks the Node event
// loop for 100ms+ on slow disks (Docker volumes, NFS, encrypted home
// dirs). The HTTP handler that calls this serialized every other
// incoming request for the duration. Matches the 11-M5 pattern in
// dashboard.ts:writeDemoGodotProject — keep the ergonomics, just yield.
export async function installGodotMCPPlugin(
  projectDir: string,
  workspaceDir: string
): Promise<InstallPluginResult> {
  const result: InstallPluginResult = {
    success: false,
    pluginCopied: false,
    pluginEnabled: false,
  };

  try {
    // Find the godot-mcp-pro addons folder - check multiple possible locations
    const possiblePaths = [
      // Next to workspace (common setup)
      resolve(workspaceDir, "..", `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "addons", "godot_mcp"),
      // Inside workspace
      resolve(workspaceDir, `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "addons", "godot_mcp"),
      // From the repo root (the canonical install location — anchors
      // on this file's location, not process.cwd(), so dev and Docker
      // agree about where the package is).
      resolve(REPO_ROOT_FROM_THIS_FILE, `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "addons", "godot_mcp"),
      // Parent of workspace parent
      resolve(workspaceDir, "..", "..", `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "addons", "godot_mcp"),
    ];

    let sourcePath: string | null = null;
    for (const candidate of possiblePaths) {
      // existsSync is fine here — it's a single stat call, not a recursive
      // copy. Using fsp.access in a loop would multiply the round trips.
      if (existsSync(candidate)) {
        sourcePath = candidate;
        logger.info({ sourcePath: candidate, event: "godot_mcp_plugin_found" }, "Found Godot MCP plugin");
        break;
      }
    }

    if (!sourcePath) {
      result.error = `Godot MCP plugin not found. Searched:\n${possiblePaths.map(p => `  - ${p}`).join("\n")}\n\nMake sure godot-mcp-pro-${GODOT_MCP_PRO_VERSION} is in the project root.`;
      logger.error({ searched: possiblePaths, event: "godot_mcp_plugin_source_missing" }, "Godot MCP plugin source not found");
      return result;
    }

    // Create project's addons directory if it doesn't exist
    const projectAddonsDir = join(projectDir, "addons");
    await fsp.mkdir(projectAddonsDir, { recursive: true });

    // Copy the godot_mcp folder to the project's addons directory
    const projectPluginDir = join(projectAddonsDir, "godot_mcp");

    // Remove existing plugin folder if it exists (for clean reinstall).
    // fsp.rm with force:true is idempotent — no need to existsSync first.
    await fsp.rm(projectPluginDir, { recursive: true, force: true });

    // Copy the plugin files
    await fsp.cp(sourcePath, projectPluginDir, { recursive: true });
    result.pluginCopied = true;
    logger.info({ sourcePath, destPath: projectPluginDir, event: "godot_mcp_plugin_copied" }, "Godot MCP plugin copied");

    // Enable the plugin in project.godot (Godot 4 format)
    const projectGodotPath = join(projectDir, "project.godot");
    let projectGodotContent: string;
    try {
      projectGodotContent = await fsp.readFile(projectGodotPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        result.error = `project.godot not found at ${projectGodotPath}`;
        return result;
      }
      throw err;
    }

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

      await fsp.writeFile(projectGodotPath, projectGodotContent, "utf-8");
      result.pluginEnabled = true;
      logger.info({ projectGodotPath, event: "godot_mcp_plugin_enabled" }, "Godot MCP plugin enabled in project.godot (Godot 4 format)");
    }

    result.success = true;
  } catch (err) {
    const error = err as Error;
    result.error = error.message;
    logger.error({ error: error.message, event: "godot_mcp_plugin_install_failed" }, "Failed to install Godot MCP plugin");
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
// 28-H-godot-mcp-async-read: converted from sync readFileSync to
// async readFile. The function is called from launchGodotEditor
// (every "Launch Godot" click) and previously blocked the event
// loop for the duration of a stat + read. The signature change
// forces the (one) call site to await.
export async function isGodotMCPPluginEnabled(projectDir: string): Promise<boolean> {
  const projectGodotPath = join(projectDir, "project.godot");
  if (!existsSync(projectGodotPath)) return false;

  try {
    const content = await fsp.readFile(projectGodotPath, "utf-8");
    // Check Godot 4 format ([editor_plugins] with plugin.cfg path)
    return content.includes("res://addons/godot_mcp/plugin.cfg");
  } catch {
    return false;
  }
}

// ─── Godot Editor Launch ──────────────────────────────────────────────────

/**
 * Launch the Godot editor with a specific project.
 *
 * Ensures the MCP plugin is installed and enabled in project.godot
 * before launching. Uses Godot 4 [editor_plugins] format.
 */
export async function launchGodotEditor(projectDir: string): Promise<{ success: boolean; pid?: number; error?: string }> {
  const platform = process.platform; // "darwin" | "linux" | "win32"

  // Ensure plugin is installed and enabled before launching
  if (!isGodotMCPPluginInstalled(projectDir) || !(await isGodotMCPPluginEnabled(projectDir))) {
    const config = loadConfig();
    const installResult = await installGodotMCPPlugin(projectDir, config.WORKSPACE_DIR);
    if (!installResult.success) {
      logger.warn({ projectDir, error: installResult.error, event: "godot_mcp_plugin_install_skipped" }, "Could not install/enable Godot MCP plugin before launch");
    }
  }

  // 28-H-godot-mcp-async-exec: converted from sync execFileSync
  // (event-loop block during /proc scan) to async execFileAsync.
  // The pgrep path on macOS/Linux can spike to 30-50ms on busy
  // CI runners; the launchGodotEditor route awaits this directly.
  const isAlreadyRunning = async (): Promise<number | null> => {
    try {
      if (platform === "win32") {
        // Windows: use tasklist
        const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq Godot.exe", "/NH"], { encoding: "utf-8", timeout: 5_000 });
        const match = stdout.match(/Godot\.exe\s+(\d+)/);
        if (match) return parseInt(match[1], 10);
      } else {
        // macOS / Linux: use pgrep. -x matches the exact process name
        // (not a substring), so a system process that happens to contain
        // "Godot" in its full command line doesn't get matched.
        const { stdout } = await execFileAsync("pgrep", ["-xi", "Godot"], { encoding: "utf-8", timeout: 5_000 });
        const trimmed = stdout.trim();
        if (trimmed) return parseInt(trimmed.split("\n")[0], 10);
      }
    } catch {
      // Process not found — proceed to launch
    }
    return null;
  };

  const existingPid = await isAlreadyRunning();
  if (existingPid) {
    logger.info({ projectDir, existingPid, event: "godot_editor_already_running" }, "Godot editor already running, skipping launch");
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

  // Check env var override first (highest priority).
  // 24-M-env-var-drift-schema-orphan: GODOT_EDITOR_PATH is read
  // here but was missing from the Zod schema entirely. The schema
  // listed GODOT_BIN but not GODOT_EDITOR_PATH — the runtime and
  // the schema disagreed about what the env var is *named*. Add
  // GODOT_EDITOR_PATH to the schema (see config.ts:67 in this
  // commit) and consume the validated value here so the single
  // Zod-validated path is the only one.
  let godotBin: string | null = loadConfig().GODOT_EDITOR_PATH || null;

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

    logger.info({ godotBin, projectDir, pid: proc.pid, event: "godot_editor_launched" }, "Godot editor launched");
    return { success: true, pid: proc.pid };
  } catch (err) {
    const error = err as Error;
    logger.error({ error: error.message, godotBin, projectDir, event: "godot_editor_launch_failed" }, "Failed to launch Godot editor");
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
  // Anchor at the repo root derived from this file's location
  // (REPO_ROOT_FROM_THIS_FILE) — see 20-L-cwd above. process.cwd()
  // varies between `apps/api/` (dev) and `/app/` (Docker), so any
  // candidate built from it produces a non-existent path in
  // production. The versioned directory is the canonical install
  // location; the unversioned `godot-mcp-pro` directory is kept as
  // a fallback for someone who cloned the package without the
  // version suffix.
  const candidates = [
    resolve(REPO_ROOT_FROM_THIS_FILE, `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`, "server"),
    resolve(REPO_ROOT_FROM_THIS_FILE, "godot-mcp-pro", "server"),
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
// 28-H-godot-mcp-async-exec: signature now async to accommodate
// the awaited execFileAsync calls in the body. The route handler
// already awaits this (POST /api/dashboard/setup-server) so the
// call-site change is zero-impact.
export async function setupGodotMCPServer(
  onProgress?: (stage: string) => void
): Promise<SetupServerResult> {
  const result: SetupServerResult = {
    success: false,
    installed: false,
    built: false,
  };

  try {
    const serverDir = findServerDir();
    if (!serverDir) {
      // 20-L-cwd: surface the actual repo root we searched, not a
      // process.cwd() that the operator can't interpret in Docker.
      const repoRoot = REPO_ROOT_FROM_THIS_FILE;
      result.error = `Could not find godot-mcp-pro server directory.\nSearched in:\n  - ${repoRoot}/godot-mcp-pro-${GODOT_MCP_PRO_VERSION}/server\n  - ${repoRoot}/godot-mcp-pro/server\n\nMake sure godot-mcp-pro-${GODOT_MCP_PRO_VERSION} is in the project root.`;
      logger.error({ searched: [resolve(repoRoot, `godot-mcp-pro-${GODOT_MCP_PRO_VERSION}`), resolve(repoRoot, "godot-mcp-pro")], event: "godot_mcp_server_missing" }, "Godot MCP server not found");
      return result;
    }

    logger.info({ serverDir, event: "godot_mcp_server_found" }, "Found Godot MCP server");

    // Step 1: Install dependencies if needed
    if (!isDependenciesInstalled(serverDir)) {
      onProgress?.("Installing npm dependencies...");
      logger.info({ serverDir, event: "godot_mcp_npm_install_started" }, "Installing npm dependencies");
      try {
        // 28-H-godot-mcp-async-exec: execFileAsync instead of
        // execFileSync. execFile passes argv as a vector — no shell
        // interpolation (a `execSync` shell route would be a small
        // attack surface for any env that can write into serverDir).
        // Async because `npm install` blocks the event loop for up
        // to 2 minutes; the route handler awaits this directly.
        // (stdio: "pipe" is the default for promisified execFile;
        // explicit stdio was rejected by the type signature.)
        await execFileAsync("npm", ["install"], {
          cwd: serverDir,
          timeout: 120000, // 2 minute timeout
        });
        result.installed = true;
        logger.info({ serverDir, event: "godot_mcp_npm_install_completed" }, "npm install completed");
      } catch (err) {
        result.error = `npm install failed: ${(err as Error).message}`;
        logger.error({ error: result.error, serverDir, event: "godot_mcp_npm_install_failed" }, "npm install failed");
        return result;
      }
    } else {
      result.installed = true;
    }

    // Step 2: Build if needed
    if (!isServerBuilt(serverDir)) {
      onProgress?.("Building TypeScript...");
      logger.info({ serverDir, event: "godot_mcp_npm_build_started" }, "Building TypeScript");
      try {
        // 28-H-godot-mcp-async-exec: same as above for `npm run build`.
        await execFileAsync("npm", ["run", "build"], {
          cwd: serverDir,
          timeout: 120000, // 2 minute timeout
        });
        result.built = true;
        logger.info({ serverDir, event: "godot_mcp_npm_build_completed" }, "npm run build completed");
      } catch (err) {
        result.error = `npm run build failed: ${(err as Error).message}`;
        logger.error({ error: result.error, serverDir, event: "godot_mcp_npm_build_failed" }, "npm run build failed");
        return result;
      }
    } else {
      result.built = true;
    }

    result.success = true;
  } catch (err) {
    result.error = (err as Error).message;
    logger.error({ error: result.error, event: "godot_mcp_server_setup_failed" }, "Server setup failed");
  }

  return result;
}