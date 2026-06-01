import type { ChatState, TicketsBoard } from "@game-studio/types";
import { readData, writeData, updateData } from "./data-store.js";

const CHAT_STATE_FILE = "chat-state.json";
const LEGACY_TICKETS_FILE = "tickets.json";

export const DEFAULT_TICKETS_BOARD: TicketsBoard = {
  sprint: "Sprint 1",
  milestone: "Milestone 1",
  columns: [
    { id: "available", label: "Available", tickets: [] },
    { id: "in_progress", label: "Processing", tickets: [] },
    { id: "qa", label: "Verify", tickets: [] },
    { id: "completed", label: "Archived", tickets: [] },
    { id: "failed", label: "Failed", tickets: [] },
  ],
};

function createDefaultBoard(projectId?: string | null): TicketsBoard {
  return {
    ...structuredClone(DEFAULT_TICKETS_BOARD),
    projectId: projectId ?? undefined,
  };
}

function normalizeProjectId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9-_]/g, "-");
}

export function getTicketsBoardFile(projectId?: string | null): string {
  if (!projectId) return LEGACY_TICKETS_FILE;
  return `tickets.${normalizeProjectId(projectId)}.json`;
}

export async function readTicketsBoard(projectId?: string | null): Promise<TicketsBoard> {
  const filename = getTicketsBoardFile(projectId);
  try {
    const board = await readData<TicketsBoard>(filename);
    if (projectId && !board.projectId) {
      board.projectId = projectId;
      await writeData(filename, board);
    }
    return board;
  } catch {
    // File doesn't exist — create default board.
    // Write is idempotent so concurrent callers writing the same default is safe.
    const board = createDefaultBoard(projectId);
    await writeData(filename, board);
    return board;
  }
}

export async function writeTicketsBoard(board: TicketsBoard, projectId?: string | null): Promise<void> {
  await writeData(getTicketsBoardFile(projectId), board);
}

/**
 * Serialized read-modify-write for the ticket board. Prevents lost updates
 * when autonomous loop and quest bridge modify the board concurrently.
 */
export async function updateTicketsBoard(
  projectId: string | null,
  updater: (board: TicketsBoard) => TicketsBoard | void
): Promise<TicketsBoard> {
  const filename = getTicketsBoardFile(projectId);
  return updateData<TicketsBoard>(filename, (board) => {
    const result = updater(board);
    return (result ?? board) as TicketsBoard;
  });
}

export async function resolveProjectIdForSession(sessionId: string): Promise<string | null> {
  try {
    const state = await readData<ChatState>(CHAT_STATE_FILE);
    return state.sessions[sessionId]?.projectId ?? null;
  } catch {
    return null;
  }
}
