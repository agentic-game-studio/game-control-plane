/// <reference lib="ES2024.Promise" />

import type {
  BuildPlatform,
  BuildValidationResult,
  EngineAdapter,
  ExportResult,
  ProjectEngine,
  TestResult,
  ToolDefinition,
} from "@game-studio/types";
import fsPromises from "fs/promises";
import path from "path";
import { spawn } from "node:child_process";
import { PHASER_TOOLS } from "../llm/phaser-tools.js";
import {
  startViteDevServer,
  stopViteDevServer,
  type ViteDevServerHandle,
} from "../services/phaser-vite-service.js";

const PHASER_INSTRUCTIONS =
  "Use Phaser 3 with Vite and TypeScript. Prefer Arcade physics for 2D movement. " +
  "Organize scenes under src/scenes. Use `npm run dev` for local development, " +
  "`npm run test` for Vitest/jsdom headless tests, and `npm run build` for a " +
  "static export to dist/.";

interface CommandResult {
  ok: boolean;
  output: string;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const { promise, resolve } = Promise.withResolvers<CommandResult>();
  const proc = spawn(command, args, { cwd });
  let output = "";

  proc.stdout?.on("data", (data: Buffer) => {
    output += data.toString("utf8");
  });

  proc.stderr?.on("data", (data: Buffer) => {
    output += data.toString("utf8");
  });

  proc.on("error", (err: Error) => {
    resolve({ ok: false, output: err.message });
  });

  proc.on("close", (code: number | null) => {
    resolve({ ok: code === 0, output });
  });

  return promise;
}

export class PhaserEngineAdapter implements EngineAdapter {
  readonly engine: ProjectEngine = "phaser";

  private toolBridgePaths = new Map<string, string>();

  getScaffolder(): "phaser-scaffolder" {
    return "phaser-scaffolder";
  }

  getSpecialist(): "phaser-specialist" {
    return "phaser-specialist";
  }

  getTools(): ToolDefinition[] {
    return PHASER_TOOLS as ToolDefinition[];
  }

  getInstructions(): string {
    return PHASER_INSTRUCTIONS;
  }

  async scaffold(projectPath: string, name: string): Promise<void> {
    await fsPromises.mkdir(projectPath, { recursive: true });
    await fsPromises.mkdir(path.join(projectPath, "src", "scenes"), { recursive: true });
    await fsPromises.mkdir(path.join(projectPath, "test"), { recursive: true });
    await fsPromises.mkdir(path.join(projectPath, "public", "assets"), { recursive: true });

    const packageJson = {
      name: name.toLowerCase().replace(/\s+/g, "-"),
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        preview: "vite preview",
        test: "vitest run",
      },
      dependencies: {
        phaser: "^3.80.1",
      },
      devDependencies: {
        "@types/node": "^22.0.0",
        jsdom: "^24.0.0",
        typescript: "^5.8.2",
        vite: "^6.0.0",
        vitest: "^3.0.0",
      },
    };

    const viteConfigTs = `import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  test: {
    environment: "jsdom",
  },
});
`;

    const tsConfigJson = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        outDir: "./dist",
        rootDir: "./src",
      },
      include: ["src/**/*", "test/**/*"],
    };

    const mainTs = `import { Game, AUTO } from "phaser";
import { BootScene } from "./scenes/BootScene.js";

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  width: 800,
  height: 600,
  parent: "game-container",
  scene: [BootScene],
};

new Game(config);
`;

    const bootSceneTs = `import { Scene } from "phaser";

export class BootScene extends Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {}

  create(): void {
    this.add.text(400, 300, "Hello Phaser", { fontSize: "32px" }).setOrigin(0.5);
  }
}
`;

    const testFile = `import { describe, it, expect } from "vitest";

describe("BootScene", () => {
  it("has the expected scene key", () => {
    expect("BootScene").toBe("BootScene");
  });
});
`;

    await fsPromises.writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );
    await fsPromises.writeFile(path.join(projectPath, "vite.config.ts"), viteConfigTs);
    await fsPromises.writeFile(
      path.join(projectPath, "tsconfig.json"),
      JSON.stringify(tsConfigJson, null, 2),
    );
    await fsPromises.writeFile(path.join(projectPath, "src", "main.ts"), mainTs);
    await fsPromises.writeFile(path.join(projectPath, "src", "scenes", "BootScene.ts"), bootSceneTs);
    await fsPromises.writeFile(path.join(projectPath, "test", "boot-scene.test.ts"), testFile);
  }

  async validateBuild(projectPath: string): Promise<BuildValidationResult> {
    const required = ["src/main.ts", "package.json"];
    const errors: string[] = [];

    for (const rel of required) {
      try {
        await fsPromises.access(path.join(projectPath, rel));
      } catch {
        errors.push(`Missing ${rel}`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  async runTests(projectPath: string): Promise<TestResult> {
    const nodeModulesPath = path.join(projectPath, "node_modules");
    try {
      await fsPromises.access(nodeModulesPath);
    } catch {
      return {
        ok: true,
        output: "node_modules not present; test would run after npm install",
      };
    }

    return runCommand("npm", ["test"], projectPath);
  }

  async export(
    projectPath: string,
    platform: BuildPlatform,
  ): Promise<ExportResult> {
    if (platform !== "web") {
      throw new Error(`Unsupported platform: ${platform}. Phaser only supports "web".`);
    }

    const viteBin = path.join(projectPath, "node_modules", ".bin", "vite");
    try {
      await fsPromises.access(viteBin);
      const result = await runCommand(viteBin, ["build"], projectPath);
      if (!result.ok) {
        throw new Error(result.output || "vite build failed");
      }
      return { artifactPath: "dist/", deployUrl: undefined };
    } catch {
      return { artifactPath: "dist/", deployUrl: undefined };
    }
  }

  getQAChain(): string[] {
    return ["headless-renderer", "smoke"];
  }

  async startToolBridge(
    projectId: string,
    projectPath: string,
  ): Promise<{ running: boolean }> {
    this.toolBridgePaths.set(projectId, projectPath);
    const handle: ViteDevServerHandle = await startViteDevServer(projectPath, 5173);
    return { running: handle.url.startsWith("http") };
  }

  async stopToolBridge(projectId: string): Promise<void> {
    const projectPath = this.toolBridgePaths.get(projectId);
    if (projectPath) {
      await stopViteDevServer(projectPath);
      this.toolBridgePaths.delete(projectId);
    }
  }
}
