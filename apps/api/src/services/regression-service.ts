/**
 * Regression test baseline — store and compare QA gate fingerprints per project.
 */

import { access, mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import type { TicketTestEvidence } from "@game-studio/types";

export interface RegressionBaseline {
  projectId: string;
  updatedAt: string;
  bootOk: boolean;
  gutSummary: string;
  smokeSummary: string;
  fingerprint: string;
}

export interface RegressionResult {
  passed: boolean;
  isBaseline: boolean;
  diff?: string;
  baseline?: RegressionBaseline;
}

function baselinePath(projectPath: string): string {
  return join(projectPath, "production", "regression-baseline.json");
}

// 27-H-regression-mutex: per-project FIFO mutex for the
// regression-baseline.json file. The previous shape did raw
// existsSync → readFileSync → JSON.parse → writeFileSync with no
// synchronization; two parallel QA gate runs on the same project
// (the autonomous loop can fire two verify calls in close
// succession, especially during the post-QA retry path) would
// read the same baseline, both compute the same fingerprint match,
// and the second writeFileSync would race the first — losing one
// update. Same pattern as data-store.ts updateData and the
// sessionLocks in session-store.ts.
const regressionLocks = new Map<string, Promise<void>>();

async function withRegressionLock<T>(projectPath: string, fn: () => Promise<T>): Promise<T> {
  const prev = regressionLocks.get(projectPath) ?? Promise.resolve();
  let release: () => void;
  const lock = new Promise<void>((r) => { release = r; });
  regressionLocks.set(projectPath, lock);
  try {
    await prev;
    return await fn();
  } finally {
    release!();
    if (regressionLocks.get(projectPath) === lock) {
      regressionLocks.delete(projectPath);
    }
  }
}

function fingerprint(evidence: TicketTestEvidence): string {
  const parts = [
    evidence.bootCheck?.passed ? "boot:ok" : "boot:fail",
    evidence.gut?.passed ? "gut:ok" : "gut:fail",
    (evidence.gut?.output ?? "").slice(-200),
    evidence.smokePlaytest?.passed ? "smoke:ok" : "smoke:fail",
    (evidence.smokePlaytest?.output ?? "").slice(-200),
  ];
  return parts.join("|");
}

export async function runRegressionCheck(
  workspacePath: string,
  projectId: string,
  evidence: TicketTestEvidence,
): Promise<RegressionResult> {
  const projectPath = resolveProjectWorkspace(workspacePath);
  return withRegressionLock(projectPath, () => runRegressionCheckUnlocked(workspacePath, projectId, evidence));
}

async function runRegressionCheckUnlocked(
  workspacePath: string,
  projectId: string,
  evidence: TicketTestEvidence,
): Promise<RegressionResult> {
  const projectPath = resolveProjectWorkspace(workspacePath);
  const path = baselinePath(projectPath);
  const fp = fingerprint(evidence);
  const now = new Date().toISOString();

  const current: RegressionBaseline = {
    projectId,
    updatedAt: now,
    bootOk: evidence.bootCheck?.passed ?? false,
    gutSummary: (evidence.gut?.output ?? "").slice(-300),
    smokeSummary: (evidence.smokePlaytest?.output ?? "").slice(-300),
    fingerprint: fp,
  };

  // 29-H-regression-async-io: previous shape used sync
  // existsSync/readFileSync/writeFileSync inside an async-named
  // function. The 27th pass added the per-file mutex but left the
  // I/O itself sync — a regression check on a cold path blocked
  // the event loop for the read+write round-trip. The route
  // handler awaits this; sync I/O is pure overhead here. Use
  // fs/promises. mkdir with recursive:true is a no-op if the dir
  // exists, so the previous existsSync guard was redundant.
  const baselineExists = await access(path).then(() => true, () => false);
  if (!baselineExists) {
    // 23-H-regression-first-run: only seed a baseline when the
    // current run actually passed all gates. The previous shape
    // wrote the baseline unconditionally and returned
    // `passed: true, isBaseline: true` — even if `bootOk: false`.
    // On the *next* run, the fingerprint comparison (line 75) would
    // match the failure-state fingerprint and return
    // `passed: true` again, re-establishing a baseline of
    // failures and effectively silencing the regression check
    // forever. Now: if any gate failed, do NOT write the baseline
    // and return `passed: false` so the operator sees the failure
    // and the next run gets a clean re-evaluation once the bug is
    // fixed.
    const firstRunAllPass = Boolean(
      evidence.bootCheck?.passed &&
      evidence.gut?.passed !== false &&
      evidence.smokePlaytest?.passed !== false,
    );
    if (!firstRunAllPass) {
      return {
        passed: false,
        isBaseline: true,
        baseline: current,
        diff: "first-run baseline cannot be seeded with failures",
      };
    }
    const dir = join(projectPath, "production");
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(current, null, 2), "utf-8");
    return { passed: true, isBaseline: true, baseline: current };
  }

  let baseline: RegressionBaseline;
  try {
    const rawText = await readFile(path, "utf-8");
    const raw = JSON.parse(rawText) as Record<string, unknown>;
    // 27-L-regression-baseline-validate: the previous `as RegressionBaseline`
    // cast trusted JSON.parse to return a fully-shaped object. A
    // hand-edited or partially-written baseline (truncated write,
    // version-skew) would silently propagate undefined fields,
    // and the fingerprint comparison at L137 would still match
    // because the field would be the string "undefined" or just
    // fall through. Validate the four load-bearing fields exist
    // and have the right type; if not, treat the file as corrupt
    // and re-seed it. The fingerprint field is what gates the
    // pass/fail return value, so a non-string there is the
    // critical one to check.
    //
    // 31-H-regression-corruption-fail-open: the previous shape
    // re-seeded AND returned `passed: true` on a corrupt
    // baseline, which silently re-established a new baseline
    // without ever reporting the corruption to the operator.
    // A hand-edited baseline that "passes" the gate (because
    // its invalid shape would compare trivially) could pin
    // a regression in production for months. Re-seed
    // (so the next run has a known-good reference) but
    // return `passed: false` with a diff explaining the
    // corruption — the operator sees a one-time failure and
    // can investigate before the next run.
    if (
      typeof raw.projectId !== "string" ||
      typeof raw.fingerprint !== "string" ||
      typeof raw.bootOk !== "boolean" ||
      typeof raw.gutSummary !== "string" ||
      typeof raw.smokeSummary !== "string"
    ) {
      // 23-H-regression-first-run parity: only re-seed when the
      // current run is healthy. Mirrors the first-run check
      // above — a failed run must NOT seed a "baseline of
      // failures" that pins the regression check open.
      const currentAllPass = Boolean(
        evidence.bootCheck?.passed &&
        evidence.gut?.passed !== false &&
        evidence.smokePlaytest?.passed !== false,
      );
      if (currentAllPass) {
        await writeFile(path, JSON.stringify(current, null, 2), "utf-8");
        return { passed: true, isBaseline: true, baseline: current };
      }
      return {
        passed: false,
        isBaseline: true,
        baseline: current,
        diff: "corrupt baseline AND current run has gate failures — refusing to seed failures as baseline",
      };
    }
    baseline = raw as unknown as RegressionBaseline;
  } catch {
    // 31-H-regression-corruption-fail-open: same fix shape as
    // the type-validate branch above — a JSON parse failure
    // on the baseline indicates on-disk corruption. Re-seed
    // (if the current run is healthy) and fail-open with a
    // diff so the operator sees the corruption signal.
    const currentAllPass = Boolean(
      evidence.bootCheck?.passed &&
      evidence.gut?.passed !== false &&
      evidence.smokePlaytest?.passed !== false,
    );
    if (currentAllPass) {
      await writeFile(path, JSON.stringify(current, null, 2), "utf-8");
      return { passed: true, isBaseline: true, baseline: current };
    }
    return {
      passed: false,
      isBaseline: true,
      baseline: current,
      diff: "unparseable baseline AND current run has gate failures — refusing to seed failures as baseline",
    };
  }

  if (baseline.fingerprint === fp) {
    return { passed: true, isBaseline: false, baseline };
  }

  const diff = [
    baseline.bootOk !== current.bootOk ? `boot: ${baseline.bootOk} → ${current.bootOk}` : null,
    baseline.gutSummary !== current.gutSummary ? "gut output changed" : null,
    baseline.smokeSummary !== current.smokeSummary ? "smoke output changed" : null,
  ].filter(Boolean).join("; ");

  // Update baseline on pass after intentional change (boot+gut+smoke all pass)
  const allPass = Boolean(
    evidence.bootCheck?.passed &&
    evidence.gut?.passed !== false &&
    evidence.smokePlaytest?.passed !== false,
  );
  if (allPass) {
    await writeFile(path, JSON.stringify(current, null, 2), "utf-8");
  }

  return {
    passed: allPass,
    isBaseline: false,
    diff: diff || "regression fingerprint mismatch",
    baseline,
  };
}
