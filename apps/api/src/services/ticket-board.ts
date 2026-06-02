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
    // Q11-6th: route the "annotate projectId" write through updateData
    // (per-file mutex) so a concurrent updater can't race us. The
    // previous direct writeData call was outside the lock; a concurrent
    // updateTicketsBoard could overwrite our projectId annotation with
    // the un-annotated version, leaving the file in a half-set state
    // forever. updateData serializes the read-modify-write.
    if (projectId && !board.projectId) {
      await updateData<TicketsBoard>(filename, (b) => {
        if (!b.projectId) b.projectId = projectId;
        return b;
      });
      board.projectId = projectId;
    }
    return board;
  } catch {
    // File doesn't exist — create default board.
    // Use updateData so the create-or-read is atomic. Without the
    // mutex, two concurrent first-time reads of the same project both
    // see ENOENT and both writeData() — the second clobbers the
    // first's projectId annotation (which is the same string in
    // practice, but the wasted I/O is also visible). updateData's lock
    // ensures exactly one writer.
    const board = createDefaultBoard(projectId);
    await updateData<TicketsBoard>(filename, (existing) => existing ?? board);
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
