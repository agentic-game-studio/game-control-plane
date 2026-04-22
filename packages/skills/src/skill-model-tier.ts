import type { ModelTier, SkillName } from "@game-studio/types";

/**
 * Model tier per skill (from .claude/docs/coordination-rules.md)
 * Haiku = read-only status checks
 * Sonnet = default for most work
 * Opus = multi-document synthesis, high-stakes gate verdicts
 */
export const skillModelTiers: Partial<Record<SkillName, ModelTier>> = {
  // Haiku skills
  "help": "haiku",
  "sprint-status": "haiku",
  "story-readiness": "haiku",
  "scope-check": "haiku",
  "project-stage-detect": "haiku",
  "changelog": "haiku",
  "patch-notes": "haiku",
  "onboard": "haiku",
  // Opus skills
  "review-all-gdds": "opus",
  "architecture-review": "opus",
  "gate-check": "opus",
  // Sonnet (default) — not listed
};
