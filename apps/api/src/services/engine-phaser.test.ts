import { describe, expect, it } from "vitest";
import { agents, allAgentRoles } from "@game-studio/agents";
import { skills } from "@game-studio/skills";

/**
 * T-003 verification: Phaser agents are registered and the flat Phaser skill
 * registry contains the expected skill names. Runtime behavior is intentionally
 * stubbed here because the adapter is implemented in T-004.
 */
describe("T-003 Phaser agent and skill registration", () => {
  it("registers the three Phaser agent roles", () => {
    expect(allAgentRoles).toContain("phaser-scaffolder");
    expect(allAgentRoles).toContain("phaser-specialist");
    expect(allAgentRoles).toContain("phaser-typescript-specialist");
  });

  it("phaser-scaffolder reports to lead-programmer", () => {
    const scaffolder = agents["phaser-scaffolder"];
    expect(scaffolder).toBeDefined();
    expect(scaffolder?.reportsTo).toContain("lead-programmer");
  });

  it("phaser-specialist has PhaserCLI in tools", () => {
    const specialist = agents["phaser-specialist"];
    expect(specialist).toBeDefined();
    expect(specialist?.tools).toContain("PhaserCLI");
  });

  it("flat Phaser skill list contains expected skills", () => {
    const names = Object.keys(skills);
    expect(names).toContain("setup-phaser-project");
    expect(names).toContain("implement-phaser-scene");
    expect(names).toContain("implement-phaser-physics");
    expect(names).toContain("implement-phaser-tilemap");
    expect(names).toContain("automated-phaser-playtest");
    expect(names).toContain("export-web-project");
    expect(names).toContain("phaser-cli-ops");
  });
});
