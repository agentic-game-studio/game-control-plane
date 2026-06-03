/**
 * Producer rolling summary — hybrid state-derived rollups emitted as
 * durable `producer_update` chat messages on the producer session.
 */

import { createHash } from "node:crypto";
import type { ProducerSummaryFact, ProducerSummarySnapshot } from "@game-studio/types";
import { logger } from "../utils/logger.js";

export const MAX_RECENT_FACTS = 30;
export const EMIT_COOLDOWN_MS = 45_000;

// 16-M-ingest-fact-fire-and-forget: ingestProducerSummaryFact can throw
// (await mod.persistChatStore can hit EIO/ENOSPC/EROFS; dynamic import
// can fail under rare module-graph races). Callers fire-and-forget
// through `void ingestProducerSummaryFact(...)` — without this helper,
// a transient write error became an unhandled rejection, which the
// index.ts unhandledRejection handler routes to fatalExit → process
// exit. The in-memory summary is a UX nicety; a lost fact is
// preferable to taking down the whole API.
export function safeIngestProducerSummaryFact(
  projectId: string,
  fact: ProducerSummaryFact,
): void {
  ingestProducerSummaryFact(projectId, fact).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), projectId, event: "producer_summary_fact_ingest_failed" },
      "Failed to ingest producer summary fact — continuing",
    );
  });
}

const pendingEmitTimers = new Map<string, ReturnType<typeof setTimeout>>();

// 18-H-prod-sum-rmw: per-project serialization chain for the
// producer-summary ingest path. The in-memory RMW on
// `session.producerSummary` is synchronous (no `await` between the
// read, push, and write) so it can't lose data in-process. But the
// next line, `await mod.persistChatStore()`, is a yield point. Two
// concurrent facts can both complete the RMW and then interleave
// on the persist: CallA writes snapshot-with-fact1, CallB writes
// snapshot-with-fact1+fact2 to disk first, then CallA's write
// overwrites it with snapshot-with-fact1 only. Process restart
// would then load the older snapshot and lose fact2. Serialize the
// persist+emit behind a per-project promise chain so the disk
// state always reflects the most recent RMW.
const producerSummaryPersistChains = new Map<string, Promise<unknown>>();

export function emptyProducerSummarySnapshot(): ProducerSummarySnapshot {
  return {
    version: 1,
    recentFacts: [],
    lastEmittedAt: null,
    lastEmittedContentHash: null,
    autonomousHint: null,
  };
}

export function pushProducerSummaryFact(
  snap: ProducerSummarySnapshot,
  fact: ProducerSummaryFact,
): ProducerSummarySnapshot {
  const recentFacts = [...snap.recentFacts, fact].slice(-MAX_RECENT_FACTS);
  let autonomousHint = snap.autonomousHint;
  if (
    fact.kind.startsWith("autonomous_") &&
    fact.kind !== "autonomous_loop_completed" &&
    fact.kind !== "autonomous_loop_stopped"
  ) {
    autonomousHint = formatAutonomousOneLiner(fact);
  }
  if (fact.kind === "autonomous_loop_completed" || fact.kind === "autonomous_loop_stopped") {
    autonomousHint = formatAutonomousOneLiner(fact);
  }
  return { ...snap, recentFacts, autonomousHint };
}

function formatAutonomousOneLiner(fact: ProducerSummaryFact): string | null {
  switch (fact.kind) {
    case "autonomous_iteration_started":
      return fact.title
        ? `Autonomous: ${fact.agentRole ?? "agent"} on “${truncate(fact.title, 60)}”`
        : `Autonomous: iteration started`;
    case "autonomous_iteration_completed":
      return "Autonomous: iteration completed";
    case "autonomous_iteration_failed":
      return `Autonomous: iteration failed${fact.detail ? ` — ${truncate(fact.detail, 80)}` : ""}`;
    case "autonomous_iteration_boot_check_failed":
      return "Autonomous: boot check failed (ticket re-queued)";
    case "autonomous_loop_completed":
      return "Autonomous loop: completed run";
    case "autonomous_loop_stopped":
      return "Autonomous loop: stopped";
    case "autonomous_error":
      return `Autonomous: error${fact.detail ? ` — ${truncate(fact.detail, 80)}` : ""}`;
    default:
      return fact.title ? truncate(fact.title, 80) : fact.detail ? truncate(fact.detail, 80) : null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatFactLine(f: ProducerSummaryFact): string {
  const role = f.agentRole ? f.agentRole.replace(/-/g, " ") : "";
  switch (f.kind) {
    case "subagent_spawned":
      return `Subagent ${role}: started${f.title ? ` — ${truncate(f.title, 70)}` : ""}`;
    case "subagent_completed":
      return `Subagent ${role}: completed${f.ticketId ? ` (${f.ticketId})` : ""}`;
    case "subagent_failed":
      return `Subagent ${role}: failed${f.detail ? ` — ${truncate(f.detail, 70)}` : ""}`;
    case "ticket_created":
      return `Ticket queued: ${truncate(f.title ?? f.ticketId ?? "untitled", 72)}${f.ticketId ? ` [${f.ticketId}]` : ""}`;
    case "ticket_moved":
      return `Ticket ${f.ticketId ?? "?"}: ${f.fromColumn ?? "?"} → ${f.toColumn ?? "?"}`;
    case "ticket_updated":
      return `Ticket ${f.ticketId ?? "?"} updated${f.detail ? `: ${f.detail}` : ""}`;
    case "workflow_stage":
      return `Workflow: stage **${f.detail ?? "?"}**${f.ticketId ? ` (ticket ${f.ticketId})` : ""}`;
    case "workflow_complete":
      return `Workflow: ${f.detail === "false" ? "ended (failed)" : "completed"}`;
    case "agent_spawned":
      return `Agent session: **${role}** spawned`;
    case "spawn_task_complete":
      return `Spawn: **${role}** finished task`;
    case "spawn_task_failed":
      return `Spawn: **${role}** failed${f.detail ? ` — ${truncate(f.detail, 70)}` : ""}`;
    case "consultation_closed":
      return `Consultation closed (${f.detail ?? f.title ?? "summary posted"})`;
    case "gdd_ingested":
      return `GDD ingested${f.detail ? `: ${f.detail}` : ""}`;
    default:
      return `${f.kind}${f.title ? `: ${truncate(f.title, 70)}` : f.detail ? `: ${truncate(f.detail, 70)}` : ""}`;
  }
}

function bucketForFact(f: ProducerSummaryFact): "done" | "inflight" | "notes" {
  switch (f.kind) {
    case "subagent_completed":
    case "spawn_task_complete":
    case "workflow_complete":
      if (f.kind === "workflow_complete" && f.detail === "false") return "notes";
      return "done";
    case "ticket_moved":
      if (f.toColumn === "completed") return "done";
      if (f.toColumn === "qa" || f.toColumn === "available") return "notes";
      return "inflight";
    case "gdd_ingested":
    case "autonomous_iteration_completed":
    case "autonomous_loop_completed":
      return "done";
    case "subagent_failed":
    case "spawn_task_failed":
    case "autonomous_iteration_failed":
    case "autonomous_iteration_boot_check_failed":
    case "autonomous_error":
    case "autonomous_loop_stopped":
      return "notes";
    default:
      return "inflight";
  }
}

/** Public for tests — builds markdown body from snapshot */
export function buildProducerUpdateMarkdown(snap: ProducerSummarySnapshot): string {
  if (snap.recentFacts.length === 0) return "";
  const facts = snap.recentFacts.slice(-25);
  const done: string[] = [];
  const inflight: string[] = [];
  const notes: string[] = [];

  for (const f of facts) {
    const line = formatFactLine(f);
    const b = bucketForFact(f);
    if (b === "done") done.push(line);
    else if (b === "notes") notes.push(line);
    else inflight.push(line);
  }

  const lines: string[] = ["## Producer update"];

  if (snap.autonomousHint) {
    lines.push("");
    lines.push(`**Autonomous** — ${snap.autonomousHint}`);
  }

  const section = (title: string, items: string[]) => {
    const uniq = [...new Set(items)].slice(-6);
    lines.push("");
    lines.push(`**${title}**`);
    if (uniq.length === 0) lines.push("- _None_");
    else uniq.forEach((x) => lines.push(`- ${x}`));
  };

  section("Completed", done);
  section("In flight", inflight);
  section("Notes", notes);

  return lines.join("\n");
}

export function hashProducerUpdateContent(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

function scheduleEmit(projectId: string, delayMs: number): void {
  if (pendingEmitTimers.has(projectId)) return;
  const t = setTimeout(() => {
    pendingEmitTimers.delete(projectId);
    void flushEmitProducerUpdate(projectId);
  }, Math.max(0, delayMs));
  // unref() so a pending debounced emit can't keep the process alive
  // during shutdown. The setInterval timers in this codebase (rate
  // limiter, heartbeat, etc.) all unref for the same reason.
  t.unref();
  pendingEmitTimers.set(projectId, t);
}

/** Cancel any pending emit for a project. Called from project-delete
 *  paths so a deleted project can't fire an emit against a torn-down
 *  state — the callback would import chat.js and broadcast to a dead
 *  project. */
export function clearProjectProducerSummary(projectId: string): void {
  const t = pendingEmitTimers.get(projectId);
  if (t) {
    clearTimeout(t);
    pendingEmitTimers.delete(projectId);
  }
}

async function flushEmitProducerUpdate(projectId: string): Promise<void> {
  const mod = await import("../routes/chat.js");
  await mod.chatStoreReady;
  // 17-M-prod-sum-compacted: walk the compaction chain so a producer_update
  // never lands on a session the UI isn't displaying. Without this, an emit
  // that fires after /compact writes to the base (compacted) session whose
  // id is what producerSessionId returns, and the message is silently lost.
  const session = mod.resolveActiveProducerSession(projectId) as
    | { id: string; producerSummary?: ProducerSummarySnapshot }
    | null;
  if (!session?.producerSummary) return;

  const snap = session.producerSummary;
  const md = buildProducerUpdateMarkdown(snap);
  if (!md.trim()) return;

  const h = hashProducerUpdateContent(md);
  if (h === snap.lastEmittedContentHash) return;

  const now = Date.now();
  const last = snap.lastEmittedAt ?? 0;
  if (last > 0 && now - last < EMIT_COOLDOWN_MS) {
    scheduleEmit(projectId, EMIT_COOLDOWN_MS - (now - last));
    return;
  }

  snap.lastEmittedAt = now;
  snap.lastEmittedContentHash = h;

  // 17-L-msg-id-collision: use the same `newId("msg")` helper as the
  // rest of chat.ts instead of `producer-update-${now}`. Two emits
  // landing in the same millisecond would produce identical ids, and
  // the frontend dedupes on `msg.id` so the second emit would be
  // silently dropped.
  const { newId } = await import("../utils/ids.js");
  await mod.appendMessage(session.id, {
    id: newId("msg"),
    type: "producer_update",
    sender: "Producer",
    content: md,
    timestamp: new Date().toISOString(),
    showActions: false,
  });
}

/**
 * Record a fact for a project and maybe emit a producer_update message.
 */
export async function ingestProducerSummaryFact(
  projectId: string,
  fact: ProducerSummaryFact,
): Promise<void> {
  if (!projectId) return;
  const mod = await import("../routes/chat.js");
  await mod.chatStoreReady;
  // 17-M-prod-sum-compacted: facts must be written to the LIVE session,
  // not the (frozen) compacted base. The summary snapshot is per-session
  // — if a project is compacted mid-flow, the fact would otherwise be
  // captured only on the dead base and a subsequent emit (which now uses
  // resolveActiveProducerSession) would emit an empty summary because the
  // new generation has no producerSummary field.
  const session = mod.resolveActiveProducerSession(projectId) as
    | { producerSummary?: ProducerSummarySnapshot }
    | null;
  if (!session) return;

  if (!session.producerSummary) {
    session.producerSummary = emptyProducerSummarySnapshot();
  }
  session.producerSummary = pushProducerSummaryFact(session.producerSummary, fact);
  // 18-H-prod-sum-rmw: serialize the persist+emit behind the per-project
  // chain. The previous tail's promise resolves into this fact's
  // work; the new tail is what the next caller awaits. Errors are
  // caught so a failure in one fact's persist doesn't poison the
  // chain for all subsequent facts (the snapshot was already
  // mutated synchronously above — we still try to persist, but a
  // disk-full here shouldn't strand later ingests).
  const previousTail = producerSummaryPersistChains.get(projectId) ?? Promise.resolve();
  const nextTail = previousTail
    .catch(() => undefined)
    .then(async () => {
      await mod.persistChatStore();
      await flushEmitProducerUpdate(projectId);
    });
  producerSummaryPersistChains.set(
    projectId,
    nextTail.catch(() => undefined),
  );
  await nextTail;
}

/**
 * Resolve projectId from a chat session id (agent / producer child) and ingest.
 */
export async function ingestProducerSummaryFromSession(
  chatSessionId: string,
  fact: Omit<ProducerSummaryFact, "at"> & { at?: string },
): Promise<void> {
  const mod = await import("../routes/chat.js");
  await mod.chatStoreReady;
  const session = mod.chatStore.sessions[chatSessionId];
  const projectId = session?.projectId;
  if (!projectId) return;
  const full: ProducerSummaryFact = {
    ...fact,
    at: fact.at ?? new Date().toISOString(),
    sessionId: fact.sessionId ?? chatSessionId,
  };
  await ingestProducerSummaryFact(projectId, full);
}
