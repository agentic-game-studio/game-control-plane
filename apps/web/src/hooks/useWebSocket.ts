"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import type { WSEvent } from "@game-studio/types";

/** PING_INTERVAL_MS — send a ping every 25s to keep the connection alive
 * through proxies (load balancers commonly drop idle sockets after 60s). The
 * server is configured to respond to pings via ws.pong() and to terminate
 * sockets that miss the heartbeat (see `apps/api/src/services/websocket.ts`). */
const PING_INTERVAL_MS = 25_000;

export function useWebSocket(onEvent: (event: WSEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // `cancelled` short-circuits the reconnect timer if the hook unmounts while
  // a reconnect is pending — otherwise the closure would call `connect()` on
  // a dead component, leak a socket, and race with the unmount cleanup.
  const cancelledRef = useRef(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (cancelledRef.current) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? apiUrl.replace(/^http/, "ws");
    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "";

    try {
      const ws = new WebSocket(`${wsUrl}/ws${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ""}`);

      ws.onopen = () => {
        setConnected(true);
        reconnectAttemptRef.current = 0;
        // Start the ping heartbeat. The interval is cleared on close/error
        // and on unmount.
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* socket died */ }
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (msg) => {
        try {
          onEventRef.current(JSON.parse(msg.data) as WSEvent);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        if (cancelledRef.current) return;

        const attempt = reconnectAttemptRef.current;
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(30_000, 1_000 * Math.pow(2, attempt));
        reconnectAttemptRef.current = attempt + 1;

        reconnectTimerRef.current = setTimeout(() => {
          // Only reconnect if this hook instance is still mounted AND the
          // current socket reference still matches (i.e. no newer connection
          // has been opened in the meantime).
          if (cancelledRef.current) return;
          if (wsRef.current === ws) {
            wsRef.current = null; // clear before opening a new one
            connect();
          }
        }, delay);
      };

      ws.onerror = () => {
        // Don't log raw event — it's not serializable in all browsers.
        // `onclose` will fire next and handle the reconnect.
        try { ws.close(); } catch { /* already closing */ }
      };

      wsRef.current = ws;
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    connect();
    return () => {
      cancelledRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { connected };
}
