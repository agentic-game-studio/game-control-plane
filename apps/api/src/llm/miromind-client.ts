/**
 * MiroMind Deep Research Client — OpenAI-compatible API wrapper.
 *
 * Uses `mirothinker-1-7-deepresearch-mini` for deep research tasks:
 * market analysis, genre trends, competitive landscape, audience profiling.
 *
 * The client is intentionally simple: MiroMind's deep research model is
 * optimised for long-form analysis, not tool-calling. We send a single
 * structured prompt and receive a research report back.
 */

import { loadConfig } from "../config.js";
import { logger } from "../utils/logger.js";

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
const FETCH_TIMEOUT_MS = 120_000;

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

export interface ResearchResult {
  topic: string;
  findings: string;
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface DeepResearchOptions {
  topic: string;
  context?: string;
  projectDescription?: string;
  signal?: AbortSignal;
}

/**
 * Run a deep research query via MiroMind.
 *
 * Sends a structured prompt with the topic and optional context, then
 * returns the model's research findings as a single text response.
 */
export async function deepResearch(options: DeepResearchOptions): Promise<ResearchResult> {
  const config = loadConfig();
  const apiKey = config.MIROMIND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("MIROMIND_API_KEY is not set — deep research is unavailable");
  }

  const model = config.MIROMIND_MODEL;
  const baseUrl = config.MIROMIND_BASE_URL;

  const systemPrompt = `You are a deep research analyst specialising in video game market analysis, genre trends, competitive landscape evaluation, target audience profiling, and technical feasibility assessment. Provide thorough, well-structured, evidence-based analysis. Format your response with clear sections using markdown headings.`;

  let userPrompt = `Conduct deep research on the following game concept:\n\n**Topic**: ${options.topic}`;
  if (options.projectDescription) {
    userPrompt += `\n\n**Project Description**: ${options.projectDescription}`;
  }
  if (options.context) {
    userPrompt += `\n\n**Additional Context**: ${options.context}`;
  }
  userPrompt += `\n\nProvide:\n1. Market & Genre Analysis — current market trends, genre popularity, target audience demographics\n2. Competitive Landscape — similar games, their strengths/weaknesses, market gaps\n3. Technical Recommendations — suitable engines (Godot, Unity, Unreal), technical challenges, performance considerations\n4. Monetization & Business Model — viable revenue models, pricing strategies\n5. GDD Recommendations — concrete suggestions for the Game Design Document based on your research\n\nBe specific and cite examples where possible.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const body = {
    model,
    messages,
    max_tokens: 4096,
    temperature: 0.7,
  };

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
      options.signal,
    );
  } finally {
    MIROMIND_SEMAPHORE.release();
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiroMind API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    choices?: Array<{
      message?: {
        content?: string;
        role?: string;
      };
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  const findings = data.choices?.[0]?.message?.content ?? "";
  logger.info(
    {
      topic: options.topic.slice(0, 80),
      findingsLen: findings.length,
      model,
      event: "miromind_research_complete",
    },
    "MiroMind deep research completed",
  );

  return {
    topic: options.topic,
    findings,
    model,
    usage: data.usage
      ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens }
      : undefined,
  };
}
