import type { ModelTier, AgentRole } from "@game-studio/types";

/**
 * Model tier mapping per agent.
 * Tier 1 = Opus, Tier 2 = Sonnet, Tier 3 = Sonnet/Haiku depending on complexity.
 */
export const agentTiers: Record<AgentRole, { tier: 1 | 2 | 3; model: ModelTier }> = {
  // Tier 1 — Leadership (Opus)
  "creative-director": { tier: 1, model: "opus" },
  "technical-director": { tier: 1, model: "opus" },
  producer: { tier: 1, model: "opus" },
  // Tier 2 — Department Leads (Sonnet)
  "game-designer": { tier: 2, model: "sonnet" },
  "lead-programmer": { tier: 2, model: "sonnet" },
  "art-director": { tier: 2, model: "sonnet" },
  "audio-director": { tier: 2, model: "sonnet" },
  "narrative-director": { tier: 2, model: "sonnet" },
  "qa-lead": { tier: 2, model: "sonnet" },
  "release-manager": { tier: 2, model: "sonnet" },
  "localization-lead": { tier: 2, model: "sonnet" },
  // Tier 3 — Specialists (Sonnet default)
  "systems-designer": { tier: 3, model: "sonnet" },
  "level-designer": { tier: 3, model: "sonnet" },
  "economy-designer": { tier: 3, model: "sonnet" },
  "ux-designer": { tier: 3, model: "sonnet" },
  "gameplay-programmer": { tier: 3, model: "sonnet" },
  "engine-programmer": { tier: 3, model: "sonnet" },
  "ai-programmer": { tier: 3, model: "sonnet" },
  "network-programmer": { tier: 3, model: "sonnet" },
  "tools-programmer": { tier: 3, model: "sonnet" },
  "ui-programmer": { tier: 3, model: "sonnet" },
  "technical-artist": { tier: 3, model: "sonnet" },
  writer: { tier: 3, model: "sonnet" },
  "world-builder": { tier: 3, model: "sonnet" },
  "sound-designer": { tier: 3, model: "sonnet" },
  "qa-tester": { tier: 3, model: "sonnet" },
  "performance-analyst": { tier: 3, model: "sonnet" },
  "devops-engineer": { tier: 3, model: "sonnet" },
  "analytics-engineer": { tier: 3, model: "sonnet" },
  "security-engineer": { tier: 3, model: "sonnet" },
  prototyper: { tier: 3, model: "sonnet" },
  "accessibility-specialist": { tier: 3, model: "sonnet" },
  "live-ops-designer": { tier: 3, model: "sonnet" },
  "community-manager": { tier: 3, model: "sonnet" },
  // Engine specialists
  "godot-specialist": { tier: 3, model: "sonnet" },
  "godot-gdscript-specialist": { tier: 3, model: "sonnet" },
  "godot-shader-specialist": { tier: 3, model: "sonnet" },
  "godot-gdextension-specialist": { tier: 3, model: "sonnet" },
  "unity-specialist": { tier: 3, model: "sonnet" },
  "unity-dots-specialist": { tier: 3, model: "sonnet" },
  "unity-shader-specialist": { tier: 3, model: "sonnet" },
  "unity-addressables-specialist": { tier: 3, model: "sonnet" },
  "unity-ui-specialist": { tier: 3, model: "sonnet" },
  "unreal-specialist": { tier: 3, model: "sonnet" },
  "ue-gas-specialist": { tier: 3, model: "sonnet" },
  "ue-blueprint-specialist": { tier: 3, model: "sonnet" },
  "ue-replication-specialist": { tier: 3, model: "sonnet" },
  "ue-umg-specialist": { tier: 3, model: "sonnet" },
  // Code review
  "code-reviewer": { tier: 3, model: "sonnet" },
};
