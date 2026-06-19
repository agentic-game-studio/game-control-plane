/**
 * MiroMind Deep Research Client — OpenAI-compatible API wrapper.
 *
 * Uses `mirothinker-1-7-deepresearch-mini` (MiroMind's hosted deep research model)
 * for multi-turn research sessions with citation extraction.
 *
 * Architecture:
 * - `deepResearch()` — single-turn quick research (backward-compatible)
 * - `multiTurnDeepResearch()` — multi-turn conversation loop (2-3 turns):
 *     Turn 1: broad research with citation request
 *     Turn 2: follow-up on gaps / deeper dives
 *     Turn 3: final synthesis
 *   Between turns, the model's output is scanned for [n] citation markers and
 *   any missed angles are surfaced in follow-up prompts.
 * - Citation extraction via `/\[(\d+)\]\s*(.+?)` pattern
 *
 * MiroMind's hosted API handles web search internally; we don't implement a
 * separate tool-calling layer — the model draws on its built-in research
 * capability (up to 300 internal tool calls per task per MiroThinker docs).
 */

import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

// ─── Concurrency control ────────────────────────────────────────────────────────

class Semaphore {
  private permits: number;
  private acquireCount = 0;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    this.acquireCount++;
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  release(): void {
    if (this.acquireCount === 0) {
      logger.warn(
        { event: "miromind_semaphore_stray_release", permits: this.permits },
        "MiromindSemaphore.release() without matching acquire — ignoring",
      );
      return;
    }
    this.acquireCount--;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}

const MIROMIND_SEMAPHORE = new Semaphore(2);
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const FETCH_TIMEOUT_MS = 180_000; // 3 min — deep research can be slow

// ─── HTTP helpers ─────────────────────────────────────────────────────────────────

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  let lastError: Error | null = null;
  const maxTotalMs = FETCH_TIMEOUT_MS * (retries + 1) + 30_000;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)];
    if (externalSignal) signals.push(externalSignal);
    const combinedSignal = signals.length === 1 ? signals[0] : AbortSignal.any(signals);

    try {
      const response = await fetch(url, { ...options, signal: combinedSignal });
      const retryable = (s: number) => s === 408 || s === 425 || s === 429 || (s >= 500 && s < 600);
      if (retryable(response.status) && attempt < retries) {
        const isRateLimit = response.status === 429;
        const baseDelay = isRateLimit ? 5000 : RETRY_DELAY_MS;
        const jitter = isRateLimit ? 2000 : 1000;
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * jitter;
        if (Date.now() - startTime + delay > maxTotalMs) break;
        logger.warn(
          { status: response.status, attempt, delayMs: Math.round(delay), event: "miromind_retry" },
          "MiroMind retry",
        );
        await abortableSleep(delay, externalSignal);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error as Error;
      if (externalSignal?.aborted) throw lastError;
      if (attempt < retries) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        if (Date.now() - startTime + delay > maxTotalMs) break;
        await abortableSleep(delay, externalSignal);
      }
    }
  }
  throw lastError ?? new Error("MiroMind max retries exceeded");
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  model: string,
  tokenBudget: number,
  signal?: AbortSignal,
): Promise<{ content: string; tokens: { input: number; output: number } }> {
  const config = loadConfig();
  const apiKey = config.MIROMIND_API_KEY?.trim();
  if (!apiKey) throw new Error("MIROMIND_API_KEY is not set");

  const body = {
    model,
    messages,
    max_tokens: tokenBudget,
    temperature: 0.7,
  };

  const baseUrl = config.MIROMIND_BASE_URL;

  await MIROMIND_SEMAPHORE.acquire();
  let response: Response;
  try {
    response = await fetchWithRetry(
      `${baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      MAX_RETRIES,
      signal,
    );
  } finally {
    MIROMIND_SEMAPHORE.release();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiroMind API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    content: data.choices?.[0]?.message?.content ?? "",
    tokens: {
      input: data.usage?.prompt_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
    },
  };
}

// ─── Citation extraction ─────────────────────────────────────────────────────────

export interface Citation {
  index: number;
  text: string;
}

/**
 * Extract numbered citations from research text.
 * Matches patterns like:
 *   [1] https://example.com/article
 *   [1] Gold price historical data (https://tradingeconomics.com)
 *   [1] Source Name — description
 */
export function extractCitations(text: string): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<number>();
  // Match [n] followed by content until next [n] or end of line
  const regex = /\[(\d+)\]\s+(.+?)(?=\s*\[|\s*$)/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const idx = parseInt(match[1], 10);
    if (seen.has(idx)) continue;
    seen.add(idx);
    citations.push({ index: idx, text: match[2].trim() });
  }
  citations.sort((a, b) => a.index - b.index);
  return citations;
}

/**
 * Extract a references section from markdown text.
 * Looks for a "## References" / "## Citations" / "## Sources" section
 * and returns the raw content.
 */
function extractReferencesSection(text: string): string | null {
  const regex = /^#{1,3}\s*(?:References|Citations|Sources|Works Cited)\s*$\n?(.+?)(?=^#{1,3}\s|\Z)/ims;
  const m = text.match(regex);
  return m?.[1]?.trim() ?? null;
}

// ─── System prompts ──────────────────────────────────────────────────────────────

const RESEARCH_SYSTEM_PROMPT = `You are a deep research analyst powered by MiroMind, specialising in video game market analysis, genre trends, competitive landscape evaluation, target audience profiling, and technical feasibility assessment.

You have access to web search and can draw on current market data, industry reports, and game release information.

# Citation Requirements
Every factual claim MUST be followed by a numbered citation in brackets referencing the source:
- [1] Source name or URL
- [2] Industry report name (publisher, year)
- [n] Game title (developer, release year) — for competitor references

Format citations exactly as: [n] description — one per source. Re-use the same number for multiple claims from the same source.

# Output Format
Use markdown headings. End every research section with a "## References" section listing all cited sources in order.`;

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface ResearchResult {
  topic: string;
  findings: string;
  model: string;
  turns: number;
  citations: Citation[];
  referencesSection: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface DeepResearchOptions {
  topic: string;
  context?: string;
  projectDescription?: string;
  signal?: AbortSignal;
  /** Max turns for multi-turn research (1-5, default 2) */
  maxTurns?: number;
  /** Whether to extract and return citations (default true) */
  requireCitations?: boolean;
}

// ─── Core functions ──────────────────────────────────────────────────────────────

/**
 * Single-turn deep research query (backward-compatible).
 */
export async function deepResearch(options: DeepResearchOptions): Promise<ResearchResult> {
  return multiTurnDeepResearch({ ...options, maxTurns: 1 });
}

/**
 * Multi-turn deep research with citation extraction.
 *
 * Turn flow:
 *   1. Broad research: topic + angle-specific prompt + "cite sources as [n]"
 *   2. Follow-up (optional): "what did you miss? surface 3 more angles"
 *   3. Final synthesis (if maxTurns >= 3): "synthesise all findings, sort citations"
 *
 * Between turns, citations are extracted and missed-angles detected to drive
 * follow-up prompts naturally rather than with hardcoded templates.
 */
export async function multiTurnDeepResearch(options: DeepResearchOptions): Promise<ResearchResult> {
  const config = loadConfig();
  const apiKey = config.MIROMIND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MIROMIND_API_KEY is not set — deep research is unavailable");
  }

  const model = config.MIROMIND_MODEL;
  const maxTurns = Math.min(Math.max(options.maxTurns ?? 2, 1), 5);
  const requireCitations = options.requireCitations !== false;

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: RESEARCH_SYSTEM_PROMPT },
  ];

  // Build turn-1 prompt
  let userPrompt = `Conduct deep research on the following game concept:\n\n**Topic**: ${options.topic}`;
  if (options.projectDescription) {
    userPrompt += `\n\n**Project Description**: ${options.projectDescription}`;
  }
  if (options.context) {
    userPrompt += `\n\n**Research Angle / Context**: ${options.context}`;
  }
  userPrompt += `\n\nProvide thorough analysis covering:
1. Market & Genre Analysis — current trends, genre popularity, audience demographics
2. Competitive Landscape — similar games, strengths/weaknesses, market gaps (name specific titles)
3. Technical Recommendations — engines (Godot, Unity, Unreal), challenges, platform fit
4. Monetization & Business Model — revenue models, pricing strategies
5. GDD Recommendations — concrete, actionable design suggestions based on your research
${requireCitations ? "\nCRITICAL: Cite every factual claim with [n] source format. End with a ## References section listing all sources." : ""}`;

  messages.push({ role: "user", content: userPrompt });

  // ── Turn 1: Broad research ──
  logger.info({ topic: options.topic.slice(0, 80), model, turn: 1, maxTurns, event: "miromind_turn_start" }, "MiroMind turn 1/start");
  const t1 = await chatCompletion(messages, model, 4096, options.signal);
  messages.push({ role: "assistant", content: t1.content });
  let totalInput = t1.tokens.input;
  let totalOutput = t1.tokens.output;
  let allCitations = requireCitations ? extractCitations(t1.content) : [];
  logger.info({ topic: options.topic.slice(0, 80), citations: allCitations.length, chars: t1.content.length, event: "miromind_turn_complete" }, "MiroMind turn 1 done");

  // ── Turn 2: Follow-up for gaps ──
  if (maxTurns >= 2) {
    const detectedGaps = detectResearchGaps(t1.content, options.topic);
    const followUp = `Excellent initial research. Now dig deeper into the following areas that need more coverage:

${detectedGaps}

Provide additional findings with citations. Focus on specifics — concrete data points, named competitors, real market numbers where available.`;

    messages.push({ role: "user", content: followUp });
    logger.info({ topic: options.topic.slice(0, 80), turn: 2, event: "miromind_turn_start" }, "MiroMind turn 2/deep-dive");
    const t2 = await chatCompletion(messages, model, 4096, options.signal);
    messages.push({ role: "assistant", content: t2.content });
    totalInput += t2.tokens.input;
    totalOutput += t2.tokens.output;
    if (requireCitations) {
      allCitations = mergeCitations(allCitations, extractCitations(t2.content));
    }
    logger.info({ topic: options.topic.slice(0, 80), citations: allCitations.length, chars: t2.content.length, event: "miromind_turn_complete" }, "MiroMind turn 2 done");
  }

  // ── Turn 3: Final synthesis ──
  if (maxTurns >= 3) {
    const synthesis = `Now synthesise ALL findings into a single, cohesive final report. Merge both turns into one document with these sections:

## 1. Executive Summary
## 2. Market & Genre Analysis
## 3. Competitive Landscape
## 4. Target Audience & Player Personas
## 5. Technical Recommendations
## 6. Monetization Strategy
## 7. GDD Recommendations
## 8. Risks & Opportunities
## References

Consolidate all citations into a single numbered References section at the end. Remove duplicate sources. Keep only the most current and relevant data.`;

    messages.push({ role: "user", content: synthesis });
    logger.info({ topic: options.topic.slice(0, 80), turn: 3, event: "miromind_turn_start" }, "MiroMind turn 3/synthesis");
    const t3 = await chatCompletion(messages, model, 4096, options.signal);
    totalInput += t3.tokens.input;
    totalOutput += t3.tokens.output;
    if (requireCitations) {
      allCitations = extractCitations(t3.content);
    }
    logger.info({ topic: options.topic.slice(0, 80), citations: allCitations.length, chars: t3.content.length, event: "miromind_turn_complete" }, "MiroMind turn 3 done");

    return {
      topic: options.topic,
      findings: t3.content,
      model,
      turns: 3,
      citations: allCitations,
      referencesSection: extractReferencesSection(t3.content),
      usage: { input_tokens: totalInput, output_tokens: totalOutput },
    };
  }

  // ── Assemble final result from 1-2 turns ──
  const finalContent = messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n---\n\n");

  return {
    topic: options.topic,
    findings: finalContent,
    model,
    turns: maxTurns,
    citations: allCitations,
    referencesSection: extractReferencesSection(finalContent),
    usage: { input_tokens: totalInput, output_tokens: totalOutput },
  };
}

// ─── Research gap detection ──────────────────────────────────────────────────────

/**
 * Scan research output for missing angles and return a list of gap prompts.
 */
function detectResearchGaps(content: string, topic: string): string {
  const lower = content.toLowerCase();
  const gaps: string[] = [];

  // Use word-boundary checks to avoid false positives (e.g., "casual" matching "ua")
  function hasWord(word: string): boolean {
    return new RegExp(`\\b${word}\\b`, "i").test(content);
  }
  function hasAny(words: string[]): boolean {
    return words.some((w) => hasWord(w));
  }

  // Check common missing angles
  if (!hasAny(["mobile", "ios", "android"])) {
    gaps.push("- Platform analysis: mobile (iOS/Android) vs PC vs console viability");
  }
  if (!hasAny(["revenue", "monetization", "monetisation", "pricing", "iap", "ads", "in-app"])) {
    gaps.push("- Revenue model: IAP, premium, ads, battle pass, subscription — which fits this genre?");
  }
  if (!hasAny(["retention", "churn", "engagement", "dau", "mau"])) {
    gaps.push("- Player retention and engagement strategies specific to this genre");
  }
  if (!hasAny(["cpi", "cpm", "aso", "user acquisition"])) {
    gaps.push("- User acquisition costs (CPI/CPM estimates) and marketing channels for this genre");
  }
  if (!hasAny(["steam"])) {
    gaps.push("- Steam-specific data: wishlist benchmarks, discoverability, regional pricing");
  }
  if (!hasAny(["localization", "localisation", "translation", "regional"])) {
    gaps.push("- Global / regional market breakdown — which regions are strongest for this genre?");
  }

  if (gaps.length === 0) {
    gaps.push("- Provide 2-3 more specific competitor examples with their revenue/user numbers");
    gaps.push("- What emerging trends in this genre could be exploited in the next 12 months?");
    gaps.push("- What are the most common reasons games in this genre fail commercially?");
  }

  return gaps.slice(0, 4).join("\n");
}

/**
 * Merge new citations into existing list, deduplicating by index.
 */
function mergeCitations(existing: Citation[], incoming: Citation[]): Citation[] {
  const map = new Map<number, string>();
  for (const c of existing) map.set(c.index, c.text);
  for (const c of incoming) map.set(c.index, c.text);
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([index, text]) => ({ index, text }));
}
