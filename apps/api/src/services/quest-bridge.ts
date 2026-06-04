/**
 * Quest Bridge Service
 * Connects the Task tool (agent spawning) to the Quest/Ticket board.
 * When a workflow is active, every Task call automatically creates and tracks a ticket.
 */
import { randomBytes } from "node:crypto";

/** Monotonic per-process counter for ticket IDs. Backs the base36
 * segment of the ID so two tickets created in the same millisecond
 * (rare but possible under burst ingest) still get unique IDs even
 * before the random suffix. */
let _ticketCounter = 0;
function ticketIdCounter(): number {
  _ticketCounter = (_ticketCounter + 1) >>> 0;
  return _ticketCounter;
}

import { broadcastEvent } from "./data-store.js";
import { readData } from "./data-store.js";
import { DEFAULT_TICKETS_BOARD, readTicketsBoard, resolveProjectIdForSession, updateTicketsBoard } from "./ticket-board.js";
import { logger } from "../utils/logger.js";
import { loadConfig } from "../config.js";
import { newId } from "../utils/ids.js";
import type { TicketsBoard, Ticket, TicketStatus, AgentRole, WSEvent, WorkflowStage, DashboardData } from "@game-studio/types";
import { ingestProducerSummaryFromSession, safeIngestProducerSummaryFact } from "./producer-summary.js";
import { triggerVerification } from "./verification-service.js";

// ─── Workflow State (in-memory, per session) ───

interface WorkflowState {
  workflowId: string;
  stage: WorkflowStage;
  tickets: Map<string, string>; // ticketId -> agentRole
  createdAt: number; // epoch ms — workflow start time
  lastActivityAt: number; // epoch ms — touched on stage advance and ticket add
}

const activeWorkflows = new Map<string, WorkflowState>();

// 11-M19: extract scheduling cadence to a named constant. 1 hour was
// chosen because workflows are long-lived; sweeping more often wastes
// CPU on a usually-empty Map, less often risks holding zombies past the
// `WORKFLOW_TTL_MS` they're checked against.
const WORKFLOW_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// 12-H8: cap the absolute number of workflows the process holds
// simultaneously, even if they all appear "active" to the cleanup
// sweep. The TTL cleanup is best-effort and runs at most once per
// hour; if a long-lived project (e.g., a multi-day sprint) keeps
// starting workflows faster than the cleanup can reap them, the map
// grows without bound. Cap at 200 workflows — well above any
// realistic single-project count, and below the threshold where the
// inner `tickets` Map starts to noticeably slow the cleanup sweep.
const MAX_ACTIVE_WORKFLOWS = 200;

// Touch a workflow's lastActivityAt to keep it alive across the TTL cleanup
// sweep. Called from every state-mutating site (stage advance, ticket add).
function touchWorkflow(wf: WorkflowState): void {
  wf.lastActivityAt = Date.now();
}

// Periodic cleanup of stale workflows. Handle is exported so the graceful
// shutdown path in index.ts can clearInterval it; without that, the interval
// keeps running on a torn-down module graph until the process exits.
// The cleanup uses `lastActivityAt` (heartbeat) rather than `createdAt` so
// a long-running workflow that's actively advancing stages isn't reaped
// halfway through. WORKFLOW_TTL_MS is therefore "idle TTL" — the time
// the workflow can sit without any state change before it's considered
// abandoned.
export const workflowCleanupInterval = setInterval(() => {
  const now = Date.now();
  const ttl = loadConfig().WORKFLOW_TTL_MS;
  for (const [sessionId, wf] of activeWorkflows) {
    if (now - wf.lastActivityAt > ttl) {
      activeWorkflows.delete(sessionId);
    }
  }
  // 12-H8: second-pass cap. After TTL reaping, if the map is still
  // over MAX_ACTIVE_WORKFLOWS, drop the oldest by createdAt. This
  // protects against the case where TTL hasn't fired yet (TTL is
  // 24h by default) but the map has accumulated 200+ workflows
  // from many short-lived sessions that each completed but whose
  // cleanup was delayed. Without this, the in-memory map would
  // grow to match lifetime session count.
  if (activeWorkflows.size > MAX_ACTIVE_WORKFLOWS) {
    const sorted = Array.from(activeWorkflows.entries()).sort(
      (a, b) => a[1].createdAt - b[1].createdAt,
    );
    const toDrop = sorted.slice(0, activeWorkflows.size - MAX_ACTIVE_WORKFLOWS);
    for (const [sessionId] of toDrop) {
      activeWorkflows.delete(sessionId);
    }
    logger.warn(
      { dropped: toDrop.length, remaining: activeWorkflows.size, cap: MAX_ACTIVE_WORKFLOWS, event: "workflows_capped" },
      `Capped active workflows map at ${MAX_ACTIVE_WORKFLOWS} — dropped ${toDrop.length} oldest`,
    );
  }
}, WORKFLOW_CLEANUP_INTERVAL_MS);
workflowCleanupInterval.unref(); // don't keep process alive on its own

export function startWorkflow(sessionId: string): string {
  // Guard against concurrent startWorkflow calls for the same session: the
  // previous version of this function would silently overwrite an in-flight
  // workflow, losing the ticket map. The Map is a regular Map (not concurrent),
  // so the check + set must happen in the same synchronous frame — which it
  // does here because Node is single-threaded.
  const existing = activeWorkflows.get(sessionId);
  if (existing) {
    logger.warn(
      { sessionId, existingWorkflowId: existing.workflowId, event: "workflow_already_active" },
      "Refusing to start a new workflow — one is already in flight for this session",
    );
    return existing.workflowId;
  }

  // 26-M-workflow-id-newid: route through newId() for 128 bits of
  // UUID entropy. The previous ad-hoc `wf-${Date.now()}-${randomBytes(3)}`
  // had 24 bits of randomness on top of ms-resolution Date.now() — a
  // parallel /api/teams burst or a session-recreated-after-delete
  // race still hit collisions. Also lets us drop the now-unused
  // `randomBytes` import.
  const workflowId = newId("wf");
  const startedAt = Date.now();
  activeWorkflows.set(sessionId, {
    workflowId,
    stage: "plan",
    tickets: new Map(),
    createdAt: startedAt,
    lastActivityAt: startedAt,
  });

  broadcastEvent({
    type: "workflow:stage",
    sessionId,
    workflowId,
    stage: "plan",
  } as WSEvent);

  return workflowId;
}

export function getWorkflow(sessionId: string): WorkflowState | undefined {
  return activeWorkflows.get(sessionId);
}

export function advanceStage(sessionId: string, stage: WorkflowStage, ticketId?: string, agentRole?: string): void {
  const wf = activeWorkflows.get(sessionId);
  if (!wf) return;
  wf.stage = stage;
  touchWorkflow(wf);

  broadcastEvent({
    type: "workflow:stage",
    sessionId,
    workflowId: wf.workflowId,
    stage,
    ticketId,
    agentRole,
  } as WSEvent);

  void ingestProducerSummaryFromSession(sessionId, {
    kind: "workflow_stage",
    at: new Date().toISOString(),
    detail: stage,
    ticketId,
    agentRole,
    sessionId,
  }).catch((err) => logger.warn({ sessionId, err: String(err), event: "producer_summary_workflow_stage_failed" },
    "ingestProducerSummary rejected in workflow_stage"));

  if (stage === "verify") {
    void triggerWorkflowVerification(sessionId, wf).catch((err) => logger.warn({ sessionId, err: String(err), event: "workflow_verify_failed" },
      "triggerWorkflowVerification rejected"));
  }
}

async function triggerWorkflowVerification(sessionId: string, wf: WorkflowState): Promise<void> {
  const projectId = await resolveProjectIdForSession(sessionId);
  if (!projectId) return;

  try {
    const board = await readTicketsBoard(projectId);
    // 17-H2: build a ticketId → ticket index once. The previous code
    // nested a linear `find` inside the columns loop, making verify
    // O(tickets × columns) per workflow. With 100 tickets and 5
    // columns that's 500 scans; with the index it's N lookups.
    const byId = new Map<string, Ticket>();
    for (const col of board.columns) {
      for (const t of col.tickets) byId.set(t.id, t);
    }
    for (const ticketId of wf.tickets.keys()) {
      const ticket = byId.get(ticketId);
      if (ticket && ticket.status === "qa") {
        // Q10-6th: deep-clone before passing to verification. The
        // shallow spread `{ ...ticket, sessionId }` shared the
        // ticket's nested objects (testEvidence, parentTicketId
        // chain, etc.) with the live board entry; if the verifier
        // mutated any of them, the change would persist on the
        // board. structuredClone is built into Node 17+ and is
        // cheaper than JSON round-trip because it preserves
        // Date/Map/Set, but for plain JSON this is fine.
        triggerVerification(
          structuredClone({ ...ticket, sessionId }),
          ticket.description || ticket.title,
        );
      }
    }
  } catch (err) {
    logger.warn(
      { sessionId, error: err instanceof Error ? err.message : String(err), event: "workflow_verify_failed" },
      "Workflow verify stage failed",
    );
  }
}

export function completeWorkflow(sessionId: string, success: boolean): void {
  const wf = activeWorkflows.get(sessionId);
  if (!wf) return;

  broadcastEvent({
    type: "workflow:complete",
    sessionId,
    workflowId: wf.workflowId,
    success,
  } as WSEvent);

  activeWorkflows.delete(sessionId);

  void ingestProducerSummaryFromSession(sessionId, {
    kind: "workflow_complete",
    at: new Date().toISOString(),
    detail: String(success),
    sessionId,
  }).catch((err) => logger.warn({ sessionId, err: String(err), event: "producer_summary_workflow_complete_failed" },
    "ingestProducerSummary rejected in workflow_complete"));
}

export async function cleanupWorkflow(sessionId: string): Promise<void> {
  // 19-M-cleanup-no-broadcast: previously cleanupWorkflow silently
  // removed the workflow from the in-memory map without any
  // websocket event or producer-summary fact. Compared to
  // completeWorkflow (L216-235) which broadcasts workflow:complete
  // and ingests a summary fact, a user watching a workflow UI
  // wouldn't see the cleanup until the next poll — the workflow
  // appeared "active" indefinitely. Resolve the projectId from the
  // session index so the broadcast carries it; bail cheaply if
  // the session was never indexed. The function is now async to
  // match resolveProjectIdForSession's signature, but the in-memory
  // map mutation is still synchronous and runs before the await so
  // concurrent callers can't double-cleanup.
  const wf = activeWorkflows.get(sessionId);
  activeWorkflows.delete(sessionId);
  if (!wf) return;
  const projectId = await resolveProjectIdForSession(sessionId);
  if (!projectId) return;
  broadcastEvent({ type: "workflow:cleared", sessionId, projectId } as WSEvent);
  safeIngestProducerSummaryFact(projectId, {
    kind: "workflow_cleared",
    at: new Date().toISOString(),
    title: "workflow cleared",
    sessionId,
  });
}

// ─── Ticket CRUD (direct file access, same as REST routes) ───

async function getBoard(projectId?: string | null): Promise<TicketsBoard> {
  try {
    return await readTicketsBoard(projectId);
  } catch {
    // Don't persist a phantom default board on a transient read error —
    // a network blip or a corrupt file would otherwise create an empty
    // board that overwrites the real one on the next save. Return the
    // default in-memory only; first successful POST will persist.
    return structuredClone(DEFAULT_TICKETS_BOARD);
  }
}

export function findTicketInBoard(board: TicketsBoard, ticketId: string): { col: number; idx: number; ticket: Ticket } | null {
  for (let c = 0; c < board.columns.length; c++) {
    for (let i = 0; i < board.columns[c].tickets.length; i++) {
      if (board.columns[c].tickets[i].id === ticketId) {
        return { col: c, idx: i, ticket: board.columns[c].tickets[i] };
      }
    }
  }
  return null;
}

// ─── Quest Bridge API ───

export async function createQuestTicket(
  sessionId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
  area: string,
  subarea: string,
  projectId?: string | null,
): Promise<Ticket> {
  const resolvedProjectId = projectId ?? await resolveProjectIdForSession(sessionId);
  const now = new Date().toISOString();
  const ticket: Ticket = {
    // 4-char base36 has only 36^4 ≈ 1.68M combinations. With Date.now()
    // prefix and 100 active tickets/sec, birthday-paradox collisions hit
    // ~50% around 1.5K tickets. Bump to 8 hex chars (4.3B combos) and
    // tag a counter as a tie-breaker for sub-millisecond bursts.
    id: `ticket-${Date.now()}-${ticketIdCounter().toString(36)}-${randomBytes(4).toString("hex")}`,
    projectId: resolvedProjectId ?? undefined,
    title,
    description,
    area,
    subarea,
    credits: 100,
    status: "available",
    assignee: agentRole,
    acknowledged: false,
    createdAt: now,
    updatedAt: now,
    sessionId,
    workflowStage: getWorkflow(sessionId)?.stage,
  };

  // Use mutex-protected write to prevent lost updates under concurrent calls
  const board = resolvedProjectId
    ? await updateTicketsBoard(resolvedProjectId, (b) => {
        const availableCol = b.columns.find((c) => c.id === "available");
        if (availableCol) {
          availableCol.tickets.push(ticket);
        }
        return b;
      })
    : (() => { throw new Error("projectId required for ticket creation"); })();

  broadcastEvent({ type: "ticket:created", ticket, projectId: resolvedProjectId } as WSEvent);

  broadcastEvent({
    type: "quest:linked",
    sessionId,
    ticketId: ticket.id,
    agentRole: agentRole as string,
  } as WSEvent);

  // Track in workflow
  const wf = getWorkflow(sessionId);
  if (wf) {
    wf.tickets.set(ticket.id, agentRole as string);
    touchWorkflow(wf);
  }

  if (resolvedProjectId) {
    safeIngestProducerSummaryFact(resolvedProjectId, {
      kind: "ticket_created",
      at: now,
      title,
      ticketId: ticket.id,
      agentRole: agentRole as string,
      sessionId,
    });
  }

  return ticket;
}

export async function moveQuestTicket(
  ticketId: string,
  status: TicketStatus,
  assignee?: string,
  // C8: callers that already know the projectId can pass it in to skip the
  // N-project resolver (which still reads every board file). Verification
  // service has the ticket object; chat/teams route can look it up once.
  knownProjectId?: string | null,
): Promise<void> {
  const projectId = knownProjectId ?? await resolveProjectIdForTicket(ticketId);

  // Capture the source column id *before* the mutation runs so the broadcast
  // event can carry the actual fromColumn. Without this snapshot, the
  // updater mutates the board and the later `findTicketInBoard` lookup
  // returns the *destination* column, producing a self-loop
  // (fromColumn === toColumn) for every move.
  let fromColumnId: string | null = null;

  // Serialize the board mutation to prevent lost updates
  const moved = projectId
    ? await updateTicketsBoard(projectId, (board) => {
        const found = findTicketInBoard(board, ticketId);
        if (!found) {
          logger.warn({ ticketId, status, event: "ticket_move_not_found" }, `Ticket ${ticketId} not found on board — skipping move to ${status}`);
          return board;
        }
        const { col, idx, ticket } = found;
        fromColumnId = board.columns[col].id;
        ticket.status = status;
        ticket.updatedAt = new Date().toISOString();
        if (assignee !== undefined) ticket.assignee = assignee;
        const targetCol = board.columns.find((c) => c.id === status);
        if (targetCol && targetCol.id !== board.columns[col].id) {
          board.columns[col].tickets.splice(idx, 1);
          targetCol.tickets.push(ticket);
        }
        return board;
      })
    : null;

  if (!projectId || !moved) return;
  // Broadcast after the lock is released
  const found = findTicketInBoard(moved, ticketId);
  if (!found) return;
  const { ticket } = found;

  broadcastEvent({
    type: "ticket:moved",
    ticket,
    fromColumn: fromColumnId ?? ticket.status,
    toColumn: status,
    projectId,
  } as WSEvent);

  safeIngestProducerSummaryFact(projectId, {
    kind: "ticket_moved",
    at: ticket.updatedAt,
    ticketId,
    title: ticket.title,
    fromColumn: fromColumnId ?? ticket.status,
    toColumn: status,
    agentRole: ticket.assignee,
  });

  if (status === "qa") {
    triggerVerification(ticket, ticket.description || ticket.title);
  }
}

export async function createFixTicket(
  sessionId: string,
  parentTicketId: string,
  title: string,
  agentRole: AgentRole,
  description: string,
): Promise<Ticket> {
  const ticket = await createQuestTicket(sessionId, title, agentRole, description, "WORKFLOW", "fix");
  // Persist parentTicketId — updateTicketsBoard ensures atomic write
  const projectId = ticket.projectId ?? null;
  if (projectId) {
    await updateTicketsBoard(projectId, (board) => {
      const found = findTicketInBoard(board, ticket.id);
      if (found) found.ticket.parentTicketId = parentTicketId;
      return board;
    });
    // 18-M-fix-ticket-no-broadcast: emit ticket:updated so the
    // kanban client picks up parentTicketId. The createQuestTicket
    // call above already broadcast ticket:created with no parent
    // (we didn't know it yet), and the field assignment here
    // mutated the board but never fired any websocket event, so
    // connected clients kept showing the fix ticket with no
    // parent link until the next manual board refresh. Without
    // the parent link, the UI can't draw the chain (a "this
    // ticket fixes <parent>" indicator) and the producer can't
    // navigate from a failed ticket back to the original.
    broadcastEvent({ type: "ticket:updated", ticket, projectId } as WSEvent);
  }
  ticket.parentTicketId = parentTicketId;
  return ticket;
}

// Short-TTL cache for resolveProjectIdForTicket. A ticket's owning project
// is invariant for the ticket's lifetime; the lookup is N+1 disk reads
// (legacy board + every per-project board), so caching the result for
// a few seconds collapses the read storm on the hot moveQuestTicket path.
const TICKET_PROJECT_CACHE_TTL_MS = 30_000;
// 27-H-ticket-project-cache-cap: hard cap on the cache size. The
// TTL reaps entries lazily on read, so a long-running API that
// creates many tickets (one entry per ticketId) grows the map to
// N=tickets-lifetime even after individual entries expire — the
// entries are reaped only when a later call *for the same
// ticketId* sees the expired entry. With the autonomous loop
// creating dozens of tickets per sprint and the typical project
// running 10+ sprints, the cache can hold tens of thousands of
// entries between "touched" events. Cap at 5000 — well above any
// realistic working set (recent tickets on hot moveQuestTicket
// calls) and low enough that the map stays well under V8's Map
// performance cliff.
const MAX_TICKET_PROJECT_CACHE = 5000;
const ticketProjectCache = new Map<string, { value: string | null; expiresAt: number }>();

/**
 * Drop cached project lookups for `projectId`. Called from the dashboard
 * DELETE handler so stale cache entries don't route fresh lookups for
 * recycled ticket ids back to a project that no longer exists.
 *
 * Q9-8: without this, a project deletion would leave the in-memory cache
 * pointing ticketIds at the just-removed project until the 30s TTL
 * expired — moveQuestTicket calls in that window would write to the
 * vanished project's board (a no-op at best, a confused error at worst).
 */
export function clearTicketProjectCacheForProject(projectId: string): void {
  for (const [ticketId, entry] of ticketProjectCache) {
    if (entry.value === projectId) {
      ticketProjectCache.delete(ticketId);
    }
  }
}

async function resolveProjectIdForTicket(ticketId: string): Promise<string | null> {
  const cached = ticketProjectCache.get(ticketId);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const legacyBoard = await getBoard(null);
  const legacyFound = findTicketInBoard(legacyBoard, ticketId);
  if (legacyFound) {
    const value = legacyFound.ticket.projectId ?? null;
    ticketProjectCache.set(ticketId, { value, expiresAt: now + TICKET_PROJECT_CACHE_TTL_MS });
    capTicketProjectCache();
    return value;
  }

  try {
    const dashboard = await readData<DashboardData>("dashboard.json");
    if (!dashboard.projects.length) {
      ticketProjectCache.set(ticketId, { value: null, expiresAt: now + TICKET_PROJECT_CACHE_TTL_MS });
      capTicketProjectCache();
      return null;
    }
    // C8: scan all per-project boards in parallel instead of one-at-a-time
    // (was N+1 sequential disk reads — quadratic as the project list grows).
    const boards = await Promise.all(
      dashboard.projects.map((p) => getBoard(p.id).then((board) => ({ projectId: p.id, board })))
    );
    for (const { projectId, board } of boards) {
      if (findTicketInBoard(board, ticketId)) {
        ticketProjectCache.set(ticketId, { value: projectId, expiresAt: now + TICKET_PROJECT_CACHE_TTL_MS });
        capTicketProjectCache();
        return projectId;
      }
    }
  } catch {
    // Ignore scan failures and fall back to null.
  }

  ticketProjectCache.set(ticketId, { value: null, expiresAt: now + TICKET_PROJECT_CACHE_TTL_MS });
  capTicketProjectCache();
  return null;
}

// 27-H-ticket-project-cache-cap: drop oldest entries
// (insertion-order) whenever the cache exceeds the cap. Map
// preserves insertion order, so the first key is the least
// recently inserted. Called after every set so a burst of new
// ticketIds can't exceed the cap.
function capTicketProjectCache(): void {
  if (ticketProjectCache.size <= MAX_TICKET_PROJECT_CACHE) return;
  const toDrop = ticketProjectCache.size - MAX_TICKET_PROJECT_CACHE;
  let dropped = 0;
  for (const key of ticketProjectCache.keys()) {
    if (dropped >= toDrop) break;
    ticketProjectCache.delete(key);
    dropped++;
  }
}
