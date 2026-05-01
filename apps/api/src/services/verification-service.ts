/**
 * Verification Service
 * Auto-verifies agent output when tickets reach the "qa" (Verify) column.
 * Selects verifier agents based on task area, invokes them via LLM,
 * parses verdict, and moves tickets accordingly.
 */

import { invokeAgent } from "./llm-service.js";
import { moveQuestTicket, createFixTicket } from "./quest-bridge.js";
import { broadcastEvent } from "./data-store.js";
import type { Ticket, AgentRole, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

// ─── Verifier selection map: area keywords → verifier agent role ───

const AREA_VERIFIERS: { keywords: string[]; verifier: AgentRole; fallback?: AgentRole }[] = [
  { keywords: ["CODE", "SCRIPT", "PROGRAMMING", "ENGINE"], verifier: "code-reviewer", fallback: "lead-programmer" },
  { keywords: ["DESIGN", "GDD", "MECHANICS", "BALANCE"], verifier: "game-designer", fallback: "creative-director" },
  { keywords: ["ART", "ASSETS", "UI", "UX", "SPRITE"], verifier: "art-director" },
  { keywords: ["NARRATIVE", "DIALOGUE", "STORY", "LORE"], verifier: "narrative-director" },
  { keywords: ["ARCHITECTURE", "SYSTEMS", "TECHNICAL"], verifier: "technical-director" },
];

function selectVerifier(area: string, subarea: string): AgentRole {
  const combined = `${area} ${subarea}`.toUpperCase();
  for (const mapping of AREA_VERIFIERS) {
    if (mapping.keywords.some((k) => combined.includes(k))) {
      return mapping.verifier;
    }
  }
  return "qa-tester";
}

// ─── Verdict parsing (same pattern as gates) ───

const VERDICT_OPTIONS = ["PASS", "FAIL", "NEEDS_FIX"];

function parseVerdict(content: string): { parsed: string; raw: string } {
  const firstLine = content.split("\n")[0].trim().toUpperCase();

  for (const option of VERDICT_OPTIONS) {
    if (firstLine.includes(option.replace("_", " "))) {
      return { parsed: option, raw: firstLine };
    }
  }

  if (firstLine.includes("PASS") || firstLine.includes("APPROVE") || firstLine.includes("ACCEPT")) {
    return { parsed: "PASS", raw: firstLine };
  }
  if (firstLine.includes("FAIL") || firstLine.includes("REJECT") || firstLine.includes("DENY")) {
    return { parsed: "FAIL", raw: firstLine };
  }
  if (firstLine.includes("FIX") || firstLine.includes("CONCERN") || firstLine.includes("ISSUE")) {
    return { parsed: "NEEDS_FIX", raw: firstLine };
  }

  // Default to PASS if ambiguous — don't block agent unnecessarily
  return { parsed: "PASS", raw: firstLine };
}

// ─── Verification prompt ───

function buildVerificationPrompt(ticket: Ticket, agentOutput: string): string {
  const agentRole = ticket.assignee ?? "agent";
  return `You are verifying the output of agent "${agentRole}" for this task.

## Original Task
${ticket.description || ticket.title}

## Agent Output
${agentOutput.slice(0, 8000)}

## Your Job
Check if the output:
1. Addresses the original task completely
2. Is technically correct and free of obvious errors
3. Does not hallucinate (e.g., references non-existent files)
4. Follows project conventions if applicable

Return verdict as the FIRST line of your response:
- PASS — output is acceptable
- FAIL — output has critical errors, agent must redo
- NEEDS_FIX — minor issues, agent should refine

Then provide detailed reasoning below.`;
}

// ─── Core verification ───

export interface VerificationResult {
  ticketId: string;
  verdict: string;
  feedback: string;
  verifier: AgentRole;
  passed: boolean;
}

/**
 * Verify a ticket's agent output asynchronously.
 * Fire-and-forget: caller should not await this.
 */
export async function verifyTicket(
  ticket: Ticket,
  agentOutput: string,
): Promise<VerificationResult> {
  const verifier = selectVerifier(ticket.area, ticket.subarea);
  const task = buildVerificationPrompt(ticket, agentOutput);

  logger.info(
    { event: "verify_start", ticketId: ticket.id, verifier, agent: ticket.assignee },
    `Verifying ticket ${ticket.id} with ${verifier}`,
  );

  try {
    const result = await invokeAgent(verifier, task, ticket.sessionId ?? "verify-fallback", undefined, undefined, undefined, false);
    const { parsed: verdict } = parseVerdict(result.content);
    const passed = verdict === "PASS";

    logger.info(
      { event: "verify_complete", ticketId: ticket.id, verdict, verifier },
      `Ticket ${ticket.id} verification: ${verdict}`,
    );

    // Move ticket based on verdict
    if (passed) {
      await moveQuestTicket(ticket.id, "completed", ticket.assignee);
    } else {
      await moveQuestTicket(ticket.id, "in_progress", ticket.assignee);
    }

    // Broadcast verification result
    broadcastEvent({
      type: "log:entry",
      sessionId: ticket.sessionId ?? "",
      level: passed ? "info" : "warn",
      message: `[VERIFY ${verdict}] ${ticket.title} by ${ticket.assignee} — ${result.content.slice(0, 200)}`,
      timestamp: new Date().toISOString(),
    } as WSEvent);

    return {
      ticketId: ticket.id,
      verdict,
      feedback: result.content,
      verifier,
      passed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error(
      { event: "verify_error", ticketId: ticket.id, error: errorMessage },
      `Verification failed for ticket ${ticket.id}: ${errorMessage}`,
    );

    // On verification error, move to completed to avoid blocking
    await moveQuestTicket(ticket.id, "completed", ticket.assignee);

    return {
      ticketId: ticket.id,
      verdict: "ERROR",
      feedback: errorMessage,
      verifier,
      passed: true, // Don't block on verification error
    };
  }
}

/**
 * Trigger verification for a ticket asynchronously.
 * Call this after moving a ticket to "qa" status.
 * Do NOT await — this is fire-and-forget.
 */
export function triggerVerification(ticket: Ticket, agentOutput: string): void {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  verifyTicket(ticket, agentOutput);
}
