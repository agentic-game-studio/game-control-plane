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

/** Acquire a per-file mutex for the duration of `body`. Used by writeData,
 * updateData, and getOrCreateData so all three of them serialize on the
 * same key — two callers holding different functions for the same
 * filename cannot both see the absent entry and install a lock. Mirrors
 * the same V8-single-thread pattern: get → set without an await between
 * them.
 *
 * Lock-safety contract: `resolveLock` is installed into the lockPromise
 * before `fileLocks.set` publishes the lock, and is invoked
 * unconditionally in the `finally` block. The only paths that bypass the
 * `try` block are the pre-`await prev` synchronous steps, but those are
 * pure map lookups + a `new Promise` constructor — none of them can
 * throw in practice. If any future change makes those steps throw-able,
 * wrap the `fileLocks.set` call in a `try/finally` that calls
 * `resolveLock` defensively so the lock is never stranded. */
export async function withFileLock<T>(filename: string, body: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(filename) ?? Promise.resolve();
  // Initialise resolveLock to a noop so the defensive catch below can
  // call it before the Promise constructor has had a chance to assign
  // the real resolver. Without this, an error between the
  // `new Promise(...)` call and `fileLocks.set(...)` would publish a
  // lockPromise with no resolver, permanently deadlocking every future
  // caller that awaits `prev` (which is now this orphan promise).
  let resolveLock: () => void = () => {};
  const lockPromise = new Promise<void>((r) => { resolveLock = r; });
  try {
    fileLocks.set(filename, lockPromise);
  } catch (err) {
    // fileLocks.set can only throw if the Map itself is broken (e.g.,
    // someone passed a frozen Map or ran out of memory). Release the
    // orphan lockPromise so any waiter doesn't deadlock, then rethrow.
    resolveLock();
    throw err;
  }
  try {
    await prev;
    return await body();
  } finally {
    resolveLock!();
    if (fileLocks.get(filename) === lockPromise) {
      fileLocks.delete(filename);
    }
  }
}

export async function readData<T>(filename: string): Promise<T> {
  const filePath = path.join(DATA_DIR, filename);
  let content: string;
  try {
    // 12-H16: read with a small retry on partial reads. fs.readFile
    // is supposed to be atomic, but a `writeData` happening on the
    // same file via tmp+rename can race on platforms with a slow
    // page cache flush. The window is tiny (microseconds) but
    // reproducible under concurrent load — a reader can see the
    // main file mid-rename and get an empty string. Retry up to
    // twice with a 25ms delay to absorb the race without making
    // the read path noticeably slower. 14-CR: previous 5ms was
    // marginal on heavily-loaded CI runners where page-cache
    // flush + Docker volume propagation can take 10-30ms.
    let attempts = 0;
    while (true) {
      content = await fs.readFile(filePath, "utf-8");
      if (content.length > 0 || attempts >= 2) break;
      attempts++;
      await new Promise((r) => setTimeout(r, 25));
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // 16-M-enoent-error-code: preserve the ENOENT code on the rewrapped
      // error so callers (getOrCreateData) can match on `err.code ===
      // "ENOENT"` instead of the brittle `msg.includes("not found")`
      // string sniff. A future translation, message rewording, or
      // unrelated error carrying the word "not" in its message would
      // confuse the substring check; the error code never moves.
      //
      // 30-M-data-store-enoent-path-leak: the previous message
      // included the absolute `filePath` (which on a production
      // deploy reveals the data directory layout — e.g.
      // `/var/lib/game-studio/data/run-metrics.json`). Log the path
      // server-side and surface a generic message + the code to
      // the caller. The code is the only contract getOrCreateData
      // cares about; the message is for human debugging.
      logger.warn({ filename, filePath, event: "data_file_missing" }, `Data file not found: ${filename}`);
      const wrapped = new Error(`Data file ${filename} not found`) as NodeJS.ErrnoException;
      wrapped.code = "ENOENT";
      throw wrapped;
    }
    throw err;
  }
  try {
    return JSON.parse(content) as T;
  } catch (parseErr) {
    // 30-M-data-store-parse-error-leak: the previous shape
    // embedded `parseErr.message` and the filename in the thrown
    // error, which a generic Express error handler would forward
    // to the client as a 500. The V8 parser message can include
    // the offending position, and the filename reveals which data
    // file exists (e.g. `run-metrics.json` — confirming the
    // feature is used). Log the full detail server-side and
    // surface a generic message to the caller; the route layer
    // can map it to a 503 ("data temporarily unavailable") rather
    // than a 500 that leaks internal state.
    logger.error(
      { filename, parseErr: parseErr instanceof Error ? parseErr.message : String(parseErr), event: "data_parse_failed" },
      `Corrupted JSON in ${filename}`,
    );
    throw new Error(`Data file ${filename} is temporarily unavailable. Retry in a moment.`);
  }
}

export async function writeData<T>(filename: string, data: T): Promise<void> {
  // 15-H-write-mutex: writeData used to bypass the per-file mutex that
  // updateData enforces. Two concurrent writes to the same file (e.g.,
  // a /settings PATCH landing while the autonomous loop is also writing
  // settings.json, or two /api/chat/sessions calls racing on
  // chat-state.json) would both write to the shared .tmp path, and the
  // second's rename could interleave with the first's writeFile —
  // leaving a truncated, corrupted, or partially-old file. Wrap the
  // body in a per-file lock so any updateData + writeData call (and
  // any two writeData calls) for the same filename are serialized.
  await withFileLock(filename, async () => {
    await ensureDataDir();
    const filePath = path.join(DATA_DIR, filename);
    const tmpPath = filePath + ".tmp";
    try {
      await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
      await fs.rename(tmpPath, filePath);
    } catch (writeErr) {
      // Clean up tmp file on failure to avoid stale .tmp files
      await fs.unlink(tmpPath).catch(() => {});
      // 12-H5: surface EROFS specifically with a clearer error. A
      // read-only filesystem (mounted data volume in CI, container
      // with the data dir bind-mounted read-only, accidental chmod)
      // produces an EROFS error from rename(). The default message
      // is "EROFS: read-only filesystem, rename '...tmp' -> '...'"
      // which is informative, but the caller has no way to
      // distinguish "disk full" from "permission denied" from
      // "read-only mount". Wrap with a tagged error so route
      // handlers can decide whether to retry (transient) or surface
      // 503 (read-only is a config problem, not a request problem).
      if (writeErr instanceof Error && /EROFS/.test(writeErr.message)) {
        const err = new Error(
          `Cannot write ${filename}: data directory is on a read-only filesystem. ` +
          `Check that ${DATA_DIR} is mounted with read-write permissions.`,
        );
        (err as Error & { code: string }).code = "DATA_DIR_READONLY";
        throw err;
      }
      throw writeErr;
    }
  });
}

/**
 * Serialized read-modify-write — prevents lost updates when multiple callers
 * modify the same file concurrently (e.g., autonomous loop + quest bridge).
 *
 * V8 single-thread guarantee: the `fileLocks.get(filename) ?? new Promise()`
 * + `fileLocks.set` pair runs in one synchronous microtask — no `await`
 * between them — so two callers cannot both observe the absent entry and
 * both install a lock. The `withFileLock` helper enforces this.
 */
export async function updateData<T>(
  filename: string,
  updater: (data: T) => T | Promise<T>
): Promise<T> {
  return withFileLock(filename, async () => {
    const data = await readData<T>(filename);
    // 11-M5: support async updaters. Some callers (writeDemoGodotProject)
    // need to do disk I/O inside the mutex so concurrent demo-project
    // POSTs don't both write the same files at once.
    const updated = await updater(data);
    await writeData(filename, updated);
    return updated;
  });
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
  return withFileLock(filename, async () => {
    try {
      return await readData<T>(filename);
    } catch (err) {
      // 16-M-enoent-error-code: switch from `msg.includes("not found")` to
      // an actual error-code check. readData now sets err.code = "ENOENT"
      // on the rewrapped error (see data-store.ts:41). Corrupted JSON
      // and other failures continue to propagate so the caller can
      // surface a real data-loss signal.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      const value = defaultValue();
      await writeData(filename, value);
      return value;
    }
  });
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
