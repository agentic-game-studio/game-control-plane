import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsPromises from "fs/promises";
import os from "node:os";
import path from "node:path";
import { UnityEngineAdapter } from "./unity-adapter.js";

describe("UnityEngineAdapter", () => {
  let tempDir: string;
  let adapter: UnityEngineAdapter;

  beforeEach(async () => {
    tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "unity-adapter-"));
    adapter = new UnityEngineAdapter();
  });

  afterEach(async () => {
    await fsPromises.rm(tempDir, { recursive: true, force: true });
  });

  it("reports engine as unity", () => {
    expect(adapter.engine).toBe("unity");
  });

  it("uses unity-specialist as both scaffolder and specialist", () => {
    expect(adapter.getScaffolder()).toBe("unity-specialist");
    expect(adapter.getSpecialist()).toBe("unity-specialist");
  });

  it("exposes UnityCLI tool definition", () => {
    const tools = adapter.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe("UnityCLI");
  });

  it("scaffold creates expected Unity project structure", async () => {
    await adapter.scaffold(tempDir, "TestUnityProject");

    const readme = await fsPromises.readFile(path.join(tempDir, "README.md"), "utf-8");
    expect(readme).toContain("TestUnityProject");

    await expect(fsPromises.stat(path.join(tempDir, "Assets", "Scripts"))).resolves.toBeDefined();
    await expect(fsPromises.stat(path.join(tempDir, "Assets", "Scenes"))).resolves.toBeDefined();
    await expect(fsPromises.stat(path.join(tempDir, "ProjectSettings"))).resolves.toBeDefined();
    await expect(fsPromises.stat(path.join(tempDir, "Packages", "manifest.json"))).resolves.toBeDefined();
  });

  it("validateBuild returns ok stub", async () => {
    const result = await adapter.validateBuild(tempDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("runTests returns ok stub", async () => {
    const result = await adapter.runTests(tempDir);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("Unity tests stub");
  });

  it("export returns artifact path for supported platforms", async () => {
    for (const platform of ["windows", "macos", "linux", "web"] as const) {
      const result = await adapter.export(tempDir, platform, { projectId: "demo", version: "0.2.0" });
      expect(result.artifactPath).toContain(`demo-${platform}-v0.2.0-`);
      expect(result.artifactPath).toMatch(/\.zip$/);
    }
  });

  it("export throws for unsupported platforms", async () => {
    await expect(adapter.export(tempDir, "android")).rejects.toThrow(
      'Unity export does not support platform "android"',
    );
    await expect(adapter.export(tempDir, "ios")).rejects.toThrow(
      'Unity export does not support platform "ios"',
    );
  });

  it("returns a QA chain", () => {
    expect(adapter.getQAChain()).toEqual(["smoke", "regression"]);
  });
});
