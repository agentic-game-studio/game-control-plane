/**
 * ShipThis CLI integration — optional cloud build / store submission.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { SUBPROCESS_MAX_BUFFER, loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

// 19-L-shipthis-cwd: derive the search root from this file's location
// instead of process.cwd(). The dev server starts in `apps/api/` and
// the Docker image starts in `/app/` — neither is where `cli-main/`
// actually lives (it's a sibling of the repo root). The same pattern
// was applied to llm-service.ts in 19-M-instructions-path; mirror it
// here so the two helpers don't disagree about where the repo is.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findShipThisCli(): string | null {
  // 24-M-env-var-drift: read SHIPTHIS_CLI_PATH from the Zod-validated
  // config instead of `process.env.SHIPTHIS_CLI_PATH` directly. The
  // 23rd pass added SHIPTHIS_CLI_PATH to the env schema (config.ts:59)
  // but didn't migrate this consumer. The Zod default is the empty
  // string, so `.filter(Boolean)` drops it the same way the original
  // `undefined` was dropped — the schema change is a no-op when the
  // env is unset.
  const candidates = [
    loadConfig().SHIPTHIS_CLI_PATH || undefined,
    join(__dirname, "..", "..", "..", "..", "cli-main", "bin", "dev.tsc.js"),
    join(__dirname, "..", "..", "..", "cli-main", "bin", "dev.tsc.js"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export interface ShipThisExportResult {
  success: boolean;
  output: string;
  error?: string;
}

export async function runShipThisExport(
  projectPath: string,
  platform: "android" | "ios" = "android",
): Promise<ShipThisExportResult> {
  const cli = findShipThisCli();
  if (!cli) {
    return {
      success: false,
      output: "",
      error: "ShipThis CLI not found. Set SHIPTHIS_CLI_PATH or vendor cli-main/",
    };
  }

  // 29-C-shipthis-actually-kill: previous shape used execFileAsync,
  // which sends SIGKILL on timeout but offers no handle to the
  // child for a manual force-kill. The 28th pass added a kill
  // timer that *logged* the timeout — but never actually killed
  // anything. A stubborn ShipThis export (network call to cloud
  // signing, stuck in a state where it ignores SIGKILL for a few
  // seconds) could pin the route handler indefinitely because
  // execFile's internal kill already fired and the child was
  // already a zombie, but the awaited promise was still pending
  // on the stdout/stderr streams draining.
  //
  // Switch to `spawn` directly so we hold a ChildProcess handle,
  // and have the kill timer call `child.kill('SIGKILL')` for real.
  // Use a Promise.race against the drain to bound the wait. If the
  // child refuses to die within the grace window we give up and
  // reject — the orphaned process is now an OS-level leak the
  // operator can find via `ps`, instead of an awaitable that
  // never resolves.
  const SHIPTHIS_TIMEOUT_MS = 600_000;
  const SHIPTHIS_KILL_GRACE_MS = 5_000;
  // 31-CR-shipthis-no-reject: bound the total wait with an outer
  // timeout that's strictly *longer* than the inner kill window. If
  // the child refuses to die within SIGKILL+grace (a SIGKILL-immune
  // process, an OS-level stuck-zombie, an event-loop starvation
  // scenario), the `close` event may never fire and the previous
  // Promise — constructed with only `resolve` and no `reject` —
  // would hang forever, pinning the route handler. The route caller
  // `await runShipThisExport(...)` would itself never resolve,
  // burning an HTTP request slot. Cap the total wait at
  // `OUTER_TIMEOUT_MS` after the inner kill fires and reject the
  // promise with an explicit error so the caller can return 500
  // and the orphan process becomes an OS-level concern (`ps`
  // / `lsof`) rather than a Promise-graph leak.
  const OUTER_TIMEOUT_MS = 30_000;
  let killTimer: NodeJS.Timeout | null = null;
  let outerTimer: NodeJS.Timeout | null = null;
  let timedOut = false;

  return new Promise<ShipThisExportResult>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, "game", "export", "--path", projectPath, "--platform", platform],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let outBytes = 0;
    let errBytes = 0;
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= SUBPROCESS_MAX_BUFFER) stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      errBytes += chunk.length;
      if (errBytes <= SUBPROCESS_MAX_BUFFER) stderr += chunk.toString("utf-8");
    });

    const settle = (result: ShipThisExportResult) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (outerTimer) clearTimeout(outerTimer);
      resolve(result);
    };

    const settleReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (outerTimer) clearTimeout(outerTimer);
      reject(err);
    };

    child.on("error", (err) => {
      settle({
        success: false,
        output: stdout + stderr,
        error: err.message,
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        settle({
          success: false,
          output: stdout + stderr,
          error: `ShipThis export exceeded timeout and was killed (signal=${signal ?? "unknown"})`,
        });
        return;
      }
      settle({
        success: code === 0,
        output: stdout + stderr,
        error: code === 0 ? undefined : `ShipThis exited with code ${code}${signal ? ` (signal ${signal})` : ""}`,
      });
    });

    killTimer = setTimeout(() => {
      timedOut = true;
      logger.warn(
        { projectPath, platform, timeoutMs: SHIPTHIS_TIMEOUT_MS, pid: child.pid, event: "shipthis_force_kill_timeout" },
        "ShipThis export exceeded timeout — sending SIGKILL",
      );
      try {
        child.kill("SIGKILL");
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), event: "shipthis_kill_failed" },
          "Failed to SIGKILL ShipThis child",
        );
      }
      // Schedule the outer cap: if the child is still alive
      // OUTER_TIMEOUT_MS after the SIGKILL fired, give up and
      // reject. The orphaned process is now an OS-level leak
      // (findable via `ps -p $pid`) — better than pinning the
      // route handler forever.
      outerTimer = setTimeout(() => {
        logger.error(
          { projectPath, platform, pid: child.pid, event: "shipthis_outer_timeout" },
          "ShipThis child refused to die within outer timeout — rejecting with orphan process",
        );
        settleReject(new Error(
          `ShipThis export failed: child refused to exit within ${OUTER_TIMEOUT_MS}ms of SIGKILL. ` +
          `Orphan process pid=${child.pid} — find via 'ps -p ${child.pid}' and reap manually.`,
        ));
      }, OUTER_TIMEOUT_MS);
    }, SHIPTHIS_TIMEOUT_MS + SHIPTHIS_KILL_GRACE_MS);
  });
}

export function isShipThisAvailable(): boolean {
  return findShipThisCli() !== null;
}
