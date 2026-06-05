/**
 * Deep Research Service — orchestrates MiroMind multi-turn research queries
 * and persists findings with citations to the project workspace.
 *
 * Called by:
 *  - /api/research/analyze (direct trigger)
 *  - /api/autonomous/start (preflight phase before GDD ingestion)
 *  - DeepResearch tool executor in llm-service.ts
 *
 * Research model: 5 parallel angles × 2-turn MiroMind sessions (default).
 * Turn 1: broad research with citation requirements.
 * Turn 2: dig deeper into gaps surfaced by automatic gap detection.
 * Switch to 3-turn with `MIROMIND_RESEARCH_TURNS=3` for synthesis pass.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "../config.js";
import { multiTurnDeepResearch, extractCitations, type Citation } from "../llm/miromind-client.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { broadcast } from "./websocket.js";
import { logger } from "../utils/logger.js";

export interface ResearchSection {
  title: string;
  content: string;
}

export interface ResearchReport {
  projectId: string;
  concept: string;
  timestamp: string;
  model: string;
  sections: ResearchSection[];
  citations: Citation[];
  totalTokens: number;
  turns: number;
}

/** Research angles — each becomes a separate MiroMind multi-turn session */
const RESEARCH_ANGLES = [
  {
    key: "market-analysis",
    title: "Market & Genre Analysis",
    prompt: `Analyze the market and genre fit for the following game concept. Cover: current genre trends, market size estimates, player demographics and preferences, platform suitability (PC, mobile, console, web), and overall viability. Be specific with genre naming conventions and cite recent successful examples. Game concept:`,
  },
  {
    key: "competitive-landscape",
    title: "Competitive Landscape",
    prompt: `Analyze the competitive landscape for the following game concept. Cover: direct and indirect competitors, their strengths and weaknesses, market gaps that this game could fill, unique selling points (USPs), and differentiation strategies. Mention specific competing titles with estimated revenue/user numbers and what this game should learn from them. Game concept:`,
  },
  {
    key: "target-audience",
    title: "Target Audience & Player Personas",
    prompt: `Define the target audience and player personas for the following game concept. Cover: primary and secondary audience segments, player motivation profiles (achievers, explorers, socializers, killers per Bartle taxonomy), age demographics, gaming habits, platform preferences, and monetization tolerance. Create at least 2 detailed player personas with names, backgrounds, and motivations. Game concept:`,
  },
  {
    key: "technical-recommendations",
    title: "Technical Recommendations",
    prompt: `Provide technical recommendations for building the following game concept. Cover: recommended game engine (Godot, Unity, Unreal — note that this project uses Godot Engine 4.x as primary), key technical challenges (networking, physics, AI, rendering), performance considerations for target platforms, art pipeline recommendations, and audio/music tooling. Be practical and specific. Game concept:`,
  },
  {
    key: "gdd-recommendations",
    title: "Game Design Document Recommendations",
    prompt: `Based on your research expertise, provide concrete recommendations for the Game Design Document of the following concept. Cover: core loop design suggestions, feature prioritization (MVP vs. post-launch), progression systems that work well for this genre, retention mechanics, content scope recommendations, and common design pitfalls to avoid. Be specific and actionable. Game concept:`,
  },
];

function formatResearchMarkdown(report: ResearchReport): string {
  const sections = [
    `# Deep Research: ${report.concept}`,
    "",
    `> Generated at ${report.timestamp} using ${report.model} (${report.turns}-turn multi-turn research)`,
    `> ${report.citations.length} sources cited across ${report.sections.length} research angles`,
    "",
    "---",
    "",
  ];

  for (const section of report.sections) {
    sections.push(`## ${section.title}`);
    sections.push("");
    sections.push(section.content);
    sections.push("");
    sections.push("---");
    sections.push("");
  }

  // Consolidated citation reference section
  if (report.citations.length > 0) {
    sections.push("## Research Sources");
    sections.push("");
    sections.push(`> ${report.citations.length} sources cited across all research angles.`);
    sections.push("");
    for (const c of report.citations.slice(0, 50)) {
      sections.push(`- [${c.index}] ${c.text}`);
    }
    if (report.citations.length > 50) {
      sections.push("");
      sections.push(`*... and ${report.citations.length - 50} more sources.*`);
    }
  }

  return sections.join("\n");
}

function buildConceptSummary(concept: string, projectDescription?: string): string {
  let summary = concept;
  if (projectDescription) {
    summary += `\n\nProject description: ${projectDescription}`;
  }
  return summary;
}

/**
 * Run multi-angle multi-turn deep research on a game concept.
 *
 * Fires 5 parallel MiroMind sessions, each with 2-turn research
 * (broad → deep-dive), then assembles results into a structured
 * RESEARCH.md file with consolidated citations.
 */
export async function runDeepResearch(
  projectId: string,
  concept: string,
  options?: {
    projectDescription?: string;
    signal?: AbortSignal;
  },
): Promise<ResearchReport> {
  const config = loadConfig();
  if (!config.MIROMIND_API_KEY?.trim()) {
    throw new Error("MIROMIND_API_KEY is not configured — deep research is unavailable. Set it in .env");
  }

  const workspaceDir = loadConfig().WORKSPACE_DIR;
  const projectPath = resolveProjectWorkspace(join(workspaceDir, "projects", projectId));
  const conceptSummary = buildConceptSummary(concept, options?.projectDescription);
  const researchTurns = Math.min(parseInt(String(process.env.MIROMIND_RESEARCH_TURNS || "2"), 10) || 2, 3);

  logger.info(
    { projectId, concept: concept.slice(0, 80), angles: RESEARCH_ANGLES.length, turns: researchTurns, event: "deep_research_start" },
    `Starting deep research — ${RESEARCH_ANGLES.length} angles × ${researchTurns} turns`,
  );
  broadcast({ type: "autonomous:research", phase: "started", projectId, concept: concept.slice(0, 80) });

  const anglePromises = RESEARCH_ANGLES.map(async (angle) => {
    try {
      const result = await multiTurnDeepResearch({
        topic: conceptSummary,
        context: `${angle.prompt} ${conceptSummary}`,
        projectDescription: options?.projectDescription,
        signal: options?.signal,
        maxTurns: researchTurns,
        requireCitations: true,
      });
      return {
        title: angle.title,
        content: result.findings,
        citations: result.citations,
        tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { angle: angle.key, err: msg, event: "deep_research_angle_failed" },
        `Research angle "${angle.key}" failed — continuing with others`,
      );
      return { title: angle.title, content: `*Research for this angle failed: ${msg}*`, citations: [] as Citation[], tokens: 0 };
    }
  });

  const results = await Promise.all(anglePromises);
  const totalTokens = results.reduce((sum, r) => sum + r.tokens, 0);

  // Merge citations from all angles, deduplicating by index
  const citationMap = new Map<number, string>();
  for (const r of results) {
    for (const c of r.citations) {
      if (!citationMap.has(c.index)) {
        citationMap.set(c.index, c.text);
      }
    }
  }
  const allCitations = Array.from(citationMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, text]) => ({ index, text }));

  const report: ResearchReport = {
    projectId,
    concept,
    timestamp: new Date().toISOString(),
    model: config.MIROMIND_MODEL,
    sections: results.map((r) => ({ title: r.title, content: r.content })),
    citations: allCitations,
    totalTokens,
    turns: researchTurns,
  };

  try {
    const researchDir = join(projectPath, "design");
    await mkdir(researchDir, { recursive: true });
    const mdContent = formatResearchMarkdown(report);
    await writeFile(join(researchDir, "RESEARCH.md"), mdContent, "utf-8");
    logger.info(
      { projectId, path: join(researchDir, "RESEARCH.md"), bytes: mdContent.length, citations: allCitations.length, event: "deep_research_saved" },
      "Research report saved to RESEARCH.md",
    );
  } catch (err) {
    logger.warn(
      { projectId, err: err instanceof Error ? err.message : String(err), event: "deep_research_save_failed" },
      "Failed to save RESEARCH.md — research results still returned in-memory",
    );
  }

  broadcast({
    type: "autonomous:research",
    phase: "completed",
    projectId,
    concept: concept.slice(0, 80),
    sections: report.sections.length,
  });

  return report;
}

/**
 * Run a targeted multi-turn research query on a single topic.
 * Returns findings with citations appended.
 */
export async function runTargetedResearch(
  topic: string,
  context?: string,
  signal?: AbortSignal,
): Promise<string> {
  const config = loadConfig();
  if (!config.MIROMIND_API_KEY?.trim()) {
    throw new Error("MIROMIND_API_KEY is not configured — deep research is unavailable. Set it in .env");
  }

  const result = await multiTurnDeepResearch({
    topic,
    context,
    signal,
    maxTurns: 2,
    requireCitations: true,
  });

  let output = result.findings;
  if (result.citations.length > 0) {
    output += `\n\n## Sources\n`;
    for (const c of result.citations.slice(0, 20)) {
      output += `\n- [${c.index}] ${c.text}`;
    }
  }

  return output;
}

/**
 * Check whether MiroMind deep research is available (API key configured).
 */
export function isDeepResearchAvailable(): boolean {
  const config = loadConfig();
  return (config.MIROMIND_API_KEY?.trim().length ?? 0) > 0;
}

/**
 * Read an existing research report from the project workspace.
 */
export async function readResearchReport(projectId: string): Promise<ResearchReport | null> {
  const workspaceDir = loadConfig().WORKSPACE_DIR;
  const projectPath = resolveProjectWorkspace(join(workspaceDir, "projects", projectId));
  const researchPath = join(projectPath, "design", "RESEARCH.md");

  try {
    const content = await readFile(researchPath, "utf-8");
    const sections = parseResearchSections(content);
    const citations = extractCitations(content);

    return {
      projectId,
      concept: "Loaded from RESEARCH.md",
      timestamp: "",
      model: "",
      sections,
      citations,
      totalTokens: 0,
      turns: 0,
    };
  } catch {
    return null;
  }
}

function parseResearchSections(markdown: string): ResearchSection[] {
  const sections: ResearchSection[] = [];
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentTitle) {
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
      }
      currentTitle = line.replace("## ", "").trim();
      currentContent = [];
    } else if (currentTitle) {
      currentContent.push(line);
    }
  }

  if (currentTitle) {
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim() });
  }

  return sections;
}
