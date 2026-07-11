import { describe, it, expect, beforeEach } from "vitest";
import type { EngineAdapter, ProjectEngine, AgentRole, ToolDefinition, BuildValidationResult, TestResult, ExportResult } from "@game-studio/types";
import { EngineNotSupportedError } from "@game-studio/types";
import {
  registerEngineAdapter,
  getEngineAdapter,
  hasEngineAdapter,
  listEngineAdapters,
  _resetEngineAdapterRegistry,
} from "./engine-adapter-factory.js";

function makeMockAdapter(engine: ProjectEngine, scaffolder: AgentRole, specialist: AgentRole): EngineAdapter {
  return {
    engine,
    getScaffolder: () => scaffolder,
    getSpecialist: () => specialist,
    getTools: (): ToolDefinition[] => [],
    getInstructions: () => `Instructions for ${engine}`,
    scaffold: async () => {},
    validateBuild: async (): Promise<BuildValidationResult> => ({ ok: true, errors: [] }),
    runTests: async (): Promise<TestResult> => ({ ok: true, output: "" }),
    export: async (): Promise<ExportResult> => ({ artifactPath: "/tmp/out" }),
    getQAChain: () => ["smoke"],
  };
}

describe("engine-adapter-factory", () => {
  beforeEach(() => {
    _resetEngineAdapterRegistry();
  });

  it("getEngineAdapter returns a registered adapter", () => {
    const adapter = makeMockAdapter("phaser", "phaser-scaffolder", "phaser-specialist");
    registerEngineAdapter(adapter);

    const got = getEngineAdapter("phaser");
    expect(got.engine).toBe("phaser");
    expect(got.getScaffolder()).toBe("phaser-scaffolder");
    expect(got.getSpecialist()).toBe("phaser-specialist");
  });

  it("getEngineAdapter returns correct scaffolder for godot", () => {
    registerEngineAdapter(makeMockAdapter("godot", "godot-scaffolder", "godot-specialist"));

    expect(getEngineAdapter("godot").getScaffolder()).toBe("godot-scaffolder");
  });

  it("getEngineAdapter throws EngineNotSupportedError for bevy (out of scope)", () => {
    expect(() => getEngineAdapter("bevy")).toThrow(EngineNotSupportedError);
    expect(() => getEngineAdapter("bevy")).toThrow(/No adapter registered for engine "bevy"/);
  });

  it("hasEngineAdapter returns true for registered, false for unregistered", () => {
    registerEngineAdapter(makeMockAdapter("unity", "unity-specialist", "unity-specialist"));

    expect(hasEngineAdapter("unity")).toBe(true);
    expect(hasEngineAdapter("phaser")).toBe(false);
  });

  it("listEngineAdapters returns all registered engines", () => {
    registerEngineAdapter(makeMockAdapter("godot", "godot-scaffolder", "godot-specialist"));
    registerEngineAdapter(makeMockAdapter("phaser", "phaser-scaffolder", "phaser-specialist"));

    const engines = listEngineAdapters();
    expect(engines).toContain("godot");
    expect(engines).toContain("phaser");
    expect(engines).toHaveLength(2);
  });

  it("registerEngineAdapter replaces existing adapter for same engine", () => {
    const first = makeMockAdapter("godot", "godot-scaffolder", "godot-specialist");
    const second = makeMockAdapter("godot", "godot-scaffolder", "godot-specialist");

    registerEngineAdapter(first);
    registerEngineAdapter(second);

    expect(listEngineAdapters()).toHaveLength(1);
  });
});
