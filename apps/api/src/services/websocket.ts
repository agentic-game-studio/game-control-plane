import { WebSocketServer, WebSocket } from "ws";
import type { WSEvent } from "@game-studio/types";

export const wss = new WebSocketServer({ noServer: true });

export function broadcast(event: WSEvent) {
  const message = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// SSE client tracking
interface SSEClient {
  sessionId: string;
  id: string;
  send: (data: string) => void;
}

export const sseClients = new Set<SSEClient>();
