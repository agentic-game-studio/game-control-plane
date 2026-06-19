import type { AgentDefinition, AgentRole } from "@game-studio/types";

export const leadershipAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "autonomous-producer": {
    name: "autonomous-producer",
    description: "The autonomous production loop. Continuously polls the Kanban board, picks the next Available ticket, spawns the right specialist, runs automated verification, advances tickets — without waiting for human prompts. Drives end-to-end game production while humans supervise.",
    tier: 1,
    model: "opus",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "AskUserQuestion", "GodotCLI"],
    maxTurns: 999,
    skills: ["autonomous-production-loop", "dev-story", "automated-playtest", "sprint-plan"],
    memory: "project",
    // autonomous-producer is a sibling of producer at tier 1 — it has no
    // manager; humans supervise it directly.
    reportsTo: [],
    delegates: ["godot-specialist", "gameplay-programmer", "godot-scaffolder", "qa-tester", "art-director", "game-designer", "writer", "market-researcher"],
  },
  "creative-director": {
    name: "creative-director",
    description: "Vision, pillars, player experience, scope arbitration.",
    tier: 1,
    model: "opus",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Task", "AskUserQuestion"],
    maxTurns: 50,
    skills: ["brainstorm", "design-system", "design-review", "gate-check", "project-stage-detect", "team-combat", "team-narrative", "team-ui", "team-level"],
    memory: "project",
    // 6I-6th: with game-director removed, tier-1 directors report to no
    // one. The producer is the board-room orchestrator and the directors
    // are peers that advise it.
    reportsTo: [],
    delegates: ["game-designer", "art-director", "audio-director", "narrative-director", "market-researcher"],
  },
  "technical-director": {
    name: "technical-director",
    description: "Architecture, technology choices, performance strategy.",
    tier: 1,
    model: "opus",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "AskUserQuestion"],
    maxTurns: 50,
    skills: ["create-architecture", "architecture-decision", "architecture-review", "perf-profile", "code-review", "gate-check"],
    memory: "project",
    reportsTo: [],
    delegates: ["lead-programmer", "devops-engineer", "performance-analyst", "technical-artist"],
  },
  producer: {
    name: "producer",
    description: "Orchestrates the multi-agent game development pipeline. Manages sprint planning, milestone tracking, risk management, scope negotiation, and cross-department coordination. As the Board Room orchestrator, spawns teams, assigns tasks, and coordinates across all departments.",
    tier: 1,
    model: "opus",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "AskUserQuestion"],
    maxTurns: 50,
    skills: ["brainstorm", "design-system", "design-review", "gate-check", "project-stage-detect", "team-combat", "team-narrative", "team-ui", "team-level", "sprint-plan", "create-epics", "create-stories", "milestone-review", "retrospective", "scope-check", "estimate", "bug-triage", "autonomous-production-loop", "setup-godot-project", "compose-scene", "automated-playtest", "export-godot-project"],
    memory: "project",
    reportsTo: [],
    delegates: ["creative-director", "technical-director", "game-designer", "lead-programmer", "art-director", "audio-director", "narrative-director", "qa-lead", "release-manager", "prototyper", "market-researcher"],
  },
};
