# Studio Frontend Pages Documentation

## Overview

All studio pages are client components (`"use client"`) using Next.js 15 App Router. They share a retro brutalist design system with Tailwind CSS v4.

**Shared patterns:**
- `border-2 border-black` on all containers
- `shadow-[4px_4px_0_0_rgba(0,0,0,1)]` for card depth
- `font-[var(--font-terminal)]` for labels and data
- `font-[var(--font-headline)]` for titles
- `font-[var(--font-label)]` for small uppercase labels
- Material Symbols Outlined icons
- Zero border-radius everywhere

**Shared components:**
- `components/Modal.tsx` — reusable modal with form fields
- `components/DataLoader.tsx` — loading spinner + error retry state

---

## `/dashboard` — Mission Control

**Hook:** `useDashboard.ts`

**Data flow:**
1. Fetch `GET /api/dashboard` on mount
2. Listen to WebSocket `project:created`, `project:updated`, `project:deleted`
3. Auto-refresh when any project event fires

**Features:**
- **StatsCards** — project count, active agents, credit summary
- **ProjectGrid** — clickable project cards with current directory panel
  - `useCurrentProject` hook syncs selected project to `localStorage` (`studio:current-project-id`)
  - ConfirmSwitchModal when switching projects
- **ActivityLog** — recent events list
- **NewProjectModal** — create new project (name, engine, description)

**CRUD:**
- `createProject(request)` → `POST /api/dashboard/projects`
- `deleteProject(id)` → `DELETE /api/dashboard/projects/:id`
- `updateProject(id, updates)` → `PATCH /api/dashboard/projects/:id`

---

## `/chat` — Board Room

**Hook:** `useCommandRoom.ts`

**Data flow:**
1. Initialize chat sessions on mount
2. Load current session messages
3. Listen to WebSocket for real-time message updates

**Features:**
- **AgentTree** — sidebar showing agent sessions and hierarchy
- **ChatThread** — message rendering (agent/user/system/welcome/progress/diff/navigate types)
- **CommandInput** — slash command autocomplete (`/spawn`, `/approve`, `/done`, `/clear`, `/help`)
- **6-step approve workflow** — progress bars with tool calls (Read, Grep, Edit, Write)
- **DiffView** — line-by-line diff rendering

**Slash commands:**
- `/spawn <agent>` — spawn an agent
- `/approve` — approve current agent action
- `/done` — mark task complete
- `/clear` — clear chat
- `/help` — show commands
- `/cost` — show credit usage
- `/diff` — show diff view

---

## `/sessions` — Session Manager

**State:** Local React state (no custom hook)

**Data flow:**
1. Fetch `GET /api/sessions` on mount
2. Listen to WebSocket `session:status`, `checkpoint:saved`
3. Listen to `log:entry` for selected session logs

**Features:**
- Session list with create/delete
- Session detail with checkpoints count, agent count, log count
- **Create Checkpoint** button per session
- **Activity Log panel** — real-time logs for selected session
- Status badges (active/running/completed/idle/error)

**CRUD:**
- `POST /api/sessions` — create session
- `DELETE /api/sessions/:id` — delete session
- `POST /api/sessions/:id/checkpoint` — create checkpoint

---

## `/agents` — Agent Registry

**State:** Local React state

**Data flow:**
1. Fetch `GET /api/prompts/agents` on mount

**Features:**
- Grid of 49 agent cards
- **Search** by name/description
- **Tier filter** — All / Opus / Sonnet / Haiku
- **Detail panel** (modal) — description, max turns, memory, tools, skills, disallowed tools
- **Spawn Agent** button — spawns agent via `POST /api/chat/spawn`

**Model colors:**
- Opus = purple
- Sonnet = blue
- Haiku = green

---

## `/skills` — Skills Library

**State:** Local React state

**Data flow:**
1. Fetch `GET /api/skills` on mount
2. Get current session from `GET /api/chat/sessions`

**Features:**
- Grid of 67 skill cards
- **Tabs** — All / Team Skills / Solo Skills
- **Category pills** — Onboarding, Design, UX Design, Architecture, Stories & Sprints, Reviews, QA & Testing, Production, Release, Creative & Content
- **Detail panel** (modal) — description, team members, phases (with parallel markers), gates
- **Invoke Skill** button — invokes via `POST /api/skills/:name/invoke`

**Team skills** have blue left border and "TEAM" badge.

---

## `/teams` — Team Workflows

**State:** Local React state

**Data flow:**
1. Fetch `GET /api/teams` on mount
2. Get current session from `GET /api/chat/sessions`

**Features:**
- Grid of 9 team workflow cards
- Each card shows: icon, name, description, team members, phase count
- **Detail panel** (modal) — full workflow phases with order numbers, parallel markers, assigned agents
- **Run Team** button — runs workflow via `POST /api/teams/:name/run`

**Team colors:**
- team-combat = red
- team-narrative = purple
- team-ui = blue
- team-progression = green
- team-world = amber
- team-audio = pink
- team-performance = orange
- team-release = cyan
- team-multiplayer = indigo

---

## `/gates` — Director Gates

**State:** Local React state

**Data flow:**
1. Fetch `GET /api/gates?sessionId=...` on mount
2. Listen to WebSocket `gate:verdict`
3. Get current session from `GET /api/chat/sessions`

**Features:**
- 5 categories: Creative Director, Technical Director, Producer, QA Lead, Art Director
- **Category filter** — All / CD / TD / PR / QL / AD
- Each gate shows: ID, description, verdict badge
- **Verdict colors:** APPROVE/READY = green, CONCERNS = yellow, REJECT = red
- **Run Gate** — executes LLM review via `POST /api/gates/:id/run`
- **Detail modal** — shows verdict details after run

---

## `/wiki` — Knowledge Graph

**Hook:** `useDocuments.ts`

**Data flow:**
1. Fetch `GET /api/documents` on mount
2. Listen to WebSocket `document:created`, `document:updated`

**Features:**
- **FileTree** — collapsible document tree by category
- **DocumentViewer** — inline markdown renderer with wikilink support
- **KnowledgeGraph** — SVG force-directed graph with drag support
- **Wikilink navigation** — click `[[Link]]` to navigate between documents
- Real-time updates when documents change

---

## `/assets` — Asset Library

**Hook:** `useAssets.ts`

**Data flow:**
1. Fetch `GET /api/assets` on mount
2. Listen to WebSocket `asset:created`, `asset:updated`, `asset:deleted`

**Features:**
- **Category tabs** — All Assets / 2D Images / 3D Models / Audio / VFX / Texture
- **Search** — filters filename, category, tags
- **Sort** — Name A-Z/Z-A, Size Small-Large/Large-Small, Newest/Oldest
- **AssetGrid** — 5-column responsive grid with cards
- **AssetCard** — type icon, filename, size badge, category color chip, hover delete, right-click context menu (Copy Path / Open Location)
- **Empty slots** — dashed border placeholders when grid < 10 items
- **Craft Asset button** — currently locked (disabled for all tiers)

**CRUD:**
- `createAsset(request)` → `POST /api/assets`
- `deleteAsset(id)` → `DELETE /api/assets/:id`
- `updateArtBible(updates)` → `PATCH /api/assets/art-bible`

**Tier check:** Craft Asset requires Artisan+ tier (currently locked via `canCraft = false`)

---

## `/tickets` — Quest Board

**Hook:** `useTickets.ts`

**Data flow:**
1. Fetch `GET /api/tickets` on mount
2. Listen to WebSocket `ticket:created`, `ticket:updated`, `ticket:moved`, `ticket:deleted`

**Features:**
- **4-column Kanban** — Available / Processing / Verify / Completed
- **QuestCard** — title, area/subarea badges, assignee (robot icon + agent name), working/pending status badge
- **Working badge** = blue (agent assigned), **Pending badge** = gray (no assignee)
- **Completed column** — only shows non-acknowledged tickets
- **Close button** — on completed cards, human acknowledges via `PATCH /api/tickets/:id` with `{acknowledged: true}`
- No drag-and-drop, no create/edit/delete (AI managed)

**Agent names** are formatted from kebab-case to Title Case (e.g., `network-programmer` → "Network Programmer")

---

## `/settings` — Credit Ledger

**Hook:** `useSettings.ts`

**Data flow:**
1. Fetch `GET /api/settings` on mount (auto weekly reset check in backend)
2. Listen to WebSocket `settings:updated`

**Features:**
- **CreditPools** — Subscription Credits + On-top Credits (large blue numbers on black bg), Burn Rate
- **SubscriptionManagement** — Current Plan (tier name, billing date, auto-renew toggle), Upgrade Plan comparison table (4 tiers)
- **TopUpHistory** — list of on-top credit purchases
- **UsageLog** — list of credit consumption per task with red minus badges
- **InsertCoinModal** — amount input with preset buttons (500/1000/5000/10000)

**CRUD:**
- `updateSettings(updates)` → `PATCH /api/settings`
- `topUp(amount)` → `POST /api/settings/topup`
- `upgradeTier(tier)` → `POST /api/settings/upgrade`
- `consumeCredits(taskName, creditsUsed)` → `POST /api/settings/consume`
- `resetSettings()` → `POST /api/settings/reset`

**Tiers:**
- Novice (Free): 1 Project, 1,000 Credit/Week
- Artisan ($29): 5 Projects, 10,000 Credit/Week, Custom Model
- Master ($99): 10 Projects, 50,000 Credit/Week, Early Access
- Legend ($299): 20 Projects, 150,000 Credit/Week, Special Support

---

## WebSocket Event Mapping

| Page | Hook | WS Events |
|------|------|-----------|
| Dashboard | `useDashboard` | `project:created`, `project:updated`, `project:deleted` |
| Chat | `useCommandRoom` | `chat:message`, `agent:spawned`, `agent:completed`, `agent:failed` |
| Sessions | local | `session:status`, `checkpoint:saved`, `log:entry` |
| Agents | local | — |
| Skills | local | — |
| Teams | local | — |
| Gates | local | `gate:verdict` |
| Wiki | `useDocuments` | `document:created`, `document:updated` |
| Assets | `useAssets` | `asset:created`, `asset:updated`, `asset:deleted` |
| Tickets | `useTickets` | `ticket:created`, `ticket:updated`, `ticket:moved`, `ticket:deleted` |
| Settings | `useSettings` | `settings:updated` |

---

## Custom Hooks

### `useDashboard.ts`
- `data`, `loading`, `error`, `retry`
- `createProject`, `deleteProject`, `updateProject`

### `useAssets.ts`
- `data`, `loading`, `error`, `retry`
- `createAsset`, `updateAsset`, `deleteAsset`, `updateArtBible`

### `useTickets.ts`
- `data`, `loading`, `error`, `retry`
- `acknowledgeTicket`

### `useSettings.ts`
- `data`, `loading`, `error`, `retry`
- `updateSettings`, `resetSettings`, `topUp`, `upgradeTier`, `consumeCredits`

### `useCommandRoom.ts`
- `sessions`, `currentSession`, `currentMessages`, `threadId`, `threadTitle`
- `executeCommand`, `selectSession`, `approveAgent`

### `useDocuments.ts`
- `documents`, `categories`, `selectedDocument`, `graphData`, `selectedId`
- `selectDocument`, `refresh`

### `useWebSocket.ts`
- Generic WebSocket hook with auto-reconnect (3s interval)
- Accepts `onEvent` callback for `WSEvent` handling
