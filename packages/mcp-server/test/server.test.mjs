import assert from "node:assert/strict";
import test from "node:test";

import { createLucidmemoMcpServer, packageName } from "../dist/index.js";

test("creates the lucidmemo MCP server without connecting stdio", () => {
  const server = createLucidmemoMcpServer({
    homeDir: "/tmp/lucidmemo-mcp-test",
    now: () => new Date("2026-05-23T00:00:00.000Z"),
    output: {
      log() {},
      error() {},
    },
  });

  assert.equal(packageName, "mcp-server");
  assert.equal(server.isConnected(), false);
});
