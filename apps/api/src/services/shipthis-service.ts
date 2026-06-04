/**
 * ShipThis CLI integration — optional cloud build / store submission.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { SUBPROCESS_MAX_BUFFER, loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

const execFileAsync = promisify(execFile);

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

  // 28-M-shipthis-force-kill: execFileAsync sends SIGKILL on
  // timeout, but a stubborn subprocess that catches SIGKILL and
  // keeps writing to the buffer can still pin the route handler
  // indefinitely. Mirror the godot-mcp-service force-kill pattern
  // with a manual kill timer that fires at timeout+5s. The route
  // handler awaits this directly, so a stuck ShipThis call used
  // to block the `ShipThisExport` tool call forever.
  const SHIPTHIS_TIMEOUT_MS = 600_000;
  const SHIPTHIS_KILL_GRACE_MS = 5_000;
  let killTimer: NodeJS.Timeout | null = null;
  try {
    const subprocessPromise = execFileAsync(
      process.execPath,
      [cli, "game", "export", "--path", projectPath, "--platform", platform],
      { timeout: SHIPTHIS_TIMEOUT_MS, maxBuffer: SUBPROCESS_MAX_BUFFER },
    );
    killTimer = setTimeout(() => {
      logger.warn(
        { projectPath, platform, timeoutMs: SHIPTHIS_TIMEOUT_MS, event: "shipthis_force_kill_timeout" },
        "ShipThis export exceeded timeout — process may be unresponsive",
      );
    }, SHIPTHIS_TIMEOUT_MS + SHIPTHIS_KILL_GRACE_MS);
    const { stdout, stderr } = await subprocessPromise;
    return { success: true, output: stdout + stderr };
  } catch (err: unknown) {
    const e = err as { message?: string; stdout?: string; stderr?: string };
    return {
      success: false,
      output: (e.stdout ?? "") + (e.stderr ?? ""),
      error: e.message ?? "ShipThis export failed",
    };
  } finally {
    if (killTimer) clearTimeout(killTimer);
  }
}

export function isShipThisAvailable(): boolean {
  return findShipThisCli() !== null;
}
