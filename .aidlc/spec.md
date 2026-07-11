# Multi-Engine Game Development AI Studio

## Objective

Transform the Game Studio Control Plane from a Godot-only production platform into a comprehensive multi-engine Game Development AI Studio. The studio must support native engines (Godot, Unity, Unreal), web-native engines (Phaser, Three.js, Babylon.js), and future engines through a single, engine-agnostic production pipeline. The existing Godot pipeline is production-ready and must remain untouched; the goal is to abstract it so that every new engine plugs in through the same contract. Success means a user can create a project, select any supported engine, and have the autonomous producer, GDD ingest, skill routing, tool injection, QA gate, build/export, and live preview automatically dispatch to the correct engine implementation.

## Commands

All commands run from the monorepo root.

```bash
# Type-check the entire workspace
pnpm typecheck

# Run the full test suite (must pass before any claim of completion)
pnpm test

# Generate GraphQL / Prisma / typed artifacts
pnpm generate

# Start the API server in dev mode
pnpm --filter @game-studio/api dev

# Start the web dashboard in dev mode
pnpm --filter @game-studio/web dev

# Lint and format (use the repo's built-in scripts)
pnpm lint
pnpm format
```

## Project Structure

New code lives alongside existing packages, following the established monorepo layout. No new top-level directories unless approved.

```
packages/
  types/src/
    dashboard.ts           # ProjectEngine union expanded + unified
    settings.ts            # GameEngine deprecated; use ProjectEngine everywhere
    agent.ts               # New engine specialist AgentRoles
    engine-adapter.ts        # NEW: EngineAdapter interface + adapter registry
    blocks.ts              # NEW: CapabilityBlock types
  agents/src/
    engine-godot.ts        # Existing — stays as agent registry
    engine-unity.ts        # Existing — experimental flags removed as skills land
    engine-unreal.ts      # Existing — experimental flags removed as skills land
    engine-phaser.ts      # NEW: phaser-specialist, phaser-scaffolder, phaser-typescript-specialist
    engine-threejs.ts     # NEW: threejs-specialist
    engine-babylon.ts     # NEW: babylon-specialist
    index.ts              # Merges all engine agent maps
  skills/src/
    skills-by-phase.ts    # Existing — add phaser/web3d/unity/unreal skill definitions
    phaser-skills.ts      # NEW: setup-phaser-project, implement-phaser-scene, etc.
    web3d-skills.ts       # NEW: setup-web3d-project, implement-3d-scene, etc.
  adapters/src/           # NEW package or existing api package — TBD in plan
    godot-adapter.ts      # GodotEngineAdapter extracted from godot-mcp-service + build-service
    phaser-adapter.ts     # PhaserEngineAdapter
    web3d-adapter.ts      # ThreeJsEngineAdapter + BabylonEngineAdapter
    unity-adapter.ts      # UnityEngineAdapter
    unreal-adapter.ts     # UnrealEngineAdapter
    registry.ts           # Map<ProjectEngine, EngineAdapter>
  blocks/src/             # NEW package — engine-agnostic capability blocks
    player-controller-2d/
      manifest.json
      godot.gd
      phaser.ts
      unity.cs
      babylon.ts
    enemy-ai-patrol/
    hud-health-bar/
    save-system-json/
    registry.ts
  api/src/services/
    mcp-lifecycle-manager.ts   # NEW: generalizes GodotMCPService JSON-RPC lifecycle
    engine-adapter-factory.ts  # NEW: resolves adapter for project.engine
    godot-mcp-service.ts       # Existing — becomes GodotEngineAdapter's MCP bridge
    phaser-mcp-service.ts      # NEW: Vite dev server lifecycle
    web3d-mcp-service.ts       # NEW: Vite dev server lifecycle for Three.js/Babylon
    build-service.ts           # Refactor executeGodotExport → executeExport(adapter)
    gdd-ingest-service.ts      # Refactor AREA_MAP hardcoded godot-specialist → engine-aware routing
    llm-service.ts             # Refactor if (engine === "godot") → adapter.getInstructions()/getTools()
    deep-research-service.ts   # Remove hardcoded "Godot Engine 4.x" prompt
  api/src/routes/
    autonomous.ts              # Refactor Godot-only MCP start → adapter.startToolBridge()
    settings.ts                # Replace VALID_ENGINES string[] with ProjectEngine enum
    dashboard.ts               # Engine picker, recommendation, health status
    builds.ts                  # Extend GameBuild with engine + deployUrl
  web/src/
    components/engine-picker.tsx       # NEW
    components/engine-health-card.tsx  # NEW
    components/web-preview-frame.tsx    # NEW: iframe preview for web engines
  tests/
    engine-adapter.test.ts            # Unit tests for adapter registry and dispatch
    gdd-routing.test.ts               # Engine-aware GDD ingest routing
    phaser-scaffold.test.ts           # Phaser project scaffold test
    web3d-scaffold.test.ts          # Three.js/Babylon scaffold test
    engine-selection.test.ts         # Dashboard engine picker UX
    block-search.test.ts             # Capability block search
```

## Code Style

### Good example — agent definition, skill definition, and adapter method follow existing patterns

```typescript
// packages/agents/src/engine-phaser.ts
import type { AgentDefinition, AgentRole } from "@game-studio/types";

export const phaserAgents: Partial<Record<AgentRole, AgentDefinition>> = {
  "phaser-scaffolder": {
    name: "phaser-scaffolder",
    description: "Creates a complete Phaser 3 + Vite + TypeScript project from scratch — package.json, vite.config.ts, src/main.ts, scenes, and asset folders. Uses file I/O or the PhaserCLI tool.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
    maxTurns: 25,
    skills: ["setup-phaser-project"],
    memory: "session",
    reportsTo: ["lead-programmer"],
  },
  "phaser-specialist": {
    name: "phaser-specialist",
    description: "Phaser 3 lead: TypeScript scenes, Arcade/Matter physics, tilemaps, input, HUD, and deployment.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task", "PhaserCLI"],
    maxTurns: 35,
    skills: [
      "setup-phaser-project",
      "implement-phaser-scene",
      "implement-phaser-physics",
      "implement-phaser-tilemap",
      "automated-phaser-playtest",
      "export-web-project",
      "phaser-cli-ops",
    ],
    memory: "session",
    reportsTo: ["lead-programmer"],
  },
  "phaser-typescript-specialist": {
    name: "phaser-typescript-specialist",
    description: "Phaser 3 TypeScript implementation details: strict typing, scene lifecycle, asset loading, and physics bodies.",
    tier: 3,
    model: "sonnet",
    tools: ["Read", "Write", "Edit", "Glob", "Grep", "Bash", "Task"],
    maxTurns: 30,
    skills: ["implement-phaser-scene", "implement-phaser-physics"],
    memory: "session",
    reportsTo: ["phaser-specialist"],
  },
};

// packages/types/src/engine-adapter.ts
import type { ProjectEngine } from "./dashboard.js";
import type { AgentRole } from "./agent.js";
import type { LLMTool } from "../llm/zai-client.js";

export type BuildPlatform = "web" | "windows" | "macos" | "linux" | "android" | "ios";

export interface EngineAdapter {
  readonly engine: ProjectEngine;
  getScaffolder(): AgentRole;
  getSpecialist(): AgentRole;
  getTools(): LLMTool[];
  getInstructions(): string;
  scaffold(projectPath: string, name: string): Promise<void>;
  validateBuild(projectPath: string): Promise<{ ok: boolean; errors: string[] }>;
  runTests(projectPath: string): Promise<{ ok: boolean; output: string }>;
  export(projectPath: string, platform: BuildPlatform): Promise<{ artifactPath: string; deployUrl?: string }>;
  getQAChain(): string[];
  startToolBridge?(): Promise<{ running: boolean }>;
  stopToolBridge?(): Promise<void>;
}

export interface EngineAdapterRegistry {
  register(adapter: EngineAdapter): void;
  get(engine: ProjectEngine): EngineAdapter;
  has(engine: ProjectEngine): boolean;
  list(): ProjectEngine[];
}
```

### Do NOT do this

```typescript
// ❌ Hardcoded engine checks scattered through services
if (project.engine === "godot") {
  await executeGodotExport(projectId, workspacePath, platform);
} else if (project.engine === "phaser") {
  await executePhaserExport(projectId, workspacePath, platform);
}

// ❌ Godot-only specialist in GDD routing
const AREA_MAP = {
  player: { assignee: "godot-specialist" }, // ignores actual engine
};

// ❌ Two different engine types in different packages
type ProjectEngine = "unity" | "unreal" | "godot" | "phaser" | "threejs";
type GameEngine = "Unity" | "Unreal" | "Godot"; // case mismatch, missing engines
```

## Testing Strategy

- **Framework:** Vitest (already used in the repo). Prefer `pnpm test` and per-package `pnpm --filter @game-studio/api test`.
- **Unit tests:** Engine adapter registry, adapter dispatch, GDD routing specialist resolution, engine type exhaustiveness, and capability-block search. These are fast, deterministic, and cover the bulk of the new logic.
- **Integration tests:** Phaser and Web3D project scaffold end-to-end (create temp directory, call adapter.scaffold(), assert files exist). Use `fs.mkdtemp` and clean up after each test.
- **Contract tests:** Every EngineAdapter implementation must pass a shared adapter contract test (scaffold, validateBuild, runTests, export signatures; no concrete engine required for the contract harness, but at least Godot + Phaser must pass the real one).
- **Regression tests:** Existing Godot tests must pass without modification. Any test that changes an existing test file is a red flag.
- **Coverage target:** New engine code ≥80% line coverage; overall repo coverage must not decrease.
- **Smoke tests:** After `pnpm typecheck && pnpm test`, run `pnpm --filter @game-studio/api dev` and `pnpm --filter @game-studio/web dev` for 30 seconds without crash to confirm tool injection and dashboard engine picker load.

## Boundaries

### Always do
- Preserve the existing Godot pipeline exactly. All existing Godot tests must pass unchanged.
- Use the unified `ProjectEngine` type everywhere; deprecate `GameEngine` in `settings.ts` and migrate callers.
- Implement every new engine through the `EngineAdapter` interface. No engine-specific `if/else` blocks in `build-service.ts`, `llm-service.ts`, `autonomous.ts`, or `gdd-ingest-service.ts`.
- Add engine-specific agents in `packages/agents/src/engine-<engine>.ts`, register them in `packages/agents/src/index.ts`, and add the roles to `AgentRole` in `packages/types/src/agent.ts`.
- Add engine-specific skills in `packages/skills/src/` and extend the `SkillName` union in `packages/types/src/skill.ts`.
- Keep engine runtime dependencies isolated (Phaser/Vite/Three.js/Babylon.js must not leak into `@game-studio/api` unless behind the adapter boundary).

### Ask first
- Adding new npm dependencies to any package (especially `apps/api` or `packages/types`).
- Creating new top-level packages (e.g., `packages/blocks`, `packages/adapters`).
- Changing CI/CD, `.github/workflows`, or test configuration.
- Modifying database schemas or JSON data files (e.g., `builds.json`, `settings.json`).
- Introducing native engine binaries or Docker images for Unity/Unreal builds.
- Changing the frontend routing or state management for the dashboard.

### Never do
- Break type safety. `ProjectEngine` must remain exhaustive; no `as string` casts to bypass it.
- Delete or skip existing Godot tests to make new tests pass.
- Add engine-specific hardcoded branches in shared services (e.g., `if (engine === "phaser") { ... }` in `build-service.ts`).
- Commit secrets, API keys, or local environment paths.
- Ship experimental agents without a clear path to skills/tools wiring.
- Introduce a new engine that has no adapter, no tests, and no skills.

## Acceptance Criteria

### Phase 0 — Abstraction Layer & Type Unification

**AC-0.1** — Unified engine type. `packages/types/src/dashboard.ts` defines a single exhaustive `ProjectEngine` union: `"godot" | "unity" | "unreal" | "phaser" | "threejs" | "babylon" | "bevy" | "playcanvas"`. `packages/types/src/settings.ts` replaces `GameEngine` with `ProjectEngine` (or an alias re-exporting `ProjectEngine`) and no other package defines a competing engine string type. (FR-6.1, NFR-2)

**AC-0.2** — `EngineAdapter` interface exists. `packages/types/src/engine-adapter.ts` (or equivalent) defines an `EngineAdapter` interface with at minimum: `engine`, `getScaffolder()`, `getSpecialist()`, `getTools()`, `getInstructions()`, `scaffold()`, `validateBuild()`, `runTests()`, `export()`, `getQAChain()`. Optional `startToolBridge()` / `stopToolBridge()` are included for MCP-based engines. (FR-1.1)

**AC-0.3** — Adapter registry is the single dispatch point. `packages/api/src/services/engine-adapter-factory.ts` exposes `getEngineAdapter(project.engine)` that returns the correct adapter for every `ProjectEngine` value. `Map<ProjectEngine, EngineAdapter>` is the internal registry. No service may import `engine-godot.ts` directly; they import the factory. (FR-1.2)

**AC-0.4** — Godot is migrated into an adapter. `packages/api/src/adapters/godot-adapter.ts` implements `EngineAdapter` and delegates to `godot-mcp-service.ts` for tools and `build-service.ts` for export. The existing `GodotMCPService` remains functional but is consumed through the adapter. All existing Godot tests still pass. (FR-1.3, NFR-1)

**AC-0.5** — GDD ingest is engine-aware. `apps/api/src/services/gdd-ingest-service.ts` resolves the engineering-area specialist by calling `getEngineAdapter(project.engine).getSpecialist()` instead of hardcoding `godot-specialist`. For an unknown/null engine, it falls back to `godot-specialist` (current behavior) with a warning log. (FR-1.4)

**AC-0.6** — Autonomous loop delegates to the adapter. `apps/api/src/routes/autonomous.ts` replaces the `if (engine === "godot") { start Godot MCP ... }` block with `adapter.startToolBridge?.()` and uses `adapter.getScaffolder()` for the initial scaffold step. (FR-1.5)

**AC-0.7** — Build service dispatches by adapter. `apps/api/src/services/build-service.ts` refactors `executeGodotExport` into a generic `executeExport(projectId, workspacePath, platform)` that calls `getEngineAdapter(project.engine).export(...)`. The public API signature remains compatible for Godot callers. (FR-1.6)

**AC-0.8** — LLM tool injection is adapter-driven. `apps/api/src/services/llm-service.ts` replaces `if (project.engine === "godot") { inject Godot MCP tools }` with `const tools = adapter.getTools(); const instructions = adapter.getInstructions();` when the adapter provides a non-empty tool set. (FR-10.1)

### Phase 1 — Phaser Adapter (Web 2D)

**AC-1.1** — Phaser agents exist. `packages/agents/src/engine-phaser.ts` registers `phaser-scaffolder`, `phaser-specialist`, and `phaser-typescript-specialist` with the same shape as Godot agents. `packages/agents/src/index.ts` merges them. `AgentRole` in `packages/types/src/agent.ts` includes these roles. (FR-2.1)

**AC-1.2** — Phaser skills exist. `packages/skills/src/skills-by-phase.ts` includes `setup-phaser-project`, `implement-phaser-scene`, `implement-phaser-physics`, `implement-phaser-tilemap`, and `automated-phaser-playtest`. Each skill has a `phases` array, an `agents` list containing `phaser-specialist` or `phaser-scaffolder`, and `userInvocable: true`. (FR-2.2)

**AC-1.3** — Phaser CLI tool. `packages/api/src/llm/zai-client.ts` (or equivalent tool registry) exposes a `PhaserCLI` tool with commands: `init`, `dev`, `build`, `test`, `preview`. The `init` command scaffolds a Vite + TypeScript + Phaser project; `build` runs `vite build` and outputs `dist/`; `test` runs Vitest + jsdom in headless mode. (FR-2.3)

**AC-1.4** — Headless Phaser test runner. `apps/api/src/services/phaser-test-service.ts` (or adapter method) can boot a Phaser game in `HEADLESS` renderer mode and run a scene test, returning pass/fail and logs. The Phaser adapter's `getQAChain()` includes this step. (FR-2.4)

**AC-1.5** — Phaser capability blocks. `packages/blocks/src/player-controller-2d/phaser.ts` and at least one other block (e.g., `enemy-ai-patrol` or `hud-health-bar`) exist with TypeScript implementations and a `manifest.json` describing inputs, outputs, and dependencies. (FR-2.5, FR-7.2)

**AC-1.6** — Web export path. `apps/api/src/services/build-service.ts` calls `PhaserEngineAdapter.export(platform)` for `web` and produces a static `dist/` artifact plus a `deployUrl` field on the `GameBuild` record when a deployment provider is configured. (FR-2.6, FR-9.2)

**AC-1.7** — In-browser live preview. `apps/web/src/components/web-preview-frame.tsx` renders an iframe pointing at the Vite dev server URL for Phaser projects. The dashboard shows a "Live Preview" button for web engines. (FR-2.7, FR-9.1)

### Phase 2 — Three.js / Babylon.js Adapter (Web 3D)

**AC-2.1** — Web3D agents exist. `packages/agents/src/engine-threejs.ts` registers `threejs-specialist`; `packages/agents/src/engine-babylon.ts` registers `babylon-specialist`. Both are tier-3, model `sonnet`, with tools including `Read`, `Write`, `Edit`, `Bash`, `Task`, and a `Web3DCLI` tool. (FR-3.1)

**AC-2.2** — Web3D skills exist. `packages/skills/src/web3d-skills.ts` (or `skills-by-phase.ts`) defines `setup-web3d-project`, `implement-3d-scene`, `implement-3d-physics`, and `implement-3d-camera`. Each skill's `agents` list uses the correct engine specialist (`threejs-specialist` vs `babylon-specialist`). (FR-3.2)

**AC-2.3** — Web3D CLI tool. A `Web3DCLI` tool with `init`, `dev`, `build`, `test`, `preview` commands supports both Three.js and Babylon.js via a `framework` parameter. `init` scaffolds a Vite project with the chosen renderer, physics package, and GLTF loading. (FR-3.3)

**AC-2.4** — Headless WebGL testing. `apps/api/src/services/web3d-test-service.ts` runs a jsdom/canvas-mock environment and reports whether a scene graph can be constructed without throwing. The Web3D adapter's `getQAChain()` includes this step. (FR-3.4)

**AC-2.5** — GLTF/GLB asset awareness. The asset pipeline accepts `.glb` inputs and, when configured, applies Draco compression and KTX2 texture encoding. The `GameBuild` record tracks the produced asset format. (FR-3.5)

**AC-2.6** — WebGPU flag. `Project` config has an optional `webgpu: boolean` flag that adapters read; Web3D adapters include WebGPU-ready instructions in `getInstructions()` when the flag is true. (FR-3.7)

**AC-2.7** — 3D asset generation placeholder. The system has a `generate-3d-asset` skill definition and a `TextTo3D` tool stub that returns a clear "not yet implemented" error unless a provider is configured. This AC only proves the pipeline slot exists; actual model integration is out of scope. (FR-3.6)

### Phase 3 — Unity Engine Adapter (Native)

**AC-3.1** — Unity agents promoted. `packages/agents/src/engine-unity.ts` removes `experimental: true` from `unity-specialist`, `unity-dots-specialist`, `unity-shader-specialist`, `unity-addressables-specialist`, and `unity-ui-specialist` once skills exist. The UI no longer shows the experimental badge. (FR-4.1)

**AC-3.2** — Unity skills exist. `packages/skills/src/skills-by-phase.ts` includes `setup-unity-project`, `implement-unity-mono`, `implement-unity-dots`, `implement-unity-urp`, and `automated-unity-playtest`. (FR-4.2)

**AC-3.3** — Unity CLI tool. `UnityCLI` tool supports `create-project`, `run-tests` (via Unity Test Runner), and `build` (batchmode). The `UnityEngineAdapter` uses file I/O + CLI; it does not require an MCP. (FR-4.3)

**AC-3.4** — Unity export. `UnityEngineAdapter.export(platform)` calls the Unity batchmode build and returns the artifact path. Unsupported platforms return a clear, human-readable error. (FR-4.4)

### Phase 4 — Unreal Engine Adapter (Native)

**AC-4.1** — Unreal skills exist. `packages/skills/src/skills-by-phase.ts` includes `setup-unreal-project`, `implement-unreal-blueprint`, `implement-unreal-gas`, and `automated-unreal-playtest`. (FR-5.1)

**AC-4.2** — Unreal CLI tool. `UnrealCLI` tool supports `ubt-build`, `uat-package`, and `run-automation` commands. The `UnrealEngineAdapter` uses UBT/UAT. (FR-5.2)

**AC-4.3** — Unreal export. `UnrealEngineAdapter.export(platform)` calls UAT packaging and returns the artifact path. (FR-5.3)

### Cross-Cutting — Engine Selection, Capability Blocks, Pipeline

**AC-5.1** — Engine picker UI. `apps/web/src/components/engine-picker.tsx` displays cards for each engine with name, 2D/3D capability, web-native badge, difficulty, and an "AI-friendly" rating. Selecting an engine updates the project's `engine` field. (FR-6.2)

**AC-5.2** — Engine recommendation. `apps/api/src/services/engine-recommendation-service.ts` (or equivalent) returns a ranked engine list given a GDD concept (e.g., "2D platformer" → Phaser, Godot; "3D shooter" → Unity, Unreal, Babylon). The recommendation appears on the project creation screen. (FR-6.3)

**AC-5.3** — Engine health dashboard. The dashboard shows per-engine status: CLI installed, MCP available, templates downloaded. Health is computed by each adapter's `checkHealth()` method or `validateBuild()` on a sample scaffold. (FR-6.4)

**AC-5.4** — Capability block registry. `packages/blocks/src/registry.ts` exports a `searchBlocks(capability, engine)` function that returns matching blocks with their engine-specific implementation paths. At least 10 blocks exist across all implemented engines. (FR-7.1, FR-7.2, FR-7.3)

**AC-5.5** — Game manifest format. `packages/types/src/blocks.ts` defines a `GameManifest` schema with a `capabilities` array. The autonomous producer can decompose a GDD into capabilities and emit a `manifest.json`. (FR-7.5)

**AC-5.6** — Engine-aware ticket generation. `apps/api/src/services/ticket-generator.ts` (or GDD ingest) produces engine-appropriate tickets: a Phaser project's first ticket is `setup-phaser-project`, a Unity project's is `setup-unity-project`, etc. (FR-8.1)

**AC-5.7** — Engine-aware QA gate chain. Each adapter's `getQAChain()` returns the correct sequence for its engine (Godot: boot → GUT → smoke; Phaser: unit → headless → smoke; Unity: Test Runner → smoke; Unreal: Automation → smoke). The QA gate service reads the chain from the adapter. (FR-8.2)

**AC-5.8** — Engine-aware deep research. `apps/api/src/services/deep-research-service.ts` no longer contains the hardcoded string "Godot Engine 4.x"; it uses the actual project engine in prompts. (FR-8.3)

**AC-5.9** — Multi-platform export matrix. `apps/api/src/services/build-service.ts` tracks per-engine supported platforms and returns a clear error when an unsupported platform is requested. `GameBuild` in `packages/types/src/build.ts` includes `engine` and `deployUrl` fields. (FR-8.4, FR-9.3, FR-9.4)

**AC-5.10** — MCP lifecycle generalization. `apps/api/src/services/mcp-lifecycle-manager.ts` implements the same JSON-RPC-over-stdio contract as `godot-mcp-service.ts` but is engine-agnostic. `godot-mcp-service.ts` becomes a thin wrapper over it. `phaser-mcp-service.ts` and `web3d-mcp-service.ts` use the manager to start/stop Vite dev servers. (FR-10.1, FR-10.3)

## Out of Scope

- **Bevy and PlayCanvas** are recognized as valid `ProjectEngine` values but will not receive adapters, agents, skills, or tools in this feature. They exist only as type-safe placeholders for Phase 5+.
- **A custom "Phaser AE" engine** is not being built. We use stock Phaser 3 and achieve the small-API-surface benefit through capability blocks.
- **Text-to-3D model generation** is only stubbed (FR-3.6). No actual model provider (Shap-E, TripoSR, Meshy, CSM) is integrated.
- **Unity MCP** is not required. If the ecosystem has no open MCP standard, the adapter uses file I/O + CLI (FR-10.2).
- **Native mobile store publishing** (App Store, Google Play) remains unchanged; the `ShipThisExport` tool still only supports Godot unless the ShipThis integration is expanded separately.
- **Cloud deployment provider accounts** (Vercel, Netlify, Cloudflare Pages) are not provisioned by this feature. The `deployUrl` field is recorded when a provider is configured, but setup of those accounts is out of scope.
- **AI-generated music/SFX pipeline** is not modified; only the engine-specific sound playback skills are touched.

## Open Questions

- **Q1 — Engine registry location:** Should `EngineAdapter` implementations live in a new `packages/adapters` package or inside `apps/api/src/adapters`? A new package improves isolation but adds a workspace dependency. **Recommended:** New `packages/adapters` package with `@game-studio/types` as its only required dependency.
- **Q2 — Capability blocks package:** Should `packages/blocks` be a runtime package or a content-only directory? Runtime blocks need build tooling; content-only blocks are easier to author. **Recommended:** Start as a content-only package with `manifest.json` + per-engine files, no build step.
- **Q3 — Web preview URL:** Should the live preview iframe use the Vite dev server started by the API, or a separately spawned preview server? A single dev server is simpler but couples the API process to the preview. **Recommended:** Spawn a dedicated Vite preview server via the adapter and report its URL in the project state.
- **Q4 — Phaser test harness:** Should the headless Phaser test runner be a standalone script (`scripts/phaser/run-tests.ts`) or a method on the adapter? The adapter method is more consistent with the interface, but a standalone script is easier to run locally. **Recommended:** Adapter method that shells out to a standalone script in the scaffolded project.
- **Q5 — Unity/Unreal CI:** Do we require a CI runner with Unity/Unreal licenses, or do we gate those adapters behind local-only development? **Recommended:** Local-only for Phase 3/4; CI only after license strategy is approved.
- **Q6 — Deploy provider default:** For web builds, which deployment provider should be the default if multiple are configured? **Recommended:** None — require explicit selection per build, with Cloudflare Pages as the first implemented provider if one must be chosen.
- **Q7 — Engine type migration:** `settings.ts` has downstream callers (e.g., `apps/api/src/routes/settings.ts`, `apps/web/src/pages/settings.tsx`). Should we keep `GameEngine` as a deprecated alias for one release or remove it immediately? **Recommended:** Keep a deprecated `type GameEngine = ProjectEngine` alias with a `@deprecated` JSDoc comment for one release cycle.

## Test Plan

### ST-001 — ProjectEngine type unification
Given a project with `engine: "phaser"`, the TypeScript compiler accepts it as `ProjectEngine` in both `packages/types/src/dashboard.ts` and `packages/types/src/settings.ts`. No file defines a separate `GameEngine` union. Verifier: `pnpm typecheck` passes.

### ST-002 — Adapter registry dispatch
Calling `getEngineAdapter("phaser")` returns an object whose `engine` property is `"phaser"`. Calling `getEngineAdapter("godot")` returns an object whose `getScaffolder()` returns `"godot-scaffolder"`. Calling `getEngineAdapter("bevy")` throws a clear `EngineNotSupportedError` because Bevy is out of scope. Verifier: unit test in `tests/engine-adapter.test.ts`.

### ST-003 — Engine-aware GDD routing
For a project with `engine: "phaser"`, parsing a GDD section named "player" yields `assignee: "phaser-specialist"`. For a project with `engine: "unity"`, the same section yields `assignee: "unity-specialist"`. For `engine: null`, the fallback is `"godot-specialist"`. Verifier: unit test in `tests/gdd-routing.test.ts`.

### ST-004 — Phaser project scaffold
`PhaserEngineAdapter.scaffold(tempDir, "jump-game")` creates `package.json`, `vite.config.ts`, `src/main.ts`, and `src/scenes/BootScene.ts` under `tempDir`. The scaffold completes in under 10 seconds. Verifier: integration test in `tests/phaser-scaffold.test.ts`.

### ST-005 — Phaser headless test chain
After scaffolding, `PhaserEngineAdapter.runTests(tempDir)` runs a Vitest + jsdom test suite and returns `ok: true`. The `getQAChain()` array includes a headless-renderer step. Verifier: integration test in `tests/phaser-scaffold.test.ts`.

### ST-006 — Web3D project scaffold
`Web3DEngineAdapter.scaffold(tempDir, "space-game", { framework: "threejs" })` creates a Vite + Three.js project. `Web3DEngineAdapter.scaffold(tempDir, "space-game", { framework: "babylon" })` creates a Vite + Babylon.js project. Both projects contain a `src/main.ts` scene bootstrap. Verifier: integration test in `tests/web3d-scaffold.test.ts`.

### ST-007 — Engine selection UX
The dashboard project creation flow renders the engine picker with cards for Godot, Unity, Unreal, Phaser, Three.js, and Babylon.js. Selecting "2D platformer" concept returns Phaser and Godot as the top two recommendations. Selecting an engine persists it in the project record returned by the API. Verifier: Playwright e2e test or `apps/web` component test.

### ST-008 — Capability block search
`searchBlocks("player-controller-2d", "phaser")` returns the Phaser implementation of the player-controller block. `searchBlocks("hud-health-bar", "godot")` returns the Godot implementation. Searching for a missing capability returns an empty array with no error. Verifier: unit test in `tests/block-search.test.ts`.

### ST-009 — Build service adapter dispatch
`executeExport(projectId, workspacePath, "web")` for a Phaser project calls `PhaserEngineAdapter.export` and returns a `GameBuild` with `engine: "phaser"` and a `deployUrl` when a provider is configured. For a Godot project, it still calls the existing Godot export path and returns `engine: "godot"`. Verifier: unit test in `tests/engine-adapter.test.ts` with mocked adapters.

### ST-010 — Godot regression gate
Running the entire existing test suite after all abstraction changes yields the same number of passing tests as before the feature branch. No existing Godot test is modified. Verifier: `pnpm test` on the base branch and feature branch produce identical pass counts.
