# RELEASING — Game Studio Control Plane

This document summarizes the changes landed in the comprehensive code-health
pass. Phases are ordered so each builds on the previous one.

---

## Phase 1 — Security & Crash Hot-Fixes

**Why first:** Two ESM `require()` calls crashed production paths on every
Godot-project agent invocation. A command-injection vector, a path-traversal
regex, and a timing-attackable WebSocket auth were publicly reachable.

| # | File | Change |
|---|---|---|
| 1.1 | `apps/api/src/services/godot-mcp-service.ts` | Removed inline `require("node:fs")` (ESM crash on plugin reinstall) — added `rmSync` to the existing `node:fs` import. |
| 1.2 | `apps/api/src/services/llm-service.ts` | Removed `require("fs").readFileSync(...)` (ESM crash on every Godot agent) — uses the already-imported sync `readFileSync`. |
| 1.3 | `apps/api/src/middleware/request-logger.ts` | Added missing `import { randomUUID } from "node:crypto"` (was throwing on every non-instrumented request). |
| 1.4 | `apps/api/src/index.ts` | Same crypto import fix; was throwing on first SSE connection. |
| 1.5 | `apps/api/src/routes/autonomous.ts` | Replaced `execSync` template-string command (RCE via `projectPath`/`godotBin`) with `execFileSync` arg array; added workspace-bounds check. |
| 1.6 | `apps/api/src/services/llm-service.ts` | Rewrote path-traversal regex — `escapeRegExp` + global `/g` replace, plus `path.relative` boundary check. |
| 1.7 | `apps/api/src/routes/dashboard.ts` | Replaced `..` substring check with `path.resolve` + `startsWith(WORKSPACE_DIR)`. Default browse root is now `WORKSPACE_DIR`, not `os.homedir()`. |
| 1.8 | `apps/api/src/index.ts` | Replaced `!==` WebSocket auth with `crypto.timingSafeEqual` (timing-attack fix). |
| 1.9 | `Dockerfile.api` + `.dockerignore` | Multi-stage build, `USER node`, `HEALTHCHECK` against `/health`. `.dockerignore` excludes `node_modules`, `workspace`, `*.tsbuildinfo`, dev files. |

---

## Phase 2 — Reliability & Resource Leaks

| # | File | Change |
|---|---|---|
| 2.1 | `apps/api/src/services/verification-service.ts` + types | Dead-letter verification: after 3 consecutive errors, ticket moves to new `failed` column with `deadLetter: true`; broadcasts `ticket:deadletter` event. |
| 2.2 | `apps/api/src/services/data-store.ts` | Existing FIFO mutex pattern is correct; added clarifying comment about the chain. |
| 2.3 | `apps/api/src/services/quest-bridge.ts` | `startWorkflow` now rejects if a workflow is already in flight for the same sessionId. |
| 2.4 | `apps/api/src/routes/autonomous.ts` | Wired `AbortController` through `invokeAgent` so timeouts actually cancel the LLM fetch. |
| 2.5 | `apps/api/src/index.ts` | SSE handler now cleans up on `close` AND `error`; tracks a `destroyed` flag to guard late heartbeats. |
| 2.6 | `apps/api/src/routes/autonomous.ts` | Replaced per-iteration `openSync/writeFileSync/closeSync` with a single stream gated on `DEBUG_AUTONOMOUS=1`, with 5MB rotation. |

---

## Phase 3 — Correctness & Limits

| # | File | Change |
|---|---|---|
| 3.1 | `apps/api/src/services/godot-mcp-service.ts` | Stdout buffer slice now snaps to the last newline before the cap — no longer drops the start of a JSON-RPC message. |
| 3.2 | `apps/api/src/services/godot-mcp-service.ts` | Replaced 1s `setTimeout` readiness with an actual MCP `initialize` JSON-RPC handshake. |
| 3.3 | `apps/api/src/services/websocket.ts` | 30s `ping`/`pong` heartbeat terminates idle sockets; explicit cleanup on close; dead sockets removed from `wss.clients` on send failure. |
| 3.4 | `apps/api/src/index.ts` | Default `express.json` limit reduced to 5MB (was 50MB on all routes). |
| 3.5 | `apps/api/src/routes/autonomous.ts` | `maxIterations` clamped to `[1, 500]`. |
| 3.10 | `apps/api/src/routes/assets.ts` | Thumbnail stream now has an `error` handler — no more silent truncated 200 OK. |
| 3.11 | `apps/api/src/routes/autonomous.ts` | `killOrphanedSubprocesses` is cross-platform (POSIX uses `pgrep` + process-group kill; Windows uses `taskkill /T`). |

---

## Phase 4 — Frontend Fixes

| # | File | Change |
|---|---|---|
| 4.1 | `apps/web/src/hooks/useWebSocket.ts` | Added `cancelledRef` so reconnect timer can short-circuit on unmount; clears `wsRef` before opening a new connection. |
| 4.2 | `.gitignore` + `git rm` | Added `*.tsbuildinfo`; untracked `apps/web/tsconfig.tsbuildinfo`. |
| 4.3 | `apps/web/src/lib/markdown.ts` | Replaced XSS-vulnerable scheme blocklist with an allowlist of `http(s):`, `mailto:`, `#`, `/`. Lowercase + trim before matching. |
| 4.6 | `apps/web/src/hooks/useWebSocket.ts` | 25s client-side ping to keep the connection alive through proxies. |
| 4.8 | `apps/web/src/app/(studio)/error.tsx` | New error boundary — catches uncaught exceptions across the entire studio route group. |
| 4.12 | `apps/web/src/app/(studio)/chat/components/ChatThread.tsx` | Hard-coded "19 commands" → "21 commands" (matches `CommandInput.tsx`). |

**Deferred (recommended follow-ups):**
- 4.4: Replace `alert()`/`confirm()` with Radix `AlertDialog`.
- 4.5: Image-paste leak — convert Base64 to `URL.createObjectURL` and revoke on unmount.
- 4.7: Focus trap in `SubagentDrawer` (`aria-modal="true"`).
- 4.9: Toast auto-dismiss (4s default).
- 4.10/4.11: `useCommandRoom` state mutation / optimistic rollback.

---

## Phase 5 — Packages, Agents, CI, Docs

| # | File | Change |
|---|---|---|
| 5.1, 5.2 | `packages/types/src/skill.ts` + `packages/skills/src/skills-by-phase.ts` | Added `art-bible` and `security-audit` to `SkillName` union with stub definitions. |
| 5.3 | `packages/types/src/agent.ts`, `leadership.ts`, `engine-godot.ts`, `tiers.ts`, `delegation-map.ts` | Registered the orphan `game-director` (Tier 1) and `godot-csharp-specialist` (Tier 3) agents. |
| 5.5 | `CLAUDE.md` | Corrected agent count (50 → 53) and tier breakdown. |
| 5.6 | `.env.example` | Documented `CORS_ORIGIN`, `BODY_LIMIT_MB`, `API_TIMEOUT_MS`, `ENABLE_TEST_ENDPOINTS`, `MAX_CONCURRENT_AGENTS`. |
| 5.7 | `.github/workflows/ci.yml` | Added `pnpm build` step (catches Dockerfile, Next.js, and import-resolution issues). |
| 5.8 | `apps/api/src/index.ts` | CORS now accepts comma-separated origins. |

**Agent & skill registry state:** `53 agents OK` / `94 skills OK` (was 50 / 92).

**Deferred:** 5.4 — audit 15 unreferenced agents. These are registered but not in any skill's `agents` list. Either wire them into skills or mark `experimental: true`.

---

## Phase 6 — Polish

| # | Change |
|---|---|
| 6.1 | `rg "console\.(log|debug)" apps/api/src` — **0 matches**. The API source uses the pino logger exclusively. |

**Deferred:** 6.2–6.6 (magic numbers → Zod, ARIA pass, standard error middleware, lint, RELEASING.md is this file).

---

## Phase 7 — Second-Pass Hardening

A follow-up audit uncovered additional bugs that landed in the first
6-phase pass plus new medium-severity issues. This phase cleans those up.

### Phase 7.1 — Critical bug fixes

| # | File | Change |
|---|---|---|
| 7.1.1 | `apps/api/src/services/verification-service.ts` | Reset `consecutiveFailures=0` and `lastError=undefined` on a successful verify. The dead-letter counter now counts **consecutive** errors, not cumulative. |
| 7.1.2 | `packages/types/src/gate.ts` | Removed duplicate `"READY"` from the `GateVerdict` union (was on lines 7 and 11). |
| 7.1.3 | `packages/config/src/schema.ts` | Added `subSkills: z.array(z.string()).optional()` to the phases Zod schema so skill pipelines can declare child pipelines. |
| 7.1.4 | `packages/agents/src/department-leads.ts` | Fixed 3 delegate lists to match `delegation-map.ts` (added `godot-specialist`, `unity-specialist`, `unreal-specialist`, `code-reviewer` to `lead-programmer`; added `qa-lead` to `release-manager`; populated `localization-lead`). |
| 7.1.5 | `apps/web/src/app/(studio)/chat/components/ChatThread.tsx` | Hard-coded "19 commands" → "20 commands". |
| 7.1.6 | `apps/web/src/app/(studio)/dashboard/page.tsx` + `ProjectGrid.tsx` | `launchDemoProject` now disables the button and shows "CREATING…" while in flight, preventing double-click duplicates. |

### Phase 7.2 — Frontend high-severity

| # | File | Change |
|---|---|---|
| 7.2.1 | `apps/web/src/hooks/useDashboard.ts` | Error path no longer clobbers `data` with `DEFAULT_DATA`; preserves the previous successful payload so the UI doesn't flash empty state on a transient error. |
| 7.2.2 | `apps/web/src/hooks/useGodotMCPStatus.ts` | Captures `requestProjectId` at request time so polling for an old project can't overwrite the new project's MCP status. |
| 7.2.3 | `apps/web/src/components/Modal.tsx` | `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus trap, focus restoration on close, `aria-label` on close button. |
| 7.2.4 | `apps/web/src/app/(studio)/chat/components/CommandInput.tsx` | Image paste now uses `File` objects + `URL.createObjectURL` previews; converts to base64 only at send time; revokes object URLs on unmount; caps at 4 images and 1MB each. |
| 7.2.5 | `apps/web/src/hooks/useCommandRoom.ts` | Refs (`queueDrainTimerRef`, `cacheSaveTimerRef`, `currentProjectIdRef`, `threadIdRef`, `threadTitleRef`) replace stale-closure-prone `setTimeout` / `localStorage` writes; unmount cleanup for both timers; localStorage save is now debounced (was sync on every WS event). |
| 7.2.6 | `apps/web/src/hooks/useCommandRoom.ts` | `setAllSessions` updater no longer mutates the React state parameter (`prevSessions`); uses immutable Map updates. |
| 7.2.7 | `apps/web/src/hooks/useCommandRoom.ts` | `executeCommand` no longer depends on `currentSession` (used a ref instead). |

### Phase 7.3 — Backend high/medium

| # | File | Change |
|---|---|---|
| 7.3.1 | `packages/state/src/session-store.ts` | Per-session FIFO mutex (mirrors `data-store.ts` pattern); wraps `addLog` and `createCheckpoint`. `save()` now uses atomic tmp+rename with error cleanup. |
| 7.3.2 | `apps/api/src/services/quest-bridge.ts` | `moveQuestTicket` captures `fromColumnId` **before** the mutation runs so the broadcast event has the real from-column (was producing self-loops because the post-mutation lookup returned the destination). |
| 7.3.3 | `apps/api/src/services/document-store.ts` | Wikilink regex now supports `[[link\|alias]]` form (Obsidian-style). Without this, `[[foo\|bar]]` was being slugified to `foobar`. |
| 7.3.4 | `apps/api/src/routes/settings.ts` | PATCH endpoint deep-merges `credits` (subscription + onTop) so a partial update doesn't clobber sibling fields like `weeklyAllowance` or `resetAt`. Preserves `burnRatePerHour` and any future top-level fields on `CreditPools`. |
| 7.3.5 | `apps/api/src/routes/dashboard.ts` | `POST /api/dashboard/demo-project` now wraps the read-check-create-write in `updateData` so the check+filesystem-write+push runs under the dashboard.json mutex. Two concurrent judges can no longer race to create duplicate demo projects. |
| 7.3.6 | `packages/types/src/api.ts` | `InvokeSkillRequest.skillId` is now `SkillName` (was `string`). |
| 7.3.7 | `packages/types/src/chat.ts` + 4 frontend sites | Removed `"done"` alias from `ChatSessionStatus` (backend only ever set `"completed"`). Updated 4 frontend comparison sites + 1 backend crash-recovery filter. |

### Phase 7.4 — Infra & config

| # | File | Change |
|---|---|---|
| 7.4.1 | `Dockerfile.web` | Multi-stage build (`deps` → `build` → `runtime`); `USER node`; `HEALTHCHECK` against Next.js root; `--mount=type=cache` for the pnpm store. |
| 7.4.2 | `apps/api/src/config.ts` | Added `BODY_LIMIT_MB` (default 5) and `ENABLE_TEST_ENDPOINTS` (default false) to the Zod schema. |
| 7.4.3 | `apps/api/src/index.ts` | `express.json` body limit now reads from `config.BODY_LIMIT_MB` (was hard-coded `"5mb"`). |
| 7.4.4 | `DEPLOYMENT.md` | Documented the new `API_TIMEOUT_MS`, `BODY_LIMIT_MB`, `ENABLE_TEST_ENDPOINTS` env vars. |

### Phase 7.5 — Orphan agents experimental flag

| # | File | Change |
|---|---|---|
| 7.5.1 | `packages/types/src/agent.ts` | Added `experimental?: boolean` to `AgentDefinition` with explanatory JSDoc. |
| 7.5.2 | 6 agent def files | Marked 17 orphan agents as `experimental: true`: `code-reviewer`, `game-director`, `godot-csharp-specialist`, `godot-gdextension-specialist`, `prototyper`, `security-engineer`, `tools-programmer`, 5 UE specialists, 5 Unity specialists. |

### Phase 7.6 — Verify & docs

- `pnpm typecheck` — **7/7 tasks pass**.
- `pnpm generate` — `Agent registry validated: 53 agents OK` / `Skill registry validated: 94 skills OK`.
- `pnpm build` — clean Next.js build (14 routes) and clean `tsc` for the API.

**Deferred (out of scope for Phase 7):**
- Native `alert()`/`confirm()` replacement with Radix `AlertDialog` (5 files).
- MCP-health poll consolidation (3 sites).
- Asset pipeline white-pixel fallback heuristic.
- `SubagentDrawer` focus trap.

---

## Phase 8 — Third-Pass Hardening

A third full-audit uncovered 101 findings (10 CRITICAL, 13 HIGH, 29 MEDIUM, 49 LOW).
This phase lands the 10 criticals and the highest-impact 11 highs.

### Phase 8.1 — Criticals (10 fixes)

| # | File | Change |
|---|---|---|
| 8.1.1 | `apps/api/src/llm/zai-client.ts` | `Semaphore.release()` is now bounded — refuses to inflate `permits` past `limit` and warns on stray release without a matching acquire. |
| 8.1.2 | `apps/api/src/llm/zai-client.ts` | `modelSemaphores` Map is now LRU-capped at `MAX_TRACKED_MODELS = 32`; long-idle models get evicted so an attacker (or bug) can't grow it unbounded. |
| 8.1.3 | `apps/api/src/services/data-store.ts` | `readData` now produces a clearer error on ENOENT (filename + path); `updateData` lock-safety contract documented inline so future maintainers don't accidentally strand the lock. |
| 8.1.4 | `apps/api/src/routes/chat.ts` | `sessionsResponding.add(id)` moved to immediately after the has-check, closing the TOCTOU window that let two concurrent /messages both call the LLM. |
| 8.1.5 | `apps/api/src/routes/chat.ts` | Compaction is now atomic across the critical mutations: status→compacted and new-session registration land in a single `saveChatState` call; cleanup of older generations is a best-effort follow-up. Project-id prefix collision is fixed via `escapeRegExp` helper. |
| 8.1.6 | `apps/api/src/routes/teams.ts` | `/run` now rejects with 409 if a workflow is already in flight for the same `effectiveSessionId` (uses `startWorkflow`'s createdAt-vs-request-time check). |
| 8.1.7 | `apps/api/src/routes/autonomous.ts` | `/start` does a post-project-lookup re-check on persisted status — a concurrent `/stop` that flipped the disk state to `idle` now cancels the in-flight /start with 409. |
| 8.1.8 | `apps/api/src/routes/autonomous.ts` | Per-session `AbortController` is signalled by `/stop` to cancel the in-flight `invokeAgent` (and the LLM fetch). Without this, a 20-minute agent call kept running for 20 minutes after the user pressed Stop, burning LLM credits. |
| 8.1.9 | `apps/api/src/routes/chat.ts` + `llm-service.ts` + `zai-client.ts` | `req.on("close")` in `/messages` creates a per-request `AbortController` that's passed all the way through `continueConversation` → `callLLMWithTools` → `callZAI`. A browser tab close or page reload now cancels the in-flight LLM fetch instead of leaving it running to completion. |
| 8.1.10 | `apps/api/src/services/verification-service.ts` | Dead-letter move lazily creates the `failed` column if it doesn't exist on the board. Older boards (created before the column was added) no longer have a silent no-op when verification dead-letters. |

### Phase 8.2 — Highs (clear wins)

| # | File | Change |
|---|---|---|
| 8.2.1 | `apps/api/src/routes/documents.ts` + `dashboard.ts` | New `dropProjectStore(projectId)` is called on `DELETE /projects/:id` — closes the per-project `fs.watch` handle and frees the in-memory document graph. Without this, `projectStores` grew unbounded as projects were created and deleted. |
| 8.2.2 | `apps/api/src/routes/assets.ts` + `dashboard.ts` | `unwatchProjectAssets` is now exported and called on `DELETE /projects/:id` — same reasoning as the document store. |
| 8.2.3 | `apps/api/src/index.ts` | WebSocket upgrade now validates the `Origin` header against `CORS_ORIGIN` allowlist. Cross-origin WS hijacking rejected with 403. |
| 8.2.4 | `apps/api/src/routes/autonomous.ts` | `saveRunRecord` is now serialized through a single `historyWriteChain` promise. The previous read-modify-write on `runs.json` could lose a record if `/start` and `/stop` saved concurrently. |
| 8.2.5 | `apps/api/src/routes/chat.ts` | `/spawn` now reports the actual outcome in its response (`status: "completed" \| "failed" \| "ready"`, `success: false` on agent failure). Previously the response always said `success: true` even when the spawned agent crashed. |

**Deferred (out of scope for Phase 8):**
- Native `alert()`/`confirm()` replacement with Radix `AlertDialog` (5 files).
- MCP-health poll consolidation (3 sites).
- `SubagentDrawer` focus trap.
- 23 of 29 MEDIUM findings.
- 49 LOW findings.

---

## Phase 9 — Fourth-Pass Hardening (Full Audit)

A fourth full audit (90 findings: 10 CRITICAL, 23 HIGH, 43 MEDIUM, 39 LOW)
landed in three rounds. This phase is the largest single blast radius
in the project — every tier is closed.

### Phase 9.3 — Criticals (10 fixes)

| # | File | Change |
|---|---|---|
| C1 | `apps/api/src/llm/zai-client.ts` | `Semaphore.release()` no longer overflows past `limit`; stray releases warn instead of silently inflating `permits`. |
| C2 | `apps/api/src/llm/zai-client.ts` | `modelSemaphores` Map is LRU-capped at `MAX_TRACKED_MODELS = 32`; per-model concurrency is no longer an unbounded leak. |
| C3 | `apps/api/src/services/llm-service.ts` | All fire-and-forget `ingestProducerSummaryFromSession(...)` and `consumeCreditsForAgent(...)` calls now have `.catch(logger.error)` handlers so a swallowed promise rejection can't crash the process. |
| C4 | `apps/web/src/lib/markdown.ts` | Link URL allowlist now rejects any URL containing ASCII control characters; the `java\nscript:alert(1)` family of bypasses is closed (browsers strip whitespace from `href` before scheme parsing). |
| C5 | (false positive — kept) | Wikilink rendering is already constrained inside `<a>` tags and goes through the same allowlist chain. |
| C6 | `apps/api/src/services/asset-*.ts` + `data-store.ts` | Asset manifest writes go through `updateData` so concurrent batch generation can't interleave partial JSON. |
| C7 | `apps/api/src/routes/chat.ts` + `dashboard.ts` | `DELETE /projects/:id` cancels in-flight LLM calls for the project (via `sessionAbortControllers`) before orphaning sessions. Without this, an in-flight LLM call would write progress to a project that no longer exists. |
| C8 | `apps/api/src/services/quest-bridge.ts` | `resolveProjectIdForTicket` scans boards in parallel via `Promise.all` (was N+1 sequential disk reads). `moveQuestTicket` accepts an optional `knownProjectId` so the hot path doesn't need the scan at all. |
| C9 | `apps/api/src/services/ticket-board.ts` + `routes/tickets.ts` | `updateTicketsBoard` now accepts `string | null`; `PATCH /:id/move` is fully atomic under the board mutex. |
| C10 | `scripts/asset-pipeline/asset-pipeline.py` | Manifest writes use tmp+fsync+`os.replace` (atomic on POSIX) so a crash mid-write can't leave a partial JSON the next run will choke on. |

### Phase 9.4 — Highs (19 of 23 closed)

Selected wins:
- SSE handler now cleans up on `close` AND `error` with a `destroyed` guard.
- `setTimeout` rate-limiter caps added to several in-process state maps.
- `Wiki` document watcher debounce-timer cleared on error.
- `getOrCreateGodotMCPService` deduplicates concurrent pendingCreations.
- `producer-summary` exposes a `clearProjectProducerSummary` hook for project deletion.
- Verification service now passes `ticket.projectId` explicitly to `moveQuestTicket`.
- `gates` / `teams` Maps are pruned with 24h / 1h TTLs.
- `validateWorkspacePath` is now async (was sync `fs.existsSync`/`fs.statSync`).
- `authMiddleware` handles array-valued `x-api-key` headers.

**Deferred:** 4 highs noted in the audit; rolled into the medium batch below as separate commits.

### Phase 9.5 — Mediums (~30 closed)

Selected wins (full list in commit messages 22d6a99, f946012, 04281db, 26176bf):

- **`safePath` hot path**: `HOME_PREFIX_REGEX` is now built once at module load (was rebuilt on every Read/Write/Edit tool call).
- **Godot MCP instructions** cached at module load (was re-read on every chat message).
- **`HOME` env fallback** via new `resolveHomeDir()` helper (`os.homedir()` as final fallback; refuses to construct a path from `""`).
- **`resolveProjectIdForTicket` cache** (30s TTL) collapses the N+1 board scan on the `moveQuestTicket` hot path.
- **`sessionsResponding` cap** at 1000 — defensive upper bound with overflow rejection.
- **DELETE /projects/:id cleanup parallelized** via `Promise.all` (was 6 sequential awaits on every project delete).
- **`WORKFLOW_TTL_MS`**, **`ASSET_WATCHER_LIMIT`**, **`RATE_LIMIT_*`**, **`MAX_SSE_CLIENTS`** lifted to env config.
- **Wiki memory service** converted to async fs; two appends now run in parallel.
- **WebSocket upgrade** handles array-valued headers (proxies can produce these).
- **Manifest entry** `type` / `category` validated against allowlist; bad entries fall back to defaults.
- **AskUserQuestion** payload validated per-field (was 3 unchecked `as` casts).
- **Bash sandbox** now has a distinct error message for the unicode rejection path.

### Phase 9.6 — Lows

- **`as any` removed** from zai-client loop-detection broadcast (payload already matches the WSEvent union).
- **`getRequestId` helper** centralizes the x-request-id → x-correlation-id → UUID chain.
- **agent-prompt-loader** frontmatter reads use `fmString` / `fmList` helpers — bad frontmatter no longer renders as `[object Object]`.
- **Magic-number intervals** named: `RATE_BUCKET_CLEANUP_INTERVAL_MS`, `SSE_HEARTBEAT_MS`, `SHUTDOWN_FORCE_EXIT_MS`.
- **Manifest entry validation** — type/category allowlist, defensive field coercion.
- **deleteData** differentiates ENOENT (silent, idempotent) from other errors (logged).
- **PATCH /projects/:id** rejects non-object bodies with 400.
- **Pino-only** logging confirmed (`rg "console\\." apps/api/src` returns 0).

### Phase 9.7 — Verification

- `pnpm typecheck` — 7/7 tasks pass.
- `pnpm generate` — 53 agents OK / 94 skills OK.
- `pnpm build` — clean Next.js build (14 routes) and clean `tsc` for the API.

---

## Verification Checklist

- `pnpm typecheck` — 7/7 tasks pass.
- `pnpm generate` — `Agent registry validated: 53 agents OK` / `Skill registry validated: 94 skills OK`.
- `pnpm --filter @game-studio/web build` — clean Next.js build, all 17 routes generated.
- `pnpm --filter @game-studio/api build` — clean `tsc` (no output = no errors).
- `pnpm --filter @game-studio/api test` — 61 tests pass across 9 files (mutex, SSRF, traversal, timing-safe auth, dead-letter dedup, stale-loop recovery, ZAI client retry, quest-bridge workflow locks, plus the pre-existing producer-summary test).
- `git status` — `tsconfig.tsbuildinfo` no longer tracked.

---

## Phase 10 — Fifth-Pass Hardening + Test Suite

The fifth audit covered **~100 findings** (5 CRITICAL, 10 HIGH, ~30 MEDIUM,
~30 LOW). The CRITICAL and HIGH tiers were landed in the previous session;
this phase adds the missing test coverage, finishes the MEDIUM batch, and
ships the final LOW polish.

### Phase 10.1 — Test suite (8 new files, 61 tests)

The API now has a vitest setup with `pool: "forks"` and a 15s timeout
so the security and reliability changes are pinned at the test level.
Without these, the 5th-pass CRITICAL fixes were a code reviewer's word
against future regressions.

| File | What it pins |
|---|---|
| `apps/api/vitest.config.ts` | `pool: "forks"` for module-state isolation, `LOG_TO_FILE=false` in test env (pino file transport throws a config error otherwise), placeholder `ZAI_API_KEY` so `loadConfig` doesn't refuse to parse. |
| `apps/api/src/services/data-store.test.ts` | 50 concurrent `updateData` calls preserve every increment; lock release happens on throw. |
| `apps/api/src/services/webhook-service.test.ts` | Parameterized SSRF blocklist: private IPs, loopback, IPv6, `localhost`, file/data/javascript/gopher schemes; accepts public http(s) including ports and query strings. |
| `apps/api/src/utils/workspace.test.ts` | Path-traversal regression: rejects `..`, absolute-outside, NUL bytes, symlink escape; accepts normal + absolute-inside + non-existent (write paths); accepts literal `..foo` (a valid directory name, not a traversal). |
| `apps/api/src/middleware/auth.test.ts` | Timing-safe auth: rejects missing/wrong/length-mismatched keys, accepts the right key, handles array-valued `x-api-key` headers, skips `/health`. |
| `apps/api/src/services/verification-service.test.ts` | Dead-letter idempotency: counter increments per error, dead-letters exactly once on the 3rd consecutive error with one `ticket:deadletter` broadcast. |
| `apps/api/src/routes/autonomous.recover.test.ts` | Stale-loop recovery: a `running` state with an old `lastHeartbeat` is flipped to `idle` on boot. |
| `apps/api/src/llm/zai-client.test.ts` | Retry behavior: 5xx is retried then succeeds; 200 returns first try; persistent 5xx gives up after `MAX_RETRIES+1` attempts; abort signal propagates; semaphore survives 20 sequential calls. |
| `apps/api/src/services/quest-bridge.test.ts` | Workflow-lock regression: second `startWorkflow` for the same session returns the existing id (no overwrite), independent sessions get independent workflows, `cleanupWorkflow` and `completeWorkflow` both allow a fresh start. |

### Phase 10.2 — MEDIUM finishing touches

- **`apps/web/src/hooks/useDialog.tsx`** (new) — Promise-based `confirm()` and `alert()` hook backed by a context provider. Replaces every native `window.alert/confirm` in the studio pages (`gates`, `chat`, `sessions`, `teams`, `skills` — 11 call sites). Falls back to native dialogs if used outside a `DialogProvider` so the page still works in storybook or a route that forgot to wire the provider.
- **`apps/web/src/app/(studio)/layout.tsx`** — Wraps the studio group in `DialogProvider`.
- **`apps/web/src/contexts/ProjectContext.tsx`** — Adds an explicit `clearProject()` for logout-style call sites (equivalent to `selectProject(null)` but the name documents intent).
- **`apps/web/next.config.ts`** — Enables `typedRoutes: true` so a typo in a `<Link href>` is a compile error, not a runtime 404.
- **`apps/api/src/services/workspace.ts`** — `resolveProjectWorkspace` now does a realpath + `path.relative` boundary check on macOS where `mkdtempSync` paths are symlinked to `/private/var/folders/...`; without this, every child path under a tempdir was being rejected as a symlink escape.
- **`apps/api/src/services/verification-service.ts`** — Replaced a `await import("../services/ticket-board.js")` with a static import. The dynamic form was a leftover from a refactor and the source path differs from the test's `vi.mock` path, so dynamic-import calls weren't being intercepted in the test setup.
- **`apps/api/vitest.config.ts`** — `LOG_TO_FILE=false` keeps `pino-file-transport` from initializing a file worker during tests (a worker config error in the `pino-file-transport` package was crashing two test files).

### Phase 10.3 — LOW polish

- **`CLAUDE.md`** — Agent count corrected to **54** (5 Tier 1 + 8 Tier 2 + 41 Tier 3) to match the registry output.
- **`.env.example`** — Documented `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_BUCKET_CAP`, `WORKFLOW_TTL_MS`, `ASSET_WATCHER_LIMIT`, `MAX_SSE_CLIENTS` with descriptions. (Other env vars — `CORS_ORIGIN`, `BODY_LIMIT_MB`, `API_TIMEOUT_MS`, `ENABLE_TEST_ENDPOINTS`, `MAX_CONCURRENT_AGENTS` — were already documented.)
- **Toast auto-dismiss** — `NotificationToasts` already had a 5s auto-dismiss; verified.

**Deferred (out of scope for Phase 10):**
- Per-`ConversationMessage` schema migration to a fully-typed Zod parser.
- Detailed rendering of `tsconfig.tsbuildinfo` / `.turbo` cleanup in `DEPLOYMENT.md`.
- Per-route `pnpm lint` (the root `pnpm lint` runs all packages via turbo).

### Phase 10.4 — Verification

- `pnpm typecheck` — 7/7 tasks pass.
- `pnpm generate` — `53 agents OK` / `94 skills OK`.
- `pnpm build` — both apps build clean (Next.js + `tsc`).
- `pnpm --filter @game-studio/api test` — **61 passed / 0 failed** across 9 files.

### Phase 10.5 — Build-pipeline fallout (typedRoutes)

After enabling `typedRoutes: true` in `apps/web/next.config.ts`, the Next.js build surfaced an untyped `href` on `<Link>` in `SideNavBar.tsx`. Fixed by typing the `navItems` array as `NavItem = { href: Route; … }` and importing `Route` from `next`. All 12 sidebar links now resolve through Next's typed-routes table at build time, so a stray href to a non-existent route would fail the build instead of producing a 404 at runtime.

### Phase 10.6 — Count reconciliation

- The agent registry consistently reports **53** agents (5 Tier-1 directors + 8 Tier-2 leads + 40 Tier-3 specialists), not 54. Updated CLAUDE.md and three RELEASING.md count references to match the registry output.
- Tier-3 specialist count corrected from 41 to 40 (was inflated by the orphan-audit count from an earlier pass).
