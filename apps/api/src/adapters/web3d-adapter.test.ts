import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Web3DEngineAdapter } from "./web3d-adapter.js";

async function mkTempDir(prefix: string): Promise<string> {
  const dir = await fsPromises.mkdtemp(join(tmpdir(), prefix));
  return dir;
}

describe("Web3DEngineAdapter", () => {
  let threejs: Web3DEngineAdapter;
  let babylon: Web3DEngineAdapter;

  beforeEach(() => {
    threejs = new Web3DEngineAdapter("threejs");
    babylon = new Web3DEngineAdapter("babylon");
  });

  describe("specialist selection", () => {
    it("returns threejs-specialist for Three.js", () => {
      expect(threejs.getSpecialist()).toBe("threejs-specialist");
      expect(threejs.getScaffolder()).toBe("threejs-specialist");
    });

    it("returns babylon-specialist for Babylon.js", () => {
      expect(babylon.getSpecialist()).toBe("babylon-specialist");
      expect(babylon.getScaffolder()).toBe("babylon-specialist");
    });
  });

  describe("scaffold", () => {
    let projectPath: string;

    beforeEach(async () => {
      projectPath = await mkTempDir("web3d-threejs-");
    });

    afterEach(async () => {
      await fsPromises.rm(projectPath, { recursive: true, force: true });
    });

    it("writes a Vite Three.js project with a scene and a jsdom test", async () => {
      await threejs.scaffold(projectPath, "my-threejs-game");

      const entries = await fsPromises.readdir(projectPath, { withFileTypes: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain("package.json");
      expect(names).toContain("vite.config.ts");
      expect(names).toContain("index.html");
      expect(names).toContain("tsconfig.json");

      const srcEntries = await fsPromises.readdir(join(projectPath, "src"));
      expect(srcEntries).toContain("main.ts");
      expect(srcEntries).toContain("dom.ts");

      const testEntries = await fsPromises.readdir(join(projectPath, "test"));
      expect(testEntries).toContain("scene.test.ts");

      const pkg = JSON.parse(await fsPromises.readFile(join(projectPath, "package.json"), "utf-8"));
      expect(pkg.name).toBe("my-threejs-game");
      expect(pkg.dependencies).toHaveProperty("three");
      expect(pkg.dependencies).toHaveProperty("@types/three");
      expect(pkg.devDependencies).toHaveProperty("vitest");
      expect(pkg.devDependencies).toHaveProperty("jsdom");
    });

    it("writes a Vite Babylon.js project with a scene and a jsdom test", async () => {
      await babylon.scaffold(projectPath, "my-babylon-game");

      const entries = await fsPromises.readdir(projectPath, { withFileTypes: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain("package.json");
      expect(names).toContain("vite.config.ts");
      expect(names).toContain("index.html");
      expect(names).toContain("tsconfig.json");

      const srcEntries = await fsPromises.readdir(join(projectPath, "src"));
      expect(srcEntries).toContain("main.ts");
      expect(srcEntries).toContain("dom.ts");

      const testEntries = await fsPromises.readdir(join(projectPath, "test"));
      expect(testEntries).toContain("scene.test.ts");

      const pkg = JSON.parse(await fsPromises.readFile(join(projectPath, "package.json"), "utf-8"));
      expect(pkg.name).toBe("my-babylon-game");
      expect(pkg.dependencies).toHaveProperty("@babylonjs/core");
    });
  });
});
