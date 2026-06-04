import type { AgentDefinition, AgentRole } from "@game-studio/types";

/**
 * Code Reviewer agents — Tier 3 (Sonnet Model)
 * Review code changes and provide critical feedback for improvement.
 */
export const codeReviewerAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "code-reviewer": {
    name: "code-reviewer",
    description: "Reviews code changes and provides critical feedback for improvement.",
    tier: 3,
    model: "sonnet",
    // 26-M-code-reviewer-write: drop "Write" from the tool list.
    // CLAUDE.md describes the code-reviewer as "read-only context,
    // no direct changes" — the previous list was a contradiction
    // that let the reviewer overwrite files it was supposed to be
    // reviewing. Code-reviewer returns a textual critique that the
    // calling agent (gameplay-programmer, engine-programmer, etc.)
    // applies; the reviewer itself never edits.
    tools: ["Read", "Glob", "Grep"],
    maxTurns: 15,
    skills: [],
    memory: "session",
    reportsTo: [],
    // 11-M20: code-reviewer is fully wired (18+ references across
    // department-leads, delegation-map, and coding agents) — not
    // experimental. Removed `experimental: true` so the UI no longer
    // shows the "experimental" badge.
  },
};
