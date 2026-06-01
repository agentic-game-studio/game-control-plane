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
  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Data file not found: ${filename} (expected at ${filePath})`);
    }
    throw err;
  }
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
 *
 * Lock-safety contract: `resolveLock` is installed into the lockPromise before
 * `fileLocks.set` publishes the lock, and is invoked unconditionally in the
 * `finally` block. The only paths that bypass the `try` block are the
 * pre-`await prev` synchronous steps, but those are pure map lookups + a
 * `new Promise` constructor — none of them can throw in practice. If any
 * future change makes those steps throw-able, wrap the `fileLocks.set` call
 * in a `try/finally` that calls `resolveLock` defensively so the lock is
 * never stranded.
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
    // Clean up the lock entry if we're the last holder. Comparison uses
    // the same `lockPromise` reference that was set above; a later caller
    // that has already installed a new lock will not have its entry
    // removed because the comparison will not match.
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
