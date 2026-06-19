import type { AgentDefinition, AgentRole } from "@game-studio/types";

/**
 * Tier 2 — Department Lead Agents (Sonnet Model)
 * These agents lead specific departments and delegate to specialists.
 */
export const departmentLeadAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "game-designer": {
    name: "game-designer",
    description: "Mechanics, systems, progression, economy, balancing. Owns the game design document system.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 40,
    skills: ["design-system", "map-systems", "brainstorm", "quick-design", "balance-check", "content-audit", "propagate-design-change"],
    memory: "project",
    reportsTo: ["creative-director"],
    delegates: ["systems-designer", "level-designer", "economy-designer"],
  },

  "lead-programmer": {
    name: "lead-programmer",
    description: "Code architecture, code review, API design. Owns the codebase structure and implementation quality.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "AskUserQuestion"],
    maxTurns: 40,
    skills: ["code-review", "create-architecture", "architecture-decision", "dev-story", "story-done", "tech-debt"],
    memory: "session",
    reportsTo: ["technical-director"],
    delegates: ["gameplay-programmer", "engine-programmer", "ai-programmer", "network-programmer", "tools-programmer", "ui-programmer", "godot-specialist", "unity-specialist", "unreal-specialist", "code-reviewer"],
  },

  "art-director": {
    name: "art-director",
    description: "Visual identity, art bible, asset standards. Owns the visual direction and art production pipeline.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 40,
    skills: ["art-bible", "ux-design", "ux-review", "asset-audit"],
    memory: "project",
    reportsTo: ["creative-director"],
    delegates: ["technical-artist", "ux-designer"],
  },

  "audio-director": {
    name: "audio-director",
    description: "Music direction, sound palette, audio implementation. Owns the audio identity.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 30,
    skills: ["generate-audio-asset"],
    memory: "project",
    reportsTo: ["creative-director"],
    delegates: ["sound-designer"],
  },

  "narrative-director": {
    name: "narrative-director",
    description: "Story arcs, world-building, character design. Owns the narrative identity and story coherence.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 40,
    skills: ["design-system", "onboard"],
    memory: "project",
    reportsTo: ["creative-director"],
    delegates: ["writer", "world-builder"],
  },

  "qa-lead": {
    name: "qa-lead",
    description: "Test strategy, bug triage, release readiness. Owns the quality assurance process.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 35,
    skills: ["qa-plan", "smoke-check", "soak-test", "regression-suite", "test-setup", "test-evidence-review", "test-flakiness"],
    memory: "project",
    reportsTo: ["producer"],
    delegates: ["qa-tester"],
  },

  "release-manager": {
    name: "release-manager",
    description: "Build management, versioning, deployment. Owns the release pipeline.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "AskUserQuestion"],
    maxTurns: 30,
    skills: ["release-checklist", "launch-checklist", "changelog", "patch-notes", "hotfix"],
    memory: "project",
    reportsTo: ["producer"],
    delegates: ["devops-engineer", "qa-lead"],
  },

  "localization-lead": {
    name: "localization-lead",
    description: "i18n, string tables, translation pipeline. Owns the localization workflow.",
    tier: 2,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 25,
    skills: ["localize"],
    memory: "project",
    reportsTo: ["producer"],
    delegates: ["writer", "ui-programmer"],
  },
};
