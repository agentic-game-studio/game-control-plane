import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { broadcast } from "./websocket.js";
import { logger } from "../utils/logger.js";
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
 *
 * V8 single-thread guarantee: the `fileLocks.get(filename) ?? new Promise()`
 * + `fileLocks.set` pair runs in one synchronous microtask — no `await`
 * between them — so two callers cannot both observe the absent entry and
 * both install a lock. If a future refactor adds an `await` between the get
 * and set, this guarantee breaks.
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

/**
 * Atomically read a file or create it with `defaultValue` if it doesn't
 * exist. Uses the same per-file mutex as `updateData` so a concurrent
 * first-time read from two callers (e.g., the same project being created
 * via two routes) cannot race: exactly one writer installs the default,
 * the other sees the just-written file.
 *
 * Why this exists: `updateData` calls `readData` first and propagates
 * ENOENT, so it cannot be used in the "create if missing" path. Callers
 * that need that behavior (ticket boards, asset inventories) must reach
 * for this helper rather than try { readData } catch { writeData }, which
 * has a TOCTOU window where two callers both write the default.
 *
 * @typeParam T - A JSON-serializable object (no Date, no Map, no
 *   functions). The type is informational; this helper does not validate
 *   the on-disk shape. Callers that load a saved value should validate
 *   it with a Zod schema or hand-rolled guard.
 *
 * @param filename - The data file under DATA_DIR. Must include the
 *   extension; this helper does not append one.
 * @param defaultValue - **A factory**, not a value. The factory is only
 *   invoked on the create path. Always pass `() => ({ ... })` rather
 *   than a pre-built object so a default with internal arrays/maps is
 *   not shared by reference across calls — two concurrent calls would
 *   otherwise see each other's mutations.
 * @returns The freshly-read value, or the just-written default if the
 *   file did not exist.
 *
 * @throws Propagates non-ENOENT errors from `readData` (corrupted JSON,
 *   EACCES, EISDIR) so the caller can decide whether to recover.
 *   Callers wanting "always return something" semantics should
 *   `.catch(() => defaultValue())` at the call site — but be aware
 *   that swallows corrupt-file signals.
 */
export async function getOrCreateData<T>(
  filename: string,
  defaultValue: () => T
): Promise<T> {
  const prev = fileLocks.get(filename) ?? Promise.resolve();
  let resolveLock: () => void;
  const lockPromise = new Promise<void>((r) => { resolveLock = r; });
  fileLocks.set(filename, lockPromise);

  try {
    await prev;
    try {
      return await readData<T>(filename);
    } catch (err) {
      // Only ENOENT triggers the create path — corrupted JSON should
      // surface to the caller so they can decide whether to recover or
      // bail (a corrupted file is usually a data-loss signal, not a
      // "just overwrite it" signal).
      const msg = (err as Error).message || "";
      if (!msg.includes("not found")) throw err;
      const value = defaultValue();
      await writeData(filename, value);
      return value;
    }
  } finally {
    resolveLock!();
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
  } catch (err) {
    // ENOENT = file already gone, treat as a successful no-op (idempotent
    // delete). Other errors (EACCES, EROFS, EBUSY) bubble up to the logger
    // so we don't silently leak cleanup failures across project deletes.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
    logger.warn({ filePath, err: (err as Error).message, event: "data_delete_failed" },
      "deleteData failed for non-ENOENT reason — file may be leaked");
    return false;
  }
}
