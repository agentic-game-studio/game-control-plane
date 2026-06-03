/**
 * ShipThis CLI integration — optional cloud build / store submission.
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { SUBPROCESS_MAX_BUFFER } from "../config.js";

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
  const candidates = [
    process.env.SHIPTHIS_CLI_PATH,
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

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [cli, "game", "export", "--path", projectPath, "--platform", platform],
      { timeout: 600_000, maxBuffer: SUBPROCESS_MAX_BUFFER },
    );
    return { success: true, output: stdout + stderr };
  } catch (err: unknown) {
    const e = err as { message?: string; stdout?: string; stderr?: string };
    return {
      success: false,
      output: (e.stdout ?? "") + (e.stderr ?? ""),
      error: e.message ?? "ShipThis export failed",
    };
  }
}

export function isShipThisAvailable(): boolean {
  return findShipThisCli() !== null;
}
