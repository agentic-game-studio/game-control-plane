/**
 * skill-validator.test.ts — unit tests for the pure `validateSkill()` extracted
 * from packages/skills/scripts/generate-skill-registry.ts into
 * packages/skills/src/validate-skill.ts. No filesystem, no process side effects.
 */

import { describe, expect, it } from "vitest";
import type { SkillDefinition } from "@game-studio/types";
import { validateSkill, gatherSubSkills, LIFECYCLE_PHASES } from "@game-studio/skills";

const skillMap: Record<string, SkillDefinition> = {};
const names = Object.keys(skillMap);

function makeBaseSkill(overrides: Partial<SkillDefinition>): SkillDefinition {
  return {
    name: "pipeline-test" as SkillDefinition["name"],
    description: "Test pipeline",
    userInvocable: true,
    phases: [
      { order: 1, name: "P1", description: "d", agents: [] },
      { order: 2, name: "P2", description: "d", agents: [] },
    ],
    ...overrides,
  } as SkillDefinition;
}

describe("validateSkill — pipeline contract", () => {
  it("rejects a pipeline phase that declares subSkills (must not use the cascade)", () => {
    const skill = makeBaseSkill({
      kind: "pipeline",
      gateMode: "auto",
      resumable: true,
      phases: [
        { order: 1, name: "P1", description: "d", agents: [], subSkills: ["setup-godot-project"] },
      ],
    });
    const issues = validateSkill(skill, skillMap, names);
    expect(issues.some((i) => i.includes("must not declare subSkills"))).toBe(true);
  });

  it("rejects a pipeline skill missing resumable", () => {
    const skill = makeBaseSkill({ kind: "pipeline", gateMode: "auto" });
    const issues = validateSkill(skill, skillMap, names);
    expect(issues.some((i) => i.includes("resumable: true"))).toBe(true);
  });

  it("rejects a pipeline skill missing gateMode", () => {
    const skill = makeBaseSkill({ kind: "pipeline", resumable: true });
    const issues = validateSkill(skill, skillMap, names);
    expect(issues.some((i) => i.includes("gateMode"))).toBe(true);
  });

  it("rejects an invalid lifecyclePhase enum value", () => {
    const skill = makeBaseSkill({
      kind: "pipeline",
      gateMode: "auto",
      resumable: true,
      lifecyclePhase: "not-a-phase" as any,
    });
    const issues = validateSkill(skill, skillMap, names);
    expect(issues.some((i) => i.includes("invalid lifecyclePhase"))).toBe(true);
  });

  it("accepts a valid dummy pipeline skill (full contract met, no subSkills)", () => {
    const skill = makeBaseSkill({
      kind: "pipeline",
      gateMode: "manual",
      resumable: true,
      lifecyclePhase: "concept",
    });
    const issues = validateSkill(skill, skillMap, names);
    // Only the "phases array" presence check + the synthetic name-mismatch check
    // (from the script) would fire — validateSkill itself returns no contract issues.
    expect(issues.filter((i) => i.includes("pipeline") || i.includes("subSkills"))).toEqual([]);
  });
});

describe("validateSkill — non-pipeline (regression parity)", () => {
  it("does NOT apply pipeline checks to atomic/team skills", () => {
    const skill = makeBaseSkill({}); // no kind
    const issues = validateSkill(skill, skillMap, names);
    expect(issues.filter((i) => i.includes("resumable") || i.includes("subSkills"))).toEqual([]);
  });
});

describe("gatherSubSkills", () => {
  it("returns an empty array for skills with no phases", () => {
    expect(gatherSubSkills(undefined)).toEqual([]);
    expect(gatherSubSkills({ name: "x" as any, description: "", userInvocable: true, phases: [] } as SkillDefinition)).toEqual([]);
  });

  it("returns the union of subSkills across phases", () => {
    const skill = makeBaseSkill({
      phases: [
        { order: 1, name: "P1", description: "d", agents: [], subSkills: ["a", "b"] },
        { order: 2, name: "P2", description: "d", agents: [], subSkills: ["c"] },
      ],
    });
    expect(gatherSubSkills(skill)).toEqual(["a", "b", "c"]);
  });
});

describe("LIFECYCLE_PHASES", () => {
  it("contains the expected phases", () => {
    expect(LIFECYCLE_PHASES).toEqual([
      "concept",
      "design",
      "pre-production",
      "production",
      "polish",
      "release",
      "live-ops",
    ]);
  });
});
