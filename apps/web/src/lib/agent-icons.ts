/** Material Symbol icon for each agent role */
export const AGENT_ICONS: Record<string, string> = {
  // Orchestrator
  "producer": "stadia_controller",

  // Tier 1 — Leadership
  "creative-director": "psychology",
  "technical-director": "engineering",

  // Tier 2 — Department Leads
  "game-designer": "sports_esports",
  "lead-programmer": "code",
  "art-director": "palette",
  "audio-director": "volume_up",
  "narrative-director": "auto_stories",
  "qa-lead": "bug_report",
  "release-manager": "rocket_launch",
  "localization-lead": "translate",

  // Tier 3 — Specialists (Design)
  "systems-designer": "memory",
  "level-designer": "architecture",
  "economy-designer": "payments",
  "ux-designer": "design_services",
  "prototyper": "science",

  // Tier 3 — Specialists (Art)
  "technical-artist": "draw",
  "accessibility-specialist": "accessibility",

  // Tier 3 — Specialists (Audio)
  "sound-designer": "audio_file",

  // Tier 3 — Specialists (Narrative)
  "writer": "edit",
  "world-builder": "public",

  // Tier 3 — Specialists (Programming)
  "gameplay-programmer": "keyboard",
  "engine-programmer": "settings",
  "ai-programmer": "smart_toy",
  "network-programmer": "router",
  "tools-programmer": "build",
  "ui-programmer": "web",

  // Tier 3 — Specialists (Production)
  "devops-engineer": "cloud_upload",
  "analytics-engineer": "analytics",
  "community-manager": "group",
  "live-ops-designer": "sync",

  // Tier 3 — Specialists (QA)
  "qa-tester": "fact_check",
  "performance-analyst": "speed",

  // Tier 3 — Engine: Godot
  "godot-specialist": "videogame_asset",
  "godot-gdscript-specialist": "data_object",
  "godot-shader-specialist": "gradient",
  "godot-gdextension-specialist": "extension",

  // Tier 3 — Engine: Unity
  "unity-specialist": "gamepad",
  "unity-dots-specialist": "view_in_ar",
  "unity-shader-specialist": "blur_on",

  // Tier 3 — Engine: Unreal
  "unreal-specialist": "joystick",
  "ue-gas-specialist": "bolt",
  "ue-blueprint-specialist": "account_tree",
  "ue-replication-specialist": "content_copy",
};

export function getAgentIcon(role: string): string {
  return AGENT_ICONS[role] ?? "smart_toy";
}

/** Agent hierarchy tree — Game Director first, all 44 agents */
export interface AgentTreeNode {
  role: string;
  tier: number;
  children: AgentTreeNode[];
}

export const AGENT_TREE: AgentTreeNode[] = [
  {
    role: "creative-director",
    tier: 1,
    children: [
      { role: "game-designer", tier: 2, children: [
        { role: "systems-designer", tier: 3, children: [] },
        { role: "level-designer", tier: 3, children: [] },
        { role: "economy-designer", tier: 3, children: [] },
        { role: "prototyper", tier: 3, children: [] },
      ]},
      { role: "art-director", tier: 2, children: [
        { role: "technical-artist", tier: 3, children: [] },
        { role: "ux-designer", tier: 3, children: [] },
        { role: "accessibility-specialist", tier: 3, children: [] },
      ]},
      { role: "audio-director", tier: 2, children: [
        { role: "sound-designer", tier: 3, children: [] },
      ]},
      { role: "narrative-director", tier: 2, children: [
        { role: "writer", tier: 3, children: [] },
        { role: "world-builder", tier: 3, children: [] },
      ]},
    ],
  },
  {
    role: "technical-director",
    tier: 1,
    children: [
      { role: "lead-programmer", tier: 2, children: [
        { role: "gameplay-programmer", tier: 3, children: [] },
        { role: "engine-programmer", tier: 3, children: [] },
        { role: "ai-programmer", tier: 3, children: [] },
        { role: "network-programmer", tier: 3, children: [] },
        { role: "tools-programmer", tier: 3, children: [] },
        { role: "ui-programmer", tier: 3, children: [] },
        { role: "godot-specialist", tier: 3, children: [
          { role: "godot-gdscript-specialist", tier: 3, children: [] },
          { role: "godot-shader-specialist", tier: 3, children: [] },
          { role: "godot-gdextension-specialist", tier: 3, children: [] },
        ]},
        { role: "unity-specialist", tier: 3, children: [
          { role: "unity-dots-specialist", tier: 3, children: [] },
          { role: "unity-shader-specialist", tier: 3, children: [] },
        ]},
        { role: "unreal-specialist", tier: 3, children: [
          { role: "ue-gas-specialist", tier: 3, children: [] },
          { role: "ue-blueprint-specialist", tier: 3, children: [] },
          { role: "ue-replication-specialist", tier: 3, children: [] },
        ]},
        { role: "analytics-engineer", tier: 3, children: [] },
      ]},
      { role: "qa-lead", tier: 2, children: [
        { role: "qa-tester", tier: 3, children: [] },
        { role: "performance-analyst", tier: 3, children: [] },
      ]},
    ],
  },
  {
    role: "producer",
    tier: 1,
    children: [
      { role: "release-manager", tier: 2, children: [
        { role: "devops-engineer", tier: 3, children: [] },
        { role: "live-ops-designer", tier: 3, children: [] },
        { role: "community-manager", tier: 3, children: [] },
      ]},
      { role: "localization-lead", tier: 2, children: [] },
    ],
  },
];
