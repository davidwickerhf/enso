// Checks that a server Ensō signed in to reaches Claude through the Agent SDK
// the way engine-sub passes it: { type: "http", url, headers: { Authorization } }.
// Signs in to the mock server, then runs one short turn on the Claude
// subscription that calls its echo tool. Uses a throwaway data dir and
// Keychain prefix, removed at the end.
//
//   node test/sdk-mcp.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createConnections } from "../lib/connections.mjs";
import { startMockServer } from "./mock-oauth-mcp.mjs";

const dataDir = mkdtempSync(path.join(tmpdir(), "enso-sdk-"));
const mock = await startMockServer();
const c = createConnections({
  dataDir,
  keychainPrefix: "enso-mcp-test-",
  builtIn: { mocknotes: { url: mock.url, label: "Mock notes" } },
  callbackBase: () => null,
  openUrl: async url => {
    const r = await fetch(url, { redirect: "manual" });
    await fetch(r.headers.get("location"));
  },
});

try {
  await c.start("mocknotes");
  const servers = await c.sessionServers();
  assert.ok(servers.mocknotes);
  const q = query({
    prompt: 'Call the mcp__mocknotes__echo tool with text "enso-ok", then reply with exactly what it returned.',
    options: { cwd: dataDir, settingSources: [], mcpServers: servers, tools: [], allowedTools: ["mcp__mocknotes__echo"], model: "claude-haiku-4-5", maxTurns: 3 },
  });
  let status = null;
  let result = "";
  for await (const m of q) {
    if (m.type === "system" && m.subtype === "init") status = m.mcp_servers.find(s => s.name === "mocknotes")?.status;
    if (m.type === "user" && Array.isArray(m.message?.content)) for (const b of m.message.content) if (b.type === "tool_result") result += JSON.stringify(b.content);
  }
  assert.equal(status, "connected");
  assert.match(result, /echo: enso-ok/);
  assert.ok(mock.stats.mcpCalls >= 2);
  console.log(`ok - Agent SDK connected with the Bearer header and called the tool (${mock.stats.mcpCalls} MCP requests)`);
} finally {
  await c.disconnect("mocknotes").catch(() => {});
  c.close();
  await mock.close();
  rmSync(dataDir, { recursive: true, force: true });
}
