import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isProjectEngine, type ProjectEngine } from "@game-studio/types";
import type {
  BlockImplementation,
  BlockManifest,
  CapabilityBlock,
} from "./types.js";

const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Scan the blocks package source tree for manifest.json files and load each
 * manifest alongside its sibling engine implementation files.
 */
export async function loadBlocks(): Promise<CapabilityBlock[]> {
  const manifestPaths = await findManifests(SRC_DIR);
  const blocks = await Promise.all(
    manifestPaths.map(async (manifestPath) => {
      const manifest = JSON.parse(
        await readFile(manifestPath, "utf-8"),
      ) as BlockManifest;
      const dir = path.dirname(manifestPath);
      const implementations = await loadImplementations(dir, manifest);
      return { manifest, implementations };
    }),
  );
  return blocks;
}

/**
 * Return blocks whose name or description matches the query (case-insensitive).
 * When `engine` is provided, only blocks that declare support for that engine
 * are returned.
 */
export async function searchBlocks(
  query: string,
  engine?: ProjectEngine,
): Promise<CapabilityBlock[]> {
  const blocks = await loadBlocks();
  const q = query.toLowerCase();
  return blocks.filter((block) => {
    const matchesText =
      block.manifest.name.toLowerCase().includes(q) ||
      block.manifest.description.toLowerCase().includes(q);
    if (!matchesText) return false;
    if (engine) {
      return block.manifest.engines.includes(engine);
    }
    return true;
  });
}

/**
 * Return the implementation of the named block for the requested engine.
 * Throws a clear error if the block or engine implementation is missing.
 */
export async function getBlock(
  name: string,
  engine: ProjectEngine,
): Promise<BlockImplementation> {
  const blocks = await loadBlocks();
  const block = blocks.find((b) => b.manifest.name === name);
  if (!block) {
    throw new Error(`Capability block "${name}" not found.`);
  }
  const implementation = block.implementations.find((impl) => impl.engine === engine);
  if (!implementation) {
    throw new Error(
      `Capability block "${name}" does not have an implementation for engine "${engine}".`,
    );
  }
  return implementation;
}

async function findManifests(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findManifests(fullPath)));
    } else if (entry.name === "manifest.json") {
      results.push(fullPath);
    }
  }
  return results;
}

async function loadImplementations(
  dir: string,
  manifest: BlockManifest,
): Promise<BlockImplementation[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const implementations: BlockImplementation[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === "manifest.json") continue;
    const engine = path.basename(entry.name, path.extname(entry.name));
    if (!isProjectEngine(engine) || !manifest.engines.includes(engine)) continue;
    const filePath = path.join(dir, entry.name);
    const code = await readFile(filePath, "utf-8");
    implementations.push({ engine, filePath, code });
  }
  return implementations;
}
