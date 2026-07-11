import { describe, expect, it } from "vitest";
import { getBlock, loadBlocks, searchBlocks } from "./registry.js";

describe("loadBlocks", () => {
  it("discovers at least the two existing blocks from manifest.json files", async () => {
    const blocks = await loadBlocks();
    const names = blocks.map((b) => b.manifest.name);

    expect(names).toContain("player-controller-2d");
    expect(names).toContain("enemy-ai-patrol");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("loads engine implementations for every declared engine", async () => {
    const blocks = await loadBlocks();
    const player = blocks.find((b) => b.manifest.name === "player-controller-2d");

    expect(player).toBeDefined();
    expect(player?.implementations.map((i) => i.engine).sort()).toEqual([
      "godot",
      "phaser",
      "unity",
    ]);
  });
});

describe("searchBlocks", () => {
  it("returns the player-controller block when searching for player with phaser", async () => {
    const results = await searchBlocks("player", "phaser");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some((b) => b.manifest.name === "player-controller-2d")).toBe(true);
    for (const block of results) {
      expect(block.manifest.engines).toContain("phaser");
    }
  });

  it("returns an empty array for a missing capability", async () => {
    await expect(searchBlocks("hud-health-bar", "godot")).resolves.toEqual([]);
  });
});

describe("getBlock", () => {
  it("returns the Phaser TypeScript implementation of player-controller-2d", async () => {
    const impl = await getBlock("player-controller-2d", "phaser");

    expect(impl.engine).toBe("phaser");
    expect(impl.filePath).toMatch(/player-controller-2d[/\\]phaser\.ts$/);
    expect(impl.code).toContain("export function createPlayerController2D");
  });

  it("throws when the block is missing", async () => {
    await expect(getBlock("hud-health-bar", "phaser")).rejects.toThrow(
      'Capability block "hud-health-bar" not found.',
    );
  });

  it("throws when the engine implementation is missing", async () => {
    await expect(getBlock("player-controller-2d", "bevy")).rejects.toThrow(
      'Capability block "player-controller-2d" does not have an implementation for engine "bevy".',
    );
  });
});
