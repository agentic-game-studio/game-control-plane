"use client";
import { useEffect, useRef, useState } from "react";
import type { WSEvent } from "@game-studio/types";
import { WS_PING_INTERVAL_MS, WS_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_DELAY_MS } from "@/lib/timing";
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
// 30-M-use-websocket-parse-error-counter: monotonic count of
// malformed messages dropped by the onmessage handler. The
// per-connection state is shared across all hooks via the
// `useWebSocket` singleton pattern, so a single counter covers
// the whole tab. Reset on (re)connect so a new socket's drops
// don't get attributed to the previous one's.
let droppedMessages = 0;
const eventListeners = new Set<Listener>();
const stateListeners = new Set<ConnectionStateListener>();

function notifyConnected(connected: boolean): void {
  sharedConnected = connected;
  for (const cb of stateListeners) {
    try { cb(connected); } catch (err) {
      // 30-M-use-websocket-empty-catch: empty catch blocks hide
      // regressions in a listener. The for-loop continues so a
      // single throwing listener can't kill the broadcast, but
      // the error needs to be visible — a state-listener that
      // throws on every event would otherwise look like a UI
      // bug with no breadcrumb. Log at warn level.
      logger.warn(
        "WebSocket state listener threw — continuing",
        { err: err instanceof Error ? err.message : String(err), event: "ws_state_listener_threw" },
      );
    }
  }
}

function dispatchEvent(event: WSEvent): void {
  for (const cb of eventListeners) {
    try { cb(event); } catch (err) {
      // 30-M-use-websocket-empty-catch: same as above for the
      // event-listener set. A single broken hook (e.g. one that
      // accidentally throws on every chat:context event) would
      // otherwise leave no trace. Log and continue.
      logger.warn(
        "WebSocket event listener threw — continuing",
        { err: err instanceof Error ? err.message : String(err), eventType: event.type, event: "ws_event_listener_threw" },
      );
    }
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

  // 30-M-use-websocket-url-scheme: validate the URL scheme before
  // passing to the WebSocket constructor. `new WebSocket("ftp://...")`
  // doesn't throw synchronously — the constructor accepts any string
  // and the failure surfaces on `connect` later, deep inside the
  // browser's WebSocket implementation, with no useful error for the
  // caller to catch. Misconfigured `NEXT_PUBLIC_WS_URL=ftp://...` or
  // a typo (`htttp`) would silently sit in a never-resolving OPEN
  // state. Validate up front and log clearly.
  if (!/^wss?:\/\//.test(wsUrl)) {
    logger.warn(
      "NEXT_PUBLIC_WS_URL is missing a ws:// or wss:// scheme — WebSocket will not connect. Falling back to disconnected state.",
      { wsUrl, event: "ws_url_invalid_scheme" },
    );
    notifyConnected(false);
    return;
  }

  try {
    const ws = new WebSocket(`${wsUrl}/ws${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ""}`);
    sharedSocket = ws;
    // 30-M-use-websocket-parse-error-counter: reset the drop
    // counter on every new connection so a fresh socket's
    // misbehaviour isn't masked by the previous socket's
    // history.
    droppedMessages = 0;

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
        try {
          ws.send(JSON.stringify({ type: "ping" }));
        } catch (err) {
          // 30-M-use-websocket-empty-catch: a send failure on a
          // ping typically means the socket died between the
          // readyState check and the send. Clear the interval
          // (the onclose handler will reconnect) and log at
          // debug so a noisy CI doesn't fill the log.
          clearInterval(myInterval);
          logger.debug(
            "WebSocket ping send failed — interval cleared, onclose will reconnect",
            { err: err instanceof Error ? err.message : String(err), event: "ws_ping_send_failed" },
          );
        }
      }, WS_PING_INTERVAL_MS);
      pingInterval = myInterval;
    };

    ws.onmessage = (msg) => {
      try {
        dispatchEvent(JSON.parse(msg.data) as WSEvent);
      } catch (err) {
        // 30-M-use-websocket-parse-error-counter: the previous
        // shape silently swallowed every malformed message. A
        // misbehaving backend that ships a single non-JSON frame
        // (or a server restart that races a partial send) would
        // drop the message with no breadcrumb. Throttled log so
        // a poison stream doesn't fill the log file — surface
        // the first error and a count for everything after.
        droppedMessages++;
        if (droppedMessages === 1 || droppedMessages % 100 === 0) {
          logger.warn(
            `WebSocket message parse failed (${droppedMessages} total dropped)`,
            { droppedMessages, err: err instanceof Error ? err.message : String(err), event: "ws_message_parse_failed" },
          );
        }
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
      // (1s) and doubling up to WS_RECONNECT_MAX_DELAY_MS, so a
      // downed server doesn't get hammered and a flaky network
      // still recovers within the cap.
      const delay = Math.min(WS_RECONNECT_MAX_DELAY_MS, WS_RECONNECT_DELAY_MS * Math.pow(2, attempt));
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
      try { ws.close(); } catch (err) {
        // 30-M-use-websocket-empty-catch: the close in the error
        // handler can throw if the socket is already CLOSING /
        // CLOSED (the implementation throws InvalidStateError).
        // The previous shape swallowed the error; log at debug
        // and continue. ws.onclose will fire next.
        logger.debug(
          "WebSocket close after onerror threw — continuing",
          { err: err instanceof Error ? err.message : String(err), event: "ws_close_after_error_threw" },
        );
      }
    };
  } catch (err) {
    // 30-M-use-websocket-empty-catch: the outer try/catch protects
    // the `new WebSocket(...)` call from a synchronous throw
    // (e.g. an invalid URL on older browsers). Previously
    // swallowed; log at warn so a config error is visible.
    logger.warn(
      "WebSocket construction threw — falling back to disconnected state",
      { err: err instanceof Error ? err.message : String(err), event: "ws_construct_failed" },
    );
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
