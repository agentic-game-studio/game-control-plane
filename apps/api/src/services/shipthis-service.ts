/**
 * ShipThis CLI integration — optional cloud build / store submission.
 */

import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { SUBPROCESS_MAX_BUFFER } from "../config.js";

const execFileAsync = promisify(execFile);

function findShipThisCli(): string | null {
  const candidates = [
    process.env.SHIPTHIS_CLI_PATH,
    join(process.cwd(), "cli-main", "bin", "dev.tsc.js"),
    join(process.cwd(), "..", "..", "cli-main", "bin", "dev.tsc.js"),
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
