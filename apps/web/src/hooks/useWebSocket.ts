"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import type { WSEvent } from "@game-studio/types";

export function useWebSocket(onEvent: (event: WSEvent) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
    const apiKey = process.env.NEXT_PUBLIC_API_KEY ?? "";

    try {
      const ws = new WebSocket(`${wsUrl}/ws${apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : ""}`);

      ws.onopen = () => {
        console.log("[WS] Connected");
        setConnected(true);
        reconnectAttemptRef.current = 0;
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
        const attempt = reconnectAttemptRef.current;
        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        const delay = Math.min(30000, 1000 * Math.pow(2, attempt));
        reconnectAttemptRef.current = attempt + 1;
        console.log(`[WS] Disconnected, reconnecting in ${delay}ms (attempt ${attempt + 1})...`);

        reconnectTimerRef.current = setTimeout(() => {
          if (wsRef.current === ws) connect();
        }, delay);
      };

      ws.onerror = (err) => {
        console.log("[WS] Error:", err);
        ws.close();
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("[WS] Failed to create connection:", err);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  return { connected };
}
