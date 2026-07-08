import type {
  BuildPlatform,
  BuildValidationResult,
  EngineAdapter,
  ExportResult,
  ProjectEngine,
  TestResult,
  ToolDefinition,
  AgentRole,
} from "@game-studio/types";
import fsPromises from "node:fs/promises";
import { join } from "node:path";
import { WEB3D_TOOLS } from "../llm/web3d-tools.js";

/**
 * Web3D engine adapter — handles both Three.js and Babylon.js projects.
 *
 * The engine is fixed at construction time (either "threejs" or "babylon")
 * or read from a project context object. It scaffolds a Vite + TypeScript
 * project, exposes the Web3DCLI/TextTo3D tools, and stubs validation,
 * testing, and export until provider-specific backends are wired in.
 */
export class Web3DEngineAdapter implements EngineAdapter {
  readonly engine: ProjectEngine;
  private readonly webgpu: boolean;

  constructor(
    engineOrContext?: ProjectEngine | { engine?: ProjectEngine; webgpu?: boolean },
  ) {
    if (engineOrContext && typeof engineOrContext === "object") {
      this.engine = engineOrContext.engine ?? "threejs";
      this.webgpu = engineOrContext.webgpu ?? false;
    } else {
      this.engine = engineOrContext ?? "threejs";
      this.webgpu = false;
    }

    if (this.engine !== "threejs" && this.engine !== "babylon") {
      throw new Error(
        `Web3DEngineAdapter only supports "threejs" and "babylon", got "${this.engine}"`,
      );
    }
  }

  getScaffolder(): AgentRole {
    return this.engine === "babylon" ? "babylon-specialist" : "threejs-specialist";
  }

  getSpecialist(): AgentRole {
    return this.engine === "babylon" ? "babylon-specialist" : "threejs-specialist";
  }

  getTools(): ToolDefinition[] {
    // WEB3D_TOOLS is shaped as LLMTool; the structurally-identical
    // ToolDefinition interface from the shared types package is the
    // adapter contract, so a typed assignment is sufficient.
    const tools: ToolDefinition[] = WEB3D_TOOLS;
    return tools;
  }

  getInstructions(): string {
    const base =
      `You are working on a ${this.engine} Web3D project. ` +
      `Use the Web3DCLI tool for project operations (init, dev, build, test, preview). ` +
      `The TextTo3D tool is currently a stub and will return "not yet implemented" unless a provider is configured.`;
    const webgpuNote = this.webgpu
      ? "\n\nWebGPU is enabled. Prefer WebGPU-capable renderer APIs (WebGPU renderer for Three.js via three/webgpu, or WebGPUEngine for Babylon.js). Test in a browser with WebGPU support."
      : "";
    return `${base}${webgpuNote}`;
  }

  async scaffold(projectPath: string, name: string): Promise<void> {
    await fsPromises.mkdir(projectPath, { recursive: true });

    const packageJson = JSON.stringify(
      {
        name: name || `${this.engine}-project`,
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "tsc && vite build",
          preview: "vite preview",
          test: "vitest run",
        },
        devDependencies: {
          "@types/node": "^22.13.5",
          jsdom: "^26.0.0",
          typescript: "^5.8.2",
          vite: "^6.4.3",
          vitest: "^3.2.6",
        },
        dependencies: this.engine === "babylon" ? { "@babylonjs/core": "^7.49.0" } : { three: "^0.175.0", "@types/three": "^0.175.0" },
      },
      null,
      2,
    );

    const viteConfig = `import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "."),
  build: { outDir: "dist" },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
`;

    const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name || this.engine}</title>
    <style>
      body { margin: 0; overflow: hidden; }
      canvas { display: block; width: 100vw; height: 100vh; }
    </style>
  </head>
  <body>
    <canvas id="app"></canvas>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

    const tsConfig = JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ES2022",
          moduleResolution: "bundler",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
          outDir: "./dist",
          rootDir: ".",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          types: ["vitest/globals", "node"],
        },
        include: ["src/**/*", "test/**/*"],
      },
      null,
      2,
    );

    const mainTs = this.sceneMainTs();
    const testTs = `import { describe, it, expect } from "vitest";
import { document } from "../src/dom.js";

describe("scene", () => {
  it("has a canvas in the DOM", () => {
    const canvas = document.getElementById("app");
    expect(canvas).not.toBeNull();
  });
});
`;

    const domTs = `// Minimal jsdom stub for headless scene tests
import { JSDOM } from "jsdom";
const jsdom = new JSDOM(
  '<!DOCTYPE html><html><body><canvas id="app"></canvas></body></html>',
);
export const document = jsdom.window.document;
export const window = jsdom.window;
`;

    await fsPromises.mkdir(join(projectPath, "src"), { recursive: true });
    await fsPromises.mkdir(join(projectPath, "test"), { recursive: true });
    await fsPromises.writeFile(join(projectPath, "package.json"), packageJson, "utf-8");
    await fsPromises.writeFile(join(projectPath, "vite.config.ts"), viteConfig, "utf-8");
    await fsPromises.writeFile(join(projectPath, "index.html"), indexHtml, "utf-8");
    await fsPromises.writeFile(join(projectPath, "tsconfig.json"), tsConfig, "utf-8");
    await fsPromises.writeFile(join(projectPath, "src", "main.ts"), mainTs, "utf-8");
    await fsPromises.writeFile(join(projectPath, "src", "dom.ts"), domTs, "utf-8");
    await fsPromises.writeFile(join(projectPath, "test", "scene.test.ts"), testTs, "utf-8");
  }

  private sceneMainTs(): string {
    if (this.engine === "babylon") {
      return `import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, MeshBuilder } from "@babylonjs/core";

const canvas = document.getElementById("app") as HTMLCanvasElement;
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const camera = new ArcRotateCamera("camera", Math.PI / 2, Math.PI / 3, 5, Vector3.Zero(), scene);
camera.attachControl(canvas, true);

new HemisphericLight("light", new Vector3(0, 1, 0), scene);
MeshBuilder.CreateBox("box", { size: 1 }, scene);

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
`;
    }

    return `import * as THREE from "three";

const canvas = document.getElementById("app") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const geometry = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

function animate() {
  requestAnimationFrame(animate);
  cube.rotation.x += 0.01;
  cube.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
`;
  }

  async validateBuild(projectPath: string): Promise<BuildValidationResult> {
    try {
      await fsPromises.access(join(projectPath, "package.json"));
      return { ok: true, errors: [] };
    } catch {
      return { ok: false, errors: ["package.json not found"] };
    }
  }

  async runTests(_projectPath: string): Promise<TestResult> {
    return { ok: true, output: "Web3D tests stubbed" };
  }

  async export(
    projectPath: string,
    _platform: BuildPlatform,
    _options?: {
      preset?: string;
      projectId?: string;
      version?: string;
      bumpVersion?: boolean;
    },
  ): Promise<ExportResult> {
    return { artifactPath: join(projectPath, "dist") };
  }

  getQAChain(): string[] {
    return ["lint", "build", "test", "preview"];
  }
}
