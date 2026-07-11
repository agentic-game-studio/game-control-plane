import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";

/**
 * Generic MCP bridge configuration. Describes the command to spawn, its
 * arguments, and an optional environment / working directory.
 */
export interface ToolBridgeConfig {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface MCPRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

interface MCPResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: MCPError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: NodeJS.Timeout;
}

function isMCPError(value: unknown): value is MCPError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "number" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function isMCPResponse(value: unknown): value is MCPResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "jsonrpc" in value &&
    value.jsonrpc === "2.0" &&
    "id" in value &&
    typeof value.id === "string" &&
    (!("error" in value) ||
      value.error === undefined ||
      value.error === null ||
      isMCPError(value.error))
  );
}

function isTextContentItem(item: unknown): item is { type: "text"; text: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "text" &&
    "text" in item &&
    typeof item.text === "string"
  );
}

function isImageContentItem(item: unknown): item is { type: "image"; data: string; mimeType?: string } {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "image" &&
    "data" in item &&
    typeof item.data === "string"
  );
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BUFFER = 1024 * 1024;

const activeBridges = new Map<string, MCPBridge>();
const pendingStarts = new Map<string, Promise<MCPBridge>>();

/**
 * A single MCP bridge: one stdio child process speaking JSON-RPC. This class
 * is engine-agnostic; it does not know whether the child is Godot, Phaser, or
 * any other engine.
 */
export class MCPBridge {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private isRunning = false;
  private initialized = false;
  private stdoutBuffer = "";
  private intentionalStop = false;

  constructor(
    readonly projectId: string,
    readonly projectPath: string,
    private readonly config: ToolBridgeConfig,
    private readonly timeout = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Start the child process and complete the MCP initialize handshake. */
  async start(): Promise<void> {
    if (this.isRunning) return;

    if (this.process) {
      logger.warn(
        { event: "mcp_start_reentry_cleanup", projectId: this.projectId },
        "start() called with orphaned process — cleaning up before re-spawn",
      );
      this.cleanup();
    }

    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.config.env ?? process.env,
      cwd: this.config.cwd,
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();

      if (this.stdoutBuffer.length > MAX_STDOUT_BUFFER) {
        const excess = this.stdoutBuffer.length - MAX_STDOUT_BUFFER;
        const lastNewline = this.stdoutBuffer.indexOf("\n", excess);
        if (lastNewline === -1) {
          this.stdoutBuffer = this.stdoutBuffer.slice(excess);
          logger.warn(
            { event: "mcp_buffer_overflow_no_newline", projectId: this.projectId },
            "MCP stdout buffer overflow with no newline — dropped pre-excess data",
          );
        } else {
          this.stdoutBuffer = this.stdoutBuffer.slice(lastNewline + 1);
          logger.warn(
            { event: "mcp_buffer_overflow", projectId: this.projectId },
            "MCP stdout buffer overflow — dropped data up to last newline",
          );
        }
      }

      this.processStdout();
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      logger.info(
        { event: "mcp_stderr", line: chunk.toString(), projectId: this.projectId },
        "MCP stderr",
      );
    });

    this.process.on("exit", (code, signal) => {
      if (this.intentionalStop) {
        logger.info(
          { event: "mcp_exit_clean", code, signal, projectId: this.projectId },
          "MCP bridge stopped cleanly",
        );
      } else {
        logger.warn(
          { event: "mcp_exit", code, signal, projectId: this.projectId },
          "MCP bridge exited unexpectedly",
        );
      }
      this.cleanup();
    });

    this.process.on("error", (err) => {
      logger.error(
        { event: "mcp_process_error", error: err.message, projectId: this.projectId },
        "MCP process error",
      );
      this.cleanup();
    });

    try {
      await this.sendInitializeHandshake();
      this.initialized = true;
      // Notify the server that the client is initialized. This is required by
      // the MCP protocol and lets long-running servers begin accepting calls.
      try {
        this.process.stdin?.write(
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
        );
      } catch {
        /* non-fatal — some servers ignore this notification anyway */
      }
    } catch (initErr) {
      logger.warn(
        {
          event: "mcp_init_failed",
          error: initErr instanceof Error ? initErr.message : String(initErr),
          projectId: this.projectId,
        },
        "MCP initialize handshake did not complete — bridge will start in degraded mode",
      );
    }

    this.isRunning = true;
    logger.info(
      { event: "mcp_bridge_started", projectId: this.projectId },
      "MCP bridge started",
    );
  }

  private sendInitializeHandshake(): Promise<unknown> {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const id = randomUUID();
    const timer = setTimeout(
      () => reject(new Error("MCP initialize handshake timed out after 5s")),
      5000,
    );

    this.pendingRequests.set(id, {
      resolve: (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
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
      reject(writeErr instanceof Error ? writeErr : new Error(String(writeErr)));
    }

    return promise;
  }

  private processStdout(): void {
    const lines = this.stdoutBuffer.split("\n");
    this.stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      if (!line.startsWith("{")) {
        if (line.includes("[MCP]") || line.includes("error") || line.includes("Error")) {
          logger.info(
            { event: "mcp_stdout", line, projectId: this.projectId },
            `MCP stdout: ${line}`,
          );
        }
        continue;
      }

      try {
        const parsed = JSON.parse(line) as unknown;
        if (!isMCPResponse(parsed)) continue;

        const pending = parsed.id ? this.pendingRequests.get(parsed.id) : undefined;
        if (!pending) continue;

        clearTimeout(pending.timeout);
        this.pendingRequests.delete(parsed.id);

        if (parsed.error) {
          logger.error(
            {
              event: "mcp_response_error",
              id: parsed.id,
              error: parsed.error,
              projectId: this.projectId,
            },
            `MCP error response: ${JSON.stringify(parsed.error)}`,
          );
          pending.reject(new Error(`${parsed.error.code}: ${parsed.error.message}`));
        } else {
          logger.info(
            { event: "mcp_response", id: parsed.id, projectId: this.projectId },
            `MCP response received for id: ${parsed.id}`,
          );
          pending.resolve(parsed.result);
        }
      } catch {
        // Not JSON — ignore
      }
    }
  }

  private async sendRequest(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.process?.stdin || !this.process?.stdout) {
      throw new Error("MCP bridge process not running (stdin/stdout not available)");
    }

    const id = randomUUID();
    const request: MCPRequest = { jsonrpc: "2.0", id, method, params };

    logger.info(
      { event: "mcp_request", method, id, projectId: this.projectId },
      `Sending MCP request: ${method}`,
    );

    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      try {
        const cancelNotification = {
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { id, reason: "client timeout" },
        };
        this.process!.stdin!.write(JSON.stringify(cancelNotification) + "\n");
      } catch (cancelErr) {
        logger.warn(
          {
            event: "mcp_cancel_write_failed",
            method,
            id,
            err: cancelErr instanceof Error ? cancelErr.message : String(cancelErr),
            projectId: this.projectId,
          },
          "Failed to send MCP cancel notification",
        );
      }
      logger.error(
        { event: "mcp_timeout", method, id, projectId: this.projectId },
        `MCP request timed out: ${method}`,
      );
      reject(new Error(`Request '${method}' timed out after ${this.timeout}ms`));
    }, this.timeout);

    this.pendingRequests.set(id, { resolve, reject, timeout });

    try {
      this.process!.stdin!.write(JSON.stringify(request) + "\n");
    } catch (err) {
      clearTimeout(timeout);
      this.pendingRequests.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }

    return promise;
  }

  /**
   * Execute a tool on the MCP bridge. Returns a string formatted for LLM
   * consumption. Errors are surfaced as strings beginning with "Error:".
   */
  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    if (!this.isRunning) {
      return `Error: MCP bridge is not running. Call start() first.`;
    }
    if (!this.initialized) {
      return `Error: MCP bridge is starting up — initialize handshake has not completed. Retry shortly.`;
    }

    try {
      const result = await this.sendRequest("tools/call", {
        name,
        arguments: input,
      });

      return this.formatResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: "mcp_tool_error", tool: name, error: message, projectId: this.projectId },
        `MCP tool error: ${message}`,
      );
      return `Error: ${message}`;
    }
  }

  private formatResult(result: unknown): string {
    if (result === undefined || result === null) {
      return JSON.stringify({ success: true });
    }

    if (typeof result === "string") {
      return result;
    }

    if (
      typeof result === "object" &&
      result !== null &&
      "content" in result &&
      Array.isArray(result.content)
    ) {
      const parts: string[] = [];
      for (const item of result.content) {
        if (isTextContentItem(item)) {
          parts.push(item.text);
        } else if (isImageContentItem(item)) {
          const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
          const sizeKB = Math.round(item.data.length * 0.75 / 1024);
          parts.push(`[Image: ${sizeKB}KB, mime=${mimeType}]`);
        }
      }
      return parts.join("\n") || JSON.stringify(result);
    }

    return JSON.stringify(result, null, 2);
  }

  /** Stop the bridge and clean up resources. */
  async stop(): Promise<void> {
    if (!this.isRunning) return;

    logger.info({ event: "mcp_bridge_stop", projectId: this.projectId }, "Stopping MCP bridge");
    this.intentionalStop = true;

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP bridge stopped"));
    }
    this.pendingRequests.clear();

    if (this.process) {
      const proc = this.process;
      try {
        proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown" }) + "\n");
      } catch {
        /* ignore — process may already be dead */
      }
      proc.kill("SIGTERM");
      this.process = null;

      const forceKillTimer = setTimeout(() => {
        try {
          if (proc.exitCode !== null || proc.killed) return;
          if (proc.kill("SIGKILL")) {
            logger.warn(
              { event: "mcp_force_kill", pid: proc.pid, projectId: this.projectId },
              "Force-killed hung MCP bridge process",
            );
          }
        } catch {
          /* already dead */
        }
      }, 5000);
      forceKillTimer.unref();

      proc.once("exit", () => {
        clearTimeout(forceKillTimer);
      });
    }

    this.isRunning = false;
    this.initialized = false;
    logger.info(
      { event: "mcp_bridge_stopped", projectId: this.projectId },
      "MCP bridge stopped",
    );
  }

  private cleanup(): void {
    this.isRunning = false;
    this.initialized = false;
    this.process = null;

    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("MCP bridge process exited"));
    }
    this.pendingRequests.clear();
    this.stdoutBuffer = "";
  }

  /** Whether the bridge process is running. */
  running(): boolean {
    return this.isRunning;
  }

  /** Whether the initialize handshake completed. */
  bridgeInitialized(): boolean {
    return this.initialized;
  }

  /** Status summary for dashboards and health checks. */
  getStatus(): { running: boolean; connected: boolean } {
    return { running: this.isRunning, connected: this.initialized };
  }
}

/** Start an MCP bridge for a project. Reuses an existing running bridge. */
export async function startMCPBridge(
  projectId: string,
  projectPath: string,
  config: ToolBridgeConfig,
): Promise<MCPBridge> {
  const existing = activeBridges.get(projectId);
  if (existing?.running()) return existing;

  const pending = pendingStarts.get(projectId);
  if (pending) return pending;

  const startPromise = (async () => {
    try {
      const bridge = new MCPBridge(projectId, projectPath, config);
      await bridge.start();
      activeBridges.set(projectId, bridge);
      return bridge;
    } finally {
      pendingStarts.delete(projectId);
    }
  })();

  pendingStarts.set(projectId, startPromise);
  return startPromise;
}

/** Stop an MCP bridge for a project and remove it from the registry. */
export async function stopMCPBridge(projectId: string): Promise<void> {
  const bridge = activeBridges.get(projectId);
  if (bridge) {
    await bridge.stop();
    activeBridges.delete(projectId);
  }
}

/** Get an active MCP bridge, or undefined if none is running. */
export function getMCPBridge(projectId: string): MCPBridge | undefined {
  return activeBridges.get(projectId);
}

/** List project IDs with active MCP bridges. */
export function listMCPBridges(): string[] {
  return Array.from(activeBridges.keys());
}

/** Stop all active bridges. Useful for graceful shutdown. */
export async function shutdownAllMCPBridges(): Promise<void> {
  const ids = listMCPBridges();
  for (const id of ids) {
    await stopMCPBridge(id);
  }
}
