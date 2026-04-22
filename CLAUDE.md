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
    └── production/        # Session state + logs
```

## Architecture

### Agent Hierarchy (48 agents)

- **Tier 1 (Opus)**: creative-director, technical-director, producer
- **Tier 2 (Sonnet)**: game-designer, lead-programmer, art-director, audio-director, narrative-director, qa-lead, release-manager, localization-lead
- **Tier 3 (Sonnet/Haiku)**: 37 specialists — systems-designer, gameplay-programmer, godot-specialist, unreal-specialist, unity-specialist, etc.

### Team Skills (9 multi-agent workflows)

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

### Director Gates (18 gates across 5 review layers)

- **Creative Director** (4): CD-PILLARS, CD-GDD-ALIGN, CD-SYSTEMS, CD-PHASE-GATE
- **Technical Director** (4): TD-FEASIBILITY, TD-ARCHITECTURE, TD-SYSTEM-BOUNDARY, TD-PHASE-GATE
- **Producer** (4): PR-SCOPE, PR-SPRINT, PR-MILESTONE, PR-PHASE-GATE
- **QA Lead** (2): QL-STORY-READY, QL-TEST-COVERAGE
- **Art Director** (2): AD-PHASE-GATE, AD-ART-BIBLE

Review modes: `solo` (AI-only), `lean` (key checkpoints, default), `full` (all gates enforced)

## Backend (apps/api)

Express server on port 3001 with:

- **Routes**: `/api/sessions`, `/api/agents`, `/api/skills`, `/api/teams`, `/api/gates`, `/api/design`
- **WebSocket**: Real-time events (agent:spawned, checkpoint:saved, gate:verdict, log:entry)
- **SSE**: Log streaming at `/api/sessions/:sessionId/stream`
- **LLM**: ZAI API client (`src/llm/zai-client.ts`) with tool execution loop, retry, message pruning

### LLM Tool Execution

The `callLLMWithTools()` function sends a request to ZAI API with game studio tools (Read, Write, Edit, Glob, Grep, Bash, Task). Tool calls are executed on the backend and results returned to the LLM. Loop continues until no more tool calls or max tools reached (100).

### Environment Variables

```bash
ZAI_API_KEY=...            # Required — ZAI API key
ZAI_BASE_URL=https://api.z.ai/api/anthropic
API_PORT=3001
API_SECRET=...            # For auth header
WORKSPACE_DIR=./workspace  # Game development directory
REVIEW_MODE=lean          # solo | lean | full
DEFAULT_MODEL=glm-5.1
MAX_TOOL_CALLS=100
TOOL_CHECKPOINT_INTERVAL=30
```

## Frontend (apps/web)

Next.js 15 App Router, Tailwind CSS v4, no UI framework. All pages are client components.

| Route | Description |
|-------|-------------|
| `/` | Dashboard — session stats, agent hierarchy, team skills, live event feed |
| `/sessions` | Session table with create/delete |
| `/sessions/[id]` | Session detail — logs, checkpoints, config tabs + quick actions |
| `/agents` | Searchable agent registry with tier filter + spawn dialog |
| `/skills` | Filterable skill list (all/team/solo) with phase stepper + invoke |
| `/teams` | Workflow timeline with member roster + run dialog |
| `/gates` | 18-gate matrix with category filter + run functionality |
| `/design` | GDD and ADR creation with status tracking |

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
| `@game-studio/types` | Shared interfaces | 8 type files (agent, skill, team, session, gate, design, sprint, api) |
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
- `apps/api/src/config.ts` — Environment validation
- `apps/api/src/routes/sessions.ts` — Session CRUD + checkpointing
- `apps/api/src/routes/skills.ts` — Skill invocation
- `apps/api/src/services/websocket.ts` — WebSocket broadcast + SSE client tracking
- `packages/types/src/api.ts` — WSEvent union type (all real-time event types)
- `packages/state/src/session-store.ts` — File-based session persistence