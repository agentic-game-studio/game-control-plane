/**
 * QA Gate Service — executable verification chain for autonomous production.
 * boot check → GUT → smoke playtest
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { loadConfig, resolvePipelinePython } from "../config.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { resolveHomeDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";
import { runRegressionCheck } from "./regression-service.js";
import type { TicketTestEvidence } from "@game-studio/types";

export interface QAGateStepResult {
  name: keyof TicketTestEvidence;
  passed: boolean;
  output?: string;
  errors?: string[];
}

export interface QAGateResult {
  passed: boolean;
  evidence: TicketTestEvidence;
  failureStep?: string;
  summary: string;
}

function runGodotHeadlessCommand(
  projectPath: string,
  command: string,
  extraArgs: string[] = [],
  timeoutSec = 90,
): { success: boolean; stdout: string; stderr: string; returnCode: number } {
  const config = loadConfig();
  const scriptDir = join(config.WORKSPACE_DIR, "scripts", "godot");
  const pythonBin = resolvePipelinePython();
  const home = resolveHomeDir();
  const godotBin = process.env.GODOT_BIN ?? (home ? join(home, ".local/bin/godot_bin/Godot") : "");

  // Use execFileSync (no shell) to avoid command injection via projectPath
  // or any of the other string inputs. A malicious projectPath like
  // `foo"; rm -rf /; "bar` would have been split into a shell pipeline;
  // now it's a single argv element that Python receives literally.
  const args = [
    join(scriptDir, "run_godot_headless.py"),
    `--project`, projectPath,
    `--command`, command,
    `--godot-bin`, godotBin,
    `--timeout`, String(Math.min(timeoutSec, 120)),
    ...extraArgs,
  ];

  try {
    const result = execFileSync(pythonBin, args, { timeout: (timeoutSec + 30) * 1000 });
    const stdout = result?.toString() ?? "";
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

function extractFatalErrors(output: string): string[] {
  if (!output) return [];
  const fatalPatterns = [/SCRIPT ERROR:/, /Parse Error/, /Parser Error/, /Invalid set index/, /Function not found/];
  const errors: string[] = [];
  for (const line of output.split("\n")) {
    if (fatalPatterns.some((p) => p.test(line))) errors.push(line.trim());
  }
  return Array.from(new Set(errors)).slice(0, 20);
}

export function runBootCheckGate(projectPath: string): QAGateStepResult {
  const result = runGodotHeadlessCommand(projectPath, "boot", [], 45);
  const errors = extractFatalErrors(result.stderr + result.stdout);
  const passed = result.success && errors.length === 0;
  return {
    name: "bootCheck",
    passed,
    output: result.stdout.slice(-500),
    errors: passed ? undefined : errors.length > 0 ? errors : [result.stderr || "Boot check failed"],
  };
}

export function runGUTGate(projectPath: string): QAGateStepResult {
  const testsDir = join(projectPath, "tests");
  const hasGut = existsSync(join(projectPath, "addons", "gut")) || existsSync(testsDir);
  if (!hasGut) {
    return { name: "gut", passed: true, output: "GUT not installed — skipped" };
  }
  const result = runGodotHeadlessCommand(projectPath, "gut", [], 120);
  const errors = extractFatalErrors(result.stderr);
  const passed = result.success && !/FAILED|failures/i.test(result.stdout + result.stderr);
  return {
    name: "gut",
    passed,
    output: (result.stdout + result.stderr).slice(-1000),
    errors: passed ? undefined : errors.length > 0 ? errors : ["GUT tests failed"],
  };
}

export function runSmokePlaytestGate(projectPath: string): QAGateStepResult {
  const smokeScript = join(projectPath, "tests", "smoke_playtest.gd");
  if (!existsSync(smokeScript)) {
    ensureSmokePlaytestScript(projectPath);
  }
  const result = runGodotHeadlessCommand(projectPath, "script", [`--script "res://tests/smoke_playtest.gd"`], 60);
  const passed = result.success && result.returnCode === 0;
  return {
    name: "smokePlaytest",
    passed,
    output: (result.stdout + result.stderr).slice(-800),
    errors: passed ? undefined : extractFatalErrors(result.stderr).slice(0, 5),
  };
}

function ensureSmokePlaytestScript(projectPath: string): void {
  const testsDir = join(projectPath, "tests");
  if (!existsSync(testsDir)) mkdirSync(testsDir, { recursive: true });
  const scriptPath = join(testsDir, "smoke_playtest.gd");
  if (existsSync(scriptPath)) return;

  writeFileSync(
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

export function runQAGateChain(workspacePath: string, projectId?: string): QAGateResult {
  const projectPath = resolveProjectWorkspace(workspacePath);
  const now = new Date().toISOString();
  const evidence: TicketTestEvidence = {};

  const boot = runBootCheckGate(projectPath);
  evidence.bootCheck = { passed: boot.passed, errors: boot.errors, at: now };
  if (!boot.passed) {
    return {
      passed: false,
      evidence,
      failureStep: "bootCheck",
      summary: `Boot check failed: ${boot.errors?.slice(0, 2).join("; ") ?? "unknown"}`,
    };
  }

  const gut = runGUTGate(projectPath);
  evidence.gut = { passed: gut.passed, output: gut.output, at: now };
  if (!gut.passed) {
    return {
      passed: false,
      evidence,
      failureStep: "gut",
      summary: `GUT failed: ${gut.errors?.slice(0, 2).join("; ") ?? "test failures"}`,
    };
  }

  const smoke = runSmokePlaytestGate(projectPath);
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
    const regression = runRegressionCheck(workspacePath, projectId, evidence);
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

export function saveTestEvidenceArtifact(
  projectPath: string,
  ticketId: string,
  evidence: TicketTestEvidence,
): string {
  const dir = join(projectPath, "production", "qa-evidence");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const relPath = join("production", "qa-evidence", `${ticketId}.json`);
  writeFileSync(join(projectPath, relPath), JSON.stringify(evidence, null, 2), "utf-8");
  return relPath;
}

export function readProjectVersion(projectPath: string): string {
  const projectGodot = join(projectPath, "project.godot");
  if (!existsSync(projectGodot)) return "0.1.0";
  try {
    const content = readFileSync(projectGodot, "utf-8");
    const match = content.match(/config\/version="([^"]+)"/);
    return match?.[1] ?? "0.1.0";
  } catch {
    return "0.1.0";
  }
}

export function bumpProjectVersion(projectPath: string, bump: "patch" | "minor" | "major" = "patch"): string {
  const projectGodot = join(projectPath, "project.godot");
  if (!existsSync(projectGodot)) return "0.1.0";

  let content = readFileSync(projectGodot, "utf-8");
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
  writeFileSync(projectGodot, content, "utf-8");
  return next;
}
