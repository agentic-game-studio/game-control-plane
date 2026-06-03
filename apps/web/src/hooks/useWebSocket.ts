"use client";
import { useEffect, useRef, useState } from "react";
import type { WSEvent } from "@game-studio/types";
import { WS_PING_INTERVAL_MS, WS_RECONNECT_DELAY_MS } from "@/lib/timing";
import { createLogger } from "@/lib/logger";

const logger = createLogger("useWebSocket");

// 10-H12: singleton WebSocket connection shared across all useWebSocket
// callers. Previously every hook (useAgents, useSkills, useDashboard,
// useGates, useSettings, useTeams, useAssets, useCommandRoom,
// useAutonomousLoop, ProjectContext, plus per-page hooks) opened its
// own connection — a single mounted page could hold 10+ concurrent
// sockets on the server. Now there's one connection per browser tab
// and each hook subscribes/unsubscribes from a shared event bus.
type Listener = (event: WSEvent) => void;
type ConnectionStateListener = (connected: boolean) => void;

let sharedSocket: WebSocket | null = null;
let sharedConnected = false;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
const eventListeners = new Set<Listener>();
const stateListeners = new Set<ConnectionStateListener>();

function notifyConnected(connected: boolean): void {
  sharedConnected = connected;
  for (const cb of stateListeners) {
    try { cb(connected); } catch { /* listener error */ }
  }
}

function dispatchEvent(event: WSEvent): void {
  for (const cb of eventListeners) {
    try { cb(event); } catch { /* listener error */ }
  }
}

function connect(): void {
  if (typeof window === "undefined") return;
  if (sharedSocket && (sharedSocket.readyState === WebSocket.OPEN || sharedSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? apiUrl.replace(/^http/, "ws");
  const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "";

  try {
    const ws = new WebSocket(`${wsUrl}/ws${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ""}`);
    sharedSocket = ws;

    ws.onopen = () => {
      notifyConnected(true);
      reconnectAttempt = 0;
      if (pingInterval) clearInterval(pingInterval);
      // 12-C4: capture the local interval handle in addition to the
      // module-global. If a stale onclose (from a previous socket)
      // happens to fire *after* we've installed a new interval, the
      // `stillCurrent && pingInterval` cleanup below would clear OUR
      // interval and leave the live socket without a heartbeat. The
      // local handle + sharedSocket guard inside the timer body
      // ensures the interval can't outlive its own socket.
      const myInterval: ReturnType<typeof setInterval> = setInterval(() => {
        // Only ping if THIS socket is still the active one and is OPEN.
        // Without the `sharedSocket === ws` check, an old interval that
        // somehow escaped cleanup could try to send on a dead socket
        // (no-op) or, worse, race with a partially-replaced ws ref.
        if (sharedSocket !== ws || ws.readyState !== WebSocket.OPEN) {
          clearInterval(myInterval);
          return;
        }
        try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* socket died */ }
      }, WS_PING_INTERVAL_MS);
      pingInterval = myInterval;
    };

    ws.onmessage = (msg) => {
      try {
        dispatchEvent(JSON.parse(msg.data) as WSEvent);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = (event) => {
      // 11-H9: guard every shared-state mutation with `sharedSocket === ws`
      // so a late onclose from the OLD socket can't clobber the NEW
      // socket's ping interval and reconnect state. Without this check,
      // when the network blip dropped socket A while reconnect was in
      // flight, A's onclose would fire *after* B's onopen had already
      // (re)set pingInterval, and A's stale callback would null out
      // B's interval — leaving the live socket with no keepalive and
      // getting disconnected by the server 60s later.
      const stillCurrent = sharedSocket === ws;
      // 19-H-ws-stale-disconnect: guard `notifyConnected(false)` on
      // stillCurrent too. The previous code flipped the global
      // `sharedConnected = false` unconditionally, so a late
      // onclose from socket A (after socket B's onopen had
      // already set it to true) would re-flip to false. The UI
      // would render "disconnected" while the live socket B was
      // OPEN, gating connection-aware features (the
      // connection-status dot, the WS-gated tool calls) on a
      // false signal. React StrictMode's double-mount triggers
      // this on every reconnect because the mount-1 socket
      // closes *after* the mount-2 socket is already OPEN.
      if (stillCurrent) {
        notifyConnected(false);
        if (pingInterval) {
          clearInterval(pingInterval);
          pingInterval = null;
        }
      }
      // 12-H13: detect auth failure on close. The server-side WS
      // auth in apps/api/src/services/websocket.ts closes the
      // connection with code 1008 (policy violation) when the apiKey
      // query param doesn't match. Without this detection, a
      // rotated API_SECRET (or a stale browser cache with the old
      // NEXT_PUBLIC_API_KEY) would cause an infinite reconnect
      // loop — every reconnect sends the same bad key, server
      // closes again, client backs off and retries. The exponential
      // backoff makes this look like "connection is unstable" to
      // the user, who has no way to know it's a credential issue.
      // Detect close code 1008 on the FIRST close, surface a
      // one-time warning, and stop reconnecting (the user must
      // refresh with a new key).
      if (event.code === 1008 && reconnectAttempt === 0) {
        // 15-L-usewebsocket-console-warn: every other module routes
        // through the pino-backed createLogger, but this hook was
        // using a raw console.warn — so a WS auth failure showed up
        // nowhere in the structured logs the dashboard operator
        // actually reads. Use the logger so it shows up in the
        // browser console, the file transport, and the request-
        // correlation prefix the rest of the codebase gets for free.
        logger.warn(
          "WS auth failed (close code 1008) — check NEXT_PUBLIC_API_KEY matches server's API_SECRET. " +
          "Reconnect attempts will continue but the key needs to be updated.",
          { event: "ws_auth_failed", closeCode: 1008 },
        );
      }
      if (!stillCurrent) return;
      // Only reconnect if there are still active subscribers — otherwise
      // we'd loop forever on a page that's been unmounted.
      if (eventListeners.size === 0 && stateListeners.size === 0) {
        sharedSocket = null;
        return;
      }
      const attempt = reconnectAttempt;
      // 14-M-reconnect-backoff: starting from WS_RECONNECT_DELAY_MS
      // (1s) and doubling up to 30s, so a downed server doesn't get
      // hammered and a flaky network still recovers within ~30s.
      const delay = Math.min(30_000, WS_RECONNECT_DELAY_MS * Math.pow(2, attempt));
      reconnectAttempt = attempt + 1;
      reconnectTimer = setTimeout(() => {
        if (sharedSocket === ws) {
          sharedSocket = null;
          if (eventListeners.size > 0 || stateListeners.size > 0) {
            connect();
          }
        }
      }, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch { /* already closing */ }
    };
  } catch {
    notifyConnected(false);
  }
}

function maybeConnect(): void {
  if (typeof window === "undefined") return;
  if (!sharedSocket) {
    connect();
  }
}

function maybeDisconnect(): void {
  if (eventListeners.size === 0 && stateListeners.size === 0) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    if (sharedSocket) {
      try { sharedSocket.close(); } catch { /* already closing */ }
      sharedSocket = null;
    }
    notifyConnected(false);
  }
}

export function useWebSocket(onEvent: (event: WSEvent) => void): { connected: boolean } {
  const [connected, setConnected] = useState(sharedConnected);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    const listener: Listener = (event) => onEventRef.current(event);
    const stateListener: ConnectionStateListener = (c) => setConnected(c);
    eventListeners.add(listener);
    stateListeners.add(stateListener);
    maybeConnect();
    // Surface the latest known state immediately
    setConnected(sharedConnected);
    return () => {
      eventListeners.delete(listener);
      stateListeners.delete(stateListener);
      maybeDisconnect();
    };
  }, []);

  return { connected };
}
