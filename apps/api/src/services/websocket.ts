import { WebSocketServer, WebSocket } from "ws";
import type { WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

export const wss = new WebSocketServer({ noServer: true });

// 30-second ping/pong heartbeat. Sockets that don't respond to a ping within
// 10s are terminated and removed from wss.clients — this prevents the client
// set from accumulating dead sockets that silently fail on every broadcast.
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
// 12-C12: the "dead socket" timeout must be longer than the sweep interval.
// Sweeps run every HEARTBEAT_INTERVAL_MS, so the *next* sweep after a ping
// fires HEARTBEAT_INTERVAL_MS later. We then need up to HEARTBEAT_TIMEOUT_MS
// for the pong to make it back. If we use HEARTBEAT_TIMEOUT_MS alone as the
// grace threshold (the previous bug), the very next sweep — 30s after the
// ping, well past the 10s grace — would always pass the grace check and
// terminate the socket, killing every connection on its second sweep
// regardless of whether a pong was in flight.
const DEAD_TIMEOUT_MS = HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS;

export const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const ws = client as WebSocket & { isAlive?: boolean; firstPingAt?: number };
    // A new connection that hasn't yet been pinged has isAlive=true and
    // firstPingAt undefined. We use that to skip the terminate check on
    // the *next* sweep (when firstPingAt has been set but no pong has
    // arrived). This avoids a 30s-after-connect race where a slow client
    // (proxy wakeup, mobile backgrounded tab) loses its connection
    // before its first pong can land.
    if (ws.isAlive === false) {
      if (ws.firstPingAt && Date.now() - ws.firstPingAt < DEAD_TIMEOUT_MS) {
        // First ping is still within its grace window — give it more
        // time. Without this, any connect-in-the-last-30s that hasn't
        // yet ponged gets killed on the very next sweep.
        continue;
      }
      // Previous ping got no pong and grace is exhausted — assume the
      // socket is dead and drop it.
      try { client.terminate(); } catch { /* already gone */ }
      continue;
    }
    ws.isAlive = false;
    ws.firstPingAt = Date.now();
    try { client.ping(); } catch { /* race with close — ignore */ }
  }
}, HEARTBEAT_INTERVAL_MS);
heartbeatInterval.unref();

wss.on("connection", (socket) => {
  const ws = socket as WebSocket & { isAlive?: boolean; firstPingAt?: number };
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
    ws.firstPingAt = undefined;
  });
  // 10-C5: an `error` event with no listener throws `Unhandled 'error'
  // event` in Node's EventEmitter and crashes the process. ECONNRESET,
  // TLS hiccups, and broken pipes all surface here. Clean up the set so
  // the next broadcast doesn't try to send to a half-dead socket.
  ws.on("error", (err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), event: "ws_client_error" },
      "WebSocket client error — terminating",
    );
    try { ws.terminate(); } catch { /* already gone */ }
    wss.clients.delete(ws);
  });
  // Belt-and-suspenders: also clean up the set on close (the heartbeat
  // interval will eventually catch zombies, but explicit cleanup is faster).
  ws.on("close", () => {
    wss.clients.delete(ws);
  });
});

// 12-H7: max queued bytes per client before we treat them as a slow
// consumer. The `ws` library buffers send() calls in the OS socket
// write buffer. If a client is slow (bad network, paused devtools,
// mobile backgrounded tab), the buffer grows unbounded and the process
// RSS climbs. Track buffered bytes and terminate the client if it
// exceeds the cap — better to drop one slow client than to OOM the
// process for everyone. 1MB is well above any single event payload
// (the largest is the assistant message at ~64KB) and below the
// default `ws` library's `maxPayload` of 100MB.
const MAX_BUFFERED_BYTES_PER_CLIENT = 1_000_000;

// 16-H-broadcast-oom: per-client buffered-bytes cap protects
// against a slow consumer, but the cap is checked AFTER
// JSON.stringify. A single 50MB event would allocate 50MB
// across every connected client before the per-client check
// could drop the slow ones. Cap the event payload by serialized
// size before stringify — anything above 1MB is almost certainly
// a runaway assistant message or a misuse, and is dropped with a
// logged warning so the operator can investigate.
const MAX_BROADCAST_BYTES = 1_000_000;

export function broadcast(event: WSEvent) {
  // Fast path: serialize once, check size. If too large, drop and log.
  let message: string;
  try {
    message = JSON.stringify(event);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), event: "ws_serialize_failed" },
      "Failed to serialize WebSocket event — dropping broadcast",
    );
    return;
  }
  if (Buffer.byteLength(message) > MAX_BROADCAST_BYTES) {
    logger.warn(
      { sizeBytes: Buffer.byteLength(message), cap: MAX_BROADCAST_BYTES, eventType: event.type, event: "ws_event_too_large" },
      "WebSocket event exceeds size cap — dropping to protect process memory",
    );
    return;
  }
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      // Non-OPEN sockets shouldn't be in the set at all, but be defensive.
      wss.clients.delete(client);
      continue;
    }
    // Slow-consumer guard. `client.bufferedAmount` is the number of
    // bytes queued in the OS socket write buffer. Check the projected
    // total (current buffer + the message we're about to queue) so a
    // borderline client doesn't get a message that pushes it well past
    // the cap before the next iteration catches up.
    const projectedBuffered = client.bufferedAmount + Buffer.byteLength(message);
    if (projectedBuffered > MAX_BUFFERED_BYTES_PER_CLIENT) {
      logger.warn(
        { buffered: client.bufferedAmount, projected: projectedBuffered, cap: MAX_BUFFERED_BYTES_PER_CLIENT, event: "ws_slow_consumer_terminated" },
        "WebSocket client exceeded max buffered bytes — terminating to protect process memory",
      );
      try { client.terminate(); } catch { /* already gone */ }
      wss.clients.delete(client);
      continue;
    }
    try {
      client.send(message);
    } catch {
      // Client disconnected during broadcast — terminate and remove so we
      // don't keep retrying a dead socket on every subsequent broadcast.
      try { client.terminate(); } catch { /* already gone */ }
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
  // 12-H18: per-client close hook invoked during graceful shutdown
  // so the heartbeat interval is cleared and the underlying
  // response is ended. Without this, the shutdown path calls
  // `client.send("")` and clears the set, but leaves the heartbeat
  // timer running and the response un-ended — the timer keeps
  // Node alive past the force-exit deadline in some cases, and the
  // leaked timer can fire a write on a socket that the process has
  // already declared closed.
  close?: () => void;
}

export const sseClients = new Set<SSEClient>();
