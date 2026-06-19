# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

**Game Studio Control Plane** — an AI-native multi-agent game production platform. A single Producer orchestrates a 54-agent studio (directors, leads, specialists) with skills, director gates, Kanban quest tracking, autonomous production loops, deep research, asset generation, and release pipelines. Output is real game content in `workspace/` (Godot projects, GDD markdown, generated assets, builds).

## Development Commands

### Setup

```bash
cp .env.example .env
pnpm install
pnpm generate          # validate 54 agents + 94 skills
pnpm typecheck
```

### Dev servers

```bash
# API → http://localhost:3001
pnpm --filter @game-studio/api dev

# Web → http://localhost:3000  (separate terminal)
pnpm --filter @game-studio/web dev
```

### Build / lint / test

```bash
pnpm build             # turbo build pipeline (Next.js + API)
pnpm typecheck         # tsc --noEmit across all packages
pnpm lint              # turbo lint
pnpm test              # vitest in API, no-op in web
pnpm test:e2e          # Playwright suite (apps/web/e2e/)
```

### Running a single test

```bash
# API unit test
pnpm --filter @game-studio/api exec vitest run src/routes/autonomous.recover.test.ts

# E2E spec
pnpm --filter @game-studio/web test:e2e -- e2e/chat.spec.ts
```

### Registry validation

```bash
pnpm generate:agents   # validate packages/agents/src/
pnpm generate:skills   # validate packages/skills/src/
pnpm generate          # both
```

### Asset generation (direct CLI)

```bash
python3 scripts/asset-pipeline/asset-pipeline.py \
  --prompt "health potion" --name "health-potion" \
  --type 2d --category ui --width 512 --height 512 \
  --output-dir workspace/<project>/assets \
  --workspace-dir workspace/<project>
```

## LLM Provider Setup

The API is Anthropic-compatible. Set **at least one** provider key:

| Provider | Env vars | Tier mapping |
|---|---|---|
| **Z.ai (default)** | `ZAI_API_KEY`, `ZAI_BASE_URL` | opus→`glm-5.1`, sonnet→`glm-4.7`, haiku→`glm-4.7-flash` |
| **Kimi (optional)** | `KIMI_API_KEY`, `KIMI_BASE_URL` | opus→`kimi-for-coding`, sonnet→`kimi-k2.6`, haiku→`kimi-k2-turbo-preview` |
| **MiroMind (deep research)** | `MIROMIND_API_KEY`, `MIROMIND_BASE_URL`, `MIROMIND_MODEL` | Pre-GDD multi-turn research; auto-runs at autonomous loop start |

When `KIMI_API_KEY` is present, `getModelForTier()` in `apps/api/src/config/model-mapping.ts` switches to Kimi automatically. Also set `API_SECRET` and `NEXT_PUBLIC_API_KEY` (same value, ≥16 chars).

## High-Level Architecture

### Monorepo layout

- `apps/api` — Express control plane: LLM tool loop, agent orchestration, autonomous routes, gates, quests, assets, chat, WebSocket/SSE.
- `apps/web` — Next.js 15 App Router + Tailwind CSS v4. All studio pages live under `src/app/(studio)/`.
- `packages/types` — Shared TypeScript interfaces (source of truth).
- `packages/agents` — 54 agent definitions across a 3-tier hierarchy.
- `packages/skills` — 94 skill definitions, including 12 team workflows and 13 Godot production skills.
- `packages/config` — Zod schemas and GDD/ADR templates.
- `packages/state` — File-based session persistence utilities.

### Agent tier model mapping

Model selection is centralized in `apps/api/src/config/model-mapping.ts`:

| Tier | Role | Z.ai | Kimi |
|---|---|---|---|
| `opus` | Directors / Producer | `glm-5.1` | `kimi-for-coding` |
| `sonnet` | Leads / Specialists | `glm-4.7` | `kimi-k2.6` |
| `haiku` | Fast / summarization | `glm-4.7-flash` | `kimi-k2-turbo-preview` |

Agent system prompts are loaded dynamically from `workspace/.claude/agents/*.md`.

### Core data flow

1. User sends a prompt in the Producer chat (`apps/web/src/hooks/useCommandRoom.ts`).
2. `apps/api/src/services/llm-service.ts` calls `callLLMWithTools()` in `apps/api/src/llm/zai-client.ts`.
3. The LLM invokes tools (`Read`, `Write`, `Edit`, `Bash`, `Task`, `GenerateAsset`, `StartConsultation`, plus Godot MCP tools when relevant).
4. `Task` spawns are intercepted by `apps/api/src/services/quest-bridge.ts` to create Kanban tickets.
5. Backend broadcasts WebSocket events (`packages/types/src/api.ts` defines `WSEvent`).
6. Frontend `useWebSocket` (`apps/web/src/lib/api.ts`) receives events and updates UI.
7. Session state is persisted to `workspace/production/session-state/*.json`; chat state to `chat-state.json`.

### Subagent model

Subagents spawned via the `Task` tool are tracked **separately** from regular chat sessions:

- Backend emits `subagent:spawned`, `subagent:completed`, `subagent:failed` events (`apps/api/src/services/llm-service.ts`).
- Frontend maintains a `subagents` Map in `useCommandRoom.ts` and renders subagents in `AgentTree.tsx`, `InFlightWorkPanel.tsx`, and `SubagentDrawer.tsx`.
- Tickets move `Available → Processing → Verify → Auto-Verified → Completed`; `apps/api/src/services/verification-service.ts` auto-verifies output in the Verify column.

### Autonomous production loop

`autonomous-producer` (tier 1) runs a milestone loop in `apps/api/src/routes/autonomous.ts`:

```
concept → deep research (optional) → GDD ingest → ticket generation
  → Godot scaffolding / implementation → automated playtest → export
```

Key helpers: `apps/api/src/services/gdd-ingest-service.ts`, `apps/api/src/services/ticket-generator.ts`, `apps/api/src/services/build-service.ts`.

### Context management

Long sessions are managed in `apps/api/src/routes/chat.ts` and `apps/api/src/llm/zai-client.ts`:

- Summarize old messages when context exceeds **100k tokens**.
- Prune to the last **30 messages** when context exceeds **125k tokens** or **80 messages**.
- **Session compaction** at >90% usage: summarize, create a new generation session, archive the old one, switch the UI tab.
- Default context windows: `glm-5.1`/`glm-4.7` = 200k tokens; `glm-4.7-flash` = 128k tokens.

### Godot MCP Pro integration

When `project.engine === "godot"`, the LLM receives Godot MCP tools:

- `apps/api/src/services/godot-mcp-service.ts` manages the `godot-mcp-pro` server lifecycle and stdio JSON-RPC client.
- Service is keyed by `projectId`; plugin is auto-installed into the Godot project.
- Frontend status is polled via `apps/web/src/hooks/useGodotMCPStatus.ts`.

### Asset generation pipeline

`scripts/asset-pipeline/asset-pipeline.py` runs a 7-step pipeline:

```
mflux (FLUX.2-klein-4b) → rembg → alpha-trim → grid-pad → sprite-sheet slice → thumbnail → Godot .import
```

Output goes to `workspace/<project>/assets/` (`raw/`, `processed/`, `ui/`, `character/`, `prop/`, `weapon/`, `tex/`, `thumbnails/`, `asset-manifest.json`). The Python binary is controlled by `PIPELINE_PYTHON` (default `/usr/local/bin/python3`).

### Important Godot constraints

- Godot `--script` mode does **not** initialize autoloads — use a boot command (`--quit`) for validation.
- Avoid `class_name` on autoload scripts; it causes “hides autoload singleton” fatal errors.
- TileMap rectangles must use `tilemap_fill_rect`, not individual `tilemap_set_cell` calls.
- UIDs are **not** computed from path — read them from `.import` files or `uid_cache.bin`.

## Key Files

| File | Purpose |
|---|---|
| `apps/api/src/llm/zai-client.ts` | LLM client with tool loop, retries, message pruning |
| `apps/api/src/services/llm-service.ts` | Agent orchestration, tool routing, subagent lifecycle |
| `apps/api/src/routes/autonomous.ts` | Autonomous production loop |
| `apps/api/src/services/quest-bridge.ts` | Intercepts `Task` spawns to create Kanban tickets |
| `apps/api/src/services/verification-service.ts` | Auto-verifies tickets in the Verify column |
| `apps/api/src/services/godot-mcp-service.ts` | Godot MCP Pro lifecycle and tool routing |
| `apps/api/src/services/gate-service.ts` | 18 LLM-powered director gates |
| `apps/api/src/config/model-mapping.ts` | Tier → model mapping and context windows |
| `apps/api/src/config.ts` | Environment validation |
| `apps/web/src/hooks/useCommandRoom.ts` | Chat state, WebSocket events, subagents |
| `packages/types/src/api.ts` | `WSEvent` union and backend API types |
| `packages/types/src/chat.ts` | Chat message/session types |
| `packages/agents/src/tiers.ts` | Tier 1 / Tier 3 agent definitions |
| `packages/skills/src/skills-by-phase.ts` | Phase-based and Godot skills |
| `scripts/asset-pipeline/asset-pipeline.py` | Asset generation pipeline |

## Environment Variables

```bash
ZAI_API_KEY=...                 # default LLM provider
ZAI_BASE_URL=https://api.z.ai/api/anthropic
KIMI_API_KEY=...                # optional alternative provider
KIMI_BASE_URL=https://api.kimi.com/coding
MIROMIND_API_KEY=...            # optional deep research
API_SECRET=...                  # auth header (≥16 chars, also NEXT_PUBLIC_API_KEY)
API_PORT=3001
WORKSPACE_DIR=./workspace       # game dev output + agent prompts
REVIEW_MODE=lean                # solo | lean | full
DEFAULT_MODEL=glm-5.1
MAX_TOOL_CALLS=100
TOOL_CHECKPOINT_INTERVAL=30
CONTEXT_WINDOW_TOKENS=...       # optional override
PIPELINE_PYTHON=/usr/local/bin/python3
```

## CI

`.github/workflows/ci.yml` runs on `main` / `master` PRs and pushes:

```bash
pnpm install --frozen-lockfile
pnpm generate
pnpm typecheck
pnpm build
pnpm test
```

Then a separate job installs Playwright Chromium and runs `pnpm --filter @game-studio/web test:e2e` with `ENABLE_TEST_ENDPOINTS=true` and `E2E_API_KEY`.

## Notes

- This codebase uses **pnpm workspaces** and **Turborepo**. Prefer `pnpm --filter <package>` over `cd` into workspace directories.
- The `workspace/` directory is gitignored and holds per-project output; framework files under `workspace/.claude/` are loaded at runtime as agent system prompts.
- All Next.js pages are client components; there is no server-side rendering framework in use beyond Next defaults.
- The API uses file-based JSON persistence (`packages/state`, `apps/api/src/services/data-store.ts`) rather than a database; concurrent writes are protected by per-file mutexes.
