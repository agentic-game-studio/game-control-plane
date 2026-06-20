/**
 * sprint-dispatcher.ts — pure area→team routing for /sprint.
 *
 * Ticket.area is a FREEFORM string (there is no enum — see packages/types/
 * tickets.ts). The canonical top-level areas come from gdd-ingest-service's
 * AREA_MAP (engineering, content, art, qa, design) plus the WORKFLOW literal
 * emitted by the Task tool, plus hierarchical ticket-generator prefixes
 * (engineering/ui, art/sprites, content/narrative, ...). This module routes any
 * area to one of the 12 REAL team skills.
 *
 * NOTE: there is NO team-performance (it does not exist — performance work lives
 * in team-polish). team-polish and team-release are lifecycle-stage teams invoked
 * by the /polish and /release pipelines respectively, NOT /sprint work-area
 * targets — so no area routes to them here. That is intentional, not an omission.
 * 10 of the 12 teams are /sprint dispatch targets.
 */

import type { AgentRole, SkillName } from "@game-studio/types";

/** Direct + normalized area-token → team skill. Lowercased keys. */
export const AREA_TO_TEAM: Record<string, SkillName> = {
  combat: "team-combat",
  ui: "team-ui",
  level: "team-level",
  audio: "team-audio",
  sfx: "team-audio",
  music: "team-audio",
  art: "team-world",
  sprite: "team-world",
  sprites: "team-world",
  animation: "team-world",
  tileset: "team-world",
  vfx: "team-world",
  content: "team-narrative",
  narrative: "team-narrative",
  writing: "team-narrative",
  dialogue: "team-narrative",
  localization: "team-narrative",
  lore: "team-narrative",
  design: "team-progression",
  balance: "team-progression",
  difficulty: "team-progression",
  economy: "team-live-ops",
  "live-ops": "team-live-ops",
  liveops: "team-live-ops",
  analytics: "team-live-ops",
  qa: "team-qa",
  testing: "team-qa",
  test: "team-qa",
  multiplayer: "team-multiplayer",
  network: "team-multiplayer",
  netcode: "team-multiplayer",
  // bare engineering (no combat/ui/level subarea) → team-qa (has gameplay-programmer).
  engineering: "team-qa",
  engine: "team-qa",
  physics: "team-qa",
  ai: "team-qa",
};

/** Key dispatch agent per team (the team's primary worker — one ticket per dispatch). */
export const TEAM_LEAD_AGENT: Partial<Record<SkillName, AgentRole>> = {
  "team-combat": "gameplay-programmer",
  "team-ui": "ui-programmer",
  "team-level": "level-designer",
  "team-audio": "sound-designer",
  "team-world": "world-builder",
  "team-narrative": "writer",
  "team-progression": "game-designer",
  "team-qa": "qa-tester",
  "team-live-ops": "economy-designer",
  "team-multiplayer": "network-programmer",
  "team-polish": "performance-analyst",
  "team-release": "release-manager",
};

/** Safe fallback when an area maps to nothing recognizable. team-qa has a gameplay-programmer + qa-tester. */
export const FALLBACK_TEAM: SkillName = "team-qa";

/**
 * Generic engineering tokens that all map to team-qa. Kept separate so the
 * segment router can prefer a SPECIFIC team token (combat/ui/level/...) when one
 * appears alongside a generic one — i.e. "engineering/combat" → team-combat, not
 * team-qa. Also excluded from substring matching to avoid false positives like
 * "detail".includes("ai").
 */
const GENERIC_ENGINEERING_TOKENS = new Set(["engineering", "engine", "physics", "ai", "code", "coding"]);

/**
 * Route a freeform area string to a team skill. Matches exact token, then
 * hierarchical segments (preferring specific over generic so engineering/combat
 * → team-combat), then substring on specific tokens. Never throws.
 */
export function areaToTeamSkill(area: string): SkillName {
  const a = (area ?? "").trim().toLowerCase();
  if (!a) return FALLBACK_TEAM;
  if (AREA_TO_TEAM[a]) return AREA_TO_TEAM[a];
  const segs = a.split(/[\/\s\-_:.]+/).filter(Boolean);
  // 1. Prefer a SPECIFIC team segment (skips generic engineering so the subarea wins).
  for (const seg of segs) {
    if (AREA_TO_TEAM[seg] && !GENERIC_ENGINEERING_TOKENS.has(seg)) return AREA_TO_TEAM[seg];
  }
  // 2. Generic engineering segment → team-qa.
  for (const seg of segs) {
    if (AREA_TO_TEAM[seg]) return AREA_TO_TEAM[seg];
  }
  // 3. Substring on specific tokens only (avoid "ai"/"engine" false positives).
  for (const key of Object.keys(AREA_TO_TEAM)) {
    if (GENERIC_ENGINEERING_TOKENS.has(key)) continue;
    if (a.includes(key)) return AREA_TO_TEAM[key];
  }
  return FALLBACK_TEAM;
}

export function teamLeadAgent(teamSkill: SkillName): AgentRole {
  return TEAM_LEAD_AGENT[teamSkill] ?? "qa-tester";
}

export interface SprintDispatchUnit {
  teamSkill: SkillName;
  agent: AgentRole;
  area: string;
  ticketCount: number;
  ticketTitles: string[];
}

/**
 * Group tickets by their area→team mapping. Pure: takes any ticket-shaped objects
 * (must have `area?` + `title`), returns one dispatch unit per distinct team.
 * Stable ordering by first appearance.
 */
export function planSprintDispatch<T extends { area?: string; title: string }>(tickets: T[]): SprintDispatchUnit[] {
  const byTeam = new Map<SkillName, SprintDispatchUnit>();
  for (const t of tickets) {
    const team = areaToTeamSkill(t.area ?? "");
    let unit = byTeam.get(team);
    if (!unit) {
      unit = {
        teamSkill: team,
        agent: teamLeadAgent(team),
        area: t.area ?? "(unspecified)",
        ticketCount: 0,
        ticketTitles: [],
      };
      byTeam.set(team, unit);
    }
    unit.ticketCount += 1;
    unit.ticketTitles.push(t.title);
  }
  return Array.from(byTeam.values());
}
