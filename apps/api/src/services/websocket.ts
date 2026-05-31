import { WebSocketServer, WebSocket } from "ws";
import type { WSEvent } from "@game-studio/types";

export const wss = new WebSocketServer({ noServer: true });

export function broadcast(event: WSEvent) {
  const message = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
      } catch {
        // Client disconnected during broadcast — skip, don't abort remaining clients
      }
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
