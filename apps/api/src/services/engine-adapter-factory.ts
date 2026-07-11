import type { EngineAdapter, ProjectEngine } from "@game-studio/types";
import { EngineNotSupportedError } from "@game-studio/types";

/**
 * Singleton registry of engine adapters. Every shared service that needs
 * engine-specific behavior calls getEngineAdapter(project.engine) instead
 * of branching on the engine string.
 *
 * Adapters register themselves at module load (see adapters/index.ts).
 * The factory is intentionally simple — a Map with get/has/list — because
 * the contract is the interface, not the registry mechanics.
 */
const registry = new Map<ProjectEngine, EngineAdapter>();

export function registerEngineAdapter(adapter: EngineAdapter): void {
  registry.set(adapter.engine, adapter);
}

export function getEngineAdapter(engine: ProjectEngine): EngineAdapter {
  const adapter = registry.get(engine);
  if (!adapter) {
    throw new EngineNotSupportedError(engine);
  }
  return adapter;
}

export function hasEngineAdapter(engine: ProjectEngine): boolean {
  return registry.has(engine);
}

export function listEngineAdapters(): ProjectEngine[] {
  return [...registry.keys()];
}

/**
 * Reset the registry. Test-only — clears all adapters so each test
 * starts from a known empty state. Production code must never call this.
 */
export function _resetEngineAdapterRegistry(): void {
  registry.clear();
}
