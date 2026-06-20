/**
 * sprint-dispatcher.test.ts — pure unit tests for the /sprint area→team router.
 * No mocks needed: these are pure functions over freeform Ticket.area strings.
 */

import { describe, expect, it } from "vitest";
import { areaToTeamSkill, teamLeadAgent, planSprintDispatch, FALLBACK_TEAM } from "./sprint-dispatcher.js";

describe("sprint-dispatcher areaToTeamSkill", () => {
  it.each([
    ["combat", "team-combat"],
    ["engineering/combat", "team-combat"],
    ["ui", "team-ui"],
    ["engineering/ui", "team-ui"],
    ["level", "team-level"],
    ["level-design", "team-level"],
    ["sfx", "team-audio"],
    ["music", "team-audio"],
    ["audio", "team-audio"],
    ["art", "team-world"],
    ["art/sprites", "team-world"],
    ["content", "team-narrative"],
    ["narrative", "team-narrative"],
    ["dialogue", "team-narrative"],
    ["design", "team-progression"],
    ["balance", "team-progression"],
    ["economy", "team-live-ops"],
    ["live-ops", "team-live-ops"],
    ["qa", "team-qa"],
    ["testing", "team-qa"],
    ["multiplayer", "team-multiplayer"],
    ["network", "team-multiplayer"],
    ["engineering", "team-qa"], // bare engineering → team-qa (NOT team-combat — the plan's suspicion was right)
    ["ENGINEERING/UI", "team-ui"], // case-insensitive
  ])("routes %s → %s", (area, team) => {
    expect(areaToTeamSkill(area)).toBe(team);
  });

  it("falls back to team-qa for unknown/empty areas and never throws", () => {
    expect(areaToTeamSkill("")).toBe(FALLBACK_TEAM);
    expect(areaToTeamSkill("totally-unknown-area")).toBe(FALLBACK_TEAM);
    expect(areaToTeamSkill("racing")).toBe(FALLBACK_TEAM);
    expect(areaToTeamSkill("puzzle")).toBe(FALLBACK_TEAM);
  });

  it("never references the nonexistent team-performance", () => {
    // team-performance does not exist (it's team-polish). Assert no area routes there.
    for (const area of ["performance", "perf", "optimization", "fps"]) {
      expect(areaToTeamSkill(area)).not.toBe("team-performance" as never);
    }
  });
});

describe("sprint-dispatcher teamLeadAgent", () => {
  it("returns the primary worker for each dispatchable team", () => {
    expect(teamLeadAgent("team-combat")).toBe("gameplay-programmer");
    expect(teamLeadAgent("team-ui")).toBe("ui-programmer");
    expect(teamLeadAgent("team-narrative")).toBe("writer");
    expect(teamLeadAgent("team-qa")).toBe("qa-tester");
    expect(teamLeadAgent("team-multiplayer")).toBe("network-programmer");
  });

  it("falls back to qa-tester for an unmapped team", () => {
    expect(teamLeadAgent("team-unknown" as never)).toBe("qa-tester");
  });
});

describe("sprint-dispatcher planSprintDispatch", () => {
  it("groups tickets by area→team (2 distinct areas → 2 units)", () => {
    const tickets = [
      { area: "ui", title: "Build HUD" },
      { area: "engineering/ui", title: "Wire menu" },
      { area: "narrative", title: "Write intro dialogue" },
    ];
    const units = planSprintDispatch(tickets);
    expect(units).toHaveLength(2); // ui×2 → team-ui; narrative → team-narrative
    const uiUnit = units.find((u) => u.teamSkill === "team-ui");
    expect(uiUnit?.ticketCount).toBe(2);
    expect(uiUnit?.agent).toBe("ui-programmer");
    expect(uiUnit?.ticketTitles).toEqual(["Build HUD", "Wire menu"]);
    const narUnit = units.find((u) => u.teamSkill === "team-narrative");
    expect(narUnit?.ticketCount).toBe(1);
    expect(narUnit?.agent).toBe("writer");
  });

  it("handles a missing area (falls back to team-qa)", () => {
    const units = planSprintDispatch([{ area: undefined, title: "Mystery task" }]);
    expect(units).toHaveLength(1);
    expect(units[0].teamSkill).toBe("team-qa");
    expect(units[0].agent).toBe("qa-tester");
  });

  it("returns no units for empty input", () => {
    expect(planSprintDispatch([])).toEqual([]);
  });
});
