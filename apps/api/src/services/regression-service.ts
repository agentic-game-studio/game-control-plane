/**
 * Regression test baseline — store and compare QA gate fingerprints per project.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

export function runRegressionCheck(
  workspacePath: string,
  projectId: string,
  evidence: TicketTestEvidence,
): RegressionResult {
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

  if (!existsSync(path)) {
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
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(current, null, 2), "utf-8");
    return { passed: true, isBaseline: true, baseline: current };
  }

  let baseline: RegressionBaseline;
  try {
    baseline = JSON.parse(readFileSync(path, "utf-8")) as RegressionBaseline;
  } catch {
    writeFileSync(path, JSON.stringify(current, null, 2), "utf-8");
    return { passed: true, isBaseline: true, baseline: current };
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
    writeFileSync(path, JSON.stringify(current, null, 2), "utf-8");
  }

  return {
    passed: allPass,
    isBaseline: false,
    diff: diff || "regression fingerprint mismatch",
    baseline,
  };
}
