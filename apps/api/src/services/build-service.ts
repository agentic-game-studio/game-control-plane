/**
 * Build registry — track Godot exports and post-export smoke tests.
 */

import { existsSync, mkdirSync } from "fs";
import fsPromises from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
import { readData, writeData, updateData, broadcastEvent } from "./data-store.js";
import { generateProjectChangelog } from "./changelog-service.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { resolveHomeDir } from "../utils/paths.js";
import { loadConfig, resolvePipelinePython, SUBPROCESS_MAX_BUFFER } from "../config.js";
import { readProjectVersion, bumpProjectVersion } from "./qa-gate-service.js";
import type { BuildPlatform, BuildsData, CreateBuildRequest, GameBuild, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";
import { newId } from "../utils/ids.js";

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
  // 22-M-predictable-build-id: use newId("build") (128 bits of
  // crypto.randomUUID() entropy, prefixed) instead of
  // `build-${Date.now()}` (timestamp-only, guessable within a
  // millisecond window). The id flows into /api/builds/:id/smoke and
  // any future per-build endpoint, so a predictable id lets an
  // attacker construct a colliding buildId. Mirrors the
  // Q4-6th (tickets) and Q5-6th (assets) fix shape.
  const build: GameBuild = {
    id: newId("build"),
    projectId: req.projectId,
    version: req.version ?? "0.1.0",
    platform: req.platform,
    preset: req.preset,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  // 22-H-create-build-rmw: route the unshift through updateData so
  // the per-file mutex serializes the read-modify-write. The
  // previous shape (readBuildsData → unshift → writeData) had two
  // concurrent executeGodotExport calls (e.g. user triggers builds
  // for two platforms in parallel, double-clicks) both reading the
  // same baseline and the second writeData clobbering the first —
  // one build lost from the registry while its Godot export
  // continued in the background, and the trailing updateBuild
  // couldn't find the lost row. The lock-free read was the same
  // pattern fixed in 21-C-update-project-engine-rmw,
  // 21-C-dashboard-read-toctou, and 13-M17 (tickets).
  await updateData<BuildsData>("builds.json", (data) => {
    data.builds.unshift(build);
    return data;
  });
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
  // 22-H-update-build-rmw: route the in-place update through updateData so
  // the per-file mutex serializes the read-modify-write. The previous
  // shape (readBuildsData → mutate → writeData) had a window where a
  // concurrent executeGodotExport / runPostExportSmokeTest could read
  // the same baseline and the second writeData would clobber the first.
  // Two parallel build completions would lose the second's status
  // transition (e.g. "building" → "success" never persisted). Same fix
  // shape as 22-H-create-build-rmw, 21-C-update-project-engine-rmw,
  // 21-C-dashboard-read-toctou, and 13-M17 (tickets).
  await updateData<BuildsData>("builds.json", (data) => {
    const idx = data.builds.findIndex((b) => b.id === build.id);
    if (idx >= 0) data.builds[idx] = build;
    else data.builds.unshift(build);
    return data;
  });
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

  // 28-H-qa-gate-async-version-helpers: bumpProjectVersion and
  // readProjectVersion are now async; await the conditional branch.
  const version = bumpVersion
    ? await bumpProjectVersion(projectPath)
    : await readProjectVersion(projectPath);
  const artifactName = `${projectId}-${platform}-v${version}-${Date.now()}.pck`;
  const artifactAbs = join(buildsDir, artifactName);

  const build = await createBuild({ projectId, platform, preset: exportPreset, version });
  build.status = "building";
  await updateBuild(build);

  const config = loadConfig();
  const scriptDir = join(config.WORKSPACE_DIR, "scripts", "godot");
  const pythonBin = resolvePipelinePython();
  const home = resolveHomeDir();
  // 24-M-env-var-drift: read GODOT_BIN from the Zod-validated
  // config instead of `process.env.GODOT_BIN` directly. The 23rd
  // pass added GODOT_BIN to the env schema (config.ts:57) but
  // didn't migrate this consumer. A future Zod transform (e.g.
  // `z.string().transform(s => path.resolve(s))`) applied to the
  // schema would silently not take effect here. The Zod default
  // is the empty string, so `||` matches the original `??`
  // behavior at the empty-string boundary.
  const godotBin = config.GODOT_BIN || (home ? join(home, ".local/bin/godot_bin/Godot") : "");

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
  // 27-H-smoke-test-real-check: previous shape returned
  // `smokeTestPassed: true` purely on `existsSync(artifactAbs)`.
  // That's not a smoke test — a 0-byte file, a half-written file
  // (Godot crashes mid-export, leaving a partial .pck), or even a
  // stale .pck from a prior build with the same name would all
  // "pass". Replaced with a real artifact-shape check: must exist,
  // must be ≥ 1 KB (Godot's smallest valid .pck is ~16 KB but a
  // 1 KB lower bound catches the obvious "export failed silently"
  // cases without false-negatives on slim exports), and for the
  // .pck format the first 4 bytes must be the Godot pack magic
  // `GDPC`. Returns the existing GameBuild so the route handler
  // can serialize it without an extra read.
  build.smokeTestPassed = false;
  if (build.status === "success" && artifactAbs) {
    build.smokeTestPassed = await verifyBuildArtifact(artifactAbs);
  }
  build.updatedAt = new Date().toISOString();
  await updateBuild(build);
  return build;
}

// 27-H-smoke-test-real-check: real artifact validation. Exists +
// non-trivial size + (for .pck) magic header. The async read is
// bounded — 4 bytes is a fixed read, not a streaming read — so the
// cost is one fs.open + one fs.read + one fs.close on the happy
// path. Reads the size via statSync first so we don't read 4 bytes
// of a 0-byte file and accidentally validate it.
async function verifyBuildArtifact(artifactAbs: string): Promise<boolean> {
  try {
    const stat = await fsPromises.stat(artifactAbs);
    if (stat.size < 1024) return false;
    if (artifactAbs.endsWith(".pck") || artifactAbs.endsWith(".zip") || artifactAbs.endsWith(".apk") || artifactAbs.endsWith(".ipa")) {
      const fd = await fsPromises.open(artifactAbs, "r");
      try {
        const buf = Buffer.alloc(4);
        await fd.read(buf, 0, 4, 0);
        // Godot pack format magic = "GDPC" (little-endian ASCII).
        // APK / ZIP / IPA use "PK\x03\x04" (zip local-file-header
        // magic). Reject any other 4-byte header so a truncated
        // export that wrote a 1KB prefix of zeroes fails this
        // check.
        const isPck = buf[0] === 0x47 && buf[1] === 0x44 && buf[2] === 0x50 && buf[3] === 0x43; // "GDPC"
        const isZip = buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04; // "PK\x03\x04"
        return isPck || isZip;
      } finally {
        await fd.close();
      }
    }
    // .exe, .app, .x86_64, .html5 — no magic header to validate,
    // fall back to "exists and non-trivial size".
    return true;
  } catch {
    return false;
  }
}

export { bumpProjectVersion, readProjectVersion };
