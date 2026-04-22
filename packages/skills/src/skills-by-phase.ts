import type { SkillDefinition, SkillName } from "@game-studio/types";
import type { AgentRole } from "@game-studio/types";

/** Skills organized by production phase */
export const skillsByPhase: Record<string, SkillDefinition[]> = {
  onboarding: [
    {
      name: "start",
      description: "First-time onboarding — asks where you are, then guides you to the right workflow",
      phases: [],
      userInvocable: true,
      args: [],
    },
    {
      name: "help",
      description: "Context-aware 'what do I do next?' — reads current stage and surfaces the required next step",
      phases: [],
      userInvocable: true,
    },
    {
      name: "project-stage-detect",
      description: "Full project audit — detect phase, identify existence gaps, recommend next steps",
      phases: [],
      userInvocable: true,
    },
    {
      name: "setup-engine",
      description: "Configure engine + version, detect knowledge gaps, populate version-aware reference docs",
      phases: [],
      userInvocable: true,
    },
    {
      name: "adopt",
      description: "Brownfield format audit — checks internal structure of existing GDDs/ADRs/stories",
      phases: [],
      userInvocable: true,
    },
  ],

  design: [
    {
      name: "brainstorm",
      description:
        "Guided ideation using professional studio methods (MDA, SDT, Bartle, verb-first)",
      phases: [
        {
          order: 1,
          name: "Concept Discovery",
          description: "Identify the core action and player fantasy",
          agents: ["game-designer"],
        },
        {
          order: 2,
          name: "Genre Analysis",
          description: "Compare against established genres and identify differentiation",
          agents: ["game-designer"],
        },
        {
          order: 3,
          name: "Pillar Definition",
          description: "Define 2-4 game pillars that define the experience",
          agents: ["creative-director", "game-designer"],
        },
        {
          order: 4,
          name: "Pillar Stress Test",
          description: "Validate pillars against each other and the core fantasy",
          agents: ["creative-director"],
          gates: ["CD-PILLARS"],
        },
        {
          order: 5,
          name: "Scope Estimation",
          description: "Estimate MVP and full vision scope",
          agents: ["producer", "game-designer"],
          gates: ["PR-SCOPE"],
        },
      ],
      userInvocable: true,
      gates: ["CD-PILLARS", "PR-SCOPE", "TD-FEASIBILITY"],
    },
    {
      name: "map-systems",
      description: "Decompose game concept into systems, map dependencies, prioritize design order",
      phases: [
        {
          order: 1,
          name: "Identify Systems",
          description: "List all game systems",
          agents: ["game-designer"],
        },
        {
          order: 2,
          name: "Dependency Mapping",
          description: "Map inter-system dependencies",
          agents: ["game-designer", "lead-programmer"],
        },
        {
          order: 3,
          name: "Layer Assignment",
          description: "Assign systems to architectural layers",
          agents: ["lead-programmer"],
          gates: ["TD-SYSTEM-BOUNDARY"],
        },
      ],
      userInvocable: true,
      gates: ["TD-SYSTEM-BOUNDARY", "CD-SYSTEMS"],
    },
    {
      name: "design-system",
      description: "Guided, section-by-section GDD authoring for a single game system",
      phases: [
        {
          order: 1,
          name: "Overview & Fantasy",
          description: "Write the overview and player fantasy sections",
          agents: ["game-designer"],
        },
        {
          order: 2,
          name: "Detailed Rules",
          description: "Define unambiguous mechanics",
          agents: ["game-designer"],
        },
        {
          order: 3,
          name: "Formulas & Edge Cases",
          description: "Define all math and edge cases",
          agents: ["game-designer", "economy-designer"],
        },
        {
          order: 4,
          name: "Dependencies & Tuning",
          description: "Map dependencies and identify tuning knobs",
          agents: ["game-designer"],
        },
        {
          order: 5,
          name: "Acceptance Criteria",
          description: "Define testable success conditions",
          agents: ["game-designer", "qa-lead"],
        },
        {
          order: 6,
          name: "Pillar Alignment Review",
          description: "Validate against game pillars",
          agents: ["creative-director"],
          gates: ["CD-GDD-ALIGN"],
        },
      ],
      userInvocable: true,
      gates: ["CD-GDD-ALIGN"],
    },
    {
      name: "quick-design",
      description: "Lightweight design spec for small changes — tuning, tweaks, minor additions",
      phases: [],
      userInvocable: true,
    },
    {
      name: "review-all-gdds",
      description: "Cross-GDD consistency and game design holism review across all design docs",
      phases: [
        {
          order: 1,
          name: "Consistency Scan",
          description: "Check for cross-document inconsistencies",
          agents: ["game-designer"],
        },
        {
          order: 2,
          name: "Design Theory Review",
          description: "Review design against established theory",
          agents: ["creative-director"],
        },
        {
          order: 3,
          name: "Cross-GDD Review",
          description: "Validate all GDDs together",
          agents: ["creative-director", "game-designer"],
          gates: ["CD-GDD-ALIGN"],
        },
      ],
      userInvocable: true,
      gates: ["CD-GDD-ALIGN"],
    },
    {
      name: "propagate-design-change",
      description: "When a GDD is revised, find affected ADRs and produce an impact report",
      phases: [],
      userInvocable: true,
    },
  ],

  "ux-design": [
    {
      name: "ux-design",
      description: "Guided section-by-section UX spec authoring",
      phases: [],
      userInvocable: true,
    },
    {
      name: "ux-review",
      description: "Validate UX specs for GDD alignment, accessibility, and pattern compliance",
      phases: [],
      userInvocable: true,
    },
  ],

  architecture: [
    {
      name: "create-architecture",
      description: "Guided authoring of the master architecture document",
      phases: [
        {
          order: 1,
          name: "System Overview",
          description: "Define the overall architecture",
          agents: ["technical-director", "lead-programmer"],
        },
        {
          order: 2,
          name: "API Design",
          description: "Define key APIs and boundaries",
          agents: ["lead-programmer"],
        },
        {
          order: 3,
          name: "ADR Authoring",
          description: "Create ADRs for major decisions",
          agents: ["technical-director"],
        },
        {
          order: 4,
          name: "Control Manifest",
          description: "Generate programmer rules sheet",
          agents: ["technical-director"],
          gates: ["TD-ARCHITECTURE", "LP-FEASIBILITY"],
        },
      ],
      userInvocable: true,
      gates: ["TD-ARCHITECTURE", "LP-FEASIBILITY", "TD-ADR"],
    },
    {
      name: "architecture-decision",
      description: "Create an Architecture Decision Record",
      phases: [],
      userInvocable: true,
      gates: ["TD-ADR"],
    },
    {
      name: "architecture-review",
      description: "Validate all ADRs for completeness and GDD coverage",
      phases: [],
      userInvocable: true,
    },
    {
      name: "create-control-manifest",
      description: "Generate flat programmer rules sheet from accepted ADRs",
      phases: [],
      userInvocable: true,
    },
  ],

  "stories-sprints": [
    {
      name: "create-epics",
      description: "Translate GDDs + ADRs into epics",
      phases: [
        {
          order: 1,
          name: "Epic Identification",
          description: "Identify all epics from GDDs",
          agents: ["producer", "game-designer"],
        },
        {
          order: 2,
          name: "Feasibility Review",
          description: "Validate epic structure",
          agents: ["producer"],
          gates: ["PR-EPIC"],
        },
      ],
      userInvocable: true,
      gates: ["PR-EPIC"],
    },
    {
      name: "create-stories",
      description: "Break a single epic into implementable story files",
      phases: [],
      userInvocable: true,
      gates: ["QL-STORY-READY"],
    },
    {
      name: "dev-story",
      description: "Read a story and implement it",
      phases: [
        {
          order: 1,
          name: "Route to Specialist",
          description: "Identify the correct programmer agent",
          agents: ["lead-programmer"],
        },
        {
          order: 2,
          name: "Implementation",
          description: "Implement the story",
          agents: [],
        },
        {
          order: 3,
          name: "Code Review",
          description: "Review implementation",
          agents: ["lead-programmer"],
          gates: ["LP-CODE-REVIEW"],
        },
      ],
      userInvocable: true,
      gates: ["LP-CODE-REVIEW"],
    },
    {
      name: "sprint-plan",
      description: "Generate or update a sprint plan",
      phases: [],
      userInvocable: true,
      gates: ["PR-SPRINT"],
    },
    {
      name: "sprint-status",
      description: "Fast 30-line sprint snapshot",
      phases: [],
      userInvocable: true,
    },
    {
      name: "story-readiness",
      description: "Validate story is implementation-ready",
      phases: [],
      userInvocable: true,
      gates: ["QL-STORY-READY"],
    },
    {
      name: "story-done",
      description: "8-phase completion review after implementation",
      phases: [
        {
          order: 1,
          name: "Verify Acceptance Criteria",
          description: "Check each criterion",
          agents: ["qa-lead", "qa-tester"],
        },
        {
          order: 2,
          name: "Code Review",
          description: "Final code review",
          agents: ["lead-programmer"],
          gates: ["LP-CODE-REVIEW"],
        },
      ],
      userInvocable: true,
      gates: ["LP-CODE-REVIEW"],
    },
    {
      name: "estimate",
      description: "Structured effort estimate with complexity breakdown",
      phases: [],
      userInvocable: true,
    },
  ],

  reviews: [
    {
      name: "design-review",
      description: "Review a game design document for completeness and consistency",
      phases: [],
      userInvocable: true,
    },
    {
      name: "code-review",
      description: "Architectural code review for a file or changeset",
      phases: [],
      userInvocable: true,
    },
    {
      name: "balance-check",
      description: "Analyze game balance data and formulas",
      phases: [],
      userInvocable: true,
    },
    {
      name: "asset-audit",
      description: "Audit assets for naming conventions and pipeline compliance",
      phases: [],
      userInvocable: true,
    },
    {
      name: "content-audit",
      description: "Audit GDD-specified content counts against implemented content",
      phases: [],
      userInvocable: true,
    },
    {
      name: "scope-check",
      description: "Analyze feature or sprint scope against original plan",
      phases: [],
      userInvocable: true,
    },
    {
      name: "perf-profile",
      description: "Structured performance profiling with bottleneck identification",
      phases: [],
      userInvocable: true,
    },
    {
      name: "tech-debt",
      description: "Scan, track, prioritize, and report on technical debt",
      phases: [],
      userInvocable: true,
    },
    {
      name: "gate-check",
      description: "Validate readiness to advance between development phases",
      phases: [
        {
          order: 1,
          name: "CD Phase Gate",
          description: "Creative director review",
          agents: ["creative-director"],
          gates: ["CD-PHASE-GATE"],
        },
        {
          order: 2,
          name: "TD Phase Gate",
          description: "Technical director review",
          agents: ["technical-director"],
          gates: ["TD-PHASE-GATE"],
        },
        {
          order: 3,
          name: "PR Phase Gate",
          description: "Producer review",
          agents: ["producer"],
          gates: ["PR-PHASE-GATE"],
        },
        {
          order: 4,
          name: "AD Phase Gate",
          description: "Art director review",
          agents: ["art-director"],
          gates: ["AD-PHASE-GATE"],
        },
      ],
      userInvocable: true,
      gates: ["CD-PHASE-GATE", "TD-PHASE-GATE", "PR-PHASE-GATE", "AD-PHASE-GATE"],
    },
    {
      name: "consistency-check",
      description: "Scan all GDDs against the entity registry for inconsistencies",
      phases: [],
      userInvocable: true,
    },
  ],

  qa: [
    {
      name: "qa-plan",
      description: "Generate a QA test plan for a sprint or feature",
      phases: [],
      userInvocable: true,
    },
    {
      name: "smoke-check",
      description: "Run critical path smoke test gate before QA hand-off",
      phases: [],
      userInvocable: true,
    },
    {
      name: "soak-test",
      description: "Generate a soak test protocol for extended play sessions",
      phases: [],
      userInvocable: true,
    },
    {
      name: "regression-suite",
      description: "Map test coverage to GDD critical paths",
      phases: [],
      userInvocable: true,
    },
    {
      name: "test-setup",
      description: "Scaffold the test framework and CI/CD pipeline",
      phases: [],
      userInvocable: true,
    },
    {
      name: "test-helpers",
      description: "Generate engine-specific test helper libraries",
      phases: [],
      userInvocable: true,
    },
    {
      name: "test-evidence-review",
      description: "Quality review of test files and manual evidence documents",
      phases: [],
      userInvocable: true,
    },
    {
      name: "test-flakiness",
      description: "Detect non-deterministic tests from CI run logs",
      phases: [],
      userInvocable: true,
    },
    {
      name: "skill-test",
      description: "Validate skill files for structural compliance",
      phases: [],
      userInvocable: true,
    },
  ],

  production: [
    {
      name: "milestone-review",
      description: "Review milestone progress and generate status report",
      phases: [],
      userInvocable: true,
      gates: ["PR-MILESTONE"],
    },
    {
      name: "retrospective",
      description: "Structured sprint or milestone retrospective",
      phases: [],
      userInvocable: true,
    },
    {
      name: "bug-report",
      description: "Create a structured bug report",
      phases: [],
      userInvocable: true,
    },
    {
      name: "bug-triage",
      description: "Read all open bugs, re-evaluate priority vs. severity",
      phases: [],
      userInvocable: true,
    },
    {
      name: "reverse-document",
      description: "Generate design or architecture docs from existing implementation",
      phases: [],
      userInvocable: true,
    },
    {
      name: "playtest-report",
      description: "Generate a structured playtest report",
      phases: [],
      userInvocable: true,
      gates: ["CD-PLAYTEST"],
    },
  ],

  release: [
    {
      name: "release-checklist",
      description: "Generate and validate a pre-release checklist",
      phases: [],
      userInvocable: true,
    },
    {
      name: "launch-checklist",
      description: "Complete launch readiness validation across all departments",
      phases: [],
      userInvocable: true,
    },
    {
      name: "changelog",
      description: "Auto-generate changelog from git commits and sprint data",
      phases: [],
      userInvocable: true,
    },
    {
      name: "patch-notes",
      description: "Generate player-facing patch notes",
      phases: [],
      userInvocable: true,
    },
    {
      name: "hotfix",
      description: "Emergency fix workflow with audit trail",
      phases: [],
      userInvocable: true,
    },
  ],

  "creative-content": [
    {
      name: "prototype",
      description: "Rapid throwaway prototype to validate a mechanic",
      phases: [],
      userInvocable: true,
    },
    {
      name: "onboard",
      description: "Generate contextual onboarding document for a new contributor",
      phases: [],
      userInvocable: true,
    },
    {
      name: "localize",
      description: "Localization workflow: string extraction and translation readiness",
      phases: [],
      userInvocable: true,
    },
  ],
};
