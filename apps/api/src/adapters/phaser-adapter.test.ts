import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PhaserEngineAdapter } from "./phaser-adapter.js";

describe("PhaserEngineAdapter", () => {
  let adapter: PhaserEngineAdapter;
  let tmpDir: string;

  beforeEach(async () => {
    adapter = new PhaserEngineAdapter();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "phaser-adapter-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("getScaffolder() returns phaser-scaffolder", () => {
    expect(adapter.getScaffolder()).toBe("phaser-scaffolder");
  });

  it("getSpecialist() returns phaser-specialist", () => {
    expect(adapter.getSpecialist()).toBe("phaser-specialist");
  });

  it("getQAChain() includes headless-renderer", () => {
    expect(adapter.getQAChain()).toContain("headless-renderer");
  });

  it("scaffold() creates expected files and directories", async () => {
    await adapter.scaffold(tmpDir, "My Game");

    const expected: [string, "file" | "dir"][] = [
      ["package.json", "file"],
      ["vite.config.ts", "file"],
      ["tsconfig.json", "file"],
      ["src/main.ts", "file"],
      ["src/scenes/BootScene.ts", "file"],
      ["test/boot-scene.test.ts", "file"],
      ["public/assets", "dir"],
    ];

    for (const [rel, kind] of expected) {
      const stat = await fs.stat(path.join(tmpDir, rel));
      if (kind === "dir") {
        expect(stat.isDirectory()).toBe(true);
      } else {
        expect(stat.isFile()).toBe(true);
      }
    }
  });

  it("validateBuild() returns ok after scaffold", async () => {
    await adapter.scaffold(tmpDir, "My Game");
    const result = await adapter.validateBuild(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("runTests() returns ok stub when node_modules is missing", async () => {
    await adapter.scaffold(tmpDir, "My Game");
    const result = await adapter.runTests(tmpDir);
    expect(result.ok).toBe(true);
    expect(result.output).toContain("node_modules not present");
  });
});
