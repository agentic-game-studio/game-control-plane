# Game Studio Control Plane

Multi-agent game development orchestration platform. Runs AI agents (game director, lead programmer, artists, etc.) to build games collaboratively, with a web UI for monitoring and control.

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
│   ├── agents/           # 48 agent definitions (3-tier hierarchy)
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

- **Tier 1 (Opus → glm-5.1)**: creative-director, technical-director, producer
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

- **Routes**:
  - `/api/sessions`, `/api/agents`, `/api/skills`, `/api/teams`, `/api/gates`, `/api/design`, `/api/documents` — Core orchestration
  - `/api/dashboard` — Projects CRUD (`GET`, `POST/DELETE /projects`)
  - `/api/tickets` — Kanban board CRUD (`GET`, `POST/PATCH/DELETE`, `PATCH /:id/move`)
  - `/api/assets` — Asset inventory CRUD + art bible (`GET`, `POST/PATCH/DELETE`, `PATCH /art-bible`)
  - `/api/settings` — Config CRUD (`GET`, `PATCH`, `POST /reset`)
  - `/api/chat` — Session management (`GET/POST /sessions`, `DELETE /sessions/:id`, `POST /sessions/:id/messages`)
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
| `/chat` | Board room command page — Game Director orchestrator, slash commands, step-based approve workflow, diff viewer, tool calls activity log |
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
| `/tickets` | Kanban board with 4 columns (Available, Processing, Verify, Archived), create/delete quests |
| `/assets` | Asset inventory grid with create/delete, Art Bible sidebar with constraints |
| `/settings` | Ledger & config — engine selection, model dropdown, API key, webhook, reset functionality |
| `/agents` | Agent registry page with searchable list + tier filter |
| `/skills` | Skills library with filterable categories |
| `/teams` | Team workflows with workflow timeline + run dialog |
| `/gates` | Director gates matrix with category filter + run functionality |

**Shared Components**: `components/Modal.tsx` (reusable modal), `components/DataLoader.tsx` (loading/error states)

### Chat UI Components (apps/web/src/app/(studio)/chat/components/)

| Component | Purpose |
|-----------|---------|
| `ChatThread.tsx` | Message rendering with agent/user/system/welcome/progress/diff/navigate types |
| `CommandInput.tsx` | Slash command autocomplete with dropdown hints |
| `DiffView.tsx` | Line-by-line diff rendering with syntax highlighting |
| `AgentTree.tsx` | Sidebar with agent sessions and hierarchy tree |

### Chat Features

- **Slash commands**: `/spawn`, `/approve`, `/done`, `/clear`, `/help`, `/cost`, `/diff`
- **6-step approve workflow**: Progress bars with tool calls (Read, Grep, Edit, Write)
- **Thinking panel**: Shows agent reasoning during progress
- **Navigate messages**: "Back to Game Director" button after task completion
- **Message types**: `system`, `agent`, `user`, `progress`, `welcome`, `diff`, `navigate`

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
pnpm generate:agents    # Validate 48 agent definitions
pnpm generate:skills   # Validate 67 skill definitions
pnpm generate          # Both validations
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
- `apps/api/src/services/websocket.ts` — WebSocket broadcast + SSE client tracking
- `apps/api/src/services/document-store.ts` — Workspace file scanning, wikilink extraction, backlink computation, fs.watch for real-time updates
- `apps/api/src/services/data-store.ts` — File-based JSON persistence for studio data
- `apps/web/src/hooks/useCommandRoom.ts` — Chat state management with tool calls, diff, navigate
- `apps/web/src/app/(studio)/chat/components/DiffView.tsx` — Diff rendering component
- `packages/types/src/api.ts` — WSEvent union type (all real-time event types)
- `packages/types/src/document.ts` — DocumentEntry, DocumentDetail, GraphData types
- `packages/types/src/chat.ts` — ChatMessage, ToolCall, DiffBlock types
- `packages/state/src/session-store.ts` — File-based session persistence