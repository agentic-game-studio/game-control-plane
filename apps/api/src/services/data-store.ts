import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast } from "./websocket.js";
import type { WSEvent } from "@game-studio/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "../data");

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

/** Per-file mutex to serialize read-modify-write cycles and prevent lost updates */
const fileLocks = new Map<string, Promise<void>>();

export async function readData<T>(filename: string): Promise<T> {
  const filePath = path.join(DATA_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  try {
    return JSON.parse(content) as T;
  } catch (parseErr) {
    throw new Error(`Corrupted JSON in ${filename}: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
  }
}

export async function writeData<T>(filename: string, data: T): Promise<void> {
  await ensureDataDir();
  const filePath = path.join(DATA_DIR, filename);
  const tmpPath = filePath + ".tmp";
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (writeErr) {
    // Clean up tmp file on failure to avoid stale .tmp files
    await fs.unlink(tmpPath).catch(() => {});
    throw writeErr;
  }
}

/**
 * Serialized read-modify-write — prevents lost updates when multiple callers
 * modify the same file concurrently (e.g., autonomous loop + quest bridge).
 */
export async function updateData<T>(
  filename: string,
  updater: (data: T) => T
): Promise<T> {
  // Wait for any in-flight update to this file to complete
  const prev = fileLocks.get(filename) ?? Promise.resolve();
  let resolveLock: () => void;
  const lockPromise = new Promise<void>((r) => { resolveLock = r; });
  fileLocks.set(filename, lockPromise);

  try {
    await prev;
    const data = await readData<T>(filename);
    const updated = updater(data);
    await writeData(filename, updated);
    return updated;
  } finally {
    resolveLock!();
    // Clean up the lock entry if we're the last holder
    if (fileLocks.get(filename) === lockPromise) {
      fileLocks.delete(filename);
    }
  }
}

export function broadcastEvent(event: WSEvent): void {
  broadcast(event);
}

/** Delete a data file. Returns true if file existed and was deleted. */
export async function deleteData(filename: string): Promise<boolean> {
  const filePath = path.join(DATA_DIR, filename);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}
