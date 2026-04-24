# Agent Document Map

คู่มืออ้างอิง: Agent ตัวไหนสร้างเอกสารประเภทไหน เก็บที่ไหน

---

## ประเภทเอกสาร (Document Types)

### มี Template อย่างเป็นทางการ

| ประเภท | Path | Template | Section |
|---------|------|----------|---------|
| GDD (Game Design Document) | `design/gdd/*.md` | `GDD_TEMPLATE` (8 sections) | Overview, Player Fantasy, Detailed Rules, Formulas, Edge Cases, Dependencies, Tuning Knobs, Acceptance Criteria |
| ADR (Architecture Decision Record) | `docs/architecture/*.md` | `ADR_TEMPLATE` | Status, Context, Decision, Alternatives (A/B + Pros/Cons), Consequences, Related GDDs, Engine Version |

### ประเภทอื่นๆ (ยังไม่มี Template)

| ประเภท | Path | หมายเหตุ |
|---------|------|----------|
| Art Bible | `design/art/art-bible.md` | รูปแบบศิลป์หลักของเกม |
| Narrative / Lore / Dialogue | `design/narrative/*.md` | เรื่องราว ตำนาน บทสนทนา |
| Level Design | `design/levels/*.md` | แผนผังด่าน |
| Balance Data | `design/balance/*.md` | สมดุลเศรษฐกิจเกม |
| UX Specification | `design/ux/*.md` | ข้อกำหนด UX/UI |
| Quick Design Spec | (ข้าง GDD ที่เกี่ยวข้อง) | สเปคด่วนสำหรับระบบย่อย |
| Sprint Plan | `production/sprints/sprint-NN.md` | แผน sprint |
| Epic | `production/epics/*/EPIC.md` | เอปิกหลัก |
| Story | `production/epics/*/story-*.md` | สตอรี่ในเอปิก |
| Milestone | `production/milestones/*.md` | รีวิว milestone |
| QA Test Plan | `production/qa/*.md` | แผนทดสอบ |
| Smoke Check | `production/qa/smoke-[date].md` | รายงาน smoke test |
| Bug Report | (ใน session/production) | รายงานบั๊ก |
| Playtest Report | `production/playtests/*.md` | รายงานเทสเกม |
| Release Checklist | `production/releases/*.md` | เช็คลิสต์ release |
| Changelog | `production/releases/` | บันทึกการเปลี่ยนแปลง |
| Patch Notes | `production/releases/` | โน้ตอัปเดต |
| Prototype | `prototypes/*.md` | รายงาน prototype |
| Onboarding Doc | (project-context) | เอกสารออนบอร์ด |

---

## Agent สร้างเอกสารอะไรบ้าง

### Tier 1 — Leadership (Opus)

#### creative-director
- **เอกสาร:** Pillar definitions, Concept docs, GDDs (ร่วม), Phase gate verdicts, Cross-GDD reviews
- **Skills:** `design-system`, `brainstorm`, `design-review`, `gate-check`
- **ทีมที่คุม:** team-combat, team-narrative, team-ui, team-level

#### technical-director
- **เอกสาร:** Master architecture doc, ADRs, Architecture reviews, Control manifests
- **Skills:** `create-architecture`, `architecture-decision`, `architecture-review`, `perf-profile`, `code-review`, `gate-check`
- **ทีมที่คุม:** team-performance, team-release, team-multiplayer

#### producer
- **เอกสาร:** Sprint plans, Epic files, Story files, Milestone reviews, Retrospectives, Scope reports, Estimates
- **Skills:** `sprint-plan`, `create-epics`, `create-stories`, `milestone-review`, `retrospective`, `scope-check`, `estimate`, `bug-triage`, `gate-check`

---

### Tier 2 — Department Leads (Sonnet)

#### game-designer
- **เอกสาร:** GDDs (ผู้เขียนหลัก), System maps, Balance analysis, Quick design specs, Design change impact reports
- **Skills:** `design-system`, `map-systems`, `brainstorm`, `quick-design`, `balance-check`, `content-audit`, `propagate-design-change`
- **Path:** `design/gdd/`

#### lead-programmer
- **เอกสาร:** Architecture docs (ร่วม), ADRs (ร่วม), Tech debt reports, Story implementations
- **Skills:** `code-review`, `create-architecture`, `architecture-decision`, `dev-story`, `story-done`, `tech-debt`
- **Path:** `docs/architecture/`

#### art-director
- **เอกสาร:** Art Bible, UX specs (ร่วม), UX reviews, Asset audit reports
- **Skills:** `art-bible`, `ux-design`, `ux-review`, `asset-audit`
- **Path:** `design/art/`, `design/ux/`

#### audio-director
- **เอกสาร:** Audio direction docs
- **Skills:** (ไม่มี skill เฉพาะ ทำงานผ่าน team-audio)
- **Path:** `design/audio/` (ไม่มี template)

#### narrative-director
- **เอกสาร:** Narrative direction briefs, Onboarding docs, Story/lore oversight
- **Skills:** `design-system`, `onboard`
- **Path:** `design/narrative/`

#### qa-lead
- **เอกสาร:** QA test plans, Smoke check reports, Soak test protocols, Regression suite mappings, Test evidence reviews, Flakiness reports
- **Skills:** `qa-plan`, `smoke-check`, `soak-test`, `regression-suite`, `test-setup`, `test-evidence-review`, `test-flakiness`
- **Path:** `production/qa/`

#### release-manager
- **เอกสาร:** Release checklists, Launch checklists, Changelogs, Patch notes, Hotfix audit trails
- **Skills:** `release-checklist`, `launch-checklist`, `changelog`, `patch-notes`, `hotfix`
- **Path:** `production/releases/`

#### localization-lead
- **เอกสาร:** Localization readiness reports, String extraction docs
- **Skills:** `localize`
- **Path:** `design/localization/` (ไม่มี template)

---

### Tier 3 — Specialists (Sonnet/Haiku)

#### systems-designer
- **เอกสาร:** GDD sections (รับมอบหมาย), Quick design specs, Balance analysis
- **Skills:** `design-system`, `quick-design`, `balance-check`
- **Path:** `design/gdd/`, `design/balance/`

#### level-designer
- **เอกสาร:** Level design docs
- **Skills:** `design-system`, `quick-design`
- **Path:** `design/levels/`

#### economy-designer
- **เอกสาร:** Balance data, Economy GDD sections
- **Skills:** `balance-check`, `design-system`
- **Path:** `design/balance/`

#### ux-designer
- **เอกสาร:** UX specifications, UX reviews
- **Skills:** `ux-design`, `ux-review`
- **Path:** `design/ux/`

#### writer
- **เอกสาร:** Dialogue, Lore entries, Item descriptions
- **Skills:** (ทำงานผ่าน team-narrative)
- **Path:** `design/narrative/`

#### world-builder
- **เอกสาร:** World lore, Faction docs, History, Geography
- **Skills:** (ทำงานผ่าน team-narrative)
- **Path:** `design/narrative/`

#### qa-tester
- **เอกสาร:** Bug reports, Test cases, Smoke check results
- **Skills:** `bug-report`, `qa-plan`, `smoke-check`
- **Path:** `production/qa/`

#### performance-analyst
- **เอกสาร:** Performance profiling reports
- **Skills:** `perf-profile`, `smoke-check`
- **Path:** `production/qa/`

#### devops-engineer
- **เอกสาร:** CI/CD configs, Test framework scaffolding
- **Skills:** `test-setup`, `release-checklist`
- **Path:** (config files)

#### prototyper
- **เอกสาร:** Prototype findings reports
- **Skills:** `prototype`
- **Path:** `prototypes/`

#### community-manager
- **เอกสาร:** Patch notes, Changelogs
- **Skills:** `changelog`, `patch-notes`
- **Path:** `production/releases/`

#### accessibility-specialist
- **เอกสาร:** Accessibility review reports
- **Skills:** `ux-review`
- **Path:** `design/ux/`

#### security-engineer
- **เอกสาร:** Security audit reports
- **Skills:** `security-audit`
- **Path:** `production/security/` (ไม่มี template)

---

## โครงสร้าง Path เต็ม

```
design/
  gdd/                  <-- game-designer, systems-designer
  narrative/            <-- writer, world-builder, narrative-director
  levels/               <-- level-designer
  balance/              <-- economy-designer
  ux/                   <-- ux-designer, art-director
  art/art-bible.md      <-- art-director
  audio/                <-- audio-director
  localization/         <-- localization-lead

docs/
  architecture/         <-- technical-director, lead-programmer
  api/                  <-- (ไม่มี agent เฉพาะ)
  postmortems/          <-- (ไม่มี agent เฉพาะ)
  engine-reference/     <-- setup-engine skill

production/
  sprints/              <-- producer
  milestones/           <-- producer
  releases/             <-- release-manager, community-manager
  epics/                <-- producer
    */EPIC.md
    */story-*.md
  playtests/            <-- (playtest-report skill)
  qa/                   <-- qa-lead, qa-tester, performance-analyst
  security/             <-- security-engineer

prototypes/             <-- prototyper
tests/                  <-- qa-lead, devops-engineer
```

---

## สรุป: Agent ตัวไหนสร้างเอกสารเยอะสุด

| Agent | จำนวนประเภทเอกสาร | หน้าที่หลัก |
|-------|-------------------|-------------|
| producer | 7+ | วางแผน sprint, epic, story, milestone |
| creative-director | 5+ | กำหนดทิศทางเกม, review ทุกดีไซน์ |
| game-designer | 5+ | เขียน GDD หลัก, วิเคราะห์สมดุล |
| technical-director | 4+ | สถาปัตยกรรม, ADR, review |
| qa-lead | 6+ | แผนทดสอบ, smoke check, regression |
| release-manager | 5+ | Release checklist, changelog, patch notes |
| art-director | 4+ | Art Bible, UX spec, asset audit |
