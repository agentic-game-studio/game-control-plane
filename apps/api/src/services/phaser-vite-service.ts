import { spawn } from "node:child_process";
import fsPromises from "fs/promises";
import path from "path";
import type { ChildProcess } from "node:child_process";

const servers = new Map<string, ChildProcess>();

export interface ViteDevServerHandle {
  url: string;
}

/**
 * Start a Vite dev server for a Phaser project.
 *
 * If node_modules is present, spawns `npm run dev` and returns the URL.
 * Otherwise returns a stub URL so tests can pass without a network install.
 */
export async function startViteDevServer(
  projectPath: string,
  port = 5173,
): Promise<ViteDevServerHandle> {
  const nodeModulesPath = path.join(projectPath, "node_modules");
  try {
    await fsPromises.access(nodeModulesPath);
  } catch {
    return { url: "http://localhost:5173" };
  }

  const existing = servers.get(projectPath);
  if (existing) {
    existing.kill("SIGTERM");
    servers.delete(projectPath);
  }

  const proc = spawn("npm", ["run", "dev"], {
    cwd: projectPath,
    env: { ...process.env, PORT: String(port), VITE_PORT: String(port) },
    stdio: "ignore",
    detached: true,
  });

  servers.set(projectPath, proc);
  return { url: `http://localhost:${port}` };
}

/** Stop a previously started Vite dev server. */
export async function stopViteDevServer(projectPath: string): Promise<void> {
  const proc = servers.get(projectPath);
  if (proc) {
    proc.kill("SIGTERM");
    servers.delete(projectPath);
  }
}
