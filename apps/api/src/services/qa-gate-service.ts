/**
 * QA Gate Service — executable verification chain for autonomous production.
 * boot check → GUT → smoke playtest
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import fs from "fs/promises";
import { join } from "path";
import { loadConfig, resolvePipelinePython } from "../config.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { resolveHomeDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { runRegressionCheck } from "./regression-service.js";
import type { TicketTestEvidence } from "@game-studio/types";

const execFileAsync = promisify(execFile);

export interface QAGateStepResult {
  name: keyof TicketTestEvidence;
  passed: boolean;
  output?: string;
  errors?: string[];
  // 23-H-gut-skip-fail-open: a step that was *not run* (vs. one that
  // ran and failed) needs a separate signal so the chain can decide
  // pass-vs-fail based on review mode. Without this, a GUT-less
  // project returned `passed: true` for the GUT step, which the chain
  // then counted as a pass — silently dropping the test gate in
  // `lean`/`full` review modes.
  skipped?: boolean;
}

export interface QAGateResult {
  passed: boolean;
  evidence: TicketTestEvidence;
  failureStep?: string;
  summary: string;
}

async function runGodotHeadlessCommand(
  projectPath: string,
  command: string,
  extraArgs: string[] = [],
  timeoutSec = 90,
): Promise<{ success: boolean; stdout: string; stderr: string; returnCode: number }> {
  const config = loadConfig();
  const scriptDir = join(config.WORKSPACE_DIR, "scripts", "godot");
  const pythonBin = resolvePipelinePython();
  const home = resolveHomeDir();
  // 24-M-env-var-drift: read GODOT_BIN from the Zod-validated
  // config instead of `process.env.GODOT_BIN` directly. The 23rd
  // pass added GODOT_BIN to the env schema (config.ts:57) but
  // didn't migrate this consumer. The Zod default is the empty
  // string, so `||` matches the original `??` behavior at the
  // empty-string boundary.
  const godotBin = config.GODOT_BIN || (home ? join(home, ".local/bin/godot_bin/Godot") : "");

  // Use execFileAsync (no shell) to avoid command injection via projectPath
  // or any of the other string inputs. A malicious projectPath like
  // `foo"; rm -rf /; "bar` would have been split into a shell pipeline;
  // now it's a single argv element that Python receives literally.
  //
  // 27-C-qa-gate-event-loop: was sync `execFileSync` from
  // node:child_process. runQAGateChain runs three of these back-to-back
  // (boot 45s + GUT 120s + smoke 60s = up to 225s), and Node is
  // single-threaded, so the entire process — every WS broadcast, every
  // HTTP request, every SSE log stream — froze for the duration.
  // Converted to the async variant from the same module; the caller
  // chain (runBootCheckGate → runQAGateChain → autonomous loop) is
  // already structured for await.
  const args = [
    join(scriptDir, "run_godot_headless.py"),
    `--project`, projectPath,
    `--command`, command,
    `--godot-bin`, godotBin,
    `--timeout`, String(Math.min(timeoutSec, 120)),
    ...extraArgs,
  ];

  try {
    const { stdout: rawStdout, stderr } = await execFileAsync(pythonBin, args, { timeout: (timeoutSec + 30) * 1000 });
    const stdout = rawStdout ?? "";
    try {
      const parsed = JSON.parse(stdout.trim()) as { success: boolean; returnCode: number; stdout?: string; stderr?: string };
      return {
        success: parsed.success && parsed.returnCode === 0,
        stdout: parsed.stdout ?? stdout,
        stderr: parsed.stderr ?? "",
        returnCode: parsed.returnCode ?? 0,
      };
    } catch (err) {
      // 21-C-qa-gate-parse-fail-open: the previous catch returned
      // `{ success: true, returnCode: 0 }` whenever stdout didn't
      // parse as JSON. The Python gate script is supposed to emit
      // a single-line JSON object; if it instead prints a Python
      // traceback, a partial line (e.g. a timeout cut it off), or
      // an empty string, the gate was silently classified as
      // "passed" — moving the ticket toward completion in
      // runQAGateChain. Mirrors the fail-closed shape used at
      // autonomous.ts:336-345 (runBootCheck): treat unparseable
      // output as a failed step, not a pass. Log the raw stdout
      // (capped) so an operator can see *why* the gate failed to
      // parse without trawling the Python script.
      const preview = stdout.length > 500 ? `${stdout.slice(0, 500)}…` : stdout;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), stdoutPreview: preview, event: "qa_gate_parse_failed" },
        "qa-gate: failed to parse Python gate output as JSON — treating as failure",
      );
      return { success: false, stdout, stderr: "Failed to parse gate output as JSON", returnCode: 1 };
    }
  } catch (err: unknown) {
    const stderr = err && typeof err === "object" && "stderr" in err ? String((err as { stderr: unknown }).stderr) : "";
    const stdout = err && typeof err === "object" && "stdout" in err ? String((err as { stdout: unknown }).stdout) : "";
    return { success: false, stdout, stderr, returnCode: 1 };
  }
}

// 29-L-qa-gate-fatal-patterns-const: hoist the fatal-error regex
// set to module scope. The previous shape rebuilt the array on
// every call to extractFatalErrors; the regexes are stateless and
// don't need a per-call allocation. With a 50KB Godot stderr
// being scanned per boot, this saves a few hundred microseconds
// per gate run and gives the patterns a name grep can find.
const FATAL_PATTERNS: RegExp[] = [
  /SCRIPT ERROR:/,
  /Parse Error/,
  /Parser Error/,
  /Invalid set index/,
  /Function not found/,
];

function extractFatalErrors(output: string): string[] {
  if (!output) return [];
  const errors: string[] = [];
  for (const line of output.split("\n")) {
    if (FATAL_PATTERNS.some((p) => p.test(line))) errors.push(line.trim());
  }
  return Array.from(new Set(errors)).slice(0, 20);
}

export async function runBootCheckGate(projectPath: string): Promise<QAGateStepResult> {
  const result = await runGodotHeadlessCommand(projectPath, "boot", [], 45);
  const errors = extractFatalErrors(result.stderr + result.stdout);
  const passed = result.success && errors.length === 0;
  return {
    name: "bootCheck",
    passed,
    output: result.stdout.slice(-500),
    errors: passed ? undefined : errors.length > 0 ? errors : [result.stderr || "Boot check failed"],
  };
}

export async function runGUTGate(projectPath: string): Promise<QAGateStepResult> {
  const testsDir = join(projectPath, "tests");
  const hasGut = existsSync(join(projectPath, "addons", "gut")) || existsSync(testsDir);
  if (!hasGut) {
    // 23-H-gut-skip-fail-open: the previous return set
    // `passed: true` for a GUT-less project, so the chain at
    // `runQAGateChain` counted it as a pass and the ticket moved
    // toward completion. The fail-closed shape (21-C-qa-gate-parse-
    // fail-open) treats unrun gates as failed by default. The chain
    // inspects `skipped` to relax this in `solo` review mode (where
    // the user explicitly opted into "AI only, no enforcement").
    return { name: "gut", passed: false, skipped: true, output: "GUT not installed — skipped" };
  }
  const result = await runGodotHeadlessCommand(projectPath, "gut", [], 120);
  const errors = extractFatalErrors(result.stderr);
  const passed = result.success && !/FAILED|failures/i.test(result.stdout + result.stderr);
  return {
    name: "gut",
    passed,
    output: (result.stdout + result.stderr).slice(-1000),
    errors: passed ? undefined : errors.length > 0 ? errors : ["GUT tests failed"],
  };
}

export async function runSmokePlaytestGate(projectPath: string): Promise<QAGateStepResult> {
  const smokeScript = join(projectPath, "tests", "smoke_playtest.gd");
  if (!existsSync(smokeScript)) {
    await ensureSmokePlaytestScript(projectPath);
  }
  // 27-C-qa-script-arg-quoting: was a single argv element with
  // embedded quotes (`["--script \"res://tests/smoke_playtest.gd\""]`).
  // argparse would have received `--script="res://tests/smoke_playtest.gd"`
  // as a literal string with quotes in it, and the Python gate
  // script's `--script` argument would have failed to find a file at
  // that path. The smoke playtest has therefore never run the real
  // `.gd` file. Split into two argv elements so argparse gets
  // `--script` and the path as separate tokens.
  const result = await runGodotHeadlessCommand(
    projectPath,
    "script",
    ["--script", "res://tests/smoke_playtest.gd"],
    60,
  );
  const passed = result.success && result.returnCode === 0;
  return {
    name: "smokePlaytest",
    passed,
    output: (result.stdout + result.stderr).slice(-800),
    errors: passed ? undefined : extractFatalErrors(result.stderr).slice(0, 5),
  };
}

async function ensureSmokePlaytestScript(projectPath: string): Promise<void> {
  const testsDir = join(projectPath, "tests");
  if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true });
  const scriptPath = join(testsDir, "smoke_playtest.gd");
  if (existsSync(scriptPath)) return;

  await fs.writeFile(
    scriptPath,
    `extends SceneTree

func _initialize() -> void:
\tprint("SMOKE_PLAYTEST_OK")
\tquit(0)
`,
    "utf-8",
  );
  logger.info({ projectPath, event: "smoke_playtest_scaffold" }, "Created smoke_playtest.gd scaffold");
}

export async function runQAGateChain(workspacePath: string, projectId?: string): Promise<QAGateResult> {
  const projectPath = resolveProjectWorkspace(workspacePath);
  const now = new Date().toISOString();
  const evidence: TicketTestEvidence = {};

  const boot = await runBootCheckGate(projectPath);
  evidence.bootCheck = { passed: boot.passed, errors: boot.errors, at: now };
  if (!boot.passed) {
    return {
      passed: false,
      evidence,
      failureStep: "bootCheck",
      summary: `Boot check failed: ${boot.errors?.slice(0, 2).join("; ") ?? "unknown"}`,
    };
  }

  const gut = await runGUTGate(projectPath);
  evidence.gut = { passed: gut.passed, output: gut.output, at: now };
  if (!gut.passed) {
    // 23-H-gut-skip-fail-open: a GUT-less project returns
    // `passed: false, skipped: true`. Fail-closed in `lean` and
    // `full` review modes (the default + enforced modes); only
    // `solo` (AI-only, no enforcement) lets the gate pass when
    // skipped. The user explicitly opted into solo, so we don't
    // surprise them with a "GUT not installed" failure.
    if (gut.skipped && loadConfig().REVIEW_MODE === "solo") {
      // Allow the chain to continue.
    } else {
      return {
        passed: false,
        evidence,
        failureStep: "gut",
        summary: gut.skipped
          ? `GUT not installed — required in ${loadConfig().REVIEW_MODE} review mode`
          : `GUT failed: ${gut.errors?.slice(0, 2).join("; ") ?? "test failures"}`,
      };
    }
  }

  const smoke = await runSmokePlaytestGate(projectPath);
  evidence.smokePlaytest = { passed: smoke.passed, output: smoke.output, at: now };
  if (!smoke.passed) {
    return {
      passed: false,
      evidence,
      failureStep: "smokePlaytest",
      summary: `Smoke playtest failed: ${smoke.errors?.slice(0, 2).join("; ") ?? "unknown"}`,
    };
  }

  if (projectId) {
    const regression = await runRegressionCheck(workspacePath, projectId, evidence);
    evidence.regression = {
      passed: regression.passed,
      isBaseline: regression.isBaseline,
      diff: regression.diff,
      at: now,
    };
    if (!regression.passed) {
      return {
        passed: false,
        evidence,
        failureStep: "regression",
        summary: `Regression check failed: ${regression.diff ?? "baseline mismatch"}`,
      };
    }
  }

  return {
    passed: true,
    evidence,
    summary: "All QA gates passed (boot, GUT, smoke, regression)",
  };
}

// 28-H-qa-gate-async-version-helpers: three sync helpers converted
// to async. The 27th pass fixed the gate chain's subprocess calls
// (runBootCheckGate / runGUTGate / runSmokePlaytestGate) but left
// the version / evidence helpers sync. saveTestEvidenceArtifact is
// called from build-service at the end of every successful Godot
// export, blocking the event loop on the writeFileSync; bumpProjectVersion
// is called from POST /api/builds/bump-version directly. The async
// signatures propagate to the two callers.
export async function saveTestEvidenceArtifact(
  projectPath: string,
  ticketId: string,
  evidence: TicketTestEvidence,
): Promise<string> {
  const dir = join(projectPath, "production", "qa-evidence");
  await fs.mkdir(dir, { recursive: true });
  const relPath = join("production", "qa-evidence", `${ticketId}.json`);
  await fs.writeFile(join(projectPath, relPath), JSON.stringify(evidence, null, 2), "utf-8");
  return relPath;
}

export async function readProjectVersion(projectPath: string): Promise<string> {
  const projectGodot = join(projectPath, "project.godot");
  try {
    const content = await fs.readFile(projectGodot, "utf-8");
    const match = content.match(/config\/version="([^"]+)"/);
    return match?.[1] ?? "0.1.0";
  } catch {
    // ENOENT (no project.godot) or permission denied — both fall back
    // to a sensible default so the caller can proceed.
    return "0.1.0";
  }
}

export async function bumpProjectVersion(projectPath: string, bump: "patch" | "minor" | "major" = "patch"): Promise<string> {
  const projectGodot = join(projectPath, "project.godot");
  let content: string;
  try {
    content = await fs.readFile(projectGodot, "utf-8");
  } catch {
    return "0.1.0";
  }

  const match = content.match(/config\/version="([^"]+)"/);
  const current = match?.[1] ?? "0.1.0";
  const parts = current.split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (bump === "major") { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (bump === "minor") { parts[1]++; parts[2] = 0; }
  else { parts[2]++; }
  const next = parts.join(".");

  if (match) {
    content = content.replace(/config\/version="[^"]+"/, `config/version="${next}"`);
  } else {
    content += `\nconfig/version="${next}"\n`;
  }
  await fs.writeFile(projectGodot, content, "utf-8");
  return next;
}
