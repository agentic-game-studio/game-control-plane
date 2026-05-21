# Game Studio Control Plane

Multi-agent game development orchestration platform. Producer acts as the Board Room orchestrator, spawning specialized agents to build games collaboratively. Per-project producer sessions with LLM context injection. Quest Bridge auto-tracks agent tasks on the Kanban board. Web UI provides real-time monitoring, interactive Q&A, and workflow pipeline visualization.

## Quick Start

```bash
# Install dependencies
pnpm install

# Verify types compile
pnpm typecheck

# Generate and validate agent/skill registries
pnpm generate

# Start backend (requires .env with ZAI_API_KEY)
pnpm --filter @game-studio/api dev

# Start frontend (separate terminal)
pnpm --filter @game-studio/web dev
```

## Project Structure

```
game-control-plane/
├── apps/
│   ├── api/              # Backend: Express + WebSocket + SSE
│   └── web/              # Frontend: Next.js 15 (App Router)
├── packages/
│   ├── types/            # Shared TypeScript interfaces (source of truth)
│   ├── agents/           # 50 agent definitions (3-tier hierarchy)
│   ├── skills/           # 67 skill definitions (9 team skills)
│   ├── config/           # Zod schemas + GDD/ADR templates
│   └── state/            # File-based session store
├── scripts/
│   └── asset-pipeline/   # AI asset generation pipeline (Python)
│       ├── asset-pipeline.py  # 7-step pipeline: mflux → rembg → post-process → manifest
│       └── presets.yaml       # 12 batch presets (UI, characters, textures, props, weapons, VFX)
└── workspace/            # Gitignored — game development directory
    ├── design/gdd/       # Game Design Documents
    ├── docs/architecture/ # Architecture Decision Records
    ├── docs/narrative/   # Narrative documents (world lore, etc.)
    ├── production/        # Session state + logs
    └── godot-test-1/     # Godot test project
        └── assets/       # Generated assets (raw, processed, ui, character, prop, weapon, tex, thumbnails)
```

## Architecture

### Agent Hierarchy (50 agents)

- **Tier 1 (Opus → glm-5.1)**: producer (standalone, owns orchestration), creative-director, technical-director
- **Tier 2 (Sonnet → glm-4.7)**: game-designer, lead-programmer, art-director, audio-director, narrative-director, qa-lead, release-manager, localization-lead
- **Tier 3 (Sonnet → glm-4.7)**: 38 specialists — systems-designer, gameplay-programmer, godot-specialist, unreal-specialist, unity-specialist, code-reviewer, etc.

### Autonomous Production Mode

The platform supports **fully autonomous game production** — no human-in-the-loop after initial game definition. The `autonomous-producer` agent orchestrates the entire pipeline from concept → playable game.

#### Architecture

```
User prompt ("make a platformer")
  → autonomous-producer (glm-5.1, tier 1)
    → creates/updates GDD (game-design.md)
    → spawns godot-scaffolder → setup-godot-project
    → spawns godot-specialist → implement-level (tilemap, enemy, HUD via subSkills)
    → spawns godot-gdscript-specialist → player controller, game state
    → spawns qa-tester → automated-playtest
    → cycles until milestone complete
```

#### Key Files

| File | Purpose |
|------|---------|
| `apps/api/src/routes/autonomous.ts` | Autonomous loop orchestration (895 lines) — spawns agents, manages sprints, handles timeouts |
| `apps/api/src/routes/gdd.ts` | GDD ingestion route — parses markdown, creates Kanban tickets, dedupes existing |
| `packages/agents/src/tiers.ts` | `autonomous-producer` (tier 1, opus) + `godot-scaffolder` (tier 3, sonnet) |
| `packages/agents/src/leadership.ts` | `autonomous-producer` agent definition + technical-director extended skills |
| `packages/agents/src/engine-godot.ts` | `godot-scaffolder` agent definition |
| `packages/agents/src/delegation-map.ts` | Added autonomous-producer + godot-scaffolder roles |
| `packages/skills/src/skills-by-phase.ts` | +804 lines — 13 Godot implementation skills, subSkills cascade |
| `workspace/.claude/agents/godot-specialist.md` | maxTurns: 20, TileMap efficiency rules, boot check gate |
| `workspace/.claude/skills/*.md` | 13 skill stub files for runtime skill loading |

#### Godot Production Skills (13 total)

| Skill | Purpose |
|-------|---------|
| `setup-godot-project` | Scaffold project.godot, autoloads, boot scene, export presets |
| `compose-scene` | Build .tscn from assets/scripts, wire nodes, connect signals |
| `implement-player-controller` | CharacterBody2D, movement constants, state machine, animations |
| `implement-game-state` | Autoload scripts (Global, Events, GameState), EventBus signals |
| `implement-tilemap` | format=0 TileMapLayer, tilemap_fill_rect for rectangles |
| `implement-level` | TileMap layers, spawn, hazards, exit; delegates via subSkills |
| `implement-enemy` | CharacterBody2D/3D, AI state machine, patrol/flying/bounce/boss |
| `implement-hud` | CanvasLayer, health bar, EventBus wiring, pause overlay |
| `implement-save-system` | JSON save/load, user:// path, SettingsManager |
| `implement-shader-effect` | gdshader, ShaderMaterial, fragment(), screen-space effects |
| `automated-playtest` | RunGodotHeadless tool, boot check, GUT framework |
| `export-godot-project` | export_presets.cfg, headless export, platform-specific settings |
| `playtest-with-mcp` | MCP workflow, Godot editor tools, fallback to headless |

#### ZAI Client Per-Model Semaphores

| Model | Concurrency | File |
|-------|-------------|------|
| glm-5.1 | 10 | `apps/api/src/llm/zai-client.ts` |
| glm-4.7 | 2 | `apps/api/src/llm/zai-client.ts` |
| glm-4.7-flash | 1 | `apps/api/src/llm/zai-client.ts` |

`MAX_RETRIES = 3` (retry delay sequence: 1s, 2s, 4s). Fetch timeout: 60s.

#### WebSocket Events (autonomous)

- `autonomous:started` — Loop started with sessionId, projectId, gameType
- `autonomous:milestone` — Milestone complete with summary
- `autonomous:completed` — All milestones done with final stats
- `autonomous:error` — Error with message and context
- `gdd:ingested` — GDD parsed with section/item counts

#### Sub-Skills Cascade

Skills can declare `subSkills` to delegate to child skill pipelines:

```typescript
// From implement-level in skills-by-phase.ts
{
  order: 6,
  name: "Generate First Level",
  subSkills: ["implement-level"],  // delegates all implement-level phases
  agents: ["godot-specialist"],
}
```

Currently used by `generate-genre-template` (phases 2 and 6). No circular references detected. No depth limit enforced (minor risk if circular refs added).

#### Constraints

- Godot `--script` mode does NOT initialize autoloads — use boot command (--quit) for validation
- `class_name` on autoloads causes "hides autoload singleton" fatal errors — avoid in autoload scripts
- TileMap tasks must use `tilemap_fill_rect` for rectangles — NOT individual `tilemap_set_cell` calls
- UIDs are NOT computed from path — must read from `.import` files or `uid_cache.bin`

#### Git Summary (last large change)

**28 files changed (+5474/-178 lines)**:
- New: `autonomous.ts` (895L), `gdd.ts` (333L), 13 SKILL.md stubs
- Core: `zai-client.ts` (semaphores, retries, timeout), `llm-service.ts` (pipeline tools)
- Skills: `skills-by-phase.ts` (+804L), `specialists.ts`, `tiers.ts`, `leadership.ts`, `engine-godot.ts`, `delegation-map.ts`
- Godot agent: `godot-specialist.md` (maxTurns: 20), `godot-scaffolder.md`, `godot-gdscript-specialist.md`

System prompts loaded from `workspace/.claude/agents/*.md` files dynamically.

### Model Tier Mapping

| Tier | Z.ai Model | Use Case |
|------|------------|----------|
| opus | glm-5.1 | Tier 1 directors (creative, technical, producer) |
| sonnet | glm-4.7 | Tier 2 leads, Tier 3 specialists |
| haiku | glm-4.7-flash | Fast responses, Tier 3 basic tasks |

System prompts loaded from `workspace/.claude/agents/*.md` files dynamically.

### Team Skills (9 LLM-powered multi-agent workflows)

| Skill | Purpose | Agents |
|-------|---------|--------|
| team-combat | Combat system design + implementation | creative-director, game-designer, lead-programmer, systems-designer, gameplay-programmer, qa-tester |
| team-narrative | Story, dialogue, quests | creative-director, narrative-director, writer, world-builder, qa-tester |
| team-ui | UI/UX design + implementation | creative-director, art-director, ux-designer, ui-programmer, qa-tester |
| team-progression | Economy, progression systems | creative-director, game-designer, economy-designer, lead-programmer, qa-tester |
| team-world | Level design, world building | creative-director, art-director, level-designer, world-builder, technical-artist |
| team-audio | Audio design + implementation | creative-director, audio-director, sound-designer, qa-tester |
| team-performance | Profiling, optimization | technical-director, lead-programmer, engine-programmer, performance-analyst |
| team-release | Release pipeline, certification | technical-director, release-manager, devops-engineer, qa-lead |
| team-multiplayer | Networking, sync | technical-director, lead-programmer, network-programmer, qa-tester |

Workflows are orchestrated by the creative-director agent using real LLM calls to coordinate team members.

### Director Gates (18 LLM-powered gates across 5 review layers)

- **Creative Director** (4): CD-PILLARS, CD-GDD-ALIGN, CD-SYSTEMS, CD-PHASE-GATE
- **Technical Director** (4): TD-FEASIBILITY, TD-ARCHITECTURE, TD-SYSTEM-BOUNDARY, TD-PHASE-GATE
- **Producer** (4): PR-SCOPE, PR-SPRINT, PR-MILESTONE, PR-PHASE-GATE
- **QA Lead** (2): QL-STORY-READY, QL-TEST-COVERAGE
- **Art Director** (2): AD-PHASE-GATE, AD-ART-BIBLE

Each gate invokes the appropriate director agent with a specific review prompt. Verdict is parsed from the first line of LLM response. On LLM failure, a `BLOCKED` verdict is broadcast via WebSocket so the UI doesn't show "running" indefinitely.

Review modes: `solo` (AI-only), `lean` (key checkpoints, default), `full` (all gates enforced)

### Code Review Sub-Agent

The `code-reviewer` agent provides critical feedback on code changes. Coding agents (gameplay-programmer, engine-programmer, ai-programmer, network-programmer, ui-programmer, godot-specialist, etc.) are instructed to spawn it after completing significant work:

- **Tier 3, Sonnet model**
- **Tools**: Read, Write, Glob, Grep (read-only context, no direct changes)
- **Delegation**: All coding agents can spawn code-reviewer via Task tool

Review focuses on:
1. Requirements from user request are addressed
2. Minimal, focused changes
3. Code reuse over duplication
4. No dead code or missing imports
5. Style consistency with existing codebase
6. No unnecessary try/catch blocks

```typescript
// Spawn via Task tool
Task: {
  agent: "code-reviewer",
  task: "Review my recent implementation..."
}
```

## Backend (apps/api)

Express server on port 3001 with:

- **Express body limit**: 50mb for image payloads (clipboard paste base64)
- **Security**: Path traversal protection, Bash sandboxing, ReDoS prevention, timing-safe auth, WebSocket auth via apiKey query param, XSS filtering, configurable CORS
- **Reliability**: Heartbeat cleanup, 409 spawn collision handling, atomic pruneMessages, recursion depth limit, graceful shutdown, SSE keepalive, per-file mutex for board writes, maxBuffer 10MB on subprocess calls, asset dimension clamping (64-4096px, steps 1-50), sessionsResponding lock cleanup on save failure, teamSessions cleanup on workflow completion
- **Routes**:
  - `/api/sessions`, `/api/agents`, `/api/skills`, `/api/teams`, `/api/gates`, `/api/design`, `/api/documents` — Core orchestration
  - `/api/dashboard` — Projects CRUD (`GET`, `POST/DELETE /projects`)
  - `/api/tickets` — Kanban board CRUD (`GET`, `POST/PATCH/DELETE`, `PATCH /:id/move`)
  - `/api/assets` — Asset inventory CRUD + art bible (`GET`, `POST/PATCH/DELETE`, `PATCH /art-bible`)
  - `/api/settings` — Config CRUD (`GET`, `PATCH`, `POST /reset`)
  - `/api/chat` — Session management (`GET/POST /sessions`, `DELETE /sessions/:id`, `POST /sessions/:id/messages`, `GET /sessions/producer/:projectId` get-or-create, `POST /sessions/:id/compact` session compaction, `POST /sessions/:id/close` close consultation, `POST /sessions/consultation/test-create` test helper)
- **WebSocket**: Real-time events (agent:spawned, checkpoint:saved, gate:verdict, log:entry, chat:context, chat:context-pressure, chat:session:compacted, ticket:verified)
- **SSE**: Log streaming at `/api/sessions/:sessionId/stream`
- **LLM**: ZAI API client (`src/llm/zai-client.ts`) with tool execution loop, retry, message pruning
- **Document Store**: `src/services/document-store.ts` — scans workspace dirs, parses YAML frontmatter, extracts `[[wikilink]]` connections, computes backlinks, serves via `/api/documents`, watches files with `fs.watch` for real-time updates
- **DataStore**: `src/services/data-store.ts` — File-based JSON persistence with per-file mutex (`updateData`/`updateTicketsBoard`) for safe concurrent writes, atomic tmp+rename pattern
- **Structured Logger**: `src/utils/logger.ts` — Pino-based logging with console + file transport
  - `apps/api/logs/api.log` — Combined info logs (rotated)
  - `apps/api/logs/error.log` — Error-only logs
  - Request IDs, correlation IDs, duration tracking
  - `src/middleware/request-logger.ts` — HTTP request/response logging middleware
  - `src/middleware/error-handler.ts` — Error logging with request context

### LLM Tool Execution

The `callLLMWithTools()` function sends a request to ZAI API with game studio tools (Read, Write, Edit, Glob, Grep, Bash, Task, GenerateAsset, StartConsultation). Tool calls are executed on the backend and results returned to the LLM. Loop continues until no more tool calls or max tools reached (100).

### Context Management (Long Sessions)

For long-running sessions, the platform employs smart context management:

| Threshold | Mechanism | Behavior |
|-----------|-----------|----------|
| > 100k tokens | Summarization | LLM summarizes old messages, injects as `[Previous Context Summary]` |
| > 125k tokens | Pruning | Keeps last 30 messages as atomic groups |
| > 80 messages | Pruning | Triggers pruning in tool execution loop |

**Summarization flow:**
1. When context exceeds 100k tokens, `summarizeOldMessages()` is called
2. Uses lightweight model (glm-4.7-flash) to summarize old messages
3. Preserves: key decisions, important facts, active tasks, code snippets
4. Keeps: system messages + summary + last 10 messages
5. `summarizedThisContext` flag prevents repeated summarization in same turn

**Conversation history pruning:**
- `pruneConversationHistory()` in `chat.ts` keeps last 30 messages
- Skips incomplete tool pairs (assistant+tool must stay together)
- Triggers after each LLM response

**Session compaction** (Claude Code-style):
- When context fills up (>90%), session can be compacted into a new generation
- Compaction flow: summarize via LLM → create new generation session → archive old session → switch UI seamlessly
- Supports `/compact` slash command (autocomplete in input) and auto-compact
- Animated purple progress bar during compaction
- Old sessions marked as `status: "compacted"`, new session tracks `generation` number
- `chat:session:compacted` WebSocket event drives frontend tab switch

**Per-session context tracking**:
- Context bar shows usage for the active tab (producer or agent), not just the producer
- Model-specific context windows: `glm-5.1`/`glm-4.7` = 200k tokens, `glm-4.7-flash` = 128k tokens
- Overridable via `CONTEXT_WINDOW_TOKENS` env var
- `chat:context` and `chat:context-pressure` WebSocket events for real-time updates
- At 80%, yellow "Compact" button appears (producer sessions only)

### Loop Detection

The tool execution loop detects repetitive patterns to prevent infinite loops:

| Detection | Threshold | Action |
|-----------|-----------|--------|
| Same tool + args | 4 times | Inject warning, continue |
| Same tool name | 4+ times in 6 iterations | Inject warning |
| Continued loop | After 15 iterations | Force stop, return response |

Loop detection events (`agent:loop:detected`) are broadcast via WebSocket and displayed as system messages in the UI.

### Tool Error Visibility

Tool execution errors are prefixed with `[TOOL ERROR: ${name}]` for visibility in logs and LLM context. This helps:
- Distinguish tool errors from content in logs
- Prevent LLM from retrying same failed operation
- Surface errors early in the tool execution loop

### Thinking Content

Agent thinking/reasoning content is captured and displayed in the UI:

- **Progress callback**: `makeProgressCallback()` broadcasts thinking text via `chat:progress` events
- **Frontend display**: Thinking panel shows content during agent work (`progress === -1` indicates thinking update)
- **Tool execution logs**: Each tool call logged with iteration number for activity tracking

### Environment Variables

```bash
ZAI_API_KEY=...            # Required — ZAI API key
ZAI_BASE_URL=https://api.z.ai/api/anthropic
API_PORT=3001
API_SECRET=...            # For auth header
WORKSPACE_DIR=./workspace  # Game development directory (system prompts loaded from .claude/agents/*.md)
REVIEW_MODE=lean          # solo | lean | full
DEFAULT_MODEL=glm-5.1      # Default fallback model
MAX_TOOL_CALLS=100         # Tool execution loop limit
TOOL_CHECKPOINT_INTERVAL=30 # Checkpoint frequency for long tasks
CONTEXT_WINDOW_TOKENS=...   # Optional: override model-specific context window sizes
```

## Frontend (apps/web)

Next.js 15 App Router, Tailwind CSS v4, no UI framework. All pages are client components.

| Route | Description |
|-------|-------------|
| `/` | Dashboard — session stats, agent hierarchy, team skills, live event feed |
| `/sessions` | Session table with create/delete |
| `/sessions/[id]` | Session detail — logs, checkpoints, config tabs + quick actions |
| `/chat` | Board room command page — Producer orchestrator, slash commands, step-based approve workflow, diff viewer, tool calls activity log |
| `/agents` | Searchable agent registry with tier filter + spawn dialog |
| `/skills` | Filterable skill list (all/team/solo) with phase stepper + invoke |
| `/teams` | Workflow timeline with member roster + run dialog |
| `/gates` | 18-gate matrix with category filter + run functionality |
| `/design` | GDD and ADR creation with status tracking |
| `/wiki` | Obsidian-style knowledge graph — collapsible file tree, inline markdown renderer, SVG force-directed graph with drag support |

### Studio Pages (apps/web/src/app/(studio)/)

| Route | Description |
|-------|-------------|
| `/dashboard` | Project management with create/delete modals, activity log, credit summary, Godot MCP server status + setup button |
| `/tickets` | Kanban board (project-scoped), 4 columns (Available, Processing, Verify, Archived), create/delete quests |
| `/assets` | Asset inventory grid (project-scoped), create/delete, Art Bible sidebar with constraints |
| `/chat` | Board room command page — per-project producer session, sample prompt buttons on empty state |
| `/settings` | Ledger & config — credit/tier pools, subscription, top-up history, usage log, engine selection, model dropdown, API key, webhook, reset |
| `/agents` | Agent registry page with searchable list + tier filter |
| `/skills` | Skills library with filterable categories |
| `/teams` | Team workflows with workflow timeline + run dialog |
| `/gates` | Director gates matrix with category filter + run functionality |

**Shared Components**: `components/Modal.tsx` (reusable modal), `components/DataLoader.tsx` (loading/error states), `components/ProjectGuard.tsx` (project-required page overlay), `contexts/ProjectContext.tsx` (project provider + useProject hook)

### Chat UI Components (apps/web/src/app/(studio)/chat/components/)

| Component | Purpose |
|-----------|---------|
| `ChatThread.tsx` | Message rendering with agent/user/system/welcome/progress/diff/navigate types |
| `CommandInput.tsx` | Slash command autocomplete with dropdown hints |
| `DiffView.tsx` | Line-by-line diff rendering with syntax highlighting |
| `AgentTree.tsx` | Sidebar with agent sessions and hierarchy tree |
| `QuestionMessage.tsx` | Interactive Q&A with radio/checkbox options |
| `WorkflowMessage.tsx` | OMC 5-stage pipeline stepper visualization |
| `PlanMessage.tsx` | Structured plan phases with per-phase execution |
| `ChatTabs.tsx` | Tabbed navigation between board room and agent sessions |
| `TopAppBar.tsx` | Top bar with project pill + switcher dropdown |
| `SubagentDrawer.tsx` | Subagent detail view in consultation sessions |
| `ProgressSummary.tsx` | Animated purple compact progress bar + per-tab context usage |

### Chat Features

- **Slash commands**: `/spawn`, `/approve`, `/done`, `/clear`, `/help`, `/cost`, `/diff`, `/compact`
- **Session compaction**: Claude Code-style compaction at >90% context — summarizes, creates new generation, archives old, seamless UI switch
- **Director consultation**: Chat directly with directors (creative, technical, art, narrative, audio) via `StartConsultation` tool — close & return to producer with summary
- **Per-tab context bar**: Shows context usage for active tab (producer or agent), model-specific windows, yellow "Compact" button at 80%
- **Auto-verification**: Tickets in Verify column auto-verified by AI verifier (code→code-reviewer, design→game-designer, art→art-director, narrative→narrative-director, architecture→technical-director, default→qa-tester); PASS→Completed, FAIL→back to Processing with feedback
- **OMC 5-stage workflow pipeline**: Plan → Decompose → Execute → Verify → Fix with progress stepper
- **Activity log**: Collapsible (Claude Code-style), shows count badge + 3 latest entries when collapsed, persists across navigation via localStorage
- **Real-time progress bar**: Smooth percentage updates (+3% every 2s) during agent work
- **Thinking panel**: Shows agent reasoning during progress
- **Navigate messages**: "Back to Producer" button after task completion
- **Message types**: `system`, `agent`, `user`, `progress`, `welcome`, `diff`, `navigate`, `question`, `plan`, `workflow`, `consultation`
- **Markdown rendering**: Messages render markdown with code blocks, lists, links
- **Image paste**: Base64 inline images via clipboard paste (50mb body limit)
- **Typing indicator**: Immediate visual feedback when agent is responding
- **Message deduplication**: Bidirectional dedup prevents duplicate messages from WS + API race conditions
- **showActions**: Approve/Override/Pause buttons only appear when explicitly requested by the agent
- **Interactive Q&A**: Agents can ask questions with selectable options (radio/checkbox), custom input, keyboard navigation via `AskUserQuestion` tool
- **Plan phases**: Agents can propose structured plans with phases via `ProposePlan` tool — users can execute individual phases or all at once
- **Per-project sessions**: Each project has its own Producer chat (`producer-<projectId>`), lazy-created on first visit
- **Project context injection**: LLM system prompt includes active project context (name, description, engine, workspace)
- **ProjectGuard**: `/chat`, `/tickets`, `/assets` require active project — yellow overlay with link to dashboard otherwise
- **Sample prompts**: Empty producer chat shows "Design a combat system", "Write opening cutscene", "Plan sprint 1" buttons
- **Animation fixes**: Restored `animate-spin` / `animate-pulse` keyframes for loading spinners
- **Session persistence**: Chat sessions saved to `chat-state.json`, survive page refreshes and server restarts; spawn/completion messages persist on producer session; progress messages and activity logs persist via localStorage cache
- **Legacy migration**: On startup, legacy `producer` session renamed to `producer-legacy`

## Data Flow

1. User creates session via web UI → POST `/api/sessions`
2. User invokes skill → POST `/api/skills/:id/invoke`
3. Backend calls ZAI API with skill team + tools
4. Agents spawn via LLM tool calls (read/write files, spawn subagents)
5. Backend broadcasts events via WebSocket
6. Frontend receives real-time updates in `useWebSocket` hook
7. Session state persisted to `workspace/production/session-state/*.json`

## State Management

Session state lives in `workspace/production/session-state/` as JSON files:
- `*.json` — Full session state (checkpoints, logs, agent invocations)
- `{sessionId}/*.json` — Individual checkpoint snapshots

Chat sessions persisted to `chat-state.json` survive page refreshes and server restarts.

Quest tickets auto-created via Quest Bridge when agents spawn (Available → Processing → Verify → Auto-Verified → Completed). Stale in-progress tickets are returned to "available" for re-pickup (not "qa" where they'd sit forever). Boot-check-exhausted tickets moved to QA with verification triggered.

**Auto-Verification** (`apps/api/src/services/verification-service.ts`): When tickets reach Verify column, an AI verifier is auto-selected based on task area (CODE→code-reviewer, DESIGN→game-designer, ART→art-director, NARRATIVE→narrative-director, ARCHITECTURE→technical-director, default→qa-tester). PASS moves to Completed; FAIL moves back to Processing with feedback and producer notification. Runs async (fire-and-forget).

Design documents in `workspace/design/gdd/` and `workspace/docs/architecture/` as Markdown.

## Design Templates

GDD files use 8-section format: Overview, Player Fantasy, Detailed Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria.

## Packages

| Package | Description | Key Files |
|---------|-------------|-----------|
| `@game-studio/types` | Shared interfaces | 9 type files (agent, skill, team, session, gate, design, sprint, api, document) |
| `@game-studio/agents` | Agent definitions | 7 definition files + tiers.ts + delegation-map.ts |
| `@game-studio/skills` | Skill definitions | skills-by-phase.ts + team-skills.ts + skill-model-tier.ts |
| `@game-studio/config` | Zod schemas | schema.ts + templates.ts |
| `@game-studio/state` | File I/O | session-store.ts |

## Scripts

```bash
pnpm typecheck         # TypeScript across all packages
pnpm build             # Turbo build pipeline
pnpm generate:agents    # Validate 49 agent definitions
pnpm generate:skills   # Validate 67 skill definitions
pnpm generate          # Both validations
pnpm test:e2e          # Playwright E2E test suite (apps/web/e2e/)
```

### Asset Pipeline (direct CLI)

```bash
# Single asset
python3 scripts/asset-pipeline/asset-pipeline.py \
  --prompt "health potion" --name "health-potion" \
  --type 2d --category ui --width 512 --height 512 \
  --output-dir workspace/godot-test-1/assets \
  --workspace-dir workspace/godot-test-1

# Batch from presets + dry-run
python3 scripts/asset-pipeline/asset-pipeline.py \
  --presets scripts/asset-pipeline/presets.yaml \
  --output-dir workspace/godot-test-1/assets \
  --workspace-dir workspace/godot-test-1
```

## Key Files

- `apps/api/src/llm/zai-client.ts` — LLM client with tool loop, retry, pruning
- `apps/api/src/services/llm-service.ts` — Agent orchestration, loads system prompts from MD files, maps tiers to Z.ai models
- `apps/api/src/services/gate-service.ts` — LLM-powered gate execution with 18 gates across 5 review layers
- `apps/api/src/config/model-mapping.ts` — Model tier → Z.ai model mapping (opus→glm-5.1, sonnet→glm-4.7, haiku→glm-4.7-flash), context window sizes, token thresholds
- `apps/api/src/config.ts` — Environment validation
- `apps/api/src/routes/sessions.ts` — Session CRUD + checkpointing
- `apps/api/src/routes/skills.ts` — Skill invocation
- `apps/api/src/routes/gates.ts` — Real LLM-powered gate execution via executeGate()
- `apps/api/src/routes/teams.ts` — Real team workflows orchestrated by creative-director
- `apps/api/src/routes/documents.ts` — Document store routes
- `apps/api/src/routes/dashboard.ts` — Projects CRUD with WebSocket events, Godot MCP auto-install, server setup endpoints
- `apps/api/src/routes/tickets.ts` — Kanban board CRUD
- `apps/api/src/routes/assets.ts` — Asset inventory + art bible CRUD + generation pipeline (PYTHON_BIN, thumbnail serving, path traversal protection)
- `apps/api/src/routes/settings.ts` — Config CRUD
- `apps/api/src/routes/chat.ts` — Session management + diff API
- `apps/api/src/utils/logger.ts` — Pino logger with console + file transport (pino, pino-pretty, pino-file-transport)
- `apps/api/src/middleware/request-logger.ts` — HTTP request/response logging middleware
- `apps/api/src/middleware/auth.ts` — Timing-safe authentication middleware
- `apps/api/src/services/websocket.ts` — WebSocket broadcast + SSE client tracking
- `apps/api/src/services/godot-mcp-service.ts` — Godot MCP Pro server lifecycle, stdio JSON-RPC client, 169 tool definitions, auto-setup, path rewriting, plugin installation
- `apps/api/src/services/document-store.ts` — Workspace file scanning, wikilink extraction, backlink computation, fs.watch for real-time updates
- `apps/api/src/services/data-store.ts` — Async file-based JSON persistence for dashboard, tickets, assets, settings with rate limiting
- `apps/api/src/services/quest-bridge.ts` — Intercepts Task tool calls to auto-create and track Quest tickets (Available → Processing → Verify → Completed)
- `apps/api/src/services/verification-service.ts` — Auto-verifies agent output when tickets reach Verify column, selects verifier by task area, moves tickets on PASS/FAIL
- `apps/web/src/hooks/useCommandRoom.ts` — Chat state management with tool calls, diff, navigate
- `apps/web/src/hooks/useGodotMCPStatus.ts` — Godot MCP health polling hook
- `apps/web/src/app/(studio)/chat/components/DiffView.tsx` — Diff rendering component
- `apps/web/src/lib/api.ts` — WebSocket API client with apiKey auth, debounced reconnect
- `apps/web/src/lib/format-time.ts` — Shared time formatting utilities
- `apps/web/src/lib/chat-context.ts` — Shared context window calculation + usage percentage for per-tab context bar
- `packages/types/src/api.ts` — WSEvent union type (all real-time event types)
- `packages/types/src/document.ts` — DocumentEntry, DocumentDetail, GraphData types
- `packages/types/src/chat.ts` — ChatMessage, ToolCall, DiffBlock types
- `packages/types/src/assets.ts` — AssetType, AssetCategory, GameAsset, AssetGenerationMeta, ArtBibleConfig types
- `packages/state/src/session-store.ts` — File-based session persistence
- `scripts/asset-pipeline/asset-pipeline.py` — 7-step asset generation pipeline (mflux → rembg → post-process → manifest)
- `scripts/asset-pipeline/presets.yaml` — 12 batch generation presets (UI, characters, textures, props, weapons, VFX)

## Asset Generation Pipeline

Automated game asset generation pipeline using local AI (FLUX.2 Klein on Apple Silicon via mflux), background removal (rembg), and Godot-ready post-processing.

### Architecture

```
mflux-generate-flux2 (FLUX.2-klein-4b, MLX on Apple Silicon)
  → Raw PNG (workspace/<project>/assets/raw/)
    → rembg (U2-Net saliency, removes background)
      → Processed PNG (assets/processed/)
        → Post-processing (alpha-trim, grid-pad, sprite-sheet slice)
          → Final asset (assets/<category>/)
            → Thumbnail (assets/thumbnails/)
            → Godot .import (Nearest filter for pixel art)
            → asset-manifest.json (registered in inventory API)
```

### Pipeline Script

**File**: `scripts/asset-pipeline/asset-pipeline.py` (729 lines, Python 3.12). 7-step pipeline: Generate (mflux) → Remove background (rembg) → Alpha-trim → Grid-pad → Sprite-sheet slice → Thumbnail → Godot .import.

### Presets (12 batch presets)

Defined in `scripts/asset-pipeline/presets.yaml`:

| Category | Presets |
|----------|---------|
| UI Icons | health-potion, mana-potion, gold-coin |
| Characters | goblin-warrior-spritesheet, player-character-idle |
| Textures | cobblestone-path, grass-tile, stone-wall |
| Props | treasure-chest, wooden-door |
| Weapons | iron-sword |
| VFX | heal-effect |

Each preset defines: name, prompt, type, category, dimensions, steps, remove_bg, tags, and optional sprite_sheet/grid_size settings.

### Directory Structure (output)

`workspace/<project>/assets/`: `raw/`, `processed/`, `ui/`, `character/`, `prop/`, `weapon/`, `tex/`, `thumbnails/`, `asset-manifest.json`.

### API Integration

**Backend routes** (`apps/api/src/routes/assets.ts`): `GET /api/assets` (list), `POST /api/assets/generate` (single or batch), `GET /api/assets/generate/presets`, `GET/DELETE /api/assets/:id`, `GET /api/assets/:id/thumbnail` (auth bypass for `<img>` tags), `GET/PATCH /api/assets/art-bible`.

**Generation request**: Single `{ prompt, name, type?, category?, width?, height?, steps?, removeBg?, workspacePath }` or batch `{ presetsFile, workspacePath }`.

**PYTHON_BIN**: Must use `/usr/local/bin/python3` (Python.org 3.12 with Pillow, rembg). Controlled by `PIPELINE_PYTHON` env var.

**Thumbnail auth bypass**: `/api/assets/{id}/thumbnail` skips auth — `<img>` tags can't send headers. Path traversal protection validates `thumbAbsPath.startsWith(workspaceDir + "/")`.

### TypeScript Types

Defined in `packages/types/src/assets.ts`: `AssetType`, `AssetCategory`, `GameAsset`, `AssetGenerationMeta`, `ArtBibleConfig`.

### LLM Tool Integration

The `GenerateAsset` tool in `apps/api/src/services/llm-service.ts` allows the Producer agent to generate assets via natural language:

- Agent calls `GenerateAsset` with prompt + parameters
- Backend invokes the pipeline script with correct Python binary and workspace paths
- Manifest paths stored workspace-relative via `--workspace-dir` flag
- Result includes generation metadata, file paths, and elapsed time

### WebSocket Events

Pipeline broadcasts these events via WebSocket:
- `asset:generated` — New asset created (includes manifest entry)
- `asset:registered` — Asset registered in inventory
- `asset:deleted` — Asset removed

### Key Implementation Details

- **Model**: `flux2-klein-4b` only (4B parameters, 15GB cached at `~/.cache/huggingface/`). The 9B model is gated — do not use.
- **Binary**: `mflux-generate-flux2` at `~/.local/bin/`
- **Input validation**: Dimensions clamped 64-4096px, steps 1-50
- **Sprite-sheet slicing**: Smart alpha-gap detection, falls back to uniform grid
- **Manifest merging**: Each run merges into existing `asset-manifest.json` by ID dedup
- **Godot import**: Auto-generates `.import` files with Nearest filter for pixel art

## Godot MCP Pro Integration

For Godot engine projects, the platform integrates with **Godot MCP Pro** to enable AI agents to control the Godot editor directly — building scenes, writing scripts, running games, simulating input, and asserting game state programmatically.

### Architecture

```
Agent tool call (e.g. create_scene)
  → GodotMCPService.executeTool()
    → JSON-RPC over stdin/stdout
      → godot-mcp-pro server (child process)
        → WebSocket (ports 6505-6514)
          → Godot MCP Pro plugin in editor
            → Godot editor responds
```

### Components

| File | Purpose |
|------|---------|
| `services/godot-mcp-service.ts` | MCP server lifecycle, stdio JSON-RPC client, 169 tool definitions, auto-setup, path rewriting |
| `services/llm-service.ts` | Injects Godot MCP tools when `project.engine === "godot"`, routes calls to MCP service |
| `routes/chat.ts` | Starts MCP service on producer session create (project-keyed) |
| `routes/dashboard.ts` | Stops MCP service when project deleted, auto-installs plugin on project creation |
| `hooks/useGodotMCPStatus.ts` | Frontend hook for polling MCP health status |

### How It Works

1. **Session creation** — When a producer session is created for a project with `engine: "godot"`, the Godot MCP service is started (non-blocking)
2. **Tool injection** — The LLM receives 169 Godot MCP tools alongside game-studio tools (Read, Write, Edit, etc.)
3. **Tool routing** — `executeTool()` checks if the tool is a Godot MCP tool (`isGodotMCPTool()`) and routes to `GodotMCPService`
4. **MCP server** — Spawns `godot-mcp-pro-v1.11.0/server/build/index.js --lite` as a child process with stdio transport
5. **Godot connection** — The MCP server internally bridges to the Godot editor via WebSocket (ports 6505-6514). The Godot editor must be running with the Godot MCP Pro plugin enabled.

### Auto-Setup & Automation

The platform automates Godot MCP setup:

| Feature | Description |
|---------|-------------|
| **Server auto-setup** | Automatically runs `npm install` + `npm run build` if needed |
| **Plugin auto-install** | Copies `addons/godot_mcp/` to project on creation, enables in `project.godot` |
| **Path rewriting** | Rewrites absolute paths from Godot (e.g., `/Users/foo/godot-test-1/`) to workspace-relative (`./workspace/godot-test-1/`) |
| **Health monitoring** | Polls MCP health every 10s, displays status in UI |

### API Endpoints

`GET /api/dashboard/server-status`, `POST /api/dashboard/setup-server`, `GET /api/dashboard/projects/:id/plugin-status`, `POST /api/dashboard/projects/:id/install-plugin`, `GET /api/dashboard/projects/:id/mcp-health`.

### Key Design Decisions

- **Project-keyed** — Service is keyed by `projectId`, shared across all sessions (producer + spawned agents). Singleton deduplication via `pendingCreations` Map prevents concurrent callers from creating duplicate services.
- **Project workspace isolation** — `executeTool()` uses `projectContext.workspacePath` (resolved relative to `WORKSPACE_DIR`) for file operations. Each project has its own directory, preventing cross-project contamination.
- **Graceful degradation** — Clear error message if Godot not running or MCP plugin not enabled
- **LITE mode** — Uses `--lite` flag (81 tools) to reduce context overhead. Use `--minimal` (35 tools) or `--full` (169 tools) via `GodotMCPServiceOptions.mode`
- **Path rewriting** — Detects Godot project directory from MCP responses and rewrites absolute paths to workspace-relative

### Frontend Status

Connected (green), Waiting for Godot editor (yellow), Disconnected/error (red).

### Environment Variables

```bash
GODOT_MCP_SERVER_PATH=...  # Optional: path to godot-mcp-pro/server/build/index.js (auto-detected)
```