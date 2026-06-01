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
    tools: ["Read", "Write", "Glob", "Grep"],
    maxTurns: 15,
    skills: [],
    memory: "session",
    reportsTo: [],
    experimental: true,
  },
};
