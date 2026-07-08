import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsPromises from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import os from "os";
import { UnrealEngineAdapter } from "./unreal-adapter.js";
import type { BuildPlatform } from "@game-studio/types";

describe("UnrealEngineAdapter", () => {
  let tmpDir: string;
  let adapter: UnrealEngineAdapter;

  beforeEach(async () => {
    tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "unreal-adapter-"));
    adapter = new UnrealEngineAdapter();
  });

  afterEach(async () => {
    await fsPromises.rm(tmpDir, { recursive: true, force: true });
  });

  it("reports engine as unreal", () => {
    expect(adapter.engine).toBe("unreal");
  });

  it("scaffolds project structure and files", async () => {
    const projectPath = path.join(tmpDir, "MyUnrealGame");
    await adapter.scaffold(projectPath, "MyUnrealGame");

    expect(existsSync(projectPath)).toBe(true);
    expect(existsSync(path.join(projectPath, "README.md"))).toBe(true);
    expect(existsSync(path.join(projectPath, "Content"))).toBe(true);
    expect(existsSync(path.join(projectPath, "Source"))).toBe(true);
    expect(existsSync(path.join(projectPath, "Config"))).toBe(true);
    expect(existsSync(path.join(projectPath, "Plugins"))).toBe(true);
    expect(existsSync(path.join(projectPath, "Build"))).toBe(true);
    expect(existsSync(path.join(projectPath, "MyUnrealGame.uproject"))).toBe(true);

    const readme = await fsPromises.readFile(path.join(projectPath, "README.md"), "utf-8");
    expect(readme).toContain("MyUnrealGame");
    expect(readme).toContain("Unreal Engine 5");

    const uproject = JSON.parse(await fsPromises.readFile(path.join(projectPath, "MyUnrealGame.uproject"), "utf-8"));
    expect(uproject.EngineAssociation).toBe("5.4");
    expect(uproject.Modules[0].Name).toBe("MyUnrealGame");
  });

  it("runTests returns a stub result", async () => {
    const result = await adapter.runTests(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("stub");
  });

  it("validateBuild returns ok", async () => {
    const result = await adapter.validateBuild(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each<BuildPlatform>(["windows", "macos", "linux"])("exports for platform %s", async (platform) => {
    const result = await adapter.export(tmpDir, platform);
    expect(result.artifactPath).toContain(`-${platform}-`);
    const artifactAbs = path.join(tmpDir, result.artifactPath);
    expect(existsSync(artifactAbs)).toBe(true);
  });

  it("throws a clear error for unsupported export platforms", async () => {
    await expect(adapter.export(tmpDir, "web" as BuildPlatform)).rejects.toThrow(
      "Unsupported Unreal export platform: web",
    );
  });

  it("returns a QA chain", () => {
    expect(adapter.getQAChain()).toEqual(["smoke", "regression"]);
  });
});
