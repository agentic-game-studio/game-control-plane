import { WebSocketServer, WebSocket } from "ws";
import type { WSEvent } from "@game-studio/types";

export const wss = new WebSocketServer({ noServer: true });

// 30-second ping/pong heartbeat. Sockets that don't respond to a ping within
// 10s are terminated and removed from wss.clients — this prevents the client
// set from accumulating dead sockets that silently fail on every broadcast.
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const ws = client as WebSocket & { isAlive?: boolean };
    if (ws.isAlive === false) {
      // Previous ping got no pong — assume the socket is dead and drop it.
      try { client.terminate(); } catch { /* already gone */ }
      continue;
    }
    ws.isAlive = false;
    try { client.ping(); } catch { /* race with close — ignore */ }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref();

wss.on("connection", (socket) => {
  const ws = socket as WebSocket & { isAlive?: boolean };
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  // Belt-and-suspenders: also clean up the set on close (the heartbeat
  // interval will eventually catch zombies, but explicit cleanup is faster).
  ws.on("close", () => {
    wss.clients.delete(ws);
  });
});

export function broadcast(event: WSEvent) {
  const message = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch {
        // Client disconnected during broadcast — terminate and remove so we
        // don't keep retrying a dead socket on every subsequent broadcast.
        try { client.terminate(); } catch { /* already gone */ }
        wss.clients.delete(client);
      }
    } else {
      // Non-OPEN sockets shouldn't be in the set at all, but be defensive.
      wss.clients.delete(client);
    }
  }
}

/**
 * Broadcast session update to frontend (progress, status changes)
 */
export function broadcastSessionUpdate(sessionId: string, updates: { progress?: number; status?: string }) {
  broadcast({
    type: "chat:session:updated",
    sessionId,
    session: updates,
  } as WSEvent);
}

// SSE client tracking
interface SSEClient {
  sessionId: string;
  id: string;
  send: (data: string) => void;
}

export const sseClients = new Set<SSEClient>();
