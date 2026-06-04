/**
 * GDD ingestion service — parse GDD markdown and create Kanban tickets.
 * Shared by /api/gdd/ingest and autonomous loop startup.
 */

import { existsSync, readFileSync, statSync } from "fs";
import { stat as statAsync } from "fs/promises";
import { readFile } from "node:fs/promises";
import { join } from "path";
import { loadConfig } from "../config.js";
import { createQuestTicket } from "./quest-bridge.js";
import { readTicketsBoard } from "./ticket-board.js";
import { broadcast } from "./websocket.js";
import { logger } from "../utils/logger.js";
import { resolveProjectWorkspace } from "../utils/workspace.js";
import type { AgentRole, TicketsBoard, WSEvent } from "@game-studio/types";

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
  for (const [k, v] of Object.entries(AREA_MAP)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  return { area: "engineering", subarea: "misc", assignee: "godot-specialist" };
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
      const rest = trimmed.replace(/^\[[AP0-9]+\]\s*/, "").trim();
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
        const rest = text.replace(/^\[[AP0-9]+\]\s*/, "").trim();
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
  } catch {
    return null;
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
}

export async function ingestGDD(
  sessionId: string,
  projectId: string,
  options?: { broadcast?: boolean },
): Promise<GDDIngestResult> {
  const gddPath = findGDDPath(projectId);
  if (!gddPath) {
    return { sectionsFound: 0, totalItems: 0, created: 0, skipped: 0, errors: [], createdTitles: [], skippedTitles: [] };
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
    };
  }

  // Q26-6th: async readFile instead of readFileSync. A 2MB GDD blocks
  // the event loop for ~50ms, freezing all WS broadcasts and HTTP
  // requests on the process during /api/gdd/ingest.
  const gddContent = await readFile(gddPath, "utf-8");
  const sections = parseGDDSections(gddContent);

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
    };
  }

  if (sections.size === 0) {
    return { gddPath, sectionsFound: 0, totalItems: 0, created: 0, skipped: 0, errors: ["No sections parsed"], createdTitles: [], skippedTitles: [] };
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
  };

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
        const ticket = await createQuestTicket(
          sessionId,
          item.title,
          meta.assignee,
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
        result.errors.push(`${item.title}: ${errMsg}`);
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
      errors: result.errors.length,
    } as WSEvent);
  }

  return result;
}
