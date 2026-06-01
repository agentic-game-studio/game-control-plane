/**
 * Verification Service
 * Auto-verifies agent output when tickets reach the "qa" (Verify) column.
 * Selects verifier agents based on task area, invokes them via LLM,
 * parses verdict, and moves tickets accordingly.
 */

import { invokeAgent } from "./llm-service.js";
import { moveQuestTicket, createFixTicket } from "./quest-bridge.js";
import { broadcastEvent } from "./data-store.js";
import { updateTicketsBoard } from "./ticket-board.js";
import type { Ticket, AgentRole, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

/** Maximum number of consecutive verification errors before a ticket is
 * dead-lettered. Without this cap, a broken verifier (e.g. missing API key,
 * LLM outage) would burn credits forever as the autonomous loop re-picks
 * the same ticket. After 3 errors, the ticket is parked in the `failed`
 * column with `deadLetter: true` and a `ticket:deadletter` event is broadcast
 * so the UI can surface it for human review. */
const MAX_VERIFY_FAILURES = 3;

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
  if (!content || typeof content !== "string") {
    return { parsed: "NEEDS_FIX", raw: "" };
  }
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

  // Default to NEEDS_FIX if ambiguous — safer than blindly passing
  return { parsed: "NEEDS_FIX", raw: firstLine };
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
      await moveQuestTicket(ticket.id, "available", ticket.assignee);
      if (ticket.sessionId && verdict !== "PASS") {
        await createFixTicket(
          ticket.sessionId,
          ticket.id,
          `Fix: ${ticket.title}`,
          (ticket.assignee as AgentRole) ?? "godot-specialist",
          `Verification ${verdict}: ${result.content.slice(0, 2000)}`,
        ).catch((err) => {
          logger.warn({ ticketId: ticket.id, error: err instanceof Error ? err.message : String(err) }, "createFixTicket failed");
        });
      }
    }

    if (ticket.projectId) {
      await updateTicketsBoard(ticket.projectId, (board) => {
        for (const col of board.columns) {
          const t = col.tickets.find((x) => x.id === ticket.id);
          if (t) {
            t.testEvidence = {
              ...t.testEvidence,
              llmVerification: { verdict, verifier, at: new Date().toISOString() },
            };
            if (passed) {
              // Reset the per-ticket failure counter on a successful verify so
              // the cap counts *consecutive* errors (as documented at
              // MAX_VERIFY_FAILURES) rather than cumulative errors across the
              // ticket's lifetime.
              t.consecutiveFailures = 0;
              t.lastError = undefined;
            }
          }
        }
        return board;
      });
    }

    broadcastEvent({
      type: "ticket:verified",
      ticketId: ticket.id,
      projectId: ticket.projectId ?? null,
      verdict,
      passed,
      verifier,
    } as WSEvent);

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

    // Bump the per-ticket failure counter. If we haven't hit the cap, leave
    // the ticket in `available` for the autonomous loop to retry. If we have
    // hit the cap, dead-letter the ticket so it stops consuming LLM credits.
    const projectId = ticket.projectId ?? null;
    let failureCount = 0;
    if (projectId) {
      try {
        await updateTicketsBoard(projectId, (board) => {
          for (const col of board.columns) {
            const t = col.tickets.find((x) => x.id === ticket.id);
            if (t) {
              t.consecutiveFailures = (t.consecutiveFailures ?? 0) + 1;
              t.lastError = errorMessage;
              failureCount = t.consecutiveFailures;
            }
          }
          return board;
        });
      } catch (bumpErr) {
        logger.warn(
          { event: "verify_bump_failed", ticketId: ticket.id, error: bumpErr instanceof Error ? bumpErr.message : String(bumpErr) },
          "Failed to record verification failure on the ticket",
        );
      }
    }

    if (failureCount >= MAX_VERIFY_FAILURES) {
      // Dead-letter: move to the `failed` column with a marker, broadcast a
      // dedicated event so the UI can show a banner, and log loudly.
      logger.error(
        { event: "verify_deadletter", ticketId: ticket.id, attempts: failureCount, error: errorMessage },
        `Ticket ${ticket.id} dead-lettered after ${failureCount} consecutive verification failures`,
      );

      if (projectId) {
        try {
          await updateTicketsBoard(projectId, (board) => {
            // Older boards (created before the `failed` column was added to
            // DEFAULT_TICKETS_BOARD) may not have it. Without this guard,
            // the dead-letter move silently no-ops: the ticket stays in its
            // current column with `deadLetter: true` set, but the UI never
            // surfaces it in the Failed column. Lazily create the column
            // here so dead-letter always lands somewhere visible.
            if (!board.columns.some((c) => c.id === "failed")) {
              board.columns.push({ id: "failed", label: "Failed", tickets: [] });
            }
            for (const col of board.columns) {
              if (col.id === "failed") {
                const t = col.tickets.find((x) => x.id === ticket.id);
                if (!t) {
                  const moved = board.columns.flatMap((c) => c.tickets).find((x) => x.id === ticket.id);
                  if (moved) {
                    moved.deadLetter = true;
                    moved.status = "failed";
                    col.tickets.push(moved);
                  }
                }
              }
              col.tickets = col.tickets.filter((x) => x.id !== ticket.id || col.id === "failed");
            }
            return board;
          });
        } catch (dlErr) {
          logger.error(
            { event: "verify_deadletter_write_failed", ticketId: ticket.id, error: dlErr instanceof Error ? dlErr.message : String(dlErr) },
            "Failed to persist dead-letter state",
          );
        }
      }

      broadcastEvent({
        type: "ticket:deadletter",
        ticketId: ticket.id,
        projectId,
        reason: errorMessage,
        attempts: failureCount,
      } as WSEvent);
    } else {
      // Under the cap — requeue so the autonomous loop can pick it up again.
      await moveQuestTicket(ticket.id, "available", ticket.assignee).catch((moveErr) => {
        logger.error(
          { event: "verify_move_failed", ticketId: ticket.id, error: moveErr instanceof Error ? moveErr.message : String(moveErr) },
          `Failed to move ticket ${ticket.id} back to available after verification error`,
        );
      });
    }

    return {
      ticketId: ticket.id,
      verdict: "ERROR",
      feedback: errorMessage,
      verifier,
      passed: false,
    };
  }
}

/**
 * Trigger verification for a ticket asynchronously.
 * Call this after moving a ticket to "qa" status.
 * Do NOT await — this is fire-and-forget.
 */
export function triggerVerification(ticket: Ticket, agentOutput: string): void {
  verifyTicket(ticket, agentOutput).catch((err) => {
    logger.error(
      { event: "verify_unhandled", ticketId: ticket.id, error: err instanceof Error ? err.message : String(err) },
      `Unhandled verification rejection for ticket ${ticket.id}`,
    );
  });
}
