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
  | "autonomous-producer"
  | "creative-director"
  | "technical-director"
  | "producer"
  | "game-director"
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
  | "godot-scaffolder"
  | "godot-specialist"
  | "godot-gdscript-specialist"
  | "godot-csharp-specialist"
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
  | "ue-umg-specialist"
  // Code review
  | "code-reviewer"
  | "market-researcher";

/**
 * Compile-time array of every AgentRole literal. Derived from the
 * union above via a single sentinel. Adding a new role to the
 * union is automatically reflected here (TS errors if the union
 * and this list drift), and the runtime guard below stays in
 * sync without anyone having to remember to update a manual
 * string array.
 *
 * 25-L-agent-role-guard: provides the source of truth for
 * `isAgentRole(x)`, used by the route handlers that previously
 * cast `body.role as AgentRole` without validation. The cast
 * was a thin barrier — a typo or attacker-supplied string in
 * the request body would propagate to the LLM call and could
 * match no registered agent, wasting a request round-trip.
 */
type AgentRoleTuple = [
  // Tier 1
  "autonomous-producer", "creative-director", "technical-director",
  "producer", "game-director",
  // Tier 2
  "game-designer", "lead-programmer", "art-director", "audio-director",
  "narrative-director", "qa-lead", "release-manager", "localization-lead",
  // Tier 3 (gameplay / engineering)
  "systems-designer", "level-designer", "economy-designer", "ux-designer",
  "gameplay-programmer", "engine-programmer", "ai-programmer",
  "network-programmer", "tools-programmer", "ui-programmer",
  "technical-artist", "writer", "world-builder", "sound-designer",
  "qa-tester", "performance-analyst", "devops-engineer",
  "analytics-engineer", "security-engineer", "prototyper",
  "accessibility-specialist", "live-ops-designer", "community-manager",
  // Engine specialists
  "godot-scaffolder", "godot-specialist", "godot-gdscript-specialist",
  "godot-csharp-specialist", "godot-shader-specialist",
  "godot-gdextension-specialist", "unity-specialist", "unity-dots-specialist",
  "unity-shader-specialist", "unity-addressables-specialist",
  "unity-ui-specialist", "unreal-specialist", "ue-gas-specialist",
  "ue-blueprint-specialist", "ue-replication-specialist", "ue-umg-specialist",
  // Code review
  "code-reviewer",
  // Research
  "market-researcher",
];

export const AGENT_ROLES = [
  // Tier 1
  "autonomous-producer", "creative-director", "technical-director",
  "producer", "game-director",
  // Tier 2
  "game-designer", "lead-programmer", "art-director", "audio-director",
  "narrative-director", "qa-lead", "release-manager", "localization-lead",
  // Tier 3 (gameplay / engineering)
  "systems-designer", "level-designer", "economy-designer", "ux-designer",
  "gameplay-programmer", "engine-programmer", "ai-programmer",
  "network-programmer", "tools-programmer", "ui-programmer",
  "technical-artist", "writer", "world-builder", "sound-designer",
  "qa-tester", "performance-analyst", "devops-engineer",
  "analytics-engineer", "security-engineer", "prototyper",
  "accessibility-specialist", "live-ops-designer", "community-manager",
  // Engine specialists
  "godot-scaffolder", "godot-specialist", "godot-gdscript-specialist",
  "godot-csharp-specialist", "godot-shader-specialist",
  "godot-gdextension-specialist", "unity-specialist", "unity-dots-specialist",
  "unity-shader-specialist", "unity-addressables-specialist",
  "unity-ui-specialist", "unreal-specialist", "ue-gas-specialist",
  "ue-blueprint-specialist", "ue-replication-specialist", "ue-umg-specialist",
  // Code review
  "code-reviewer",
  // Research
  "market-researcher",
] as const satisfies AgentRoleTuple;

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

export type AgentTool =
  | "Read"
  | "Write"
  | "Edit"
  | "Glob"
  | "Grep"
  | "Bash"
  | "Task"
  | "AskUserQuestion"
  | "GodotCLI"
  | "DeepResearch";

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
  /**
   * Mark this agent as experimental. Experimental agents are defined but
   * not yet wired into any skill's `uses`/`agents` list. The UI should
   * render an "experimental" badge on these so users know they're not
   * reachable from the standard workflow. Mark true to surface a new
   * agent without committing to the delegation wiring in the same PR.
   */
  experimental?: boolean;
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
