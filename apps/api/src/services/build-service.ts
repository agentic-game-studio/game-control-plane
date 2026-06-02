/**
 * Build registry — track Godot exports and post-export smoke tests.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import { readData, writeData, broadcastEvent } from "./data-store.js";
import { generateProjectChangelog } from "./changelog-service.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { resolveHomeDir } from "../utils/paths.js";
import { loadConfig, resolvePipelinePython, SUBPROCESS_MAX_BUFFER } from "../config.js";
import { readProjectVersion, bumpProjectVersion } from "./qa-gate-service.js";
import type { BuildPlatform, BuildsData, CreateBuildRequest, GameBuild, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

const DEFAULT_BUILDS: BuildsData = { builds: [] };

async function readBuildsData(): Promise<BuildsData> {
  try {
    return await readData<BuildsData>("builds.json");
  } catch {
    return DEFAULT_BUILDS;
  }
}

export async function listBuilds(projectId?: string): Promise<GameBuild[]> {
  const data = await readBuildsData();
  if (!projectId) return data.builds;
  return data.builds.filter((b) => b.projectId === projectId);
}

export async function createBuild(req: CreateBuildRequest): Promise<GameBuild> {
  const now = new Date().toISOString();
  const build: GameBuild = {
    id: `build-${Date.now()}`,
    projectId: req.projectId,
    version: req.version ?? "0.1.0",
    platform: req.platform,
    preset: req.preset,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const data = await readBuildsData();
  data.builds.unshift(build);
  await writeData("builds.json", data);
  broadcastEvent({ type: "build:created", build } as WSEvent);
  return build;
}

function defaultPresetForPlatform(platform: BuildPlatform): string {
  const map: Record<BuildPlatform, string> = {
    windows: "Windows Desktop",
    macos: "macOS",
    linux: "Linux/X11",
    web: "Web",
    android: "Android",
    ios: "iOS",
  };
  return map[platform] ?? "Windows Desktop";
}

export async function updateBuild(build: GameBuild): Promise<void> {
  const data = await readBuildsData();
  const idx = data.builds.findIndex((b) => b.id === build.id);
  if (idx >= 0) data.builds[idx] = build;
  else data.builds.unshift(build);
  await writeData("builds.json", data);
  broadcastEvent({ type: "build:updated", build } as WSEvent);
}

export async function executeGodotExport(
  projectId: string,
  workspacePath: string,
  platform: BuildPlatform,
  preset?: string,
  bumpVersion = false,
): Promise<GameBuild> {
  const projectPath = resolveProjectWorkspace(workspacePath);
  const exportPreset = preset ?? defaultPresetForPlatform(platform);
  const buildsDir = join(projectPath, "builds");
  if (!existsSync(buildsDir)) mkdirSync(buildsDir, { recursive: true });

  const version = bumpVersion ? bumpProjectVersion(projectPath) : readProjectVersion(projectPath);
  const artifactName = `${projectId}-${platform}-v${version}-${Date.now()}.pck`;
  const artifactAbs = join(buildsDir, artifactName);

  const build = await createBuild({ projectId, platform, preset: exportPreset, version });
  build.status = "building";
  await updateBuild(build);

  const config = loadConfig();
  const scriptDir = join(config.WORKSPACE_DIR, "scripts", "godot");
  const pythonBin = resolvePipelinePython();
  const home = resolveHomeDir();
  const godotBin = process.env.GODOT_BIN ?? (home ? join(home, ".local/bin/godot_bin/Godot") : "");

  try {
    // execFileSync (no shell) so a projectPath or exportPreset containing
    // shell metacharacters can't escalate into a shell pipeline. Each arg
    // is a single argv element to Python, parsed exactly as written.
    const args = [
      join(scriptDir, "run_godot_headless.py"),
      "--project", projectPath,
      "--command", "export",
      "--godot-bin", godotBin,
      "--export-preset", exportPreset,
      "--export-output", artifactAbs,
      "--timeout", "180",
    ];
    // Q25-6th: execFile (async) instead of execFileSync. A 4-minute
    // Godot export blocks the entire event loop with the sync variant,
    // freezing WS broadcasts and HTTP requests on the process. The
    // async version yields to the event loop so other clients can
    // proceed while the export runs.
    await execFileAsync(pythonBin, args, { timeout: 240_000, maxBuffer: SUBPROCESS_MAX_BUFFER });
    build.status = "success";
    build.artifactPath = join("builds", artifactName);
    build.smokeTestPassed = existsSync(artifactAbs);
    try {
      build.changelog = await generateProjectChangelog(projectId, workspacePath);
    } catch { /* non-fatal */ }
  } catch (err) {
    build.status = "failed";
    build.error = err instanceof Error ? err.message : String(err);
    logger.error({ projectId, platform, error: build.error, event: "build_export_failed" }, "Export failed");
  }

  build.updatedAt = new Date().toISOString();
  await updateBuild(build);
  return build;
}

export async function runPostExportSmokeTest(buildId: string, workspacePath: string): Promise<GameBuild | null> {
  const data = await readBuildsData();
  const build = data.builds.find((b) => b.id === buildId);
  if (!build) return null;

  const projectPath = resolveProjectWorkspace(workspacePath);
  const artifactAbs = build.artifactPath ? join(projectPath, build.artifactPath) : null;
  build.smokeTestPassed = build.status === "success" && !!artifactAbs && existsSync(artifactAbs);
  build.updatedAt = new Date().toISOString();
  await updateBuild(build);
  return build;
}

export { bumpProjectVersion, readProjectVersion };
