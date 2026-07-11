process.stdin.setEncoding("utf8");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              serverInfo: { name: "mock", version: "1" },
            },
          }) + "\n",
        );
      } else if (msg.method === "tools/call") {
        const { name, arguments: args } = msg.params;
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: {
              content: [
                { type: "text", text: `mock:${name}:${JSON.stringify(args)}` },
              ],
            },
          }) + "\n",
        );
      }
      // notifications/initialized and shutdown are intentionally ignored.
    } catch {
      // Ignore malformed lines.
    }
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
