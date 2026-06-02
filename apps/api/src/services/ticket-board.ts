import type { ChatState, TicketsBoard } from "@game-studio/types";
import { createHash } from "node:crypto";
import { readData, writeData, updateData, getOrCreateData } from "./data-store.js";

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

/**
 * Make a project id safe for use as a filename segment.
 *
 * Q9-4: the previous implementation just replaced non-alphanumeric chars
 * with "-", which silently collided distinct ids (`proj-abc!x` and
 * `proj-abc?x` both became `proj-abc-x`). Two callers from different
 * projects would then read/write the same tickets.json file and clobber
 * each other's tickets.
 *
 * Fix: if the input contained any unsafe character, append a short hash
 * of the original. The safe-form prefix keeps filenames readable on disk;
 * the hash discriminator makes collisions cryptographically improbable.
 * Safe inputs (already only [A-Za-z0-9_-]) are returned unchanged so the
 * common case keeps its clean filename.
 */
function normalizeProjectId(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9-_]/g, "-");
  if (safe === projectId) return safe;
  const discriminator = createHash("sha256").update(projectId).digest("hex").slice(0, 8);
  return `${safe}-${discriminator}`;
}

export function getTicketsBoardFile(projectId?: string | null): string {
  if (!projectId) return LEGACY_TICKETS_FILE;
  return `tickets.${normalizeProjectId(projectId)}.json`;
}

export async function readTicketsBoard(projectId?: string | null): Promise<TicketsBoard> {
  const filename = getTicketsBoardFile(projectId);
  // Q9-2: use getOrCreateData so the ENOENT path doesn't re-throw. The
  // previous `try { readData } catch { updateData }` pattern was broken:
  // updateData internally calls readData, which raises ENOENT again and
  // propagates out — the catch block was unreachable. getOrCreateData
  // serializes the read-or-create through the same per-file mutex.
  const board = await getOrCreateData<TicketsBoard>(filename, () =>
    createDefaultBoard(projectId),
  );
  // Annotate projectId on legacy boards that pre-date the field. Route
  // through updateData so a concurrent updater can't race us.
  if (projectId && !board.projectId) {
    await updateData<TicketsBoard>(filename, (b) => {
      if (!b.projectId) b.projectId = projectId;
      return b;
    });
    board.projectId = projectId;
  }
  return board;
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
