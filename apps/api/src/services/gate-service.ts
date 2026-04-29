/**
 * Gate Service — executes real LLM-powered gate reviews.
 *
 * Loads gate definitions from workspace/.claude/docs/director-gates.md
 * and invokes the appropriate agent to perform the review.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.js";
import { invokeAgent } from "./llm-service.js";
import { logger } from "../utils/logger.js";
import type { AgentRole } from "@game-studio/types";

export interface GateResult {
  gateId: string;
  verdict: "APPROVE" | "READY" | "CONCERNS" | "REJECT" | "NOT_READY" | "READY" | string;
  details: string;
  agent: string;
  timestamp: string;
}

interface GateDefinition {
  id: string;
  agent: AgentRole;
  prompt: string;
  contextFields: string[];
  verdictOptions: string[];
}

// Gate to agent mapping
const GATE_AGENTS: Record<string, { agent: AgentRole; model: string }> = {
  "CD-PILLARS": { agent: "creative-director", model: "opus" },
  "CD-GDD-ALIGN": { agent: "creative-director", model: "opus" },
  "CD-SYSTEMS": { agent: "creative-director", model: "opus" },
  "CD-NARRATIVE": { agent: "creative-director", model: "opus" },
  "CD-PLAYTEST": { agent: "creative-director", model: "opus" },
  "CD-PHASE-GATE": { agent: "creative-director", model: "opus" },
  "TD-FEASIBILITY": { agent: "technical-director", model: "opus" },
  "TD-ARCHITECTURE": { agent: "technical-director", model: "opus" },
  "TD-SYSTEM-BOUNDARY": { agent: "technical-director", model: "opus" },
  "TD-PHASE-GATE": { agent: "technical-director", model: "opus" },
  "TD-ADR": { agent: "technical-director", model: "opus" },
  "TD-ENGINE-RISK": { agent: "technical-director", model: "opus" },
  "PR-SCOPE": { agent: "producer", model: "opus" },
  "PR-SPRINT": { agent: "producer", model: "opus" },
  "PR-MILESTONE": { agent: "producer", model: "opus" },
  "PR-EPIC": { agent: "producer", model: "opus" },
  "PR-PHASE-GATE": { agent: "producer", model: "opus" },
  "AD-CONCEPT-VISUAL": { agent: "art-director", model: "sonnet" },
  "AD-ART-BIBLE": { agent: "art-director", model: "sonnet" },
  "AD-PHASE-GATE": { agent: "art-director", model: "sonnet" },
  "AD-VISUAL": { agent: "art-director", model: "sonnet" },
  "LP-FEASIBILITY": { agent: "lead-programmer", model: "sonnet" },
  "LP-CODE-REVIEW": { agent: "lead-programmer", model: "sonnet" },
  "QL-STORY-READY": { agent: "qa-lead", model: "sonnet" },
  "QL-TEST-COVERAGE": { agent: "qa-lead", model: "sonnet" },
  "ND-CONSISTENCY": { agent: "narrative-director", model: "sonnet" },
};

// Gate prompts from director-gates.md
const GATE_PROMPTS: Record<string, { prompt: string; verdictOptions: string[] }> = {
  "CD-PILLARS": {
    prompt: "Review these game pillars. Are they falsifiable — could a real design decision actually fail this pillar? Do they create meaningful tension with each other? Do they differentiate this game from its closest comparables? Would they help resolve a design disagreement in practice, or are they too vague to be useful? Return specific feedback for each pillar and an overall verdict: APPROVE (strong), CONCERNS [list] (needs sharpening), or REJECT (weak — pillars do not carry weight).",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "CD-GDD-ALIGN": {
    prompt: "Review this system GDD for pillar alignment. Does every section serve the stated pillars? Are there mechanics or rules that contradict or weaken a pillar? Does the Player Fantasy section match the game's core fantasy? Return APPROVE, CONCERNS [specific sections with issues], or REJECT [pillar violations that must be redesigned before this system is implementable].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "CD-SYSTEMS": {
    prompt: "Review this systems decomposition against the game's design pillars. Does the full set of MVP-tier systems collectively deliver the core fantasy? Are there systems whose mechanics don't serve any stated pillar? Are there pillar-critical player experiences that have no system assigned? Return APPROVE (systems serve the vision), CONCERNS [specific gaps], or REJECT [fundamental gaps must be revised before GDD authoring begins].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "CD-NARRATIVE": {
    prompt: "Review this narrative content for consistency with the game's pillars and established world rules. Does the tone match the game's established voice? Are there contradictions with existing lore? Return APPROVE, CONCERNS [specific inconsistencies], or REJECT [contradictions that break world coherence].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "CD-PLAYTEST": {
    prompt: "Review this playtest report against the game's design pillars and core fantasy. Is the player experience matching the intended fantasy? Are there systematic issues that represent pillar drift? Return APPROVE (core fantasy is landing), CONCERNS [gaps], or REJECT [core fantasy is not present].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "CD-PHASE-GATE": {
    prompt: "Review the current project state for creative direction readiness. Are the game pillars faithfully represented in all design artifacts? Does the current state preserve the core fantasy? Return READY, CONCERNS [list], or NOT READY [blockers].",
    verdictOptions: ["READY", "CONCERNS", "NOT_READY"],
  },
  "TD-FEASIBILITY": {
    prompt: "Review these technical risks for the game concept. Flag any HIGH risk items that could invalidate the concept, risks that are engine-specific, and risks commonly underestimated by solo developers. Return VIABLE (risks are manageable), CONCERNS [list with mitigations], or HIGH RISK [blockers that require concept revision].",
    verdictOptions: ["VIABLE", "CONCERNS", "HIGH_RISK"],
  },
  "TD-ARCHITECTURE": {
    prompt: "Review this master architecture document for technical soundness. Check: (1) Is every technical requirement covered by an architectural decision? (2) Are all HIGH risk engine domains addressed? (3) Are API boundaries clean and implementable? Return APPROVE, CONCERNS [list], or REJECT [blockers that must be resolved before coding starts].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "TD-SYSTEM-BOUNDARY": {
    prompt: "Review this systems decomposition from an architectural perspective. Are the system boundaries clean? Are there God Object risks? Does the dependency ordering create implementation-sequencing problems? Return APPROVE (boundaries are architecturally sound), CONCERNS [specific boundary issues], or REJECT [fundamental boundary problems].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "TD-PHASE-GATE": {
    prompt: "Review the current project state for technical readiness. Is the architecture sound for this phase? Are all high-risk engine domains addressed? Are performance budgets realistic? Return READY, CONCERNS [list], or NOT READY [blockers].",
    verdictOptions: ["READY", "CONCERNS", "NOT_READY"],
  },
  "TD-ADR": {
    prompt: "Review this Architecture Decision Record. Does it have a clear problem statement and rationale? Are rejected alternatives genuinely considered? Does it link to GDD requirements? Return APPROVE, CONCERNS [specific gaps], or REJECT [underspecified or makes unsound technical assumptions].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "TD-ENGINE-RISK": {
    prompt: "Review this engine API usage against the version reference. Is this API present and unchanged in the current engine version? Return APPROVE (safe to use), CONCERNS [verify before implementing], or REJECT [API has changed].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "PR-SCOPE": {
    prompt: "Review this scope estimate. Is the MVP achievable in the stated timeline for the stated team size? Are the scope tiers correctly ordered? Return REALISTIC, OPTIMISTIC [specific adjustments recommended], or UNREALISTIC [blockers — timeline or MVP must be revised].",
    verdictOptions: ["REALISTIC", "OPTIMISTIC", "UNREALISTIC"],
  },
  "PR-SPRINT": {
    prompt: "Review this sprint plan for feasibility. Is the story load realistic for the available capacity? Are stories correctly ordered by dependency? Return REALISTIC, CONCERNS [specific risks], or UNREALISTIC [sprint must be descoped].",
    verdictOptions: ["REALISTIC", "CONCERNS", "UNREALISTIC"],
  },
  "PR-MILESTONE": {
    prompt: "Review this milestone status. Based on current velocity and blocked story count, will this milestone hit its target date? What are the top 3 production risks? Return ON TRACK, AT RISK [specific mitigations], or OFF TRACK [date must slip or scope must cut].",
    verdictOptions: ["ON_TRACK", "AT_RISK", "OFF_TRACK"],
  },
  "PR-EPIC": {
    prompt: "Review this epic structure for production feasibility. Are the epic boundaries scoped appropriately? Are epics correctly ordered by system dependency? Return REALISTIC, CONCERNS [structural adjustments needed], or UNREALISTIC [epics must be restructured].",
    verdictOptions: ["REALISTIC", "CONCERNS", "UNREALISTIC"],
  },
  "PR-PHASE-GATE": {
    prompt: "Review the current project state for production readiness. Is the scope realistic for the timeline and team size? Are dependencies properly ordered? Return READY, CONCERNS [list], or NOT READY [blockers].",
    verdictOptions: ["READY", "CONCERNS", "NOT_READY"],
  },
  "AD-CONCEPT-VISUAL": {
    prompt: "Based on these game pillars and core concept, propose 2-3 distinct visual identity directions. For each direction provide: visual rule, mood targets, shape language, color philosophy. Recommend which best serves the stated pillars. Return CONCEPTS (multiple options), STRONG (one dominant direction), or CONCERNS (pillars don't provide enough direction).",
    verdictOptions: ["CONCEPTS", "STRONG", "CONCERNS"],
  },
  "AD-ART-BIBLE": {
    prompt: "Review this art bible for completeness and internal consistency. Does the color system match the mood targets? Does the shape language follow from the visual identity? Return APPROVE (art bible is production-ready), CONCERNS [specific sections needing clarification], or REJECT [fundamental inconsistencies].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "AD-PHASE-GATE": {
    prompt: "Review the current project state for visual direction readiness. Is the visual identity established and documented at the level this phase requires? Return READY, CONCERNS [specific visual direction gaps], or NOT READY [visual blockers that must be resolved].",
    verdictOptions: ["READY", "CONCERNS", "NOT_READY"],
  },
  "AD-VISUAL": {
    prompt: "Review this visual direction decision for consistency with the established art style. Does it match the art bible? Is it achievable within platform constraints? Return APPROVE, CONCERNS [specific adjustments], or REJECT [style violation or production risk].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "LP-FEASIBILITY": {
    prompt: "Review this architecture for implementation feasibility. Flag any decisions that would be difficult to implement, missing interface definitions, or patterns that create avoidable technical debt. Return FEASIBLE, CONCERNS [list], or INFEASIBLE [blockers that make this architecture unimplementable].",
    verdictOptions: ["FEASIBLE", "CONCERNS", "INFEASIBLE"],
  },
  "LP-CODE-REVIEW": {
    prompt: "Review this implementation against the story acceptance criteria and governing ADR. Does the code match the architecture boundaries? Are there violations of coding standards? Return APPROVE, CONCERNS [specific issues], or REJECT [must be revised before merge].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
  "QL-STORY-READY": {
    prompt: "Review this story's acceptance criteria for testability. Are all criteria specific enough that a developer would know unambiguously when they are done? Flag criteria that are too vague. Return ADEQUATE (criteria are implementable), GAPS [specific criteria needing refinement], or INADEQUATE [story must be revised before sprint inclusion].",
    verdictOptions: ["ADEQUATE", "GAPS", "INADEQUATE"],
  },
  "QL-TEST-COVERAGE": {
    prompt: "Review the test coverage for these implementation stories. Are all Logic stories covered by passing unit tests? Are Integration stories covered? Are GDD acceptance criteria mapped to tests? Return ADEQUATE, GAPS [specific missing tests], or INADEQUATE [critical logic is untested].",
    verdictOptions: ["ADEQUATE", "GAPS", "INADEQUATE"],
  },
  "ND-CONSISTENCY": {
    prompt: "Review this narrative content for internal consistency. Are character voices consistent? Does the lore contradict established facts? Return APPROVE, CONCERNS [specific inconsistencies to fix], or REJECT [contradictions that break the narrative foundation].",
    verdictOptions: ["APPROVE", "CONCERNS", "REJECT"],
  },
};

/**
 * Execute a gate review using LLM
 */
export async function executeGate(
  gateId: string,
  sessionId: string,
  context?: string
): Promise<GateResult> {
  const gateConfig = GATE_AGENTS[gateId];

  if (!gateConfig) {
    return {
      gateId,
      verdict: "NOT_SUPPORTED",
      details: `Gate ${gateId} is not yet implemented. Add gate definition to gate-service.ts`,
      agent: "unknown",
      timestamp: new Date().toISOString(),
    };
  }

  const gatePrompt = GATE_PROMPTS[gateId];

  if (!gatePrompt) {
    return {
      gateId,
      verdict: "NOT_SUPPORTED",
      details: `Gate prompt for ${gateId} is not defined`,
      agent: gateConfig.agent,
      timestamp: new Date().toISOString(),
    };
  }

  // Build the task prompt
  let task = `You are performing a **${gateId}** gate review.

## Your Task
${gatePrompt.prompt}

## Verdict Format
Return your verdict as the FIRST line of your response:
- ${gatePrompt.verdictOptions.join(" / ")}

Then provide your detailed reasoning below.

## Context`;

  if (context) {
    task += `
${context}`;
  } else {
    task += `
No specific context provided. If you can perform a general review based on available project files in the workspace, do so. Otherwise, return a CONCERNS verdict noting that specific context is needed for a thorough review.`;
  }

  try {
    // Invoke the agent to perform the review
    logger.info({ gateId, agent: gateConfig.agent, event: "gate_start" }, `Executing ${gateId}`);
    const result = await invokeAgent(gateConfig.agent, task, sessionId);
    logger.info({ gateId, contentLength: result.content.length, event: "gate_complete" }, `${gateId} completed`);

    // Parse verdict from response
    const verdict = parseVerdict(result.content, gatePrompt.verdictOptions);
    logger.info({ gateId, verdict: verdict.parsed, event: "gate_verdict" }, `${gateId} verdict: ${verdict.parsed}`);

    return {
      gateId,
      verdict: verdict.parsed,
      details: result.content,
      agent: gateConfig.agent,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error({ gateId, error: errorMessage, event: "gate_error" }, `${gateId} failed`);
    return {
      gateId,
      verdict: "ERROR",
      details: `Gate execution failed: ${errorMessage}`,
      agent: gateConfig.agent,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Parse verdict from LLM response
 */
function parseVerdict(
  content: string,
  expectedOptions: string[]
): { parsed: string; raw: string } {
  // First line is usually the verdict
  const firstLine = content.split("\n")[0].trim().toUpperCase();

  // Check for exact match
  for (const option of expectedOptions) {
    if (firstLine.includes(option.replace("_", " "))) {
      return { parsed: option, raw: firstLine };
    }
  }

  // Check for partial matches
  if (firstLine.includes("APPROVE") || firstLine.includes("READY") || firstLine.includes("STRONG")) {
    return { parsed: expectedOptions.includes("APPROVE") ? "APPROVE" : "READY", raw: firstLine };
  }
  if (firstLine.includes("REJECT") || firstLine.includes("NOT READY") || firstLine.includes("INFEASIBLE") || firstLine.includes("INADEQUATE") || firstLine.includes("UNREALISTIC") || firstLine.includes("OFF TRACK") || firstLine.includes("HIGH RISK")) {
    // Map to closest expected option
    if (expectedOptions.includes("NOT_READY")) return { parsed: "NOT_READY", raw: firstLine };
    if (expectedOptions.includes("REJECT")) return { parsed: "REJECT", raw: firstLine };
    if (expectedOptions.includes("INFEASIBLE")) return { parsed: "INFEASIBLE", raw: firstLine };
    if (expectedOptions.includes("INADEQUATE")) return { parsed: "INADEQUATE", raw: firstLine };
    if (expectedOptions.includes("UNREALISTIC")) return { parsed: "UNREALISTIC", raw: firstLine };
    return { parsed: "REJECT", raw: firstLine };
  }
  if (firstLine.includes("CONCERNS") || firstLine.includes("CONCERN") || firstLine.includes("GAPS") || firstLine.includes("AT RISK") || firstLine.includes("OPTIMISTIC")) {
    if (expectedOptions.includes("CONCERNS")) return { parsed: "CONCERNS", raw: firstLine };
    if (expectedOptions.includes("GAPS")) return { parsed: "GAPS", raw: firstLine };
    if (expectedOptions.includes("AT_RISK")) return { parsed: "AT_RISK", raw: firstLine };
    return { parsed: "CONCERNS", raw: firstLine };
  }

  // Default to CONCERNS if we can't parse
  return { parsed: expectedOptions.includes("CONCERNS") ? "CONCERNS" : expectedOptions[0], raw: firstLine };
}

/**
 * Get all supported gates
 */
export function getSupportedGates(): string[] {
  return Object.keys(GATE_PROMPTS);
}

/**
 * Get gate info
 */
export function getGateInfo(gateId: string): { agent: AgentRole; verdictOptions: string[] } | null {
  const agent = GATE_AGENTS[gateId];
  const prompt = GATE_PROMPTS[gateId];

  if (!agent || !prompt) return null;

  return {
    agent: agent.agent,
    verdictOptions: prompt.verdictOptions,
  };
}
