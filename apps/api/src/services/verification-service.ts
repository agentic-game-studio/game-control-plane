/**
 * Verification Service
 * Auto-verifies agent output when tickets reach the "qa" (Verify) column.
 * Selects verifier agents based on task area, invokes them via LLM,
 * parses verdict, and moves tickets accordingly.
 */

import { invokeAgent } from "./llm-service.js";
import { moveQuestTicket, createFixTicket, findTicketInBoard } from "./quest-bridge.js";
import { broadcastEvent } from "./data-store.js";
import { updateTicketsBoard, readTicketsBoard } from "./ticket-board.js";
import type { Ticket, AgentRole, WSEvent } from "@game-studio/types";
import { logger } from "../utils/logger.js";

// 10-M1: track in-flight verifications by ticketId so external events
// (project delete, ticket delete) can abort the underlying LLM call.
// Without this, a project delete would orphan the verification job: the
// LLM round-trip would continue burning tokens on a ticket that no
// longer exists.
const activeVerifications = new Map<string, AbortController>();

export function cancelVerification(ticketId: string): boolean {
  const controller = activeVerifications.get(ticketId);
  if (!controller) return false;
  try { controller.abort(); } catch { /* already aborted */ }
  activeVerifications.delete(ticketId);
  return true;
}

export function cancelVerificationsForProject(projectId: string): number {
  let count = 0;
  for (const [ticketId, controller] of activeVerifications) {
    if (ticketId.startsWith(`${projectId}-`) || ticketId.includes(`/${projectId}/`)) {
      try { controller.abort(); } catch { /* already aborted */ }
      activeVerifications.delete(ticketId);
      count++;
    }
  }
  return count;
}

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
    const fallbackSession = ticket.projectId
      ? `verify-fallback-${ticket.projectId}`
      : `verify-fallback-${ticket.id}`;
    // 10-M1: thread an AbortController through invokeAgent so the
    // verification can be cancelled externally (e.g. when the project
    // is deleted while a verifier is mid-call).
    const controller = new AbortController();
    activeVerifications.set(ticket.id, controller);
    let result: { content: string };
    try {
      result = await invokeAgent(
        verifier,
        task,
        ticket.sessionId ?? fallbackSession,
        undefined,
        undefined,
        undefined,
        false,
        0,
        undefined,
        undefined,
        undefined,
        controller.signal,
      );
    } finally {
      // Only clear if this controller is still the active one for the
      // ticket — a re-entered verification would have replaced it.
      if (activeVerifications.get(ticket.id) === controller) {
        activeVerifications.delete(ticket.id);
      }
    }
    const { parsed: verdict } = parseVerdict(result.content);
    const passed = verdict === "PASS";

    logger.info(
      { event: "verify_complete", ticketId: ticket.id, verdict, verifier },
      `Ticket ${ticket.id} verification: ${verdict}`,
    );

    // Move ticket based on verdict, atomically resetting the failure
    // counter on PASS in the same board-mutation call (Q9-13). The
    // previous split was: moveQuestTicket, then a separate
    // updateTicketsBoard to reset the counter. The two operations ran
    // under separate locks, so a concurrent verify-error could increment
    // the counter between them, then the reset would clobber it back to
    // 0 — the ticket would then be "completed" with a stale counter that
    // didn't reflect the most recent failure.
    //
    // Doing both in one updateTicketsBoard call keeps the move, the
    // counter reset, and the test-evidence write under a single lock.
    if (ticket.projectId) {
      const targetStatus: "completed" | "available" = passed ? "completed" : "available";
      const targetAssignee = ticket.assignee;
      // Capture the source column id *before* the mutation runs so the
      // broadcast event can carry the actual fromColumn. Without this
      // snapshot, the updater mutates the board and the broadcast can't
      // report the correct source — produces a self-loop animation in
      // the UI (fromColumn === toColumn).
      let fromColumnId: string | null = null;
      const updatedBoard = await updateTicketsBoard(ticket.projectId, (board) => {
        const found = findTicketInBoard(board, ticket.id);
        if (!found) return board;
        const { col: fromColIdx, idx, ticket: t } = found;
        // Move the ticket.
        fromColumnId = board.columns[fromColIdx].id;
        const fromColumn = board.columns[fromColIdx];
        t.status = targetStatus;
        t.updatedAt = new Date().toISOString();
        if (targetAssignee !== undefined) t.assignee = targetAssignee;
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
        const targetCol = board.columns.find((c) => c.id === targetStatus);
        if (targetCol && targetCol.id !== fromColumn.id) {
          fromColumn.tickets.splice(idx, 1);
          targetCol.tickets.push(t);
        }
        return board;
      });

      // Broadcast the move (mirrors moveQuestTicket's broadcast) so the UI
      // animates the column change. Use the updated board's view of the
      // ticket (now with refreshed status + reset counter) so consumers
      // see consistent state.
      const found = findTicketInBoard(updatedBoard, ticket.id);
      if (found) {
        broadcastEvent({
          type: "ticket:moved",
          ticket: found.ticket,
          fromColumn: fromColumnId ?? found.ticket.status,
          toColumn: targetStatus,
          projectId: ticket.projectId,
        } as WSEvent);
      }
    } else {
      // No projectId — fall back to the legacy path. The old code could
      // move a ticket with no projectId, so we keep that behavior.
      if (passed) {
        await moveQuestTicket(ticket.id, "completed", ticket.assignee);
      } else {
        await moveQuestTicket(ticket.id, "available", ticket.assignee);
      }
    }

    if (!passed) {
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
        // Idempotency check: if the ticket is ALREADY in the `failed`
        // column with `deadLetter: true`, skip the move and re-broadcast.
        // Without this, a redelivered webhook or a retry from the producer
        // re-applies the move, broadcasts another `ticket:deadletter`,
        // and bumps the `lastError` text again — the UI then loses track
        // of which attempt caused the dead-letter.
        let alreadyDeadLettered = false;
        try {
          const board = await readTicketsBoard(projectId);
          const failedCol = board.columns.find((c) => c.id === "failed");
          if (failedCol?.tickets.some((t) => t.id === ticket.id && t.deadLetter)) {
            alreadyDeadLettered = true;
          }
        } catch {
          // If the read fails, fall through and try to dead-letter — better
          // to apply it twice than to never apply it at all.
        }

        if (!alreadyDeadLettered) {
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
              // Refuse to dead-letter the same ticket twice in the same
              // board. The first dead-letter places it in `failed`; the
              // outer board read above already short-circuited, but a race
              // between two concurrent verify failures on the same ticket
              // could arrive here simultaneously. Skip the splice/insert
              // and just refresh the lastError to the most recent message.
              const failedCol = board.columns.find((c) => c.id === "failed")!;
              const existingDead = failedCol.tickets.find((t) => t.id === ticket.id);
              if (existingDead) {
                existingDead.lastError = errorMessage;
                existingDead.deadLetter = true;
                existingDead.status = "failed";
                return board;
              }
              const moved = board.columns.flatMap((c) => c.tickets).find((x) => x.id === ticket.id);
              if (moved) {
                moved.deadLetter = true;
                moved.status = "failed";
                moved.lastError = errorMessage;
                failedCol.tickets.push(moved);
              }
              for (const col of board.columns) {
                if (col.id === "failed") continue;
                col.tickets = col.tickets.filter((x) => x.id !== ticket.id);
              }
              return board;
            });
          } catch (dlErr) {
            logger.error(
              { event: "verify_deadletter_write_failed", ticketId: ticket.id, error: dlErr instanceof Error ? dlErr.message : String(dlErr) },
              "Failed to persist dead-letter state",
            );
          }
        } else {
          logger.info(
            { event: "verify_deadletter_dedup", ticketId: ticket.id, attempts: failureCount },
            `Ticket ${ticket.id} already dead-lettered — skipping duplicate move`,
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
      // Q18-6th: thread `projectId` so moveQuestTicket doesn't re-run the
      // N-project resolver. On a workspace with 100+ projects the resolver
      // is a full-board scan per ticket; passing projectId skips it.
      await moveQuestTicket(ticket.id, "available", ticket.assignee, projectId).catch((moveErr) => {
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
