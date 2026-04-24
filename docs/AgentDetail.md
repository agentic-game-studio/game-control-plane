# CCGS (Claude Code Game Studios) — Agent Documentation

## Agent File Format

ทุก agent ใช้ YAML frontmatter + markdown body:

```yaml
---
name: agent-name
description: "What this agent does"
tools: [Read, Glob, Grep, Write, Edit, Bash]
model: opus | sonnet | haiku
maxTurns: 20
disallowedTools: [Bash]
skills: [skill-name]
memory: user | project
---

[Agent prompt continues as markdown content]
```

---

## Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Agent identifier (unique) |
| `description` | string | One-liner about role |
| `tools` | array | Allowed tools (Read, Glob, Grep, Write, Edit, Bash, Task, WebSearch) |
| `model` | opus/sonnet/haiku | Model tier assignment |
| `maxTurns` | integer | Max conversation turns before termination |
| `disallowedTools` | array | Explicitly blocked tools |
| `skills` | array | Skill names this agent can invoke |
| `memory` | user/project | Memory persistence type |

---

## Model Routing

| Model | Tier | Use Case |
|-------|------|---------|
| **Opus** | 4 (Highest) | Strategic decisions, architecture, multi-document synthesis |
| **Sonnet** | 2 (Standard) | Implementation, design authoring, most agents |
| **Haiku** | 1 (Light) | Read-only, simple tasks |

---

## Collaboration Protocols

### Type A: Collaborative Implementer

```markdown
**You are a collaborative implementer, not an autonomous code generator.**
The user approves all architectural decisions and file changes.
```

**Workflow:**
1. Read design document
2. Ask architecture questions
3. Propose architecture before implementing
4. Implement with transparency
5. Get approval before writing files
6. Offer next steps

### Type B: Collaborative Consultant

```markdown
**You are a collaborative consultant, not an autonomous executor.**
The user makes all creative decisions; you provide expert guidance.
```

**Workflow:**
1. Ask clarifying questions
2. Present 2-4 options with reasoning
3. Draft based on user's choice
4. Get approval before writing files

---

## Agent Roles & Responsibilities

### Tier 1 — Leadership Agents (Opus)

| Agent | Role | Key Responsibilities |
|-------|------|---------------------|
| **creative-director** | Vision & Creative Authority | Game vision, pillars, tone, aesthetic direction, ludonarrative harmony, scope arbitration |
| **technical-director** | Technical Architecture | Engine decisions, performance budgets, tech stack, cross-system integration, ADRs |
| **producer** | Production Management | Sprint planning, milestone tracking, risk management, scope negotiation, cross-department coordination |

### Tier 2 — Department Leads (Sonnet)

| Agent | Role | Key Responsibilities |
|-------|------|---------------------|
| **game-designer** | Game Mechanics & Systems | Core loops, progression, combat mechanics, economy, balancing, player experience |
| **lead-programmer** | Code Architecture | System design, code review, API design, refactoring strategy, pattern enforcement |
| **art-director** | Visual Identity | Art bible, style guides, asset standards, color palettes, visual hierarchy, UI/UX direction |
| **audio-director** | Audio Strategy | Music direction, sound palette, audio implementation, sonic branding |
| **narrative-director** | Story Architecture | Story structure, world-building, character design, dialogue systems, ludonarrative harmony |
| **qa-lead** | Quality Assurance | Test strategy, bug triage, release quality gates, regression management |
| **release-manager** | Release Pipeline | Certification, versioning, store submissions, deployment, hotfixes |
| **localization-lead** | Internationalization | String externalization, translation pipeline, locale testing |

### Tier 3 — Specialists (Sonnet/Haiku)

| Agent | Model | Role |
|-------|-------|------|
| **systems-designer** | Sonnet | Combat formulas, crafting recipes, status effect interactions |
| **level-designer** | Sonnet | Level layouts, encounter pacing, difficulty curves |
| **economy-designer** | Sonnet | Resource economies, loot tables, progression curves, sink/faucet modeling |
| **live-ops-designer** | Sonnet | Seasons, events, battle passes, retention mechanics, live economy |
| **ux-designer** | Sonnet | User flows, accessibility, input handling, onboarding |
| **gameplay-programmer** | Sonnet | Gameplay feature implementation |
| **engine-programmer** | Sonnet | Core engine systems (rendering, physics, memory) |
| **ai-programmer** | Sonnet | Behavior trees, pathfinding, NPC AI, decision-making |
| **network-programmer** | Sonnet | Netcode, replication, lag compensation, matchmaking |
| **ui-programmer** | Sonnet | UI screens, widgets, data binding |
| **tools-programmer** | Sonnet | Editor extensions, pipeline automation |
| **performance-analyst** | Sonnet | Profiling, optimization, memory analysis |
| **technical-artist** | Sonnet | Shaders, VFX, art pipeline tools |
| **sound-designer** | Haiku | SFX specs, audio events, mixing documentation |
| **writer** | Sonnet | Dialogue, lore entries, item descriptions |
| **world-builder** | Sonnet | Factions, history, geography, ecology, world rules |
| **prototyper** | Sonnet | Rapid throwaway prototypes, mechanic validation |
| **devops-engineer** | Haiku | CI/CD, build scripts, branching strategy |
| **analytics-engineer** | Sonnet | Event tracking, dashboards, A/B tests |
| **community-manager** | Haiku | Patch notes, player feedback, community health |
| **security-engineer** | Sonnet | Anti-cheat, save encryption, network security |
| **accessibility-specialist** | Sonnet | WCAG compliance, colorblind modes, remapping |
| **qa-tester** | Haiku | Test cases, bug reports, test execution |

### Engine Specialists

| Agent | Model | Role |
|-------|-------|------|
| **godot-specialist** | Sonnet | Godot 4 authority: GDScript, node/scene, signals, resources |
| **godot-gdscript-specialist** | Sonnet | GDScript patterns, static typing, signals, coroutines |
| **godot-shader-specialist** | Sonnet | Godot shading language, visual shaders, particles |
| **godot-gdextension-specialist** | Sonnet | C++/Rust bindings, GDExtension, native performance |
| **unity-specialist** | Sonnet | Unity authority: MonoBehaviour/DOTS, Addressables, URP |
| **unity-dots-specialist** | Sonnet | DOTS/ECS, Jobs, Burst compiler |
| **unity-shader-specialist** | Sonnet | Shader Graph, VFX Graph, SRP customization |
| **unity-ui-specialist** | Sonnet | UI Toolkit, UGUI, UXML/USS |
| **unity-addressables-specialist** | Sonnet | Addressables, async loading, memory management |
| **unreal-specialist** | Sonnet | UE5 authority: Blueprint/C++, GAS, subsystems |
| **ue-gas-specialist** | Sonnet | Gameplay Ability System, abilities, effects |
| **ue-blueprint-specialist** | Sonnet | Blueprint architecture, BP/C++ boundary |
| **ue-replication-specialist** | Sonnet | Property replication, RPCs, prediction |
| **ue-umg-specialist** | Sonnet | UMG/CommonUI, widget hierarchy, data binding |

---

## Organizational Hierarchy

```
                           [Human Developer]
                                 |
                 +---------------+---------------+
                 |               |               |
         creative-director  technical-director  producer
                 |               |               |
        +--------+--------+     |        (coordinates all)
        |        |        |     |
  game-designer art-dir  narr-dir  lead-programmer  qa-lead  audio-dir
        |        |        |         |                |        |
     +--+--+     |     +--+--+  +--+--+--+--+--+   |        |
     |  |  |     |     |     |  |  |  |  |  |  |   |        |
    sys lvl eco  ta   wrt  wrld gp ep  ai net tl ui qa-t    snd
                                 |
                             +---+---+
                             |       |
                          perf-a   devops   analytics

  Additional Leads:
    release-manager         -- Release pipeline, versioning, deployment
    localization-lead       -- i18n, string tables, translation pipeline
    prototyper              -- Rapid throwaway prototypes, concept validation
    security-engineer       -- Anti-cheat, exploits, data privacy, network security
    accessibility-specialist -- WCAG, colorblind, remapping, text scaling
    live-ops-designer       -- Seasons, events, battle passes, retention, live economy
    community-manager       -- Patch notes, player feedback, crisis comms
```

---

## Delegation Rules

### Who Can Delegate to Whom

| From | Can Delegate To |
|------|----------------|
| creative-director | game-designer, art-director, audio-director, narrative-director |
| technical-director | lead-programmer, devops-engineer, performance-analyst, technical-artist |
| producer | Any agent (task assignment within their domain only) |
| game-designer | systems-designer, level-designer, economy-designer |
| lead-programmer | gameplay-programmer, engine-programmer, ai-programmer, network-programmer, tools-programmer, ui-programmer |
| art-director | technical-artist, ux-designer |
| audio-director | sound-designer |
| narrative-director | writer, world-builder |
| qa-lead | qa-tester |
| release-manager | devops-engineer (release builds), qa-lead (release testing) |
| [engine]-specialist | engine sub-specialists |

### Escalation Paths

| Situation | Escalate To |
|---------|------------|
| Two designers disagree on a mechanic | game-designer |
| Game design vs narrative conflict | creative-director |
| Game design vs technical feasibility | producer → creative-director + technical-director |
| Art vs audio tonal conflict | creative-director |
| Code architecture disagreement | technical-director |
| Schedule conflict between departments | producer |
| Scope exceeds capacity | producer → creative-director for cuts |
| Quality gate disagreement | qa-lead → technical-director |
| Performance budget violation | performance-analyst → technical-director |

---

## All 51 Agents

### Leadership (6)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **creative-director** | opus | Read, Glob, Grep, Write, Edit, WebSearch | Bash | brainstorm, design-review | user |
| **technical-director** | opus | Read, Glob, Grep, Write, Edit, Bash, WebSearch | — | — | user |
| **producer** | opus | Read, Glob, Grep, Write, Edit, Bash, WebSearch | — | sprint-plan, scope-check, estimate, milestone-review | user |
| **art-director** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | Bash | — | project |
| **audio-director** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | — | — | — |
| **narrative-director** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | Bash | — | project |

### Design (6)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **game-designer** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | Bash | design-review, balance-check, brainstorm | project |
| **systems-designer** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | — | — | — |
| **level-designer** | sonnet | Read, Glob, Grep, Write, Edit | — | — | — |
| **ux-designer** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | Bash | — | project |
| **economy-designer** | sonnet | Read, Glob, Grep, Write, Edit, WebSearch | — | — | — |
| **live-ops-designer** | sonnet | Read, Glob, Grep, Write, Edit, Task | Bash | — | — |

### Programming (8)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **lead-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | code-review, architecture-decision, tech-debt | project |
| **engine-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **gameplay-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **ai-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **network-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **ui-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **tools-programmer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **performance-analyst** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |

### Godot Specialists (5)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **godot-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **godot-gdscript-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **godot-csharp-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **godot-gdextension-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **godot-shader-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |

### Unity Specialists (5)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **unity-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **unity-shader-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **unity-ui-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **unity-dots-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **unity-addressables-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |

### Unreal Specialists (5)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **unreal-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **ue-blueprint-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **ue-gas-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **ue-replication-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **ue-umg-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |

### Production/Ops (5)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **devops-engineer** | haiku | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **release-manager** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | release-checklist, changelog, patch-notes | — |
| **localization-lead** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **community-manager** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **analytics-engineer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |

### QA (4)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **qa-lead** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | bug-report, release-checklist | project |
| **qa-tester** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **security-engineer** | sonnet | Read, Glob, Grep, Write, Edit, Bash, Task | — | — | — |
| **accessibility-specialist** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |

### Content (5)

| Agent | Model | Tools | disallowedTools | Skills | Memory |
|-------|-------|-------|-----------------|--------|--------|
| **world-builder** | sonnet | Read, Glob, Grep, Write, Edit | Bash | — | project |
| **sound-designer** | haiku | Read, Glob, Grep, Write, Edit | Bash | — | — |
| **writer** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **prototyper** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |
| **technical-artist** | sonnet | Read, Glob, Grep, Write, Edit, Bash | — | — | — |

---

## 68 Slash Commands

### Onboarding & Navigation (5)

| Command | ทำอะไร |
|---------|--------|
| `/start` | สำหรับครั้งแรก — ถามว่าอยู่ขั้นไหน แล้วชี้ไปที่ workflow ที่ถูกต้อง |
| `/help` | "ฉันควรทำอะไรต่อ?" — ดู current stage แล้วบอกขั้นตอนถัดไป |
| `/project-stage-detect` | ตรวจทั้ง project — ดู phase, หา gap, แนะนำ next steps |
| `/setup-engine` | ตั้งค่า engine + version, หา knowledge gaps, สร้าง version-aware reference docs |
| `/adopt` | ตรวจ format ของ GDDs/ADRs/stories ที่มีอยู่ แล้ววางแผน migration |

### Game Design (6)

| Command | ทำอะไร |
|---------|--------|
| `/brainstorm` | สร้างไอเดียแบบมืออาชีพ (MDA, SDT, Bartle, verb-first) |
| `/map-systems` | แยก game concept ออกเป็น systems, map dependencies, จัดลำดับ design |
| `/design-system` | เขียน GDD ทีละส่วนสำหรับหนึ่ง game system |
| `/quick-design` | Design spec แบบเบา — สำหรับ tuning, tweaks, minor additions |
| `/review-all-gdds` | ตรวจความสอดคล้องของ GDDs ทั้งหมด |
| `/propagate-design-change` | เมื่อ GDD ถูกแก้ไข หา ADRs ที่เกี่ยวข้อง แล้วสร้าง impact report |

### UX & Interface Design (2)

| Command | ทำอะไร |
|---------|--------|
| `/ux-design` | เขียน UX spec ทีละส่วน (screen/flow, HUD, หรือ pattern library) |
| `/ux-review` | ตรวจ UX specs ว่าตรงกับ GDD, accessibility, pattern compliance ไหม |

### Architecture (4)

| Command | ทำอะไร |
|---------|--------|
| `/create-architecture` | เขียน master architecture document |
| `/architecture-decision` | สร้าง ADR (Architecture Decision Record) |
| `/architecture-review` | ตรวจ ADRs ทั้งหมดว่าครบ, dependencies ถูกลำดับ, ครอบ GDD ไหม |
| `/create-control-manifest` | สร้าง programmer rules sheet จาก accepted ADRs |

### Stories & Sprints (8)

| Command | ทำอะไร |
|---------|--------|
| `/create-epics` | แปลง GDDs + ADRs เป็น epics — หนึ่ง epic ต่อ architectural module |
| `/create-stories` | แยก epic เดียวออกเป็น story files ที่ implement ได้ |
| `/dev-story` | อ่าน story แล้ว implement — ส่งไปให้ programmer agent ที่ถูกต้อง |
| `/sprint-plan` | สร้างหรือ update sprint plan; เริ่ม sprint-status.yaml |
| `/sprint-status` | สร้าง sprint snapshot 30 บรรทัด |
| `/story-readiness` | ตรวจว่า story พร้อม implement หรือยัง (READY/NEEDS WORK/BLOCKED) |
| `/story-done` | 8-phase completion review หลัง implement |
| `/estimate` | ประมาณ effort พร้อม complexity, dependencies, risk breakdown |

### Reviews & Analysis (10)

| Command | ทำอะไร |
|---------|--------|
| `/design-review` | ตรวจ game design document ว่าครบและสอดคล้องไหม |
| `/code-review` | Architectural code review สำหรับ file หรือ changeset |
| `/balance-check` | วิเคราะห์ game balance data, formulas, config — หา outliers |
| `/asset-audit` | ตรวจ assets ว่าตรง naming conventions, file size budgets ไหม |
| `/content-audit` | ตรวจ GDD-specified content counts ว่าตรงกับ implemented ไหม |
| `/scope-check` | วิเคราะห์ feature/sprint scope หา scope creep |
| `/perf-profile` | Structured performance profiling พร้อมหา bottleneck |
| `/tech-debt` | สแกน, track, จัดลำดับ, รายงาน tech debt |
| `/gate-check` | ตรวจความพร้อมที่จะข้าม development phases |
| `/consistency-check` | สแกน GDDs กับ entity registry หาข้อขัดแย้ง |

### QA & Testing (10)

| Command | ทำอะไร |
|---------|--------|
| `/qa-plan` | สร้าง QA test plan สำหรับ sprint หรือ feature |
| `/smoke-check` | Run critical path smoke test gate ก่อน QA hand-off |
| `/soak-test` | สร้าง soak test protocol สำหรับ extended play sessions |
| `/regression-suite` | Map test coverage กับ GDD critical paths |
| `/test-setup` | ตั้ง test framework และ CI/CD pipeline |
| `/test-helpers` | สร้าง engine-specific test helper libraries |
| `/test-evidence-review` | ตรวจ quality ของ test files |
| `/test-flakiness` | หา non-deterministic (flaky) tests จาก CI logs |
| `/skill-test` | ตรวจ skill files ว่าถูก format และ behavior ถูกต้องไหม |

### Production (7)

| Command | ทำอะไร |
|---------|--------|
| `/milestone-review` | ตรวจ milestone progress แล้วสร้าง status report |
| `/retrospective` | ทำ structured sprint หรือ milestone retrospective |
| `/bug-report` | สร้าง structured bug report |
| `/bug-triage` | อ่าน bugs ที่เปิดอยู่, re-evaluate priority, assign owner |
| `/reverse-document` | สร้าง design หรือ architecture docs จาก existing implementation |
| `/playtest-report` | สร้าง structured playtest report หรือวิเคราะห์ playtest notes |
| `/reverse-document` | สร้าง design/architecture docs จาก existing code |

### Release (5)

| Command | ทำอะไร |
|---------|--------|
| `/release-checklist` | สร้างและตรวจ pre-release checklist |
| `/launch-checklist` | Complete launch readiness validation ทุก department |
| `/changelog` | Auto-generate changelog จาก git commits |
| `/patch-notes` | สร้าง player-facing patch notes จาก git history |
| `/hotfix` | Emergency fix workflow พร้อม audit trail |

### Creative & Content (3)

| Command | ทำอะไร |
|---------|--------|
| `/prototype` | Rapid throwaway prototype เพื่อ validate mechanic |
| `/onboard` | สร้าง onboarding document สำหรับ new contributor |
| `/localize` | Localization workflow: string extraction, validation |

### Team Orchestration (9)

| Command | Agents |
|---------|--------|
| `/team-combat` | game-designer + gameplay-programmer + ai-programmer + technical-artist + sound-designer + qa-tester |
| `/team-narrative` | narrative-director + writer + world-builder + level-designer |
| `/team-ui` | ux-designer + ui-programmer + art-director + accessibility-specialist |
| `/team-release` | release-manager + qa-lead + devops-engineer + producer |
| `/team-polish` | performance-analyst + technical-artist + sound-designer + qa-tester |
| `/team-audio` | audio-director + sound-designer + technical-artist + gameplay-programmer |
| `/team-level` | level-designer + narrative-director + world-builder + art-director + systems-designer + qa-tester |
| `/team-live-ops` | live-ops-designer + economy-designer + community-manager + analytics-engineer |
| `/team-qa` | qa-lead + qa-tester + gameplay-programmer + producer |

---

## Skills Inventory

| Skill | Used By |
|-------|---------|
| `sprint-plan` | producer |
| `scope-check` | producer |
| `estimate` | producer |
| `milestone-review` | producer |
| `brainstorm` | creative-director, game-designer |
| `design-review` | creative-director, game-designer |
| `balance-check` | game-designer |
| `code-review` | lead-programmer |
| `architecture-decision` | lead-programmer |
| `tech-debt` | lead-programmer |
| `bug-report` | qa-lead |
| `release-checklist` | qa-lead, release-manager |
| `changelog` | release-manager |
| `patch-notes` | release-manager |

---

## Memory Types

| Type | Description |
|------|-------------|
| `user` | Persistent user preferences (survives compaction) |
| `project` | Project-specific context |

---

## Gate Verdict Format

Director agents มี special output format สำหรับ gate reviews:

```
[GATE-ID]: APPROVE | CONCERNS | REJECT
```

| Gate | Agent |
|------|-------|
| `CD-PILLARS`, `CD-GDD-ALIGN`, `CD-NARRATIVE-FIT` | creative-director |
| `TD-FEASIBILITY`, `TD-ARCHITECTURE`, `TD-CHANGE-IMPACT`, `TD-MANIFEST` | technical-director |
| `PR-SPRINT`, `PR-EPIC`, `PR-MILESTONE`, `PR-SCOPE` | producer |
| `AD-ART-BIBLE`, `AD-CONCEPT-VISUAL` | art-director |

---

## Review Modes

ทุก gate มี 3 review modes:

| Mode | Behavior |
|------|----------|
| `full` | All gates active |
| `lean` | **Default** — PHASE-GATEs only |
| `solo` | No gates (game jams, prototypes) |

Config: `production/review-mode.txt`

---

## Workflow Patterns

### Pattern 1: New Feature (Full Pipeline)
```
1. creative-director  -- Approves feature concept aligns with vision
2. game-designer      -- Creates design document with full spec
3. producer           -- Schedules work, identifies dependencies
4. lead-programmer   -- Designs code architecture, creates interface sketch
5. [specialist-programmer] -- Implements the feature
6. technical-artist   -- Implements visual effects (if needed)
7. writer             -- Creates text content (if needed)
8. sound-designer    -- Creates audio event list (if needed)
9. qa-tester          -- Writes test cases
10. qa-lead           -- Reviews and approves test coverage
11. lead-programmer   -- Code review
12. qa-tester         -- Executes tests
13. producer          -- Marks task complete
```

### Pattern 2: Bug Fix
```
1. qa-tester          -- Files bug report with /bug-report
2. qa-lead            -- Triages severity and priority
3. producer           -- Assigns to sprint (if not S1)
4. lead-programmer    -- Identifies root cause, assigns to programmer
5. [specialist-programmer] -- Fixes the bug
6. lead-programmer    -- Code review
7. qa-tester          -- Verifies fix and runs regression
8. qa-lead            -- Closes bug
```

### Pattern 3: Sprint Cycle
```
1. producer           -- Plans sprint with /sprint-plan new
2. [All agents]       -- Execute assigned tasks
3. producer           -- Daily status with /sprint-plan status
4. qa-lead            -- Continuous testing during sprint
5. lead-programmer    -- Continuous code review during sprint
6. producer           -- Sprint retrospective with post-sprint hook
7. producer           -- Plans next sprint incorporating learnings
```

### Pattern 4: Release Pipeline
```
1. producer             -- Declares release candidate
2. release-manager      -- Cuts release branch, generates /release-checklist
3. qa-lead              -- Runs full regression, signs off on quality
4. localization-lead    -- Verifies all strings translated
5. performance-analyst   -- Confirms performance benchmarks within targets
6. devops-engineer      -- Builds release artifacts, runs deployment pipeline
7. release-manager      -- Generates /changelog, tags release
8. technical-director   -- Final sign-off on major releases
9. release-manager      -- Deploys and monitors for 48 hours
10. producer            -- Marks release complete
```

---

## Strategic Decision Pattern

Director-level agents มอบตัวเลือกผ่าน AskUserQuestion:

1. **Understand the full context**
2. **Frame the decision** — state core question + evaluation criteria
3. **Present 2-3 strategic options** — pros/cons, downstream consequences
4. **Make a clear recommendation**
5. **Support the user's decision** — document + cascade

---

## Common Pattern: Question-First Workflow (Consultants)

1. Ask clarifying questions
2. Present 2-4 options with reasoning
3. Draft based on user's choice
4. Get approval before writing files

---

## Common Pattern: Implementation Workflow (Implementers)

1. Read the design document
2. Ask architecture questions
3. Propose architecture before implementing
4. Implement with transparency
5. Get approval before writing files
6. Offer next steps

---

## Version Awareness Pattern (Engine Specialists)

**CRITICAL**: Before suggesting engine API code, you MUST:
1. Read `docs/engine-reference/{engine}/VERSION.md` to confirm engine version
2. Check `docs/engine-reference/{engine}/deprecated-apis.md`
3. Check `docs/engine-reference/{engine}/breaking-changes.md`
4. For subsystem work, read relevant `docs/engine-reference/{engine}/modules/*.md`

---

## Tools Summary

| Tool | Agents Using |
|------|-------------|
| **Bash** | programming, QA, production, engine specialists |
| **WebSearch** | directors, game-designer, ux-designer, live-ops-designer |
| **Task** | godot-specialist, security-engineer, live-ops-designer, engine specialists |
| **disallowedTools: Bash** | creative-director, game-designer, world-builder, narrative-director, ux-designer, art-director, live-ops-designer, sound-designer |

---

## maxTurns Distribution

| maxTurns | Agents |
|----------|--------|
| 30 | creative-director, technical-director, producer |
| 20 | most sonnet agents (designers, programmers, QA) |
| 10 | haiku agents (devops-engineer, sound-designer, accessibility-specialist) |

---

## Stories & Sprints Command Groups

| หมวด | Commands |
|------|----------|
| แตก Epic/Story | `/create-epics`, `/create-stories`, `/story-readiness`, `/estimate` |
| Implementation | `/dev-story`, `/story-done`, `/sprint-plan` |
| Review | `/code-review`, `/design-review`, `/gate-check`, `/consistency-check` |
| QA | `/qa-plan`, `/smoke-check`, `/test-setup`, `/bug-report` |
| Release | `/release-checklist`, `/changelog`, `/patch-notes`, `/hotfix` |

---

## Summary

- **51 agents total** ใน CCGS
- **3 model tiers**: Opus (strategic), Sonnet (implementers), Haiku (light)
- **2 collaboration types**: Implementer (Type A) vs Consultant (Type B)
- **Standard YAML frontmatter** format
- **Standard workflows** สำหรับทุก agent type
- **Gate verdicts** สำหรับ director-level reviews (25 gates)
- **Delegation maps** สำหรับ cross-team coordination
- **Engine specialists** มี 15 agents สำหรับ Godot, Unity, Unreal
- **68 slash commands** ครอบคลุมทุกขั้นตอนของการพัฒนาเกม
- **9 team orchestrators** สำหรับประสานงานหลาย agents
