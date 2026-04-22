import type { SkillDefinition } from "@game-studio/types";
import type { AgentRole } from "@game-studio/types";

/** Team orchestration skills — 9 teams coordinating multiple agents */
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
    phases: [],
    userInvocable: true,
    teamMembers: ["performance-analyst", "technical-artist", "sound-designer", "qa-tester"],
  },

  {
    name: "team-audio",
    description: "Coordinate audio: audio-director + sound-designer + technical-artist + gameplay-programmer",
    phases: [],
    userInvocable: true,
    teamMembers: ["audio-director", "sound-designer", "technical-artist", "gameplay-programmer"],
  },

  {
    name: "team-level",
    description: "Coordinate level design: level-designer + narrative-director + world-builder + art-director + systems-designer + qa-tester",
    phases: [],
    userInvocable: true,
    teamMembers: ["level-designer", "narrative-director", "world-builder", "art-director", "systems-designer", "qa-tester"],
  },

  {
    name: "team-live-ops",
    description: "Coordinate live ops: live-ops-designer + economy-designer + community-manager + analytics-engineer",
    phases: [],
    userInvocable: true,
    teamMembers: ["live-ops-designer", "economy-designer", "community-manager", "analytics-engineer"],
  },

  {
    name: "team-qa",
    description: "Coordinate QA: qa-lead + qa-tester + gameplay-programmer + producer",
    phases: [],
    userInvocable: true,
    teamMembers: ["qa-lead", "qa-tester", "gameplay-programmer", "producer"],
  },
];
