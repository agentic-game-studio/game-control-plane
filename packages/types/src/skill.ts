import type { AgentRole } from "./agent.js";
import type { ModelTier } from "./agent.js";

export type SkillName =
  // Onboarding
  | "start"
  | "help"
  | "project-stage-detect"
  | "setup-engine"
  | "adopt"
  // Design
  | "brainstorm"
  | "map-systems"
  | "design-system"
  | "quick-design"
  | "review-all-gdds"
  | "propagate-design-change"
  // UX
  | "ux-design"
  | "ux-review"
  // Architecture
  | "create-architecture"
  | "architecture-decision"
  | "architecture-review"
  | "create-control-manifest"
  // Stories & Sprints
  | "create-epics"
  | "create-stories"
  | "dev-story"
  | "sprint-plan"
  | "sprint-status"
  | "story-readiness"
  | "story-done"
  | "estimate"
  // Reviews & Analysis
  | "design-review"
  | "code-review"
  | "balance-check"
  | "asset-audit"
  | "art-bible"
  | "content-audit"
  | "scope-check"
  | "security-audit"
  | "perf-profile"
  | "tech-debt"
  | "gate-check"
  | "consistency-check"
  // QA & Testing
  | "qa-plan"
  | "smoke-check"
  | "soak-test"
  | "regression-suite"
  | "test-setup"
  | "test-helpers"
  | "test-evidence-review"
  | "test-flakiness"
  | "skill-test"
  // Production
  | "milestone-review"
  | "retrospective"
  | "bug-report"
  | "bug-triage"
  | "reverse-document"
  | "playtest-report"
  // Release
  | "release-checklist"
  | "launch-checklist"
  | "changelog"
  | "patch-notes"
  | "hotfix"
  // Creative & Content
  | "prototype"
  | "onboard"
  | "localize"
  // Godot Production
  | "setup-godot-project"
  | "compose-scene"
  | "automated-playtest"
  | "export-godot-project"
  | "autonomous-production-loop"
  | "implement-player-controller"
  | "run-godot-headless"
  | "implement-game-state"
  | "implement-tilemap"
  | "implement-level"
  | "implement-enemy"
  | "implement-multiplayer"
  | "implement-hud"
  | "implement-save-system"
  | "gdd-to-tickets"
  | "write-dialogue"
  | "write-lore"
  | "generate-audio-asset"
  | "playtest-with-mcp"
  | "implement-shader-effect"
  | "generate-genre-template"
  // Team Orchestration
  | "team-combat"
  | "team-narrative"
  | "team-ui"
  | "team-release"
  | "team-polish"
  | "team-audio"
  | "team-level"
  | "team-live-ops"
  | "team-qa"
  | "team-multiplayer"
  | "team-progression"
  | "team-world"
  // Local Godot CLI
  | "godot-cli-ops";

export interface SkillArg {
  name: string;
  description: string;
  required?: boolean;
  default?: string;
}

export interface SkillPhase {
  order: number;
  name: string;
  description: string;
  agents: AgentRole[];
  parallel?: boolean;
  gates?: string[];
  /**
   * Sub-skills to invoke after this phase's agent tasks complete.
   * Each sub-skill runs its own full skill pipeline (all phases + agents).
   * Use for hierarchical decomposition — e.g. implement-level → sub-skills
   * for tilemap, enemy, collectibles rather than duplicating those agents here.
   */
  subSkills?: SkillName[];
}

export interface SkillDefinition {
  name: SkillName;
  description: string;
  phases: SkillPhase[];
  model?: ModelTier;
  userInvocable: boolean;
  args?: SkillArg[];
  gates?: string[];
  teamMembers?: AgentRole[];
}
