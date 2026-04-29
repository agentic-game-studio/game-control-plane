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
│   ├── agents/           # 49 agent definitions (3-tier hierarchy)
│   ├── skills/           # 67 skill definitions (9 team skills)
│   ├── config/           # Zod schemas + GDD/ADR templates
│   └── state/            # File-based session store
└── workspace/            # Gitignored — game development directory
    ├── design/gdd/       # Game Design Documents
    ├── docs/architecture/ # Architecture Decision Records
    ├── docs/narrative/   # Narrative documents (world lore, etc.)
    └── production/        # Session state + logs
```

## Architecture

### Agent Hierarchy (48 agents)

- **Tier 1 (Opus → glm-5.1)**: producer (standalone, owns orchestration), creative-director, technical-director
- **Tier 2 (Sonnet → glm-4.7)**: game-designer, lead-programmer, art-director, audio-director, narrative-director, qa-lead, release-manager, localization-lead
- **Tier 3 (Sonnet/Haiku → glm-4.7/glm-4.7-flash)**: 37 specialists — systems-designer, gameplay-programmer, godot-specialist, unreal-specialist, unity-specialist, etc.

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

Each gate invokes the appropriate director agent with a specific review prompt. Verdict is parsed from the first line of LLM response.

Review modes: `solo` (AI-only), `lean` (key checkpoints, default), `full` (all gates enforced)

## Backend (apps/api)

Express server on port 3001 with:

- **Express body limit**: 50mb for image payloads (clipboard paste base64)
- **Security**: Path traversal protection, Bash sandboxing, ReDoS prevention, timing-safe auth, WebSocket auth via apiKey query param, XSS filtering, configurable CORS
- **Reliability**: Heartbeat cleanup, 409 spawn collision handling, atomic pruneMessages, recursion depth limit, graceful shutdown, SSE keepalive
- **Routes**:
  - `/api/sessions`, `/api/agents`, `/api/skills`, `/api/teams`, `/api/gates`, `/api/design`, `/api/documents` — Core orchestration
  - `/api/dashboard` — Projects CRUD (`GET`, `POST/DELETE /projects`)
  - `/api/tickets` — Kanban board CRUD (`GET`, `POST/PATCH/DELETE`, `PATCH /:id/move`)
  - `/api/assets` — Asset inventory CRUD + art bible (`GET`, `POST/PATCH/DELETE`, `PATCH /art-bible`)
  - `/api/settings` — Config CRUD (`GET`, `PATCH`, `POST /reset`)
  - `/api/chat` — Session management (`GET/POST /sessions`, `DELETE /sessions/:id`, `POST /sessions/:id/messages`, `GET /sessions/producer/:projectId` get-or-create)
- **WebSocket**: Real-time events (agent:spawned, checkpoint:saved, gate:verdict, log:entry)
- **SSE**: Log streaming at `/api/sessions/:sessionId/stream`
- **LLM**: ZAI API client (`src/llm/zai-client.ts`) with tool execution loop, retry, message pruning
- **Document Store**: `src/services/document-store.ts` — scans workspace dirs, parses YAML frontmatter, extracts `[[wikilink]]` connections, computes backlinks, serves via `/api/documents`, watches files with `fs.watch` for real-time updates
- **DataStore**: `src/services/data-store.ts` — File-based JSON persistence for dashboard, tickets, assets, settings

### LLM Tool Execution

The `callLLMWithTools()` function sends a request to ZAI API with game studio tools (Read, Write, Edit, Glob, Grep, Bash, Task). Tool calls are executed on the backend and results returned to the LLM. Loop continues until no more tool calls or max tools reached (100).

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
| `/dashboard` | Project management with create/delete modals, activity log, credit summary |
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

### Chat Features

- **Slash commands**: `/spawn`, `/approve`, `/done`, `/clear`, `/help`, `/cost`, `/diff`
- **OMC 5-stage workflow pipeline**: Plan → Decompose → Execute → Verify → Fix with progress stepper
- **Activity log**: Real-time tool call activity (Read, Bash, Edit, etc.) under progress bar
- **Real-time progress bar**: Smooth percentage updates (+3% every 2s) during agent work
- **Thinking panel**: Shows agent reasoning during progress
- **Navigate messages**: "Back to Producer" button after task completion
- **Message types**: `system`, `agent`, `user`, `progress`, `welcome`, `diff`, `navigate`, `question`, `plan`, `workflow`
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
- **Session persistence**: Chat sessions saved to `chat-state.json`, survive page refreshes and server restarts; spawn/completion messages persist on producer session
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

Quest tickets auto-created via Quest Bridge when agents spawn (Available → Processing → Verify → Completed).

Design documents in `workspace/design/gdd/` and `workspace/docs/architecture/` as Markdown.

## Design Templates

GDD files use 8-section format:
1. Overview — one-paragraph summary
2. Player Fantasy — desired feeling/experience
3. Detailed Rules — unambiguous mechanics
4. Formulas — math with variable definitions
5. Edge Cases — scenario handling table
6. Dependencies — what this system depends on
7. Tuning Knobs — configurable parameters
8. Acceptance Criteria — testable requirements

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

## Key Files

- `apps/api/src/llm/zai-client.ts` — LLM client with tool loop, retry, pruning
- `apps/api/src/services/llm-service.ts` — Agent orchestration, loads system prompts from MD files, maps tiers to Z.ai models
- `apps/api/src/services/gate-service.ts` — LLM-powered gate execution with 18 gates across 5 review layers
- `apps/api/src/config/model-mapping.ts` — Model tier → Z.ai model mapping (opus→glm-5.1, sonnet→glm-4.7, haiku→glm-4.7-flash)
- `apps/api/src/config.ts` — Environment validation
- `apps/api/src/routes/sessions.ts` — Session CRUD + checkpointing
- `apps/api/src/routes/skills.ts` — Skill invocation
- `apps/api/src/routes/gates.ts` — Real LLM-powered gate execution via executeGate()
- `apps/api/src/routes/teams.ts` — Real team workflows orchestrated by creative-director
- `apps/api/src/routes/documents.ts` — Document store routes
- `apps/api/src/routes/dashboard.ts` — Projects CRUD with WebSocket events
- `apps/api/src/routes/tickets.ts` — Kanban board CRUD
- `apps/api/src/routes/assets.ts` — Asset inventory + art bible CRUD
- `apps/api/src/routes/settings.ts` — Config CRUD
- `apps/api/src/routes/chat.ts` — Session management + diff API
- `apps/api/src/middleware/auth.ts` — Timing-safe authentication middleware
- `apps/api/src/services/websocket.ts` — WebSocket broadcast + SSE client tracking
- `apps/api/src/services/document-store.ts` — Workspace file scanning, wikilink extraction, backlink computation, fs.watch for real-time updates
- `apps/api/src/services/data-store.ts` — Async file-based JSON persistence for dashboard, tickets, assets, settings with rate limiting
- `apps/api/src/services/quest-bridge.ts` — Intercepts Task tool calls to auto-create and track Quest tickets (Available → Processing → Verify → Completed)
- `apps/web/src/hooks/useCommandRoom.ts` — Chat state management with tool calls, diff, navigate
- `apps/web/src/app/(studio)/chat/components/DiffView.tsx` — Diff rendering component
- `apps/web/src/lib/api.ts` — WebSocket API client with apiKey auth, debounced reconnect
- `apps/web/src/lib/format-time.ts` — Shared time formatting utilities
- `packages/types/src/api.ts` — WSEvent union type (all real-time event types)
- `packages/types/src/document.ts` — DocumentEntry, DocumentDetail, GraphData types
- `packages/types/src/chat.ts` — ChatMessage, ToolCall, DiffBlock types
- `packages/state/src/session-store.ts` — File-based session persistence