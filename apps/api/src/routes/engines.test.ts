import { describe, it, expect } from "vitest";
import { getEngineHealth } from "./engines.js";
import { hasEngineAdapter, listEngineAdapters } from "../services/engine-adapter-factory.js";
import { PROJECT_ENGINES } from "@game-studio/types";

describe("engines health endpoint", () => {
  it("returns one entry for every known engine", () => {
    const health = getEngineHealth();
    expect(health).toHaveLength(PROJECT_ENGINES.length);
    for (const entry of health) {
      expect(PROJECT_ENGINES).toContain(entry.engine);
    }
  });

  it("marks registered adapters as healthy and unregistered engines as not healthy", () => {
    const registered = new Set(listEngineAdapters());
    const health = getEngineHealth();

    for (const { engine, healthy } of health) {
      expect(healthy).toBe(registered.has(engine));
    }
  });

  it("reports bevy and playcanvas as not healthy", () => {
    const health = getEngineHealth();
    const byEngine = Object.fromEntries(health.map((h) => [h.engine, h.healthy]));

    expect(hasEngineAdapter("bevy")).toBe(false);
    expect(hasEngineAdapter("playcanvas")).toBe(false);
    expect(byEngine.bevy).toBe(false);
    expect(byEngine.playcanvas).toBe(false);
  });

  it("reports the implemented engines as healthy", () => {
    const health = getEngineHealth();
    const byEngine = Object.fromEntries(health.map((h) => [h.engine, h.healthy]));

    expect(byEngine.godot).toBe(true);
    expect(byEngine.phaser).toBe(true);
    expect(byEngine.threejs).toBe(true);
    expect(byEngine.babylon).toBe(true);
    expect(byEngine.unity).toBe(true);
    expect(byEngine.unreal).toBe(true);
  });
});
