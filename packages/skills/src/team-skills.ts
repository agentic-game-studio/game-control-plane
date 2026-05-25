import type { SkillDefinition } from "@game-studio/types";
import type { AgentRole } from "@game-studio/types";

/** Team orchestration skills — 13 teams coordinating multiple agents */
export const teamSkills: SkillDefinition[] = [
  {
    name: "team-combat",
    description: "Coordinate combat system implementation: game-designer + gameplay-programmer + ai-programmer + technical-artist + sound-designer + qa-tester",
    phases: [
      {
        order: 1,
        name: "Design",
        description: "Game designer creates combat GDD",
        agents: ["game-designer"],
      },
      {
        order: 2,
        name: "Architecture",
        description: "Programmers design code structure",
        agents: ["gameplay-programmer", "ai-programmer"],
      },
      {
        order: 3,
        name: "Implementation",
        description: "Parallel implementation by specialists",
        agents: ["gameplay-programmer", "ai-programmer", "technical-artist", "sound-designer"],
        parallel: true,
      },
      {
        order: 4,
        name: "Integration",
        description: "Wire together all components",
        agents: ["gameplay-programmer"],
      },
      {
        order: 5,
        name: "Validation",
        description: "QA validates combat systems",
        agents: ["qa-tester", "qa-lead"],
      },
    ],
    userInvocable: true,
    teamMembers: ["game-designer", "gameplay-programmer", "ai-programmer", "technical-artist", "sound-designer", "qa-tester"],
  },

  {
    name: "team-narrative",
    description: "Coordinate narrative content: narrative-director + writer + world-builder + level-designer",
    phases: [
      {
        order: 1,
        name: "Direction",
        description: "Narrative director defines direction",
        agents: ["narrative-director"],
      },
      {
        order: 2,
        name: "Content Creation",
        description: "Parallel content creation",
        agents: ["writer", "world-builder", "level-designer"],
        parallel: true,
      },
      {
        order: 3,
        name: "Integration",
        description: "Integrate narrative into levels",
        agents: ["level-designer", "narrative-director"],
      },
    ],
    userInvocable: true,
    teamMembers: ["narrative-director", "writer", "world-builder", "level-designer"],
  },

  {
    name: "team-ui",
    description: "Coordinate UI implementation: ux-designer + ui-programmer + art-director + accessibility-specialist",
    phases: [
      {
        order: 1,
        name: "UX Spec",
        description: "UX designer creates specifications",
        agents: ["ux-designer"],
      },
      {
        order: 2,
        name: "Visual Design",
        description: "Art director validates visual direction",
        agents: ["art-director"],
      },
      {
        order: 3,
        name: "Implementation",
        description: "UI implementation and accessibility",
        agents: ["ui-programmer", "accessibility-specialist"],
        parallel: true,
      },
      {
        order: 4,
        name: "Validation",
        description: "Accessibility review and QA",
        agents: ["accessibility-specialist", "qa-tester"],
      },
    ],
    userInvocable: true,
    teamMembers: ["ux-designer", "ui-programmer", "art-director", "accessibility-specialist"],
  },

  {
    name: "team-release",
    description: "Coordinate release: release-manager + qa-lead + devops-engineer + producer",
    phases: [
      {
        order: 1,
        name: "Checklist",
        description: "Generate release checklist",
        agents: ["release-manager"],
      },
      {
        order: 2,
        name: "QA Sign-off",
        description: "QA regression and sign-off",
        agents: ["qa-lead"],
      },
      {
        order: 3,
        name: "Build",
        description: "Build and deploy",
        agents: ["devops-engineer"],
      },
      {
        order: 4,
        name: "Final Sign-off",
        description: "Release manager final sign-off",
        agents: ["release-manager", "producer"],
      },
    ],
    userInvocable: true,
    teamMembers: ["release-manager", "qa-lead", "devops-engineer", "producer"],
  },

  {
    name: "team-polish",
    description: "Coordinate polish: performance-analyst + technical-artist + sound-designer + qa-tester",
    phases: [
      { order: 1, name: "Profile", description: "Run performance profiling", agents: ["performance-analyst"] },
      { order: 2, name: "Visual Polish", description: "VFX and rendering polish", agents: ["technical-artist"], parallel: true },
      { order: 3, name: "Audio Polish", description: "Mix and SFX polish", agents: ["sound-designer"], parallel: true },
      { order: 4, name: "QA Pass", description: "Regression and smoke tests", agents: ["qa-tester"] },
    ],
    userInvocable: true,
    teamMembers: ["performance-analyst", "technical-artist", "sound-designer", "qa-tester"],
  },

  {
    name: "team-audio",
    description: "Coordinate audio: audio-director + sound-designer + technical-artist + gameplay-programmer",
    phases: [
      { order: 1, name: "Audio Direction", description: "Define audio bible and SFX list", agents: ["audio-director"] },
      { order: 2, name: "SFX Generation", description: "Generate procedural SFX via GenerateAudio", agents: ["sound-designer"] },
      { order: 3, name: "Integration", description: "Wire AudioStreamPlayer nodes", agents: ["gameplay-programmer", "technical-artist"], parallel: true },
      { order: 4, name: "Validation", description: "Playtest audio triggers", agents: ["qa-tester"] },
    ],
    userInvocable: true,
    teamMembers: ["audio-director", "sound-designer", "technical-artist", "gameplay-programmer"],
  },

  {
    name: "team-level",
    description: "Coordinate level design: level-designer + narrative-director + world-builder + art-director + systems-designer + qa-tester",
    phases: [
      { order: 1, name: "Level Spec", description: "Level design document and pacing", agents: ["level-designer", "narrative-director"] },
      { order: 2, name: "World Build", description: "Tilemaps, props, narrative beats", agents: ["world-builder", "art-director"], parallel: true },
      { order: 3, name: "Implementation", description: "Build level scenes", agents: ["level-designer", "systems-designer"] },
      { order: 4, name: "Playtest", description: "Level QA pass", agents: ["qa-tester"] },
    ],
    userInvocable: true,
    teamMembers: ["level-designer", "narrative-director", "world-builder", "art-director", "systems-designer", "qa-tester"],
  },

  {
    name: "team-live-ops",
    description: "Coordinate live ops: live-ops-designer + economy-designer + community-manager + analytics-engineer",
    phases: [
      { order: 1, name: "Economy Design", description: "Define economy and events", agents: ["economy-designer", "live-ops-designer"] },
      { order: 2, name: "Analytics", description: "Event schema and telemetry hooks", agents: ["analytics-engineer"] },
      { order: 3, name: "Community", description: "Community messaging plan", agents: ["community-manager"] },
    ],
    userInvocable: true,
    teamMembers: ["live-ops-designer", "economy-designer", "community-manager", "analytics-engineer"],
  },

  {
    name: "team-qa",
    description: "Coordinate QA: qa-lead + qa-tester + gameplay-programmer + producer",
    phases: [
      { order: 1, name: "QA Plan", description: "Define test matrix and acceptance criteria", agents: ["qa-lead"] },
      { order: 2, name: "Automated Tests", description: "Run GUT and smoke playtest", agents: ["qa-tester"] },
      { order: 3, name: "Fix Cycle", description: "Address failures", agents: ["gameplay-programmer"] },
      { order: 4, name: "Sign-off", description: "Producer QA sign-off", agents: ["producer", "qa-lead"] },
    ],
    userInvocable: true,
    teamMembers: ["qa-lead", "qa-tester", "gameplay-programmer", "producer"],
  },

  {
    name: "team-multiplayer",
    description: "Coordinate multiplayer: technical-director + network-programmer + gameplay-programmer + qa-tester",
    phases: [
      { order: 1, name: "Feasibility", description: "TD network feasibility review", agents: ["technical-director"] },
      { order: 2, name: "Implementation", description: "Netcode and sync", agents: ["network-programmer", "gameplay-programmer"], parallel: true },
      { order: 3, name: "Integration", description: "Wire multiplayer into game flow", agents: ["gameplay-programmer"] },
      { order: 4, name: "Network QA", description: "Multi-client test pass", agents: ["qa-tester"] },
    ],
    userInvocable: true,
    teamMembers: ["technical-director", "network-programmer", "gameplay-programmer", "qa-tester"],
  },

  {
    name: "team-progression",
    description: "Coordinate progression: creative-director + game-designer + economy-designer + lead-programmer + qa-tester",
    phases: [
      { order: 1, name: "Progression Design", description: "Define XP, unlocks, and economy loops", agents: ["game-designer", "economy-designer"] },
      { order: 2, name: "Architecture", description: "Data models and save hooks", agents: ["lead-programmer"] },
      { order: 3, name: "Implementation", description: "Build progression systems", agents: ["gameplay-programmer", "economy-designer"], parallel: true },
      { order: 4, name: "Validation", description: "Balance and QA pass", agents: ["qa-tester", "creative-director"] },
    ],
    userInvocable: true,
    teamMembers: ["creative-director", "game-designer", "economy-designer", "lead-programmer", "qa-tester"],
  },

  {
    name: "team-world",
    description: "Coordinate world building: creative-director + art-director + level-designer + world-builder + technical-artist",
    phases: [
      { order: 1, name: "World Vision", description: "Art bible and biome direction", agents: ["creative-director", "art-director"] },
      { order: 2, name: "Layout", description: "Level blockout and world map", agents: ["level-designer", "world-builder"], parallel: true },
      { order: 3, name: "Art Pass", description: "Environment art and props", agents: ["technical-artist", "art-director"] },
      { order: 4, name: "Integration", description: "Wire scenes and navigation", agents: ["level-designer"] },
    ],
    userInvocable: true,
    teamMembers: ["creative-director", "art-director", "level-designer", "world-builder", "technical-artist"],
  },
];
