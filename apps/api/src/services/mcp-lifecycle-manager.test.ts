import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  startMCPBridge,
  stopMCPBridge,
  getMCPBridge,
  listMCPBridges,
} from "./mcp-lifecycle-manager.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, "__fixtures__/mock-mcp-server.js");

describe("MCP lifecycle manager", () => {
  const projectId = "test-project";

  afterEach(async () => {
    await stopMCPBridge(projectId);
  });

  it("startMCPBridge / stopMCPBridge lifecycle", async () => {
    const bridge = await startMCPBridge(projectId, __dirname, {
      command: "node",
      args: [fixturePath],
    });

    expect(bridge.running()).toBe(true);
    expect(bridge.bridgeInitialized()).toBe(true);

    const result = await bridge.executeTool("echo", { message: "hello" });
    expect(result).toBe('mock:echo:{"message":"hello"}');

    await stopMCPBridge(projectId);

    expect(bridge.running()).toBe(false);
    expect(getMCPBridge(projectId)).toBeUndefined();
  });

  it("listMCPBridges returns active bridges", async () => {
    expect(listMCPBridges()).toHaveLength(0);

    await startMCPBridge(projectId, __dirname, {
      command: "node",
      args: [fixturePath],
    });

    expect(listMCPBridges()).toContain(projectId);

    await stopMCPBridge(projectId);

    expect(listMCPBridges()).toHaveLength(0);
  });

  it("executeTool on a non-running bridge returns a clear error", async () => {
    const bridge = await startMCPBridge(projectId, __dirname, {
      command: "node",
      args: [fixturePath],
    });

    await stopMCPBridge(projectId);

    const result = await bridge.executeTool("echo", {});
    expect(result).toContain("not running");
  });
});
