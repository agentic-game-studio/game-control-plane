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

**Agent & skill registry state:** `53 agents OK` / `94 skills OK` (was 51 / 92).

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

## Verification Checklist

- `pnpm typecheck` — 7/7 tasks pass.
- `pnpm generate` — `Agent registry validated: 53 agents OK` / `Skill registry validated: 94 skills OK`.
- `pnpm --filter @game-studio/web build` — clean Next.js build, all 17 routes generated.
- `pnpm --filter @game-studio/api build` — clean `tsc` (no output = no errors).
- `git status` — `tsconfig.tsbuildinfo` no longer tracked.
