import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { createServer } from "net";
import { GodotConnectionError, GodotCommandError, TimeoutError, } from "./utils/errors.js";
const BASE_PORT = 6505;
const MAX_PORT = 6509;
const COMMAND_TIMEOUT_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 10000;
/** Check if a port is available */
function isPortFree(port) {
    return new Promise((resolve) => {
        const server = createServer();
        server.once("error", () => resolve(false));
        server.once("listening", () => {
            server.close(() => resolve(true));
        });
        server.listen(port, "127.0.0.1");
    });
}
export class GodotConnection {
    wss = null;
    client = null;
    port;
    fixedPort;
    pendingRequests = new Map();
    heartbeatTimer = null;
    constructor(port = BASE_PORT, fixedPort = false) {
        this.port = port;
        this.fixedPort = fixedPort;
    }
    /** Start WebSocket server on first available port in range */
    async connect() {
        if (this.wss)
            return;
        let chosenPort = this.port;
        if (this.fixedPort) {
            // When port is explicitly configured, check if it's available first
            if (!(await isPortFree(this.port))) {
                console.error(`[MCP] Warning: Configured port ${this.port} is already in use (possibly a stale MCP server process). ` +
                    `Try removing the explicit GODOT_MCP_PORT from your config to use auto-scanning, ` +
                    `or kill the process occupying port ${this.port}.`);
            }
            chosenPort = this.port;
        }
        else {
            // Auto-scan for first available port in range
            for (let p = BASE_PORT; p <= MAX_PORT; p++) {
                if (await isPortFree(p)) {
                    chosenPort = p;
                    break;
                }
                if (p === MAX_PORT) {
                    console.error(`[MCP] All ports ${BASE_PORT}-${MAX_PORT} are in use. Trying configured port ${this.port} anyway.`);
                    chosenPort = this.port;
                }
            }
        }
        this.port = chosenPort;
        return new Promise((resolve, reject) => {
            this.wss = new WebSocketServer({ port: this.port, host: "127.0.0.1" });
            this.wss.on("listening", () => {
                console.error(`[MCP] WebSocket server listening on ws://127.0.0.1:${this.port}`);
                resolve();
            });
            this.wss.on("error", (err) => {
                console.error("[MCP] WebSocket server error:", err.message);
                reject(err);
            });
            this.wss.on("connection", (ws) => {
                console.error("[MCP] Godot editor connected");
                if (this.client) {
                    this.client.close(1000, "Replaced by new connection");
                }
                this.client = ws;
                this.startHeartbeat();
                ws.on("message", (data) => {
                    this.handleMessage(data.toString());
                });
                ws.on("close", () => {
                    console.error("[MCP] Godot editor disconnected");
                    if (this.client === ws) {
                        this.client = null;
                        this.stopHeartbeat();
                        this.rejectAllPending(new GodotConnectionError("Godot disconnected"));
                    }
                });
                ws.on("error", (err) => {
                    console.error("[MCP] WebSocket error:", err.message);
                });
            });
        });
    }
    disconnect() {
        this.stopHeartbeat();
        if (this.client) {
            this.client.close(1000, "Server shutting down");
            this.client = null;
        }
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        this.rejectAllPending(new GodotConnectionError("Server shut down"));
    }
    isConnected() {
        return this.client?.readyState === WebSocket.OPEN;
    }
    getPort() {
        return this.port;
    }
    async sendCommand(method, params = {}) {
        if (!this.isConnected()) {
            throw new GodotConnectionError("Godot editor is not connected. Make sure the Godot MCP Pro plugin is enabled and the editor is running.");
        }
        const id = randomUUID();
        const request = {
            jsonrpc: "2.0",
            method,
            params,
            id,
        };
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new TimeoutError(method, COMMAND_TIMEOUT_MS));
            }, COMMAND_TIMEOUT_MS);
            this.pendingRequests.set(id, {
                resolve: resolve,
                reject,
                timer,
            });
            this.client.send(JSON.stringify(request));
        });
    }
    handleMessage(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        }
        catch {
            console.error("[MCP] Failed to parse message from Godot:", data);
            return;
        }
        if (msg.method === "pong") {
            return;
        }
        if (!msg.id)
            return;
        const pending = this.pendingRequests.get(msg.id);
        if (!pending)
            return;
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
            pending.reject(new GodotCommandError(msg.error.code, msg.error.message, msg.error.data));
        }
        else {
            pending.resolve(msg.result);
        }
    }
    rejectAllPending(error) {
        for (const [, pending] of this.pendingRequests) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.isConnected()) {
                this.client.send(JSON.stringify({ jsonrpc: "2.0", method: "ping", params: {} }));
            }
        }, HEARTBEAT_INTERVAL_MS);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
}
//# sourceMappingURL=godot-connection.js.map