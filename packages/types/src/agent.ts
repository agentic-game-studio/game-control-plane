/**
 * Shared TypeScript types for the Agentic Game Studio Control Plane.
 * This is the single source of truth for all TypeScript interfaces used
 * across the frontend, backend, and shared packages.
 */

export type ModelTier = "opus" | "sonnet" | "haiku";

export type AgentTier = 1 | 2 | 3;

/** Agent roles following the 3-tier studio hierarchy */
export type AgentRole =
  // Tier 1 — Leadership
  | "game-director"
  | "creative-director"
  | "technical-director"
  | "producer"
  // Tier 2 — Department Leads
  | "game-designer"
  | "lead-programmer"
  | "art-director"
  | "audio-director"
  | "narrative-director"
  | "qa-lead"
  | "release-manager"
  | "localization-lead"
  // Tier 3 — Specialists
  | "systems-designer"
  | "level-designer"
  | "economy-designer"
  | "ux-designer"
  | "gameplay-programmer"
  | "engine-programmer"
  | "ai-programmer"
  | "network-programmer"
  | "tools-programmer"
  | "ui-programmer"
  | "technical-artist"
  | "writer"
  | "world-builder"
  | "sound-designer"
  | "qa-tester"
  | "performance-analyst"
  | "devops-engineer"
  | "analytics-engineer"
  | "security-engineer"
  | "prototyper"
  | "accessibility-specialist"
  | "live-ops-designer"
  | "community-manager"
  // Engine specialists
  | "godot-specialist"
  | "godot-gdscript-specialist"
  | "godot-shader-specialist"
  | "godot-gdextension-specialist"
  | "unity-specialist"
  | "unity-dots-specialist"
  | "unity-shader-specialist"
  | "unity-addressables-specialist"
  | "unity-ui-specialist"
  | "unreal-specialist"
  | "ue-gas-specialist"
  | "ue-blueprint-specialist"
  | "ue-replication-specialist"
  | "ue-umg-specialist";

export type AgentTool =
  | "Read"
  | "Write"
  | "Edit"
  | "Glob"
  | "Grep"
  | "Bash"
  | "Task"
  | "AskUserQuestion";

export interface AgentDefinition {
  name: AgentRole;
  description: string;
  tier: AgentTier;
  model: ModelTier;
  tools: AgentTool[];
  maxTurns: number;
  disallowedTools?: AgentTool[];
  skills?: string[];
  memory: "user" | "project" | "session";
  delegates?: AgentRole[];
  reportsTo?: AgentRole[];
  /** The prompt injected into the system message */
  systemPrompt?: string;
}

export interface AgentMetrics {
  agent: string;
  phase: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: "completed" | "failed";
  tokenUsage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}
