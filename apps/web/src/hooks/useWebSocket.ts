"use client";
import { useEffect, useRef, useCallback } from "react";
import type { WSEvent } from "@game-studio/types";

export function useWebSocket(onEvent: (event: WSEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001";
    const ws = new WebSocket(`${wsUrl}/ws`);

    ws.onopen = () => {
      console.log("[WS] Connected");
    };

    ws.onmessage = (msg) => {
      try {
        onEventRef.current(JSON.parse(msg.data) as WSEvent);
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      console.log("[WS] Disconnected, reconnecting in 3s...");
      setTimeout(() => {
        if (wsRef.current === ws) connect();
      }, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);
}
