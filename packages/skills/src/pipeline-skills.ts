/**
 * Lifecycle Pipeline skills — `kind: "pipeline"` SkillDefinitions consumed by
 * `apps/api/src/services/pipeline-service.ts`.
 *
 * Each pipeline chains phases sequentially with inter-phase director gates
 * classified via `isGatePassing()` (single classifier). Run-state is persisted
 * per-run for resume; phase agents run sequentially in v1 (parallel:true is
 * parsed but not yet honored — see .omc/plans/lifecycle-pipeline.md §2.5).
 *
 * Pipeline skills MUST NOT declare `subSkills` on any phase — the skills.ts
 * cascade is one-level and does not re-enter the pipeline runner, so a
 * pipeline phase declaring subSkills would silently no-op. /make-game
 * sequences child runs manually instead.
 *
 * Phase 1 ship: `/concept` (1 gate, 2 phases, manual mode).
 * Phase 2 ship: `/design` (3 gates, 3 phases, manual mode).
 * Phase 3 ship: `/sprint` (auto-dispatches available tickets to feature teams).
 * Phase 4 ship: `/slice`, `/polish`, `/release` (pre-production → polish → release).
 * Phase 5 ship: `/make-game` (chains the above into a full-lifecycle orchestrator).
 */

import type { SkillDefinition } from "@game-studio/types";

export const pipelineSkills: SkillDefinition[] = [
  {
    name: "pipeline-concept",
    description:
      "/concept — start a new game concept from a one-line idea. Phase 1 (market-research) uses MiroMind deep research to validate market fit and surface design angles; Phase 2 (creative-director) distills the research into 3-5 design pillars and a one-paragraph pitch. The CD-PILLARS gate holds for human approval before the concept is considered final (manual mode: a /advance is required).",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "concept",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "market-research",
        description:
          "Run MiroMind multi-angle deep research on the concept: market analysis, competitive landscape, target audience, technical recommendations, and GDD recommendations. Output: a research report written to workspace/design/concept/<slug>-research.md.",
        agents: ["market-researcher"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "creative-director",
        description:
          "Read the research report and produce a concept brief: 3-5 design pillars (each pillar = a sentence + a 'why it matters' line), a one-paragraph pitch, and a 'risks & open questions' section. Output: workspace/design/concept/<slug>-concept.md.",
        agents: ["creative-director"],
        gates: ["CD-PILLARS"],
        createsTickets: false,
      },
    ],
  },
  {
    name: "pipeline-design",
    description:
      "/design — turn a concept into a production-ready design. Phase 1 (market-research) reuses MiroMind deep research. Phase 2 (gdd-draft) has the game-designer author an 8-section GDD written to workspace/design/gdd/<slug>.md, then the pipeline auto-ingests it onto the Kanban board (gdd:ingested); the CD-GDD-ALIGN gate holds for creative-direction sign-off. Phase 3 (art-architecture) has the creative-director + art-director produce the art bible and the technical-director's feasibility/architecture concerns are captured, gated by TD-FEASIBILITY then TD-ARCHITECTURE. Manual mode: a /advance is required at each of the 3 gates.",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "design",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "market-research",
        description:
          "Run MiroMind multi-angle deep research on the concept to ground the design in market/competitive/audience reality. Output: workspace/design/concept/<slug>-research.md (reused by the gdd-draft phase).",
        agents: ["market-researcher"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "gdd-draft",
        description:
          "Author the 8-section Game Design Document (Overview, Player Fantasy, Detailed Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria) at workspace/design/gdd/<slug>.md, grounded in the research report. On phase completion the pipeline auto-ingests the GDD onto the Kanban board as Quest tickets.",
        agents: ["game-designer"],
        gates: ["CD-GDD-ALIGN"],
        createsTickets: false,
      },
      {
        order: 3,
        name: "art-architecture",
        description:
          "Produce the art bible (style guide, palette, constraints) and capture the technical architecture / ADRs needed to realize the GDD. Output: art bible entry + ADR(s) under workspace/docs/architecture/. The two TD gates confirm the design is buildable and architecturally sound.",
        agents: ["creative-director", "art-director"],
        gates: ["TD-FEASIBILITY", "TD-ARCHITECTURE"],
        createsTickets: false,
      },
    ],
  },
  {
    name: "pipeline-sprint",
    description:
      "/sprint — execute a sprint: read available tickets off the Kanban board, group them by area, and auto-dispatch each group to the matching feature team (CODE→team-combat/combat-subarea, UI→team-ui, NARRATIVE→team-narrative, ART→team-world, AUDIO→team-audio, etc. via sprint-dispatcher). Each dispatch creates a Quest ticket and triggers auto-verification. The producer then reviews the sprint, gated by PR-SPRINT. Manual mode: /advance past the PR-SPRINT gate. Note: team-polish and team-release are NOT sprint targets (they are lifecycle-stage teams driven by /polish and /release).",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "production",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "sprint-dispatch",
        description:
          "Pre-hook reads the board's available column, groups tickets by area→team, and dispatches each team's lead agent via the Task tool (creates Quest tickets + triggers verification). The producer agent then summarizes the dispatched work.",
        agents: ["producer"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "sprint-review",
        description: "Producer reviews sprint outcomes against the GDD/scope. PR-SPRINT gate holds for approval.",
        agents: ["producer"],
        gates: ["PR-SPRINT"],
        createsTickets: false,
      },
    ],
  },
  {
    name: "pipeline-slice",
    description:
      "/slice — scope and prototype a vertical slice. technical-director scopes the slice against the GDD, game-designer writes the slice spec, then the prototyper builds a playable prototype + runs a tech spike. TD-SYSTEM-BOUNDARY gate confirms the system boundary is sound before full production. Manual mode: /advance past the gate.",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "pre-production",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "scope-slice",
        description: "technical-director scopes the vertical slice against the GDD: which systems, what's in/out, the riskiest unknown.",
        agents: ["technical-director"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "slice-spec",
        description: "game-designer writes the slice spec: the playable scenario, success criteria, and acceptance tests.",
        agents: ["game-designer"],
        createsTickets: false,
      },
      {
        order: 3,
        name: "prototype",
        description: "prototyper builds a playable prototype and runs a tech spike on the riskiest unknown. Output: prototype artifact on disk. TD-SYSTEM-BOUNDARY gate confirms the system boundary.",
        agents: ["prototyper"],
        gates: ["TD-SYSTEM-BOUNDARY"],
        createsTickets: false,
      },
    ],
  },
  {
    name: "pipeline-polish",
    description:
      "/polish — wrap team-polish: profile, then visually + aurally polish, then a QA pass. performance-analyst profiles and reports, technical-artist applies visual polish, sound-designer applies audio polish, qa-tester runs a final pass. AD-PHASE-GATE holds for art-director sign-off. Manual mode: /advance past the gate.",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "polish",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "profile",
        description: "performance-analyst profiles the build and writes a perf report (bottlenecks, frame budget, targets). Output: perf report on disk.",
        agents: ["performance-analyst"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "visual-polish",
        description: "technical-artist applies visual polish against the perf report + art bible (LODs, atlases, particle budget).",
        agents: ["technical-artist"],
        createsTickets: false,
      },
      {
        order: 3,
        name: "audio-polish",
        description: "sound-designer applies audio polish (mix, ducking, variation).",
        agents: ["sound-designer"],
        createsTickets: false,
      },
      {
        order: 4,
        name: "qa-pass",
        description: "qa-tester runs a final polish QA pass. AD-PHASE-GATE holds for art-director sign-off on the polished build.",
        agents: ["qa-tester"],
        gates: ["AD-PHASE-GATE"],
        createsTickets: false,
      },
    ],
  },
  {
    name: "pipeline-release",
    description:
      "/release — wrap team-release: release-manager checklist, qa-lead sign-off, devops-engineer exports a build, then final sign-off. The build phase auto-exports the project via executeGodotExport (build artifact + changelog). PR-MILESTONE gate holds for milestone sign-off. Manual mode: /advance past the gate.",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "release",
    userInvocable: true,
    phases: [
      {
        order: 1,
        name: "release-checklist",
        description: "release-manager runs the release checklist (store metadata, ratings, crash-readiness).",
        agents: ["release-manager"],
        createsTickets: false,
      },
      {
        order: 2,
        name: "qa-signoff",
        description: "qa-lead signs off on release-readiness (smoke tests, cert checks).",
        agents: ["qa-lead"],
        createsTickets: false,
      },
      {
        order: 3,
        name: "release-build",
        description: "devops-engineer drives the export. On phase completion the pipeline auto-exports the project via executeGodotExport (writes build artifact + changelog).",
        agents: ["devops-engineer"],
        createsTickets: false,
      },
      {
        order: 4,
        name: "final-signoff",
        description: "release-manager + producer final sign-off. PR-MILESTONE gate holds for milestone approval. createsTickets:true records the release decision on the board (auto-verified).",
        agents: ["release-manager", "producer"],
        gates: ["PR-MILESTONE"],
        createsTickets: true,
      },
    ],
  },
  {
    name: "pipeline-make-game",
    description:
      "/make-game — orchestrate the full lifecycle: concept → design → slice → sprint → polish → release. Each lifecycle stage runs its child pipeline to completion (auto), then the producer reviews at a PR-PHASE-GATE before advancing to the next stage. Manual mode (default): /advance walks you through each stage with one approval between children. Auto mode: runs end-to-end without input. The manual counterpart to autonomous production — same primitives as the individual pipelines, only the parent's inter-pipeline gate-approval differs (plan principle 1).",
    kind: "pipeline",
    gateMode: "manual",
    resumable: true,
    lifecyclePhase: "production",
    userInvocable: true,
    phases: [
      { order: 1, name: "concept", description: "Run the /concept child pipeline (auto) to a final concept + pillars.", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 2, name: "design", description: "Run the /design child pipeline (auto) to a GDD + art bible + ADRs.", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 3, name: "slice", description: "Run the /slice child pipeline (auto) to a vertical-slice prototype.", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 4, name: "sprint", description: "Run the /sprint child pipeline (auto) to dispatch + execute a sprint.", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 5, name: "polish", description: "Run the /polish child pipeline (auto).", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
      { order: 6, name: "release", description: "Run the /release child pipeline (auto) to a build + sign-off.", agents: ["producer"], gates: ["PR-PHASE-GATE"], createsTickets: false },
    ],
  },
];