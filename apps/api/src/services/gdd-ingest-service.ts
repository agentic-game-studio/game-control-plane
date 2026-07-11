/**
 * GDD ingestion service — parse GDD markdown and create Kanban tickets.
 * Shared by /api/gdd/ingest and autonomous loop startup.
 */

// 31-L-gdd-ingest-unused-sync-imports: the 27-M and Q26-6th
// passes migrated the hot path to async (`statAsync` and
// `readFile` from `fs/promises` are now imported below). The
// legacy `readFileSync` / `statSync` names from the `"fs"`
// import were never dropped; both names are now only mentioned
// in audit-reference comments. The TypeScript compiler strips
// unused imports, so this is purely a grep-noise / hygiene fix
// — no runtime cost.
import { existsSync } from "fs";
import { stat as statAsync } from "fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { loadConfig } from "../config.js";
import { readData } from "./data-store.js";
import { createQuestTicket } from "./quest-bridge.js";
import { readTicketsBoard } from "./ticket-board.js";
import { broadcast } from "./websocket.js";
import { logger } from "../utils/logger.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import { getEngineAdapter } from "./engine-adapter-factory.js";
import "../adapters/index.js";
import { EngineNotSupportedError } from "@game-studio/types";
import type { AgentRole, DashboardData, ProjectEngine, TicketsBoard, WSEvent } from "@game-studio/types";

const AREA_MAP: Record<string, { area: string; subarea: string; assignee: AgentRole }> = {
  player: { area: "engineering", subarea: "player", assignee: "godot-specialist" },
  movement: { area: "engineering", subarea: "player", assignee: "godot-specialist" },
  camera: { area: "engineering", subarea: "camera", assignee: "godot-specialist" },
  physics: { area: "engineering", subarea: "physics", assignee: "godot-specialist" },
  combat: { area: "engineering", subarea: "combat", assignee: "godot-specialist" },
  enemy: { area: "engineering", subarea: "enemy", assignee: "godot-specialist" },
  tilemap: { area: "engineering", subarea: "tilemap", assignee: "godot-specialist" },
  level: { area: "engineering", subarea: "level", assignee: "godot-specialist" },
  saving: { area: "engineering", subarea: "save-system", assignee: "godot-specialist" },
  audio: { area: "engineering", subarea: "audio", assignee: "sound-designer" },
  "ui/hud": { area: "engineering", subarea: "ui", assignee: "godot-specialist" },
  "ui/menu": { area: "engineering", subarea: "ui", assignee: "godot-specialist" },
  writing: { area: "content", subarea: "writing", assignee: "writer" },
  narrative: { area: "content", subarea: "narrative", assignee: "writer" },
  dialogue: { area: "content", subarea: "dialogue", assignee: "writer" },
  "art/sprites": { area: "art", subarea: "sprites", assignee: "art-director" },
  "art/backgrounds": { area: "art", subarea: "backgrounds", assignee: "art-director" },
  "art/animations": { area: "art", subarea: "animations", assignee: "art-director" },
  "art/tilesets": { area: "art", subarea: "tilesets", assignee: "art-director" },
  "art/vfx": { area: "art", subarea: "vfx", assignee: "art-director" },
  sfx: { area: "art", subarea: "sfx", assignee: "sound-designer" },
  music: { area: "art", subarea: "music", assignee: "sound-designer" },
  testing: { area: "qa", subarea: "testing", assignee: "qa-tester" },
  balance: { area: "design", subarea: "balance", assignee: "creative-director" },
  "game-design": { area: "design", subarea: "game-design", assignee: "creative-director" },
  difficulty: { area: "design", subarea: "difficulty", assignee: "creative-director" },
  localization: { area: "content", subarea: "localization", assignee: "localization-lead" },
};

export interface ParsedGDDItem {
  title: string;
  description: string;
  section: string;
  priority: "P0" | "P1" | "P2";
}

function resolveTicketMeta(section: string): { area: string; subarea: string; assignee: AgentRole } {
  const key = section.toLowerCase().trim();
  // 29-H-gdd-area-match: previous shape used a bidirectional
  // substring match (`key.includes(k) || k.includes(key)`). The
  // bidirectional form has two failure modes:
  //  1. A GDD section named "art" matches the first "art/*" map
  //     key in iteration order, which is "art/sprites" — but a
  //     GDD that wanted bare "art" should not get the sprites
  //     assignee. The match order is whichever key was inserted
  //     first, which is fragile across re-orderings of the map.
  //  2. A short map key like "ui" appears as a substring inside
  //     unrelated user sections ("audio", "build", "guide") via
  //     the `k.includes(key)` direction — "audio".includes("ui")
  //     is false but the next iteration might find "ui/hud"
  //     before it should. The original developer was reaching
  //     for "match exact or hierarchical child"; do that
  //     explicitly:
  //     - exact match wins first
  //     - then `key` is a child path of `k` (e.g. "art/sprites"
  //       matches "art" parent)
  //     - then `k` is a child path of `key` (e.g. "art" matches
  //       "art/sprites" — though usually we want exact, this
  //       handles the reverse case for one-level parents)
  // Iteration order of Object.entries is insertion order; the
  // more specific keys ("art/sprites", "ui/hud") were declared
  // after the bare "art" / "ui" parents, so the exact-match
  // pass naturally runs first and the prefix passes only fire
  // when there's no exact hit.
  for (const [k, v] of Object.entries(AREA_MAP)) {
    if (key === k) return v;
  }
  for (const [k, v] of Object.entries(AREA_MAP)) {
    if (key.startsWith(k + "/")) return v;
  }
  for (const [k, v] of Object.entries(AREA_MAP)) {
    if (k.startsWith(key + "/")) return v;
  }
  return { area: "engineering", subarea: "misc", assignee: "godot-specialist" };
}

function resolveEngineSpecialist(engine: ProjectEngine | null | undefined): AgentRole {
  if (!engine) {
    logger.warn({ engine, event: "gdd_engine_unknown" }, "No engine set for project; falling back to godot-specialist for engineering tickets");
    return "godot-specialist";
  }
  try {
    const adapter = getEngineAdapter(engine);
    return adapter.getSpecialist();
  } catch (err) {
    if (err instanceof EngineNotSupportedError) {
      logger.warn({ engine, event: "gdd_engine_not_supported" }, `Engine "${engine}" has no registered adapter; falling back to godot-specialist for engineering tickets`);
      return "godot-specialist";
    }
    throw err;
  }
}

export function parseGDDSections(content: string): Map<string, ParsedGDDItem[]> {
  const sections = new Map<string, ParsedGDDItem[]>();
  const lines = content.split("\n");

  let currentSection = "overview";
  let currentItems: ParsedGDDItem[] = [];
  let currentDescription = "";
  let inList = false;
  let currentPriority: "P0" | "P1" | "P2" = "P1";
  let currentTitle = "";

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("## ")) {
      if (currentTitle) {
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      if (currentItems.length > 0) {
        sections.set(currentSection, currentItems);
      }
      currentSection = trimmed.slice(3).toLowerCase().replace(/[^a-z0-9]/g, "-");
      currentItems = [];
      currentDescription = "";
      inList = false;
      currentTitle = "";
      continue;
    }

    if (trimmed.startsWith("### ")) {
      if (currentTitle) {
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      currentTitle = trimmed.slice(4).trim();
      currentDescription = "";
      inList = false;
      currentPriority = "P1";
      continue;
    }

    if (trimmed.startsWith("[P0]") || trimmed.startsWith("[P1]") || trimmed.startsWith("[P2]")) {
      currentPriority = trimmed.slice(0, 3) as "P0" | "P1" | "P2";
      // 29-M-gdd-strict-priority: previous regex
      // `/^\[[AP0-9]+\]\s*/` accepted any mix of A/P/0-9 inside the
      // brackets, e.g. `[A99]` or `[P1A]`. The classification at
      // L135 already requires an exact `[P0|P1|P2]` match, so a
      // misclassified line never reaches here — but the strip
      // regex still had to agree. Tighten it to the same exact
      // alternation.
      const rest = trimmed.replace(/^\[(P0|P1|P2)\]\s*/, "").trim();
      if (rest) {
        if (currentTitle) {
          currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
        }
        currentTitle = rest;
        currentDescription = "";
        inList = false;
      }
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.slice(2).trim();
      if (!text) continue;
      if (text.startsWith("[P0]") || text.startsWith("[P1]") || text.startsWith("[P2]")) {
        currentPriority = text.slice(0, 3) as "P0" | "P1" | "P2";
        // 29-M-gdd-strict-priority: same fix as the heading branch.
        const rest = text.replace(/^\[(P0|P1|P2)\]\s*/, "").trim();
        if (currentTitle) {
          currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
        }
        currentTitle = rest;
        currentDescription = "";
        inList = true;
      } else if (!currentTitle) {
        currentTitle = text;
        currentPriority = "P1";
        inList = true;
      } else if (inList) {
        currentDescription += (currentDescription ? " " : "") + text;
      }
      continue;
    }

    if (!trimmed) {
      if (currentTitle) {
        currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
      }
      currentTitle = "";
      currentDescription = "";
      inList = false;
      continue;
    }

    if (currentTitle) {
      currentDescription += (currentDescription ? " " : "") + trimmed;
    }
  }

  if (currentTitle) {
    currentItems.push({ title: currentTitle, description: currentDescription, section: currentSection, priority: currentPriority });
  }
  if (currentItems.length > 0) {
    sections.set(currentSection, currentItems);
  }

  return sections;
}

export function findGDDPath(projectSlug: string): string | null {
  // 15-CR-gdd-traversal: projectSlug arrives raw from the request body
  // (POST /api/gdd/ingest and autonomous.ts startup). Without
  // containment, `projectSlug = "../../etc"` resolves to
  // `/etc/gdd/game.md` and reads from outside the workspace.
  // resolveProjectWorkspace throws on escape — catch and return null
  // so the route returns 404 (no GDD found) instead of 500.
  let projectRoot: string;
  try {
    projectRoot = resolveProjectWorkspace(projectSlug);
  } catch (err) {
    // 30-M-gdd-traversal-catch-all: the previous catch returned
    // null for *any* error from resolveProjectWorkspace, including
    // programming errors unrelated to the containment check (a
    // future refactor that adds config validation, throws a
    // different error class, or hits an EACCES reading the
    // workspace dir would all be silently downgraded to "no
    // GDD found"). resolveProjectWorkspace's escape errors are
    // plain Error instances with the words "Path traversal not
    // allowed" or "NUL byte" in the message; treat only those
    // (plus a generic "Path escapes" / "outside workspace"
    // sibling if the message drifts in a future patch) as a
    // legitimate "no GDD found" — let everything else propagate
    // so the route layer returns 500 and the operator can see
    // the real failure in the logs.
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Path traversal not allowed") ||
      msg.includes("NUL byte") ||
      msg.includes("Path escapes") ||
      msg.includes("outside workspace")
    ) {
      return null;
    }
    throw err;
  }
  const config = loadConfig();
  const altPaths = [
    join(projectRoot, "gdd", "game.md"),
    join(projectRoot, "docs", "gdd.md"),
    join(projectRoot, "docs", "game.md"),
    join(projectRoot, "GDD.md"),
    join(projectRoot, "game-design.md"),
    join(config.WORKSPACE_DIR, "design", "gdd", `${projectSlug}.md`),
  ];
  for (const p of altPaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function getExistingTicketTitles(board: TicketsBoard): Promise<Set<string>> {
  const titles = new Set<string>();
  for (const col of board.columns) {
    if (col.id === "completed") continue;
    for (const t of col.tickets) {
      titles.add(t.title.toLowerCase());
    }
  }
  return titles;
}

export interface GDDIngestResult {
  gddPath?: string;
  sectionsFound: number;
  totalItems: number;
  created: number;
  skipped: number;
  errors: string[];
  createdTitles: string[];
  skippedTitles: string[];
  // 30-M-gdd-error-truncation: separate the count from the
  // truncated `errors` array so callers can surface "180/200
  // tickets failed" without having to attach the full error
  // strings to the WS broadcast or the GDD ingest response.
  errorCount: number;
}

export async function ingestGDD(
  sessionId: string,
  projectId: string,
  options?: { broadcast?: boolean },
): Promise<GDDIngestResult> {
  const gddPath = findGDDPath(projectId);
  if (!gddPath) {
    return { sectionsFound: 0, totalItems: 0, created: 0, skipped: 0, errors: [], createdTitles: [], skippedTitles: [], errorCount: 0 };
  }

  // 27-M-gdd-stat-async: was statSync on the /api/gdd/ingest hot
  // path. The previous Q26-6th pass already moved the readFile to
  // async; statSync on a 2MB file is ~5ms of blocked event loop
  // (small but non-zero) on the same code path. The readFile is
  // fs.promises.readFile now, so doing an await on a stat is
  // trivial — it just costs one Promise tick.
  const stat = await statAsync(gddPath);
  const MAX_GDD_SIZE = 2 * 1024 * 1024;
  if (stat.size > MAX_GDD_SIZE) {
    return {
      gddPath,
      sectionsFound: 0,
      totalItems: 0,
      created: 0,
      skipped: 0,
      errors: [`GDD file too large (${Math.round(stat.size / 1024)}KB)`],
      createdTitles: [],
      skippedTitles: [],
      errorCount: 1,
    };
  }

  // Q26-6th: async readFile instead of readFileSync. A 2MB GDD blocks
  // the event loop for ~50ms, freezing all WS broadcasts and HTTP
  // requests on the process during /api/gdd/ingest.
  const gddContent = await readFile(gddPath, "utf-8");
  const sections = parseGDDSections(gddContent);

  const dashboard = await readData<DashboardData>("dashboard.json");
  const project = dashboard.projects.find((p) => p.id === projectId);
  const engineeringSpecialist = resolveEngineSpecialist(project?.engine ?? null);

  const MAX_ITEMS = 200;
  let totalParsed = 0;
  for (const items of sections.values()) totalParsed += items.length;
  if (totalParsed > MAX_ITEMS) {
    return {
      gddPath,
      sectionsFound: sections.size,
      totalItems: totalParsed,
      created: 0,
      skipped: 0,
      errors: [`GDD contains ${totalParsed} items — maximum is ${MAX_ITEMS}`],
      createdTitles: [],
      skippedTitles: [],
      errorCount: 1,
    };
  }

  if (sections.size === 0) {
    return { gddPath, sectionsFound: 0, totalItems: 0, created: 0, skipped: 0, errors: ["No sections parsed"], createdTitles: [], skippedTitles: [], errorCount: 1 };
  }

  let board: TicketsBoard;
  try {
    board = await readTicketsBoard(projectId);
  } catch {
    board = {
      projectId,
      sprint: "Sprint 1",
      milestone: "Milestone 1",
      columns: [
        { id: "available", label: "Available", tickets: [] },
        { id: "in_progress", label: "Processing", tickets: [] },
        { id: "qa", label: "Verify", tickets: [] },
        { id: "completed", label: "Archived", tickets: [] },
      ],
    };
  }

  const existingTitles = await getExistingTicketTitles(board);
  const result: GDDIngestResult = {
    gddPath,
    sectionsFound: sections.size,
    totalItems: 0,
    created: 0,
    skipped: 0,
    errors: [],
    createdTitles: [],
    skippedTitles: [],
    errorCount: 0,
  };
  // 30-M-gdd-error-truncation: cap the in-memory errors array.
  // A 200-item GDD with a broken createQuestTicket (e.g. quota
  // hit) would otherwise produce a 200-line errors array that the
  // route handler would serialise verbatim. errorCount holds the
  // full tally and the activity log uses that; the truncated
  // array stays small enough to ship over WS and embed in the
  // gdd:ingested payload.
  const MAX_GDD_ERRORS = 10;

  for (const [section, items] of Array.from(sections.entries())) {
    for (const item of items) {
      result.totalItems++;
      if (existingTitles.has(item.title.toLowerCase())) {
        result.skipped++;
        result.skippedTitles.push(item.title);
        continue;
      }

      try {
        const meta = resolveTicketMeta(section);
        const assignee = meta.area === "engineering" ? engineeringSpecialist : meta.assignee;
        const ticket = await createQuestTicket(
          sessionId,
          item.title,
          assignee,
          item.description || `From GDD section: ${section}`,
          meta.area,
          meta.subarea,
          projectId,
        );
        result.created++;
        result.createdTitles.push(ticket.title);
        existingTitles.add(item.title.toLowerCase());
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        result.errorCount++;
        if (result.errors.length < MAX_GDD_ERRORS) {
          result.errors.push(`${item.title}: ${errMsg}`);
        }
        logger.error({ error: errMsg, item: item.title, section, event: "gdd_ticket_create_failed" }, "Failed to create ticket from GDD");
      }
    }
  }

  if (options?.broadcast !== false) {
    broadcast({
      type: "gdd:ingested",
      sessionId,
      projectId,
      total: result.totalItems,
      created: result.created,
      skipped: result.skipped,
      // 30-M-gdd-error-truncation: broadcast the full error count
      // rather than the truncated array length so the UI can show
      // "200/180 failed" without rounding.
      errors: result.errorCount,
    } as WSEvent);
  }

  return result;
}
