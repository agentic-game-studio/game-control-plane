/**
 * Pure skill-validation logic, factored out of `scripts/generate-skill-registry.ts`
 * so it is unit-testable without touching the filesystem or running the script's
 * top-level side effects (process.exit, console logs).
 *
 * See .omc/plans/lifecycle-pipeline.md for the pipeline contract enforced here.
 */

import type { SkillDefinition } from "@game-studio/types";

export const LIFECYCLE_PHASES = ["concept", "design", "pre-production", "production", "polish", "release", "live-ops"] as const;

/** Gather every subSkill declared on any phase of a skill (the real cascade surface). */
export function gatherSubSkills(skill: SkillDefinition | undefined): string[] {
  if (!skill) return [];
  const out: string[] = [];
  for (const phase of skill.phases ?? []) {
    if (Array.isArray(phase.subSkills)) {
      for (const sub of phase.subSkills) {
        if (typeof sub === "string") out.push(sub);
      }
    }
  }
  return out;
}

/**
 * Validate a single skill definition. PURE (no filesystem, no process.exit) so
 * it is unit-testable. `skillsMap` + `allNames` are passed in for subSkill
 * reference resolution and DFS cycle detection.
 *
 * Returns a list of issue strings (empty = valid).
 */
export function validateSkill(
  skill: SkillDefinition,
  skillsMap: Record<string, SkillDefinition>,
  allNames: string[],
): string[] {
  const issues: string[] = [];
  const name = skill.name;

  if (!name) {
    issues.push("Skill missing name");
    return issues;
  }
  if (!skill.description) {
    issues.push(`Skill ${name} missing description`);
  }
  if (!Array.isArray(skill.phases)) {
    issues.push(`Skill ${name} missing phases array`);
  }

  // ── Pipeline-specific contract (kind === "pipeline") ──
  if (skill.kind === "pipeline") {
    if (skill.resumable !== true) {
      issues.push(`Pipeline skill ${name} should set resumable: true (required for resume after restart)`);
    }
    if (!skill.gateMode) {
      issues.push(`Pipeline skill ${name} should set gateMode ("auto" | "manual")`);
    }
    if (skill.lifecyclePhase !== undefined && !(LIFECYCLE_PHASES as readonly string[]).includes(skill.lifecyclePhase)) {
      issues.push(`Pipeline skill ${name} has invalid lifecyclePhase "${skill.lifecyclePhase}" (valid: ${LIFECYCLE_PHASES.join(", ")})`);
    }
    // REJECT subSkills on any pipeline phase. The skills.ts cascade is one-level
    // and does NOT re-enter the pipeline runner, so a pipeline phase declaring
    // subSkills would silently no-op. /make-game sequences child runs manually.
    for (const phase of skill.phases ?? []) {
      if (phase.subSkills && phase.subSkills.length > 0) {
        issues.push(
          `Pipeline skill ${name} phase "${phase.name}" must not declare subSkills — ` +
            `pipelines sequence child runs manually in /make-game (the subSkills cascade does not apply to pipelines)`,
        );
      }
    }
  }

  // ── subSkills reference resolution (per-phase) ──
  for (const phase of skill.phases ?? []) {
    if (!Array.isArray(phase.subSkills)) continue;
    for (const sub of phase.subSkills) {
      if (typeof sub !== "string") {
        issues.push(`Skill ${name} has non-string subSkill entry: ${String(sub)}`);
        continue;
      }
      if (!allNames.includes(sub)) {
        issues.push(`Skill ${name} references unknown subSkill: ${sub}`);
      }
    }
  }

  // ── Cycle detection across this skill's subSkill tree (DFS) ──
  const visited = new Set<string>([name]);
  const stack: string[] = [name];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const sub of gatherSubSkills(skillsMap[current])) {
      if (visited.has(sub)) {
        issues.push(`subSkills cycle detected: ${name} -> ... -> ${sub}`);
        stack.length = 0; // stop walking — the cycle is real
        break;
      }
      visited.add(sub);
      stack.push(sub);
    }
  }

  return issues;
}
