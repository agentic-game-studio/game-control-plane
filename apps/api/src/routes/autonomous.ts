/**
 * autonomous.ts — Autonomous production loop runner.
 *
 * Drives the indie game production pipeline without human intervention.
 * Reads tickets from tickets.json, dispatches to appropriate agents,
 * and manages loop state across API calls via file-based persistence.
 *
 * Routes:
 *   POST /autonomous/start       — Start or resume the loop for a project
 *   POST /autonomous/stop        — Halt the running loop
 *   GET  /autonomous/status      — Get current loop status
 *   GET  /autonomous/history     — Get completed loop runs
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { existsSync, mkdirSync, openSync, writeFileSync, closeSync, readdirSync, statSync, unlinkSync, renameSync } from "fs";
import { join, resolve, sep } from "path";
import { loadConfig, resolvePipelinePython, SUBPROCESS_MAX_BUFFER } from "../config.js";
import { invokeAgent, detectEngineFromWorkspace, type ProjectContext } from "../services/llm-service.js";
import { readData, writeData, broadcastEvent } from "../services/data-store.js";
import { generateTickets, addTicketsToBoard } from "../services/ticket-generator.js";
import { readTicketsBoard, updateTicketsBoard } from "../services/ticket-board.js";
import { broadcast } from "../services/websocket.js";
import { logger } from "../utils/logger.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { resolveHomeDir } from "../utils/paths.js";
import type { AgentRole, WSEvent } from "@game-studio/types";
import type { TicketsBoard, Ticket, DashboardData } from "@game-studio/types";
import { getOrCreateGodotMCPService, launchGodotEditor, type GodotMCPServiceOptions } from "../services/godot-mcp-service.js";
import { safeIngestProducerSummaryFact } from "../services/producer-summary.js";
import { ingestGDD } from "../services/gdd-ingest-service.js";
import { runQAGateChain, saveTestEvidenceArtifact } from "../services/qa-gate-service.js";
import { triggerVerification } from "../services/verification-service.js";
import { advanceMilestoneIfReady } from "../services/milestone-service.js";
import { upsertRunMetrics, listRunMetrics, getRunMetrics, recordTokenUsage } from "../services/run-metrics-service.js";
import { externalizeProductionNote } from "../services/wiki-memory-service.js";
import { fireWebhook } from "../services/webhook-service.js";
import { executeGodotExport } from "../services/build-service.js";
import { newId } from "../utils/ids.js";
import { generateProjectChangelog } from "../services/changelog-service.js";

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFile as readFileAsync, writeFile as writeFileAsync, rename as renameAsync } from "node:fs/promises";

const execFileAsyncLocal = promisify(execFile);

// 16-M-ingest-fact-fire-and-forget: safeIngestProducerSummaryFact is
// defined in services/producer-summary.js so it can be reused by other
// routes (chat.ts has 4 call sites of its own). The shared helper
// swallows rejection from the underlying persistChatStore() call so a
// transient disk error doesn't escalate to an unhandledRejection.

type ReadyProjectContext = ProjectContext & { workspacePath: string };

/** In-memory registry of running loop session IDs for graceful shutdown */
const activeLoopSessions = new Set<string>();

/** AbortController per session, signalled by /stop to cancel in-flight work.
 * Without this, /stop only takes effect at the next loop iteration boundary —
 * so a 20-minute invokeAgent call would keep running for up to 20 minutes
 * after the user pressed Stop, burning LLM credits. */
const loopAbortControllers = new Map<string, AbortController>();

/** Tracks /start calls that are mid-validation (after the first await
 * but before the sessionId is added to `activeLoopSessions`). Without
 * this lock, two concurrent /start requests for the same sessionId can
 * both pass the duplicate-running check at line 1115 (the
 * `activeLoopSessions.has` test runs before the set is updated at line
 * 1175), then both spawn their own IIFEs and double-broadcast
 * autonomous:* events. */
const pendingStarts = new Set<string>();
const STALE_LOOP_HEARTBEAT_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale

// 6D-6th: route debug output under the workspace instead of /tmp. On a
// shared host or in a Docker container, /tmp is either unwriteable or
// pollutes the OS tmpdir with the API's loop state on every crash. A
// dedicated logs/ subdirectory under the project workspace keeps it
// scoped to the application and follows our workspace convention.
// (SESSIONS_DIR is declared below at line ~297 — resolve the same path
// here directly so this const can be used at module load time without a
// temporal-dead-zone error.)
const DEBUG_FILE = join(loadConfig().WORKSPACE_DIR, "production", "logs", "autonomous-debug.txt");
const DEBUG_FILE_MAX_BYTES = 5 * 1024 * 1024; // 5MB before rotation
const DEBUG_FILE_BACKUP = `${DEBUG_FILE}.1`;

// Lazily opened file descriptor. The previous implementation opened,
// wrote, fsynced, and closed a file descriptor on EVERY iteration (up
// to 200× per loop) — burning I/O and growing the file without bound.
// This version keeps a single fd open for the lifetime of the process
// (writeFileSync/closeSync take an fd number) and rotates when the
// file exceeds 5MB. The whole thing is gated on `DEBUG_AUTONOMOUS=1`
// so it's a no-op in production.
let debugStream: ReturnType<typeof openSync> | null = null;
let debugBytesWritten = 0;

function debugLog(msg: string): void {
  if (process.env.DEBUG_AUTONOMOUS !== "1") return;
  const line = `[${new Date().toISOString()}] ${msg}\n`;

  // Open the stream on first use.
  if (debugStream === null) {
    try {
      debugStream = openSync(DEBUG_FILE, "a");
      debugBytesWritten = existsSync(DEBUG_FILE) ? statSync(DEBUG_FILE).size : 0;
    } catch {
      // If the file can't be opened, silently fall through — debug logging
      // must never break the production path.
      return;
    }
  }

  // Rotate when the file grows past the cap. Rename the current file to
  // .1 (overwriting any prior backup) and start a fresh stream.
  if (debugBytesWritten + Buffer.byteLength(line) > DEBUG_FILE_MAX_BYTES) {
    try {
      closeSync(debugStream);
      unlinkSync(DEBUG_FILE_BACKUP);
      renameSync(DEBUG_FILE, DEBUG_FILE_BACKUP);
    } catch {
      // Rotation failure isn't fatal — keep writing to the existing fd.
    }
    debugStream = openSync(DEBUG_FILE, "a");
    debugBytesWritten = 0;
  }

  try {
    writeFileSync(debugStream, line);
    debugBytesWritten += Buffer.byteLength(line);
  } catch {
    // Write failure — close and reset so the next call re-opens.
    try { closeSync(debugStream); } catch { /* already closed */ }
    debugStream = null;
  }
}

/**
 * Kill orphaned Godot headless subprocesses left behind when an agent invocation
 * times out. The RunGodotHeadless tool uses `python3 run_godot_headless.py` which
 * spawns a godot subprocess. If the parent python3 is orphaned (agent timed out),
 * it keeps running indefinitely with its child godot process.
 *
 * Cross-platform: uses `pgrep` + `pkill` on POSIX, `tasklist` + `taskkill` on
 * Windows.
 */
function killOrphanedSubprocesses(): void {
  const platform = process.platform;

  try {
    if (platform === "win32") {
      // 11-H2: the previous code used `taskkill /F /T /IM godot.exe` which
      // kills EVERY godot.exe on the box — including the user's open
      // Godot editor windows that have nothing to do with our runner.
      // Build a targeted kill: enumerate godot.exe processes with
      // `tasklist`, parse out their parent PIDs, and only kill the
      // ones whose parent is python.exe running run_godot_headless.py.
      // We then kill the child + the python parent, mirroring the
      // POSIX `pgrep -P` walk below.
      type WinProc = { pid: number; parentPid: number; name: string };
      const listOut = execFileSync("tasklist", ["/FO", "CSV", "/NH"], { timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      const all: WinProc[] = [];
      for (const line of listOut.split(/\r?\n/)) {
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const m = /^"([^"]+)","(\d+)","[^"]*","\d+","[\d,]+ ?K?"/.exec(line);
        if (!m) continue;
        all.push({ name: m[1]!, pid: parseInt(m[2]!, 10), parentPid: 0 });
      }
      // WMI roundtrip to populate parent pids. `wmic` is deprecated but
      // still shipped; `Get-CimInstance` is the modern equivalent. We
      // use PowerShell because it's preinstalled on all supported
      // Windows versions and doesn't need admin to read process info.
      const psScript = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation`;
      const psOut = execFileSync("powershell", ["-NoProfile", "-Command", psScript], {
        timeout: 10000,
        stdio: ["ignore", "pipe", "ignore"],
      }).toString();
      const parentByChild = new Map<number, number>();
      for (const line of psOut.split(/\r?\n/).slice(1)) {
        const m = /^"(\d+)","(\d+)"/.exec(line);
        if (!m) continue;
        parentByChild.set(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
      }
      for (const p of all) p.parentPid = parentByChild.get(p.pid) ?? 0;

      // Find godot.exe children whose parent is python.exe running our
      // script. We don't have a portable way to read the parent's
      // command line via tasklist, so we additionally check that the
      // parent's parent is the API or one of our spawning shells by
      // walking the tree to find a python.exe ancestor — if any
      // ancestor is python.exe with run_godot_headless.py in its argv,
      // it's ours. Practically, we just check that the direct parent
      // is python.exe; the runner script always spawns godot directly.
      const pythonPids = new Set(all.filter((p) => /^python(\d+)?\.exe$/i.test(p.name)).map((p) => p.pid));
      const godotChildren: WinProc[] = [];
      for (const p of all) {
        if (!/^godot\.exe$/i.test(p.name)) continue;
        if (!pythonPids.has(p.parentPid)) continue;
        godotChildren.push(p);
      }
      if (godotChildren.length === 0) return;

      const killedChildPids: number[] = [];
      for (const child of godotChildren) {
        try {
          execFileSync("taskkill", ["/F", "/PID", String(child.pid)], { timeout: 5000, stdio: "ignore" });
          killedChildPids.push(child.pid);
        } catch {
          // child may have already exited; keep going
        }
      }
      // Walk up from each killed child and kill the python parent too,
      // to release any pending I/O on the runner script.
      const parentPids = new Set(godotChildren.map((c) => c.parentPid).filter((p) => p > 0));
      const killedParentPids: number[] = [];
      for (const parentPid of parentPids) {
        try {
          execFileSync("taskkill", ["/F", "/PID", String(parentPid)], { timeout: 5000, stdio: "ignore" });
          killedParentPids.push(parentPid);
        } catch {
          // parent may have already exited
        }
      }
      logger.info(
        { killedChildPids, killedParentPids, event: "kill_orphaned_subprocesses_win32" },
        `Killed ${killedChildPids.length} orphaned godot child + ${killedParentPids.length} python parent subprocess(es) on win32`,
      );
      return;
    }

    // POSIX: pgrep finds the python3 parent processes running our runner script.
    // The `[r]` character class is the standard shell trick to avoid matching
    // our own API process whose argv might contain the literal string during
    // pattern search. The pattern anchors on the .py suffix so a stray
    // process with "run_godot_headless" anywhere in its command line
    // (e.g. an editor with that file open) doesn't get killed.
    const myPid = process.pid;
    const pids = execFileSync("pgrep", ["-f", "[r]un_godot_headless\\.py"], { timeout: 5000 })
      .toString()
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0 && n !== myPid);

    if (pids.length === 0) return;

    logger.info(
      { pids, event: "kill_orphaned_subprocesses" },
      `Killing ${pids.length} orphaned godot headless subprocess(es)`,
    );

    for (const pid of pids) {
      // Walk the process tree: kill the python parent, then any child
      // godot processes it spawned. Using a negative pid here would only
      // work if the python runner is a process-group leader, which it
      // isn't (we spawn it from the API process group). Walking the
      // tree with `pgrep -P` is portable and doesn't depend on
      // setpgid/posix_spawn semantics.
      const childPids = execFileSync("pgrep", ["-P", String(pid)], { timeout: 5000 })
        .toString()
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      for (const childPid of childPids) {
        try {
          process.kill(childPid, "SIGKILL");
          logger.info({ pid: childPid, parentPid: pid, event: "killed_orphaned_child" }, `Killed orphaned godot child pid=${childPid} (parent=${pid})`);
        } catch {
          // Child may have exited — fall through and try the parent.
        }
      }
      try {
        process.kill(pid, "SIGKILL");
        logger.info({ pid, event: "killed_orphaned_subprocess" }, `Killed orphaned python runner pid=${pid}`);
      } catch {
        // Process may have already exited (race with natural completion).
      }
    }
  } catch {
    // pgrep, pkill, or taskkill not installed / no matches — non-fatal.
  }
}

/**
 * godot-headless-boot-check — MANDATORY post-ticket gate.
 *
 * After each agent ticket completes, this runs `godot --headless --check-only`
 * against the project to verify all scripts and scenes parse without errors.
 *
 * Returns { bootOk: true } on success.
 * Returns { bootOk: false, errors: string[] } on failure — ticket is NOT marked done,
 * it goes back to the queue for the agent to fix.
 *
 * NOTE: `--check-only` hangs in some macOS terminal environments (known Godot issue).
 * The godot-headless.py runner uses a 120s timeout and spawns via subprocess.Popen
 * with platform-specific workarounds. We invoke it the same way RunGodotHeadless does
 * so we benefit from those workarounds.
 */
async function runBootCheck(projectPath: string): Promise<{ bootOk: boolean; errors: string[] }> {
  const config = loadConfig();
  // scripts/godot lives inside WORKSPACE_DIR (workspace/scripts/godot, via symlink)
  const scriptDir = join(config.WORKSPACE_DIR, "scripts", "godot");
  const pythonBin = resolvePipelinePython();
  const home = resolveHomeDir();
  // 24-M-env-var-drift: read GODOT_BIN from the Zod-validated
  // config (already bound to `config` two lines above) instead of
  // `process.env.GODOT_BIN` directly. The 23rd pass added GODOT_BIN
  // to the env schema (config.ts:57) but didn't migrate this
  // consumer. The Zod default is the empty string, so `||` matches
  // the original `??` behavior at the empty-string boundary.
  const godotBin = config.GODOT_BIN || (home ? join(home, ".local/bin/godot_bin/Godot") : "");

  // Validate projectPath is inside the workspace to prevent command injection
  // or path traversal before we even build the command array.
  const resolvedProject = resolve(projectPath);
  const resolvedWorkspace = resolve(config.WORKSPACE_DIR);
  if (!resolvedProject.startsWith(resolvedWorkspace + sep) &&
      resolvedProject !== resolvedWorkspace) {
    return { bootOk: false, errors: [`Project path outside workspace: ${projectPath}`] };
  }

  try {
    // execFile passes args as a vector — no shell interpolation, no injection risk.
    // Q3-6th: use the async variant instead of execFileSync. The sync version
    // blocks the entire event loop for up to 90s, freezing all WS broadcasts
    // and HTTP requests across the process. The async version yields to the
    // event loop so other requests can proceed while Godot boots.
    const scriptPath = join(scriptDir, "run_godot_headless.py");
    const { stdout } = await execFileAsyncLocal(
      pythonBin,
      [scriptPath, "--project", projectPath, "--command", "boot", "--godot-bin", godotBin, "--timeout", "45"],
      { timeout: 90_000, maxBuffer: SUBPROCESS_MAX_BUFFER }, // 90s max (boot is fast, 60s timeout inside script)
    );

    // Parse JSON output from run_godot_headless.py
    let errors: string[] = [];
    try {
      const parsed = JSON.parse(stdout.trim());
      if (!parsed.success || parsed.returnCode !== 0) {
        errors = extractErrors(parsed.stderr ?? "");
      }
    } catch {
      // JSON parse failed — fall back to raw text scanning so we never silently
      // pass with bootOk:true when the script produced malformed output.
      errors = extractErrors(stdout);
    }

    if (errors.length > 0) {
      logger.warn({ projectPath, errors, event: "boot_check_failed" }, `Boot check FAILED for ${projectPath}: ${errors.length} errors`);
      return { bootOk: false, errors };
    } else {
      logger.info({ projectPath, event: "boot_check_passed" }, `Boot check PASSED for ${projectPath}`);
      return { bootOk: true, errors: [] };
    }
  } catch (err: unknown) {
    // execFile throws on non-zero exit — that's the normal failure case
    let errors: string[] = [];
    let errorMsg = "";

    if (err && typeof err === "object" && "stderr" in err) {
      errors = extractErrors(String((err as { stderr: unknown }).stderr ?? ""));
      errorMsg = `exit ${(err as { status?: number }).status ?? "?"}: ${errors.slice(0, 3).join("; ")}`;
    } else {
      errorMsg = err instanceof Error ? err.message : String(err);
    }

    logger.warn({ projectPath, error: errorMsg, event: "boot_check_error" }, `Boot check FAILED: ${errorMsg}`);
    return { bootOk: false, errors: errors.length > 0 ? errors : [`Boot check failed: ${errorMsg}`] };
  }
}

/** Extract fatal error lines from godot headless output.
 * Distinguishes actual parse/script errors from non-fatal warnings.
 * Godot can exit 0 but still report parse errors in stderr — we catch those.
 * Non-fatal: generic ERROR: (often warnings), r克萨斯 errors, driver init messages.
 */
function extractErrors(output: string): string[] {
  if (!output) return [];
  const lines = output.split("\n");

  // Fatal: always indicate a real problem that will prevent the game from running
  const fatalPatterns = [
    { pattern: /SCRIPT ERROR:/, label: "SCRIPT ERROR" },
    { pattern: /Parse Error/, label: "Parse Error" },      // space = Godot parse error
    { pattern: /Parser Error/, label: "Parser Error" },
    { pattern: /Invalid set index/, label: "Invalid set index" },
    { pattern: /Function not found/, label: "Function not found" },
    { pattern: /Export variable not found/, label: "Export not found" },
    // Non-fatal (too broad — skip):
    //   /ERROR:/    — Godot driver init messages, vulkan warnings, etc. not fatal
    //   /Failed to load/ — may be non-critical asset warnings
  ];

  const errorLines: string[] = [];
  for (const line of lines) {
    for (const { pattern, label } of fatalPatterns) {
      if (pattern.test(line)) {
        errorLines.push(line.trim());
        break;
      }
    }
  }

  // Also check returnCode — if Godot crashed (non-zero exit), include a marker
  // The caller handles returnCode separately via parsed.returnCode
  const unique = Array.from(new Set(errorLines));
  return unique.slice(0, 20);
}

export const autonomousRouter: Router = Router();

const config = loadConfig();
const SESSIONS_DIR = join(config.WORKSPACE_DIR, "production", "sessions");

export async function abortAllLoops(): Promise<void> {
  for (const sessionId of activeLoopSessions) {
    const state = await loadLoopState(sessionId);
    if (state && state.status === "running") {
      state.status = "idle";
      state.lastHeartbeat = new Date().toISOString();
      await saveLoopState(state);
    }
    // Signal the in-flight invokeAgent to abort. Without this, the loop's
    // worker IIFE just sees the status flip to "idle" on its next iteration
    // boundary, but the LLM fetch inside runIteration would keep running
    // until the per-attempt 20-minute timeout. That burns credits during
    // graceful shutdown — the whole point of `abortAllLoops` is to stop
    // work quickly.
    const loopAbort = loopAbortControllers.get(sessionId);
    if (loopAbort) {
      loopAbort.abort();
    }
  }
  loopAbortControllers.clear();
  activeLoopSessions.clear();
}

/** Recover loops stuck in 'running' after API restart (no in-memory runner) */
export async function recoverStaleLoopStates(): Promise<number> {
  if (!existsSync(SESSIONS_DIR)) return 0;
  let recovered = 0;
  const now = Date.now();
  try {
    const entries = readdirSync(SESSIONS_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const statePath = join(SESSIONS_DIR, entry.name, "loop-state.json");
      if (!existsSync(statePath)) continue;
      try {
        const raw = await readFileAsync(statePath, "utf-8");
        const state = JSON.parse(raw) as LoopState;
        if (state.status !== "running") continue;
        const age = now - new Date(state.lastHeartbeat).getTime();
        if (age > STALE_LOOP_HEARTBEAT_MS || !activeLoopSessions.has(state.sessionId)) {
          state.status = "idle";
          state.lastError = state.lastError ?? "Recovered stale loop after API restart";
          await saveLoopState(state);
          recovered++;
        }
      } catch { /* skip corrupt */ }
    }
  } catch { /* non-fatal */ }
  return recovered;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoopIteration {
  iteration: number;
  ticketId: string;
  agentRole: string;
  title: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

interface LoopState {
  projectId: string;
  sessionId: string;
  status: "idle" | "running" | "paused" | "done" | "error";
  startedAt: string;
  lastHeartbeat: string;
  currentIteration: number;
  maxIterations: number;
  currentTicketId?: string;
  currentAgentRole?: string;
  completedCount: number;
  failedCount: number;
  iterations: LoopIteration[];
  lastError?: string;
}

interface LoopRunRecord {
  runId: string;
  projectId: string;
  startedAt: string;
  completedAt?: string;
  totalIterations: number;
  completedCount: number;
  failedCount: number;
  status: "completed" | "stopped" | "error" | "exhausted";
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function getLoopStatePath(sessionId: string): string {
  const dir = join(SESSIONS_DIR, sessionId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "loop-state.json");
}

function getLoopHistoryPath(): string {
  const dir = join(SESSIONS_DIR, ".history");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "runs.json");
}

async function loadLoopState(sessionId: string): Promise<LoopState | null> {
  const path = getLoopStatePath(sessionId);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFileAsync(path, "utf-8");
    return JSON.parse(raw) as LoopState;
  } catch (err) {
    // 20-L-swallow-loop-state: log the parse/read failure so a
    // corrupted loop-state file doesn't look like "no loop in
    // progress" to the operator. Sibling failure paths in this
    // file (L459 debugLog, L582 / L636 logger.warn) all log
    // something; the previous bare `catch {}` was the only silent
    // failure in the autonomous startup sequence.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), path, event: "load_loop_state_failed" },
      "loadLoopState: failed to read or parse — treating as no prior state",
    );
    return null;
  }
}

/** Per-session save chain. Maps sessionId → tail of the pending
 * save promise. Each `saveLoopState` call awaits the previous tail
 * before writing, so two writers to the same session serialize
 * (no torn writes, no stale-writer clobbering a fresher state). */
const saveChains = new Map<string, Promise<void>>();

async function saveLoopState(state: LoopState): Promise<void> {
  const path = getLoopStatePath(state.sessionId);
  // Per-session save mutex. Without this, /stop's idle save can be
  // overwritten by a /start / runIteration save in flight on the same
  // sessionId — the IIFE re-saves its locally-buffered state with
  // status="running" and currentIteration=N+1, undoing the stop. The
  // chain is "last write wins" by file mtime, so /stop's intent is
  // silently dropped. The mutex serializes all writes to the same
  // session's state file, so the second writer sees the first writer's
  // state and can react (e.g. skip the save if the iteration is stale).
  const prev = saveChains.get(state.sessionId) ?? Promise.resolve();
  const next = prev.then(async () => {
    // 12-C10: re-read the on-disk state INSIDE the mutex. The
    // pre-check in runIteration (loadLoopState → status check)
    // happens outside the chain, so a /stop that lands between the
    // pre-check and this write would have its "idle" save clobbered
    // by the iteration's "running" save. Inside the mutex chain, we
    // can safely refuse to demote a stop-state back to "running".
    if (state.status === "running") {
      try {
        const diskRaw = await readFileAsync(path, "utf-8");
        const disk = JSON.parse(diskRaw) as LoopState;
        if (disk.status === "idle" || disk.status === "done" || disk.status === "error") {
          logger.info(
            { sessionId: state.sessionId, diskStatus: disk.status, event: "loop_state_save_refused_stop_race" },
            "Refusing to overwrite stop-state with running — /stop or /done already landed",
          );
          return;
        }
      } catch {
        // No on-disk state yet (first save) or unparseable — fall through to write.
      }
    }
    // Atomic write: write to .tmp + rename so a crash mid-write can't
    // leave a truncated loop-state.json that fails to parse on next read.
    // fs.promises.writeFile uses O_CREAT|O_TRUNC; the rename is atomic
    // on the same filesystem, which gives the same crash-safety as
    // fsync+rename without the extra sync(2) syscall on the hot path.
    const tmp = `${path}.tmp`;
    await writeFileAsync(tmp, JSON.stringify(state, null, 2), "utf-8");
    await renameAsync(tmp, path);
  }).catch((err) => {
    // Don't let a single failed save poison the chain for subsequent
    // writers — log and continue. The next save will retry from a
    // clean tail.
    logger.error({ err: (err as Error).message, sessionId: state.sessionId, event: "loop_state_save_failed" },
      "Loop state save failed");
  });
  // 10-H1: capture the catch-wrapped tail into a const so the GC
  // comparison below actually matches. The previous code did
  // `saveChains.set(state.sessionId, next.catch(() => {}))` and
  // then later compared against another `next.catch(() => {})` — but
  // `.catch` returns a *new* promise each call, so the comparison
  // was always false and the entry was never deleted. Every save
  // left a stale entry in the map.
  const tail = next.catch(() => {});
  saveChains.set(state.sessionId, tail);
  // GC: when the chain is idle (no pending writers), drop the entry
  // so an unbounded set of historical sessionIds doesn't grow.
  next.finally(() => {
    if (saveChains.get(state.sessionId) === tail) {
      saveChains.delete(state.sessionId);
    }
  });
  await next;
}

async function loadHistory(): Promise<LoopRunRecord[]> {
  const path = getLoopHistoryPath();
  if (!existsSync(path)) return [];
  try {
    const raw = await readFileAsync(path, "utf-8");
    return JSON.parse(raw) as LoopRunRecord[];
  } catch (err) {
    // 20-L-swallow-loop-state: see sibling comment in loadLoopState.
    // A corrupted run-history file used to silently produce an
    // empty history — the operator would see the loop restart
    // from scratch with no explanation.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), path, event: "load_history_failed" },
      "loadHistory: failed to read or parse — treating as empty history",
    );
    return [];
  }
}

async function saveHistory(history: LoopRunRecord[]): Promise<void> {
  const path = getLoopHistoryPath();
  // Atomic write — see saveLoopState above.
  const tmp = `${path}.tmp`;
  await writeFileAsync(tmp, JSON.stringify(history, null, 2), "utf-8");
  await renameAsync(tmp, path);
}

// Serialize run-history writes. Two concurrent /start or /stop calls each
// call saveRunRecord which does read → mutate → write — without a mutex
// the second caller reads stale state and clobbers the first caller's
// record. Single in-flight chain is enough since writes are rare.
let historyWriteChain: Promise<void> = Promise.resolve();
function saveRunRecord(record: LoopRunRecord): void {
  const next = historyWriteChain.then(async () => {
    const history = await loadHistory();
    const updated = [record, ...history].slice(0, 50);
    await saveHistory(updated);
  }).catch((err) => {
    // Log the failure so a long-running chain of broken writes is visible
    // — but still swallow it so one bad write doesn't poison the chain.
    logger.warn({ err: err instanceof Error ? err.message : String(err), event: "autonomous_history_write_failed" },
      "Failed to persist loop run record — continuing");
  });
  historyWriteChain = next;
}

// ─── Ticket helpers ──────────────────────────────────────────────────────────

const STALE_IN_PROGRESS_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Archive tickets stuck in in_progress for too long (crashed/timed-out iterations).
 * Returns the (possibly mutated) board plus the number of tickets archived.
 *
 * 23-C-cleanup-stale-rmw: routes the read-mutate-write through
 * updateTicketsBoard so the per-file mutex serializes concurrent
 * callers. The previous shape (mutate the passed-in `board` then
 * `writeTicketsBoard`) bypassed the per-file mutex that
 * `updateTicketsBoard` holds — a concurrent `moveQuestTicket` (which
 * does go through the mutex) could read the same baseline, mutate its
 * local copy, and write it *around* the cleanup, clobbering a
 * simultaneously moved ticket. Same fix shape as 22-H-create-build-rmw,
 * 21-C-update-project-engine-rmw, 21-C-dashboard-read-toctou.
 */
async function cleanupStaleInProgress(
  projectId: string,
): Promise<{ board: TicketsBoard; archived: number }> {
  let archived = 0;
  const board = await updateTicketsBoard(projectId, (board) => {
    const now = Date.now();
    let changed = false;

    const inProgressCol = board.columns.find((c) => c.id === "in_progress");
    if (!inProgressCol || inProgressCol.tickets.length === 0) {
      return board;
    }

    const stillValid: Ticket[] = [];
    const toArchive: Ticket[] = [];

    for (const ticket of inProgressCol.tickets) {
      const age = now - new Date(ticket.updatedAt).getTime();
      if (age > STALE_IN_PROGRESS_THRESHOLD_MS) {
        toArchive.push(ticket);
        changed = true;
      } else {
        stillValid.push(ticket);
      }
    }

    if (!changed) return board;

    inProgressCol.tickets = stillValid;

    // Move stale tickets to qa column for review (not directly to completed —
    // an agent crash can leave the project in a broken state; reviewer checks the diff)
    const qaCol = board.columns.find((c) => c.id === "qa");
    if (qaCol) {
      for (const t of toArchive) {
        t.status = "qa";
        t.updatedAt = new Date().toISOString();
        qaCol.tickets.push(t);
      }
    }

    archived = toArchive.length;
    return board;
  });

  if (archived > 0) {
    logger.info({ projectId, archived, event: "stale_in_progress_archived" }, `Archived ${archived} stale in_progress tickets`);
  }
  return { board, archived };
}

function getNextAvailableTicket(board: TicketsBoard): Ticket | null {
  const col = board.columns.find((c) => c.id === "available");
  if (!col || col.tickets.length === 0) return null;
  // Pick oldest ticket (FIFO) — copy first so the in-place sort doesn't
  // mutate the caller's board state and re-order tickets on every poll.
  return [...col.tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
}

function assignTicketToAgent(ticket: Ticket): AgentRole {
  const assignee = ticket.assignee as string;
  if (assignee && assignee !== "unassigned") return assignee as AgentRole;

  // Priority: explicit agentRole on ticket > area-based fallback
  if (ticket.agentRole) return ticket.agentRole as AgentRole;

  // Fallback mapping by area
  const areaMap: Record<string, AgentRole> = {
    engineering: "godot-specialist",
    content: "writer",
    design: "creative-director",
    qa: "qa-tester",
    art: "art-director",
  };
  return areaMap[ticket.area] ?? "godot-specialist";
}

function makeTokenTracker(sessionId: string, projectId: string) {
  return (usage: { input_tokens: number; output_tokens: number }) => {
    // 16-H-void-record-token-usage: persistChatStore-style write inside.
    // Failures must not crash the loop via unhandledRejection.
    recordTokenUsage(sessionId, projectId, usage).catch((err) => {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), event: "record_token_usage_failed" },
        "Failed to record token usage — continuing",
      );
    });
  };
}

async function producerSprintReplan(
  state: LoopState,
  projectContext: ReadyProjectContext,
): Promise<void> {
  try {
    await invokeAgent(
      "autonomous-producer" as AgentRole,
      `[SPRINT REPLAN] Queue empty at iteration ${state.currentIteration}. Review board, producer summary, and GDD. Suggest new tickets or confirm templates exhausted. Use CreateTicket for gaps. Planning only — do not spawn subagents for implementation.`,
      state.sessionId,
      undefined,
      undefined,
      undefined,
      false,
      1,
      projectContext,
      undefined,
      makeTokenTracker(state.sessionId, state.projectId),
    );
    await externalizeProductionNote(
      state.projectId,
      "sprint-replan",
      `Autonomous producer replan at iteration ${state.currentIteration}`,
    );
  } catch (err) {
    // 19-M-replan-error: capture the failure into the producer summary
    // so the next replan attempt (or the producer session's next
    // message) sees the prior failure, instead of silently swallowing
    // it. Previously the catch logged `producer_replan_skipped` with
    // no reason, so a persistent LLM outage during replan would burn
    // every 5th iteration's worth of `generateTickets` invocations
    // while the operator had no way to tell from logs whether the
    // replan was skipped on purpose (board was healthy) or because
    // the LLM call was 500ing. The producer summary fact is the
    // canonical "what happened" feed for the next producer prompt.
    logger.warn(
      { projectId: state.projectId, event: "producer_replan_failed", err: err instanceof Error ? err.message : String(err) },
      "Sprint replan failed",
    );
    safeIngestProducerSummaryFact(state.projectId, {
      kind: "producer_replan_failed",
      at: new Date().toISOString(),
      title: `Sprint replan failed at iteration ${state.currentIteration}`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

async function moveTicket(projectId: string, ticketId: string, status: string): Promise<Ticket | null> {
  // 14-H2-move-ticket-toctou: returns the post-move ticket (or null if
  // not found) so callers don't need a second readTicketsBoard() that
  // would race against any other writer that touches the board between
  // this move and the re-read. Previously the loop did
  //   await moveTicket(...); const qaTicket = (await readTicketsBoard(...)).columns...
  // and a concurrent UI drag (or another autonomous iteration) could
  // move/remove the ticket in the gap, so triggerVerification() was
  // silently skipped. Now the post-move snapshot is captured under the
  // same mutex as the move itself.
  let moved: Ticket | null = null;
  await updateTicketsBoard(projectId, (data) => {
    for (const column of data.columns) {
      const idx = column.tickets.findIndex((t) => t.id === ticketId);
      if (idx !== -1) {
        const ticket = column.tickets[idx];
        column.tickets.splice(idx, 1);
        const destCol = data.columns.find((c) => c.id === status);
        if (destCol) {
          const updated: Ticket = { ...ticket, status: status as Ticket["status"], updatedAt: new Date().toISOString() };
          destCol.tickets.push(updated);
          moved = updated;
        }
        return data;
      }
    }
    return data;
  });
  return moved;
}

async function getProjectContext(projectId: string): Promise<ProjectContext | undefined> {
  const data = await readData<DashboardData>("dashboard.json");
  const project = data.projects.find((p) => p.id === projectId);
  if (!project) return undefined;

  let engine = project.engine;
  // Auto-detect engine if not set
  const effectiveWorkspacePath = project.workspacePath ?? project.id;
  if (!engine && effectiveWorkspacePath) {
    const detected = await detectEngineFromWorkspace(effectiveWorkspacePath);
    if (detected) engine = detected as "godot" | "unreal" | "unity" | "phaser" | "threejs";
  }

  return {
    name: project.name,
    description: project.description,
    engine,
    workspacePath: effectiveWorkspacePath,
    projectId: project.id,
  };
}

// ─── Core loop step ──────────────────────────────────────────────────────────

async function runIteration(state: LoopState, board: TicketsBoard, projectContext: ReadyProjectContext, abortSignal?: AbortSignal): Promise<{ ticket: Ticket | null; done: boolean; error?: string }> {
  debugLog(`runIteration ENTRY iter=${state.currentIteration}, projectContext.engine=${projectContext.engine}, workspacePath=${projectContext.workspacePath}`);

  // Clean up stale in_progress tickets (from crashed/timed-out iterations)
  const cleanup = await cleanupStaleInProgress(state.projectId);
  board = cleanup.board;

  let ticket = getNextAvailableTicket(board);
  debugLog(`getNextAvailableTicket result: ${ticket ? `ticket.id=${ticket.id}, title=${ticket.title}` : "null (queue empty)"}`);

    // Queue empty — generate new tickets from GDD analysis
    if (!ticket) {
      const completedCol = board.columns.find((c) => c.id === "completed");
      const totalCompleted = completedCol?.tickets.length ?? 0;

      debugLog(`queue empty, completedCount=${totalCompleted}, generating tickets...`);

      if (state.currentIteration > 0 && state.currentIteration % 5 === 0) {
        await producerSprintReplan(state, projectContext);
      }

      try {
        const newTickets = await generateTickets(
          state.projectId,
          projectContext.workspacePath,
          projectContext.description,
        );
        debugLog(`generateTickets returned ${newTickets.length} tickets`);

        if (newTickets.length > 0) {
          await addTicketsToBoard(state.projectId, newTickets);
          logger.info(`Generated ${newTickets.length} new tickets`);
          const refreshedBoard = await readTicketsBoard(state.projectId);
          ticket = getNextAvailableTicket(refreshedBoard);
          debugLog(`queue replenished: ${newTickets.length} tickets added, getNextAvailableTicket=${ticket ? "got ticket" : "still null"}`);
        } else if (totalCompleted > 0) {
          debugLog(`all ${totalCompleted} feature templates exhausted — loop done`);
          void fireWebhook("autonomous:completed", { projectId: state.projectId, sessionId: state.sessionId, completedCount: totalCompleted });
          try {
            await generateProjectChangelog(state.projectId, projectContext.workspacePath);
            await executeGodotExport(state.projectId, projectContext.workspacePath, "web", undefined, true);
          } catch { /* non-fatal ship step */ }
          return { ticket: null, done: true };
        } else {
          // No completed tickets AND zero new tickets — either first run with no templates
          // applicable to this project, or templates are being filtered out entirely.
          // Continue retrying but cap at maxIterations so we don't loop forever.
          debugLog(`no tickets generated and nothing completed yet — will retry (iter=${state.currentIteration}/${state.maxIterations})`);
          return { ticket: null, done: false };
        }
      } catch (err) {
        logger.error({ err, event: "ticket_generation_failed" }, "Ticket generation failed");
        return { ticket: null, done: false };
      }
    }

  if (!ticket) {
    debugLog("runIteration exiting without ticket after generation attempt");
    return { ticket: null, done: false };
  }

  const activeTicket = ticket;

  state.currentTicketId = activeTicket.id;
  state.currentAgentRole = assignTicketToAgent(activeTicket);
  state.status = "running";

  const iteration: LoopIteration = {
    iteration: state.currentIteration,
    ticketId: activeTicket.id,
    agentRole: state.currentAgentRole,
    title: activeTicket.title,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  state.iterations.push(iteration);
  await saveLoopState(state);

  // Broadcast iteration start
  broadcast({
    type: "autonomous:iteration:started",
    sessionId: state.sessionId,
    ticketId: activeTicket.id,
    agentRole: state.currentAgentRole,
    title: activeTicket.title,
    iteration: state.currentIteration,
  } as WSEvent);

  safeIngestProducerSummaryFact(state.projectId, {
    kind: "autonomous_iteration_started",
    at: new Date().toISOString(),
    ticketId: activeTicket.id,
    title: activeTicket.title,
    agentRole: state.currentAgentRole,
    detail: `iteration ${state.currentIteration}`,
  });

  // Move ticket to in_progress
  await moveTicket(state.projectId, activeTicket.id, "in_progress");

  // Per-ticket retry with exponential backoff for transient fetch failures.
  // "fetch failed" = Node.js network error (ZAI API unreachable). These are often
  // temporary — retry up to 3 times before treating as a real failure.
  const MAX_TICKET_RETRIES = 3;
  const RETRY_DELAYS = [15_000, 30_000, 60_000]; // 15s, 30s, 60s
  let agentResult: { content?: string } | null = null;
  let agentError = "";
  let attempt = 0;
  let agentRejected = false;

  while (attempt <= MAX_TICKET_RETRIES) {
    attempt++;
    const AGENT_TIMEOUT_MS = 1_200_000; // 20 minutes per attempt

    // AbortController is wired through `invokeAgent` → `callLLMWithTools` so
    // that when the timeout fires, the in-flight LLM request is actually
    // cancelled. Without this, `Promise.race` would stop awaiting the agent
    // promise but the LLM fetch would keep running, eventually completing and
    // potentially mutating shared state (token usage, broadcast events) after
    // the autonomous loop has moved on.
    //
    // The abort signal is also linked to the loop-level abort signal
    // (signalled by /stop) so that stopping the loop cancels the in-flight
    // invokeAgent immediately rather than waiting for the 20-minute timeout.
    const agentAbort = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        agentAbort.abort();
      } else {
        abortSignal.addEventListener("abort", () => agentAbort.abort(), { once: true });
      }
    }
    const agentPromise = invokeAgent(
      state.currentAgentRole as AgentRole,
      `[AUTONOMOUS TICKET] ${activeTicket.description || activeTicket.title}${attempt > 1 ? ` (retry ${attempt}/${MAX_TICKET_RETRIES})` : ""}`,
      state.sessionId,
      attempt > 1 ? `Previous attempt failed with: ${agentError}. Fix the issue and retry.` : undefined,
      undefined, // conversationHistory
      undefined, // onProgress
      true,      // broadcastEvents
      1,         // depth
      projectContext,
      undefined,
      makeTokenTracker(state.sessionId, state.projectId),
      agentAbort.signal,
    );

    // 26-H-timeout-leak: previously the setTimeout that backs
    // timeoutPromise was never cleared when agentPromise won
    // the race. The timer kept the event loop alive for up to
    // AGENT_TIMEOUT_MS (30s default) after a successful
    // completion — invisible in production (other things keep
    // the loop alive) but a 30-second tail on every fast
    // agent completion during tests / graceful shutdown. Also
    // harmless-but-noisy: the agentAbort.abort() inside the
    // timer callback ran on an already-settled controller
    // after a successful race. Wrap the timer in a handle and
    // clear it on both the agent-wins and the timeout-wins
    // paths. The 11th pass fixed the same pattern elsewhere;
    // this is the second instance.
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        // Cancel the LLM call so it doesn't keep running in the background.
        agentAbort.abort();
        reject(new Error(`Agent timed out after ${AGENT_TIMEOUT_MS / 1000}s — godot-specialist likely hanging on a Godot MCP tool. The MCP per-tool timeout is 30s; if a tool hangs past that the MCP service kills it. Check that Godot editor is running with godot_mcp plugin and MCP port 6005 is reachable.`));
      }, AGENT_TIMEOUT_MS);
    });

    agentRejected = false;
    try {
      agentResult = await Promise.race([agentPromise, timeoutPromise]);
    } catch (err: unknown) {
      agentRejected = true;
      agentError = err instanceof Error ? err.message : String(err);
    } finally {
      // Clear whichever side won. setTimeout's handle is
      // always non-null after the timeoutPromise constructor
      // returned; the null-check is defensive in case the
      // race resolved synchronously before the timer was
      // registered.
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }

    if (!agentRejected) {
      // Agent completed successfully
      break;
    }

    // Classify the error
    const isFetchFailure = agentError.includes("fetch failed") || agentError.includes("fetch() failed");
    const isTimeout = agentError.includes("timed out") || agentError.includes("timeout");
    const isBootFailure = agentError.includes("Boot check failed");

    if (isFetchFailure && attempt <= MAX_TICKET_RETRIES) {
      logger.warn({ ticketId: activeTicket.id, attempt, error: agentError, event: "retry_fetch_failure" },
        `ZAI fetch failure on attempt ${attempt}/${MAX_TICKET_RETRIES} — retrying in ${RETRY_DELAYS[attempt - 1] / 1000}s`);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
      continue;
    }

    // Non-retryable or max retries exceeded — stop retrying
    if (attempt > MAX_TICKET_RETRIES) {
      logger.warn({ ticketId: activeTicket.id, error: agentError, event: "max_retries_exceeded" },
        `Ticket ${activeTicket.id} failed after ${MAX_TICKET_RETRIES} retries — giving up`);
    }
    break;
  }

  agentRejected = agentError.length > 0 && !agentResult;

  if (agentRejected) {
    // Kill any orphaned godot/python subprocesses left behind by timed-out agents
    killOrphanedSubprocesses();

    // Even on crash/timeout, run boot check — a crashed agent may have left
    // the project in a broken state (parse errors, half-written files).
    // Skip boot check only if we have no valid project path.
    let bootOk = true;
    let bootErrors: string[] = [];
    if (projectContext.workspacePath) {
      const fullProjectPath = resolveProjectWorkspace(projectContext.workspacePath);
      const bootResult = await runBootCheck(fullProjectPath);
      bootOk = bootResult.bootOk;
      bootErrors = bootResult.errors;
    } else {
      // No workspace path — can't validate; treat as unhealthy so reviewer inspects
      bootOk = false;
      bootErrors = [`No workspacePath configured for projectId=${state.projectId}`];
    }

    // Build the failure description
    const crashPrefix = bootOk
      ? `[Agent crashed/timed out — project health OK]\n`
      : `[Agent crashed/timed out — boot check FAILED]\n`;
    const combinedError = crashPrefix
      + (bootErrors.length > 0 ? `Boot errors:\n${bootErrors.slice(0, 5).join("\n")}\n\n` : "")
      + `Agent error:\n${agentError}`;

    iteration.status = "failed";
    iteration.completedAt = new Date().toISOString();
    iteration.error = combinedError;
    state.failedCount++;
    state.lastError = combinedError;
    state.lastHeartbeat = new Date().toISOString();

    // Route to QA for code reviewer + LLM verification. moveTicket
    // now returns the post-move snapshot under the same mutex, so we
    // don't need a second readTicketsBoard() that would race against
    // any other writer.
    const qaTicket = await moveTicket(state.projectId, activeTicket.id, "qa");
    if (qaTicket) {
      triggerVerification({ ...qaTicket, sessionId: state.sessionId }, combinedError);
    }

    // Invoke code-reviewer to analyze what went wrong and provide diagnostic feedback.
    // This runs async (non-blocking) so the loop isn't slowed down by a second LLM call.
    // Errors from the reviewer are logged but never block the loop.
    invokeAgent(
      "code-reviewer" as AgentRole,
      `Code review task — analyze this failed ticket and provide diagnostic feedback.

**Ticket:** ${activeTicket.title}
**Agent:** ${state.currentAgentRole}
**Error:** ${combinedError}
**Project workspace:** ${projectContext.workspacePath ?? "unknown"}

Review the godot-specialist's recent changes in the project workspace above.
Identify what likely caused the failure. Be specific — point to files, functions, or patterns.
If the failure is a known Godot gotcha (e.g. class_name conflicts, tilemap tool limits, etc.), note it.
If the failure is an infinite loop or hang (timeout), suggest a workaround.`,
      state.sessionId,
      undefined, // no additional context needed — workspace path is in the projectContext
      undefined, // no conversation history
      undefined, // no onProgress
      false,     // don't broadcast reviewer events — it's background analysis
      1,
      projectContext,
      undefined,
      makeTokenTracker(state.sessionId, state.projectId),
    ).then((result) => {
      logger.info({ ticketId: activeTicket.id, reviewLength: result.content.length, event: "code_review_done" },
        `Code review for failed ticket ${activeTicket.id}: ${result.content.slice(0, 200)}`);
    }).catch((err) => {
      logger.warn({ ticketId: activeTicket.id, error: err.message, event: "code_review_error" },
        `Code reviewer failed for ticket ${activeTicket.id}: ${err.message}`);
    });

    broadcast({
      type: "autonomous:iteration:failed",
      sessionId: state.sessionId,
      ticketId: activeTicket.id,
      agentRole: activeTicket.agentRole ?? "godot-specialist",
      iteration: state.currentIteration,
      // 12-H3: truncate the broadcast error. The full error stays in
      // `iteration.error` (persisted in LoopState), but the WS event
      // sent to every connected client is bounded. Without this, a
      // misconfigured project that times out 200 iterations in a row
      // floods every connected UI with the same multi-KB error string
      // each tick — visible as 200 toast popups and a chat-thread
      // scroll-storm. Truncation to 500 chars keeps the message
      // diagnosable from the UI while cutting payload size by ~10x
      // for typical boot-failure + agent-hang chains.
      error: combinedError.slice(0, 500),
      bootOk,
      // Boot errors are already capped to 5 in the source string, but
      // each one can itself be a multi-line stack trace. Slice each
      // entry so the broadcast doesn't carry the full crash dump.
      bootErrors: bootErrors.slice(0, 5).map((e) => e.slice(0, 200)),
    } as WSEvent);

    safeIngestProducerSummaryFact(state.projectId, {
      kind: "autonomous_iteration_failed",
      at: new Date().toISOString(),
      ticketId: activeTicket.id,
      title: activeTicket.title,
      agentRole: state.currentAgentRole,
      detail: combinedError.slice(0, 400),
    });
  } else {
    // Agent completed — run executable QA gate chain before marking ticket done.
    let qaPassed = true;
    let qaSummary = "";
    let qaEvidence = {};

    if (!projectContext.workspacePath) {
      qaPassed = false;
      qaSummary = `Project workspacePath not configured (projectId=${state.projectId})`;
    } else {
      const qaResult = runQAGateChain(projectContext.workspacePath, state.projectId);
      qaPassed = qaResult.passed;
      qaSummary = qaResult.summary;
      qaEvidence = qaResult.evidence;

      const fullProjectPath = resolveProjectWorkspace(projectContext.workspacePath);
      saveTestEvidenceArtifact(fullProjectPath, activeTicket.id, qaResult.evidence);

      await updateTicketsBoard(state.projectId, (board) => {
        for (const col of board.columns) {
          const t = col.tickets.find((x) => x.id === activeTicket.id);
          if (t) t.testEvidence = qaResult.evidence;
        }
        return board;
      });

      // 16-H-void-upsert-run-metrics: write through updateData;
      // crash on failure would kill the loop.
      upsertRunMetrics({
        sessionId: state.sessionId,
        projectId: state.projectId,
        qaGatePasses: qaPassed ? (state.completedCount + 1) : state.completedCount,
        qaGateFailures: qaPassed ? state.failedCount : state.failedCount + 1,
        completedCount: state.completedCount,
        failedCount: state.failedCount,
        totalIterations: state.currentIteration,
      }).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), event: "upsert_run_metrics_failed" },
          "Failed to upsert run metrics — continuing",
        );
      });
    }

    if (!qaPassed) {
      iteration.status = "failed";
      iteration.completedAt = new Date().toISOString();
      iteration.error = `QA gate failed: ${qaSummary}\n\nAgent output:\n${agentResult?.content?.slice(0, 300) ?? ""}`;
      iteration.output = iteration.error;
      state.failedCount++;
      state.lastError = iteration.error;
      state.lastHeartbeat = new Date().toISOString();

      await moveTicket(state.projectId, activeTicket.id, "available");

      broadcast({
        type: "autonomous:iteration:boot_check_failed",
        sessionId: state.sessionId,
        ticketId: activeTicket.id,
        iteration: state.currentIteration,
        errors: [qaSummary],
      } as WSEvent);

      safeIngestProducerSummaryFact(state.projectId, {
        kind: "autonomous_iteration_boot_check_failed",
        at: new Date().toISOString(),
        ticketId: activeTicket.id,
        title: activeTicket.title,
        detail: qaSummary.slice(0, 400),
      });
    } else {
      // QA gates passed — move to verify column for LLM supplement, then complete
      iteration.status = "completed";
      iteration.completedAt = new Date().toISOString();
      iteration.output = agentResult?.content?.slice(0, 500);
      state.completedCount++;
      state.lastHeartbeat = new Date().toISOString();

      await moveTicket(state.projectId, activeTicket.id, "qa");

      const verifyTicket = (await readTicketsBoard(state.projectId)).columns
        .flatMap((c) => c.tickets)
        .find((t) => t.id === activeTicket.id);
      if (verifyTicket) {
        triggerVerification(
          { ...verifyTicket, sessionId: state.sessionId, testEvidence: qaEvidence as typeof verifyTicket.testEvidence },
          `${agentResult?.content ?? ""}\n\nQA: ${qaSummary}`,
        );
      } else {
        await moveTicket(state.projectId, activeTicket.id, "completed");
      }

      const gateContext = `Milestone check after ticket "${activeTicket.title}". Completed: ${state.completedCount}. Agent output:\n${agentResult?.content?.slice(0, 1500) ?? ""}`;
      // 16-H-void-advance-milestone: same pattern — failure in the
      // milestone gate must not bubble up to unhandledRejection.
      advanceMilestoneIfReady(state.projectId, state.sessionId, state.completedCount, gateContext).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), projectId: state.projectId, event: "advance_milestone_failed" },
          "Failed to advance milestone — continuing",
        );
      });

      // 16-H-void-externalize-note: file write under workspace/wiki;
      // transient EIO/ENOSPC would crash the loop without this catch.
      externalizeProductionNote(
        state.projectId,
        "ticket-completed",
        `${activeTicket.title}: ${qaSummary}`,
      ).catch((err) => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), projectId: state.projectId, event: "externalize_note_failed" },
          "Failed to externalize production note — continuing",
        );
      });

      broadcast({
        type: "autonomous:iteration:completed",
        sessionId: state.sessionId,
        ticketId: activeTicket.id,
        iteration: state.currentIteration,
        completedCount: state.completedCount,
      } as WSEvent);

      safeIngestProducerSummaryFact(state.projectId, {
        kind: "autonomous_iteration_completed",
        at: new Date().toISOString(),
        ticketId: activeTicket.id,
        title: activeTicket.title,
        agentRole: state.currentAgentRole,
        detail: `completedCount=${state.completedCount}`,
      });
    }
  }

  state.currentIteration++;
  state.currentTicketId = undefined;
  state.currentAgentRole = undefined;
  // Reload from disk before saving so a concurrent /stop's idle save
  // (or a /start that picked up while we were iterating) isn't clobbered
  // by our locally-buffered "running" state. If the disk state shows a
  // status that the iteration shouldn't be in (idle / error / done), or
  // the iteration counter has moved on, merge instead of overwriting.
  const onDisk = await loadLoopState(state.sessionId);
  if (onDisk && onDisk.status !== "running") {
    logger.info({ sessionId: state.sessionId, diskStatus: onDisk.status, iter: state.currentIteration, event: "iteration_save_skipped_stopped" },
      "Skipping iteration save — loop was stopped or finished while this iteration was running");
    return { ticket: activeTicket, done: true };
  }
  if (onDisk && onDisk.currentIteration > state.currentIteration) {
    // Another writer (a concurrent iteration or a manually edited state)
    // has a higher iteration count. Don't regress.
    logger.warn({ sessionId: state.sessionId, diskIter: onDisk.currentIteration, ourIter: state.currentIteration, event: "iteration_save_skipped_stale" },
      "Skipping iteration save — disk state has a higher iteration count");
    return { ticket: activeTicket, done: false };
  }
  await saveLoopState(state);

  // Check if we've hit max iterations
  if (state.currentIteration >= state.maxIterations) {
    return { ticket: activeTicket, done: true };
  }

  return { ticket: activeTicket, done: false };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /autonomous/start — Start or resume the autonomous loop
autonomousRouter.post("/start", async (req: Request, res: Response) => {
  const { sessionId, projectId } = req.body as {
    sessionId?: string;
    projectId?: string;
    maxIterations?: number;
  };
  // Clamp maxIterations to [1, 500] so a client can't request an effectively
  // infinite loop. Anything beyond 500 iterations is almost certainly a bug
  // or a runaway request.
  const rawMaxIterations = (req.body as { maxIterations?: number }).maxIterations ?? 200;
  const maxIterations = Math.min(Math.max(parseInt(String(rawMaxIterations), 10) || 200, 1), 500);

  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  if (!projectId) {
    res.status(400).json({ success: false, error: "projectId is required" });
    return;
  }

  // Serialize /start per sessionId BEFORE the first await. Two concurrent
  // /start calls for the same sessionId can otherwise both pass the
  // duplicate-running check below (the set membership is updated only
  // after the awaits complete) and both spawn their own IIFEs.
  if (pendingStarts.has(sessionId) || activeLoopSessions.has(sessionId)) {
    res.status(409).json({ success: false, error: "Loop start already in progress" });
    return;
  }
  pendingStarts.add(sessionId);
  // Track whether the lock was handed off to the IIFE. If the handler
  // returns or throws before line ~1205, the finally must release
  // `pendingStarts` or the session is permanently unstartable.
  let lockHandedOff = false;
  try {
  const projectContext = await getProjectContext(projectId);
  if (!projectContext) {
    pendingStarts.delete(sessionId);
    res.status(404).json({ success: false, error: `Project ${projectId} not found` });
    return;
  }

  const workspacePath = projectContext.workspacePath;
  if (!workspacePath) {
    pendingStarts.delete(sessionId);
    res.status(400).json({
      success: false,
      error: `Project ${projectId} has no workspacePath. Configure a workspace before starting autonomous mode.`,
    });
    return;
  }

  const workspaceAbsPath = resolveProjectWorkspace(workspacePath);
  if (!existsSync(workspaceAbsPath)) {
    pendingStarts.delete(sessionId);
    res.status(400).json({
      success: false,
      error: `Project workspace does not exist: ${workspacePath}`,
    });
    return;
  }

  const readyProjectContext: ReadyProjectContext = {
    ...projectContext,
    workspacePath,
  };

  const existing = await loadLoopState(sessionId);

  // Allow resume if persisted 'running' but no active in-memory runner (zombie after restart)
  if (existing && existing.status === "running" && (activeLoopSessions.has(sessionId) || pendingStarts.has(sessionId))) {
    pendingStarts.delete(sessionId);
    res.status(409).json({ success: false, error: "Loop already running", data: existing });
    return;
  }
  if (existing && existing.status === "running") {
    existing.status = "idle";
    await saveLoopState(existing);
  }

  // Auto-ingest GDD tickets on start
  void ingestGDD(sessionId, projectId, { broadcast: true }).then((gddResult) => {
    if (gddResult.created > 0) {
      logger.info({ projectId, created: gddResult.created, event: "autonomous_gdd_ingest" }, `Auto-ingested ${gddResult.created} GDD tickets`);
    }
  }).catch(() => { /* non-fatal */ });

  broadcast({
    type: "autonomous:started",
    sessionId,
    projectId,
    gameType: readyProjectContext.description?.slice(0, 80),
  } as WSEvent);

  // 16-H-void-upsert-run-metrics: see comment at the other call site.
  upsertRunMetrics({ sessionId, projectId, startedAt: new Date().toISOString() }).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), event: "upsert_run_metrics_failed" },
      "Failed to upsert run metrics (startedAt) — continuing",
    );
  });

  const state: LoopState = existing && existing.status !== "idle"
    ? { ...existing, status: "running", maxIterations, lastHeartbeat: new Date().toISOString() }
    : {
        projectId,
        sessionId,
        status: "running",
        startedAt: existing?.startedAt ?? new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        currentIteration: existing?.currentIteration ?? 0,
        maxIterations,
        completedCount: existing?.completedCount ?? 0,
        failedCount: existing?.failedCount ?? 0,
        iterations: existing?.iterations ?? [],
      };

  await saveLoopState(state);

  // Re-check after all the disk + project lookups. A /stop that came in
  // while we were awaiting getProjectContext would have set the persisted
  // state back to "idle" — starting a new IIFE in that case would race
  // against the just-stopped loop and start a fresh run. Bail before we
  // even create the AbortController.
  const postCheck = await loadLoopState(sessionId);
  if (postCheck && postCheck.status === "idle" && postCheck.lastHeartbeat !== state.lastHeartbeat) {
    logger.warn({ sessionId, event: "autonomous_start_race_stopped" },
      "Concurrent /stop cancelled /start — abandoning new loop");
    pendingStarts.delete(sessionId);
    res.status(409).json({
      success: false,
      error: "Loop was stopped while /start was processing",
      data: postCheck,
    });
    return;
  }

  // Kick off the loop asynchronously (don't block the HTTP response)
  // Hand off the per-sessionId lock from `pendingStarts` to
  // `activeLoopSessions`. The IIFE's `.finally` cleans up
  // `activeLoopSessions` on completion; `pendingStarts` no longer
  // holds the entry because the validation phase is done.
  pendingStarts.delete(sessionId);
  try {
    activeLoopSessions.add(sessionId);
    lockHandedOff = true;
  } catch (err) {
    // 12-C15: defensive handover. If `activeLoopSessions.add` ever
    // throws (frozen Set, OOM, etc.), the pendingStarts entry is
    // already gone but the IIFE will not register. Re-add to
    // pendingStarts so a subsequent /start can retry.
    // 14-CR-autonomous: set lockHandedOff = true BEFORE the re-add
    // so the outer finally's `if (!lockHandedOff)` branch skips the
    // pendingStarts.delete. The previous code rethrew without
    // setting the flag, so the finally ran and undid the re-add —
    // leaving the session permanently un-startable (no entry in
    // pendingStarts, no entry in activeLoopSessions, persisted
    // state still "running" → /stop couldn't find it either).
    lockHandedOff = true;
    pendingStarts.add(sessionId);
    throw err;
  }
  // Per-session AbortController: /stop signals it to cancel the in-flight
  // invokeAgent (and the LLM fetch) so the loop exits immediately rather
  // than waiting for the current ticket to finish (up to 20 min).
  const loopAbort = new AbortController();
  loopAbortControllers.set(sessionId, loopAbort);
  (async () => {
    debugLog(`batch ${state.sessionId}] async loop started, projectId=${state.projectId}`);

    // Autonomous producer sprint planning at loop start
    try {
      await invokeAgent(
        "autonomous-producer" as AgentRole,
        `[SPRINT PLAN] Review project ${state.projectId} ticket board and producer summary. Confirm sprint priorities. Do not spawn subagents — planning only.`,
        state.sessionId,
        undefined,
        undefined,
        undefined,
        false,
        1,
        readyProjectContext,
        undefined,
        makeTokenTracker(state.sessionId, state.projectId),
      );
    } catch (err) {
      // 21-M-producer-plan-swallow: include `err` in the structured
      // log so a recurring LLM outage during the producer's first
      // planning call surfaces a real cause. The previous bare
      // `catch {}` discarded the error and only logged an event
      // discriminator, so a sustained LLM 500 looked like "skipped
      // on purpose". Sibling sprint-replan (L782) already includes
      // both `event` and `err`.
      logger.warn(
        { projectId: state.projectId, err: err instanceof Error ? err.message : String(err), event: "producer_plan_failed" },
        "Autonomous producer planning failed — continuing without planning step",
      );
    }

    debugLog(`batch ${state.sessionId}] validated projectContext engine=${readyProjectContext.engine}, workspacePath=${readyProjectContext.workspacePath}`);

    // Start Godot MCP service for godot projects (mirrors chat.ts logic)
    if (readyProjectContext.engine === "godot") {
      const mcpOptions: GodotMCPServiceOptions = {
        projectPath: readyProjectContext.workspacePath,
        mode: "lite",
      };
      logger.info({ projectId: state.projectId, engine: readyProjectContext.engine, event: "autonomous_mcp_starting" },
        "Starting Godot MCP service for autonomous loop");
      getOrCreateGodotMCPService(state.projectId, mcpOptions).then((service) => {
        logger.info({ projectId: state.projectId, running: service.running(), event: "autonomous_mcp_started" },
          "Godot MCP service ready");
      }).catch((err) => {
        logger.error({ projectId: state.projectId, error: err.message, event: "autonomous_mcp_start_error" },
          "Failed to start Godot MCP service — agents will fall back to file I/O");
      });

      // Auto-launch Godot editor if workspace path is known.
      // 16-H-launch-godot-fire-forget: launchGodotEditor is now async
      // because the plugin install was made async to avoid blocking
      // the event loop. The autonomous loop must not block on Godot
      // startup, so fire-and-forget and log the outcome when settled.
      const projectDir = resolveProjectWorkspace(readyProjectContext.workspacePath);
      launchGodotEditor(projectDir).then((launchResult) => {
        if (launchResult.success) {
          logger.info({ projectId: state.projectId, pid: launchResult.pid, event: "godot_editor_launched" },
            `Godot editor launched (pid=${launchResult.pid})`);
        } else {
          logger.warn({ projectId: state.projectId, error: launchResult.error, event: "godot_editor_launch_failed" },
            `Godot editor launch failed: ${launchResult.error}`);
        }
      }).catch((err) => {
        logger.warn({ projectId: state.projectId, err: err instanceof Error ? err.message : String(err), event: "godot_editor_launch_failed" },
          "Godot editor launch failed (rejected promise)");
      });
    }

    let currentState = (await loadLoopState(state.sessionId))!;
    let done = false;

    debugLog(`batch ${state.sessionId}] starting while loop`);
    // 14-H-autonomous-heartbeat: tick the heartbeat every 60s while the
    // loop is running, so an in-flight 20-min invokeAgent doesn't
    // appear stale to recoverStaleLoopStates() on API restart. Without
    // this, an API restart during a long iteration would mark the
    // session "idle", but the in-flight LLM call would still complete
    // and write its locally-buffered state with status="running" —
    // racing against a fresh /start that picked up the recovered idle
    // session. The 60s interval is well under the 5-min stale
    // threshold (STALE_LOOP_HEARTBEAT_MS) and saves happen on the
    // same file as runIteration's own updates.
    const heartbeatTimer = setInterval(() => {
      void saveLoopState({ ...currentState, lastHeartbeat: new Date().toISOString() }).catch((err) => {
        logger.warn(
          { sessionId: state.sessionId, err: err instanceof Error ? err.message : String(err), event: "autonomous_heartbeat_failed" },
          "Periodic heartbeat save failed",
        );
      });
    }, 60_000);
    heartbeatTimer.unref?.();
    while (!done && currentState.status === "running" && !loopAbort.signal.aborted) {
      try {
        debugLog(`batch ${state.sessionId}] calling runIteration`);
        const board = await readTicketsBoard(state.projectId);
        const result = await runIteration(currentState, board, readyProjectContext, loopAbort.signal);
        debugLog(`batch ${state.sessionId}] runIteration returned, done=${result.done}`);
        currentState = (await loadLoopState(state.sessionId))!;
        done = result.done;

        if (!done) {
          // Small delay between iterations to avoid hammering the API
          await new Promise((r) => setTimeout(r, 2000));
        }
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        currentState.status = "error";
        currentState.lastError = error;
        currentState.lastHeartbeat = new Date().toISOString();
        await saveLoopState(currentState);
        done = true;

        broadcast({
          type: "autonomous:error",
          sessionId: state.sessionId,
          error,
        } as WSEvent);

        void fireWebhook("autonomous:error", { sessionId: state.sessionId, projectId: currentState.projectId, error });

        safeIngestProducerSummaryFact(currentState.projectId, {
          kind: "autonomous_error",
          at: new Date().toISOString(),
          detail: error,
        });
      }
    }
    // Stop the 60s heartbeat now that the loop has exited (normal,
    // error, or abort). Without this, the interval keeps firing in
    // the background until process exit and writes stale
    // lastHeartbeat values for already-finished sessions.
    clearInterval(heartbeatTimer);

    if (currentState.status === "running") {
      currentState.status = done ? "done" : "idle";
      await saveLoopState(currentState);

      // Save run record
      saveRunRecord({
        runId: newId("run"),
        projectId: currentState.projectId,
        startedAt: currentState.startedAt,
        completedAt: new Date().toISOString(),
        totalIterations: currentState.currentIteration,
        completedCount: currentState.completedCount,
        failedCount: currentState.failedCount,
        status: currentState.failedCount > 0 && currentState.completedCount === 0 ? "error" : "completed",
      });

      broadcast({
        type: "autonomous:completed",
        sessionId: state.sessionId,
        completedCount: currentState.completedCount,
        failedCount: currentState.failedCount,
        totalIterations: currentState.currentIteration,
      } as WSEvent);

      void fireWebhook("autonomous:completed", {
        sessionId: state.sessionId,
        projectId: currentState.projectId,
        completedCount: currentState.completedCount,
        failedCount: currentState.failedCount,
        totalIterations: currentState.currentIteration,
      });

      safeIngestProducerSummaryFact(currentState.projectId, {
        kind: "autonomous_loop_completed",
        at: new Date().toISOString(),
        detail: `done=${currentState.completedCount} fail=${currentState.failedCount} iter=${currentState.currentIteration}`,
      });
    }
  })().catch((err) => {
    debugLog(`batch ${state.sessionId}] CRASH in async loop: ${err}`);
    logger.error({ error: err, event: "autonomous_loop_crash" }, "Autonomous loop crashed");
  }).finally(() => {
    activeLoopSessions.delete(sessionId);
    loopAbortControllers.delete(sessionId);
  });

  res.status(202).json({ success: true, data: state });
  } finally {
    // Release the start-phase lock if the IIFE never took ownership
    // (validation failed, a /stop raced in, or an unexpected throw).
    if (!lockHandedOff) {
      pendingStarts.delete(sessionId);
    }
  }
});

// POST /autonomous/stop — Halt the running loop
autonomousRouter.post("/stop", async (req: Request, res: Response) => {
  const { sessionId } = req.body as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId is required" });
    return;
  }

  const state = await loadLoopState(sessionId);
  if (!state) {
    res.status(404).json({ success: false, error: "No loop state found for session" });
    return;
  }

  // Signal the in-flight invokeAgent (and the LLM fetch) to abort. Without
  // this, /stop only takes effect at the next loop-iteration boundary — a
  // 20-minute agent call would keep running for up to 20 minutes after Stop.
  const loopAbort = loopAbortControllers.get(sessionId);
  if (loopAbort) {
    loopAbort.abort();
    logger.info({ sessionId, event: "autonomous_stop_aborted_inflight" },
      "Stop signalled — in-flight invokeAgent will be cancelled");
  }

  state.status = "idle";
  state.lastHeartbeat = new Date().toISOString();
  await saveLoopState(state);

  saveRunRecord({
    runId: newId("run"),
    projectId: state.projectId,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    totalIterations: state.currentIteration,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
    status: "stopped",
  });

  broadcast({
    type: "autonomous:stopped",
    sessionId,
    completedCount: state.completedCount,
    failedCount: state.failedCount,
  } as WSEvent);

  safeIngestProducerSummaryFact(state.projectId, {
    kind: "autonomous_loop_stopped",
    at: new Date().toISOString(),
    detail: `done=${state.completedCount} fail=${state.failedCount} iter=${state.currentIteration}`,
  });

  res.json({ success: true, data: state });
});

// GET /autonomous/status — Get current loop status
autonomousRouter.get("/status", async (req: Request, res: Response) => {
  const { sessionId } = req.query as { sessionId?: string };
  if (!sessionId) {
    res.status(400).json({ success: false, error: "sessionId query param is required" });
    return;
  }

  const state = await loadLoopState(sessionId);
  if (!state) {
    res.json({ success: true, data: { status: "not_found" } });
    return;
  }

  res.json({ success: true, data: state });
});

// GET /autonomous/metrics — Run metrics for session or project
autonomousRouter.get("/metrics", async (req: Request, res: Response) => {
  const { sessionId, projectId } = req.query as { sessionId?: string; projectId?: string };
  if (sessionId) {
    const metrics = await getRunMetrics(sessionId);
    res.json({ success: true, data: metrics });
    return;
  }
  const metrics = await listRunMetrics(projectId);
  res.json({ success: true, data: metrics });
});

// GET /autonomous/history — Get completed loop runs
autonomousRouter.get("/history", async (_req: Request, res: Response) => {
  const history = await loadHistory();
  res.json({ success: true, data: history });
});
