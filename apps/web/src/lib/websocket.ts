import type { WSEvent } from "@game-studio/types";

type Listener = (event: WSEvent) => void;

class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: Set<Listener> = new Set();
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:3001/ws";
    this.ws = new WebSocket(url);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSEvent;
        this.listeners.forEach((fn) => fn(data));
      } catch {
        // ignore parse errors
      }
    };

    this.ws.onclose = () => {
      // Auto-reconnect after 3s
      this.reconnectTimeout = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  subscribe(listener: Listener): () => void {
    if (!this.ws) this.connect();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.ws?.close();
    this.ws = null;
  }
}

export const wsClient = new WebSocketClient();
