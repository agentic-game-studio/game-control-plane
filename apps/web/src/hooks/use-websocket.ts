"use client";

import { useEffect, useState, useCallback } from "react";
import { wsClient } from "@/lib/websocket";
import type { WSEvent } from "@game-studio/types";

export function useWebSocket() {
  const [events, setEvents] = useState<WSEvent[]>([]);

  const subscribe = useCallback((event: WSEvent) => {
    setEvents((prev) => [...prev.slice(-99), event]);
  }, []);

  useEffect(() => {
    const unsub = wsClient.subscribe(subscribe);
    wsClient.connect();
    return () => {
      unsub();
    };
  }, [subscribe]);

  return { events };
}
