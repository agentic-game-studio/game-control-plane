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
];