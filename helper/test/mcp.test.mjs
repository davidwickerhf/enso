// The zen-browser MCP server's launcher, scopes, client identity and client
// registration, all offline and in throwaway folders:
//   - client labels from clientInfo names
//   - Codex config.toml edits on a fixture with other servers and secrets
//   - `enso mcp install/uninstall/status` against a temporary HOME (fake `claude`)
//   - `enso mcp` bridging stdio to a running server with a fake browser, the
//     client label reaching the activity log and the page ribbon, read scope,
//     token rotation, and answering while Zen isn't running
//
//   node test/mcp.test.mjs

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENSO = path.join(here, "../bin/enso.mjs");
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-mcp-")));
const data = path.join(root, "data");
const port = 49000 + Math.floor(Math.random() * 900);
process.env.ENSO_DATA = data;
process.env.ENSO_MCP_PORT = String(port);
delete process.env.ENSO_LEGACY_DATA;

const { clientLabel, identifyClient, encodeClientHeader, readToken, rotateTokens, scopeForAuthorization } = await import("../lib/mcpauth.mjs");
const { editCodexToml, codexEntryKind } = await import("../lib/mcpinstall.mjs");

let httpServer;
try {
  // ---- client labels ----
  const cases = { "claude-code": "Claude Code", "Claude Code": "Claude Code", "codex-mcp-client": "Codex", codex: "Codex", "cursor-vscode": "Cursor", Cursor: "Cursor", "t3-code": "T3 Code", t3code: "T3 Code", "claude-ai": "Claude Desktop", "Visual Studio Code": "VS Code", "my-agent": "my-agent", "": "An MCP client", [`x${"y".repeat(60)}`]: `x${"y".repeat(39)}` };
  for (const [name, label] of Object.entries(cases)) assert.equal(clientLabel(name), label, name);
  assert.equal(encodeClientHeader({ name: "claude-code", version: "2.1.3" }), "claude-code/2.1.3");
  assert.equal(encodeClientHeader({ name: "a/b\nc" }), "a-bc");
  assert.deepEqual(identifyClient({ headers: { "x-enso-client": "codex-mcp-client/0.50.0" }, scope: "read" }), { name: "codex-mcp-client", version: "0.50.0", label: "Codex", scope: "read", via: "launcher" });
  assert.equal(identifyClient({ headers: {}, body: { method: "initialize", params: { clientInfo: { name: "cursor-vscode", version: "1" } } } }).label, "Cursor");
  assert.equal(identifyClient({ headers: { "x-enso-client": "claude-code/2", "x-enso-client-label": "T3 Code" } }).label, "T3 Code");
  assert.equal(identifyClient({ headers: { "user-agent": "node" } }).label, "An MCP client");
  console.log("ok - client labels from clientInfo, headers and overrides");

  // ---- Codex config.toml ----
  const fixture = [
    "# Codex config",
    'model = "gpt-5"',
    "",
    "[mcp_servers.github]",
    'command = "github-mcp"',
    'env = { GITHUB_TOKEN = "ghp_SECRET_github_value" }',
    "",
    "[mcp_servers.notes]",
    'url = "https://notes.example.com/mcp"',
    "[mcp_servers.notes.http_headers]",
    'Authorization = "Bearer NOTES_SECRET"',
    "",
    "[mcp_servers.zen-browser]",
    'url = "http://127.0.0.1:47823/mcp"',
    "startup_timeout_sec = 20",
    "",
    "[mcp_servers.zen-browser.http_headers]",
    'Authorization = "Bearer ZEN_OLD_TOKEN"',
    "",
    "# approvals for zen tools",
    '[mcp_servers.zen-browser.tools."page_click"]',
    'approval = "ask"',
    "",
    "[profiles.work]",
    'notes = """',
    "[mcp_servers.zen-browser]",
    'url = "inside a string, not a table"',
    '"""',
    "list = [",
    '  ["a"],',
    "  [1, 2],",
    "]",
    "",
  ].join("\n");
  const { text: installed, changes } = editCodexToml(fixture, { mode: "install", command: "/Users/x/Library/Application Support/Enso/bin/enso", args: ["mcp"] });
  // other entries come through byte for byte
  for (const keep of [
    "# Codex config\nmodel = \"gpt-5\"\n\n[mcp_servers.github]\ncommand = \"github-mcp\"\nenv = { GITHUB_TOKEN = \"ghp_SECRET_github_value\" }\n\n[mcp_servers.notes]\nurl = \"https://notes.example.com/mcp\"\n[mcp_servers.notes.http_headers]\nAuthorization = \"Bearer NOTES_SECRET\"\n\n",
    "# approvals for zen tools\n[mcp_servers.zen-browser.tools.\"page_click\"]\napproval = \"ask\"\n\n[profiles.work]\nnotes = \"\"\"\n[mcp_servers.zen-browser]\nurl = \"inside a string, not a table\"\n\"\"\"\nlist = [\n  [\"a\"],\n  [1, 2],\n]\n",
  ])
    assert.ok(installed.includes(keep), `kept unchanged:\n${keep}`);
  assert.ok(installed.includes('[mcp_servers.zen-browser]\ncommand = "/Users/x/Library/Application Support/Enso/bin/enso"\nargs = ["mcp"]\nstartup_timeout_sec = 20\n'), installed);
  assert.ok(!installed.includes("ZEN_OLD_TOKEN") && !installed.includes('url = "http://127.0.0.1:47823/mcp"'));
  assert.ok(!/\n\n\n/.test(installed), "no blank-line runs left behind");
  assert.deepEqual(changes, ["removed url", "removed [mcp_servers.zen-browser.http_headers] table", "set [mcp_servers.zen-browser] command and args (mcp)"]);
  for (const c of changes) assert.ok(!/SECRET|TOKEN|127\.0\.0\.1/.test(c), "changes carry no values");
  assert.equal(codexEntryKind(fixture), "http");
  assert.equal(codexEntryKind(installed), "launcher");
  // idempotent
  assert.equal(editCodexToml(installed, { mode: "install", command: "/Users/x/Library/Application Support/Enso/bin/enso", args: ["mcp"] }).text, installed);
  // read-only
  const ro = editCodexToml(installed, { mode: "install", command: "/e", args: ["mcp", "--read-only"] }).text;
  assert.equal(codexEntryKind(ro), "launcher-read");
  // uninstall removes the server and its subtables, nothing else
  const { text: removed } = editCodexToml(installed, { mode: "uninstall" });
  assert.equal(codexEntryKind(removed), null);
  assert.ok(removed.includes("[mcp_servers.notes.http_headers]\nAuthorization = \"Bearer NOTES_SECRET\"") && removed.includes('[mcp_servers.zen-browser]\nurl = "inside a string, not a table"'));
  assert.ok(!removed.includes("tools.\"page_click\""));
  // fresh file, inline entry, CRLF, no trailing newline
  assert.equal(editCodexToml("", { command: "/e" }).text, '[mcp_servers.zen-browser]\ncommand = "/e"\nargs = ["mcp"]\n');
  const inline = editCodexToml('[mcp_servers]\nzen-browser = { url = "http://x", http_headers = { Authorization = "Bearer Q" } }\nother = { command = "o" }', { command: "/e" });
  assert.equal(inline.text, '[mcp_servers]\nother = { command = "o" }\n\n[mcp_servers.zen-browser]\ncommand = "/e"\nargs = ["mcp"]\n');
  const crlf = editCodexToml('a = 1\r\n[mcp_servers."zen-browser"]\r\nurl = "http://x"\r\n', { command: "/e" }).text;
  assert.equal(crlf, 'a = 1\r\n[mcp_servers."zen-browser"]\r\ncommand = "/e"\r\nargs = ["mcp"]\r\n');
  console.log("ok - Codex config.toml: launcher set, old url/http_headers removed, everything else byte for byte");

  // ---- enso mcp install / status / uninstall in a temporary HOME ----
  const home = path.join(root, "home");
  const bin = path.join(root, "bin");
  mkdirSync(path.join(home, ".codex"), { recursive: true });
  mkdirSync(path.join(home, ".cursor"), { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(home, ".codex", "config.toml"), fixture, { mode: 0o600 });
  writeFileSync(path.join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { other: { url: "https://o.example.com", headers: { Authorization: "Bearer CURSOR_SECRET" } }, "zen-browser": { url: "http://127.0.0.1:47823/mcp", headers: { Authorization: "Bearer ZEN_OLD_TOKEN" } } } }, null, 2));
  // A fake `claude` that logs its arguments and keeps ~/.claude.json like the real one.
  const claudeLog = path.join(root, "claude.log");
  writeFileSync(
    path.join(bin, "claude"),
    `#!${process.execPath}
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(claudeLog)}, JSON.stringify(a) + "\\n");
const f = path.join(process.env.HOME, ".claude.json");
const j = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
j.mcpServers ??= {};
if (a[1] === "remove") { if (!j.mcpServers[a[2]]) process.exit(1); delete j.mcpServers[a[2]]; }
if (a[1] === "add") { const i = a.indexOf("--"); j.mcpServers[a[4]] = { type: "stdio", command: a[i + 1], args: a.slice(i + 2) }; }
fs.writeFileSync(f, JSON.stringify(j));
`,
  );
  chmodSync(path.join(bin, "claude"), 0o755);
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "zen-browser": { type: "http", url: "http://127.0.0.1:47823/mcp", headers: { Authorization: "Bearer ZEN_OLD_TOKEN" } } } }));
  const cliEnv = { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ENSO_DATA: path.join(home, "Library/Application Support/Enso"), ENSO_MCP_PORT: String(port + 1), TMPDIR: tmpdir() };
  const cli = (...args) => spawnSync(process.execPath, [ENSO, "mcp", ...args], { env: cliEnv, encoding: "utf8", timeout: 60_000 });

  let r = cli("status");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Helper: +not running \(open Zen\)/);
  assert.match(r.stdout, /Claude Code +registered over http/);
  assert.match(r.stdout, /Codex +registered over http/);
  assert.match(r.stdout, /Cursor +registered over http/);

  r = cli("install");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const secret of ["ZEN_OLD_TOKEN", "NOTES_SECRET", "ghp_SECRET", "CURSOR_SECRET"]) assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), `output shows no ${secret}`);
  const launcher = path.join(cliEnv.ENSO_DATA, "bin", "enso");
  assert.ok(existsSync(launcher) && (statSync(launcher).mode & 0o111), "launcher written and executable");
  const calls = readFileSync(claudeLog, "utf8").trim().split("\n").map(l => JSON.parse(l));
  assert.deepEqual(calls.at(-2), ["mcp", "remove", "zen-browser", "-s", "user"]);
  assert.deepEqual(calls.at(-1), ["mcp", "add", "--scope", "user", "zen-browser", "--", launcher, "mcp"]);
  const codexAfter = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.equal(codexEntryKind(codexAfter), "launcher");
  assert.ok(codexAfter.includes("NOTES_SECRET") && codexAfter.includes("ghp_SECRET_github_value"));
  const backups = readdirSync(path.join(home, ".codex")).filter(f => f.startsWith("config.toml.enso-backup-"));
  assert.equal(backups.length, 1);
  assert.equal(statSync(path.join(home, ".codex", backups[0])).mode & 0o777, 0o600, "backup is 0600");
  assert.equal(readFileSync(path.join(home, ".codex", backups[0]), "utf8"), fixture);
  assert.equal(statSync(path.join(home, ".codex", "config.toml")).mode & 0o777, 0o600, "config keeps its mode");
  const cursorAfter = JSON.parse(readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8"));
  assert.deepEqual(cursorAfter.mcpServers["zen-browser"], { command: launcher, args: ["mcp"] });
  assert.equal(cursorAfter.mcpServers.other.headers.Authorization, "Bearer CURSOR_SECRET");

  r = cli("install", "--client", "cursor", "--read-only");
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")).mcpServers["zen-browser"].args, ["mcp", "--read-only"]);
  r = cli("status");
  assert.match(r.stdout, /Claude Code +registered \(launcher, full access\)/);
  assert.match(r.stdout, /Codex +registered \(launcher, full access\)/);
  assert.match(r.stdout, /Cursor +registered \(launcher, read-only\)/);

  r = cli("uninstall", "--client", "codex");
  assert.equal(r.status, 0);
  assert.equal(codexEntryKind(readFileSync(path.join(home, ".codex", "config.toml"), "utf8")), null);
  r = cli("uninstall");
  assert.match(cli("status").stdout, /Claude Code +not registered[\s\S]*Cursor +not registered/);
  assert.equal(cli("install", "--client", "nope").status, 1);
  console.log("ok - enso mcp install / status / uninstall (Claude Code, Codex, Cursor) in a temporary HOME, no values printed");

  // ---- a running server with a fake browser ----
  const store = await import("../lib/store.mjs");
  const { startMcpServer } = await import("../lib/mcpserver.mjs");
  const browserCalls = [];
  const browserRequest = async (type, action, args, tabId, agent) => {
    browserCalls.push({ type, action, args, tabId, agent });
    if (action === "tabs_list") return [{ tabId: 7, title: "Example", url: "https://example.com/", active: true, groupId: -1 }];
    if (action === "click") return { ok: true, url: "https://example.com/", title: "Example", description: "the Save button" };
    return {};
  };
  httpServer = startMcpServer({ browserRequest, onReports: () => {} });
  for (let i = 0; i < 50 && !httpServer.listening; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(httpServer.listening);
  assert.equal(statSync(path.join(data, "mcp-token")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(data, "mcp-token-read")).mode & 0o777, 0o600);
  assert.equal(scopeForAuthorization(`Bearer ${readToken("read")}`), "read");
  assert.equal(scopeForAuthorization("Bearer nope"), null);

  // The launcher, as an MCP client would run it.
  function launch(args = [], env = {}) {
    const p = spawn(process.execPath, [ENSO, "mcp", ...args], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const waiters = [];
    const msgs = [];
    p.stdout.on("data", d => {
      out += d;
      let nl;
      while ((nl = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        const m = JSON.parse(line);
        msgs.push(m);
        for (const w of waiters.splice(0)) if (!w(m)) waiters.push(w);
      }
    });
    p.stderr.on("data", d => (err += d));
    let id = 0;
    return {
      msgs,
      stderr: () => err,
      notify: (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"),
      wait: (test, ms = 10_000) =>
        new Promise((resolve, reject) => {
          const hit = msgs.find(test);
          if (hit) return resolve(hit);
          const t = setTimeout(() => reject(new Error(`timed out; stderr: ${err}`)), ms);
          waiters.push(m => test(m) && (clearTimeout(t), resolve(m), true));
        }),
      request(method, params) {
        const n = ++id;
        p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n");
        return this.wait(m => m.id === n);
      },
      async close() {
        p.stdin.end();
        await new Promise(r => p.on("exit", r));
      },
    };
  }
  const initParams = name => ({ protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "0.50.0" } });
  const textOf = r => r.result?.content?.map(c => c.text).join("\n") ?? "";

  const codex = launch();
  let res = await codex.request("initialize", initParams("codex-mcp-client"));
  assert.equal(res.result.serverInfo.name, "zen-browser");
  codex.notify("notifications/initialized");
  res = await codex.request("tools/list", {});
  const names = res.result.tools.map(t => t.name);
  assert.ok(names.includes("tabs_list") && names.includes("page_click") && names.includes("session_fetch"));
  res = await codex.request("tools/call", { name: "tabs_list", arguments: {} });
  assert.ok(!res.result.isError, textOf(res));
  assert.match(textOf(res), /Example/);
  res = await codex.request("tools/call", { name: "page_click", arguments: { ref: 3, tabId: 7, requested_by_user: true, irreversible: false } });
  assert.ok(!res.result.isError, textOf(res));
  const click = browserCalls.find(c => c.action === "click");
  assert.equal(click.agent, "Codex", "the page ribbon gets the client's label");
  assert.equal(click.tabId, 7);
  const logged = store.listActions({})[0];
  assert.equal(logged.source, "Codex");
  assert.equal(logged.client, "codex-mcp-client");
  assert.equal(logged.action, "click");
  assert.ok(existsSync(path.join(data, "mcp-tools-cache.json")), "tool list cached for when Zen is closed");
  console.log("ok - enso mcp bridges stdio to the helper; Codex is named in the activity log and on the page");

  // ---- the Firefox Add-ons build (extension.hello channel "listed") has no page_eval ----
  const { setExtensionInfo, resetExtensionInfo } = await import("../lib/extinfo.mjs");
  for (const t of ["page_eval", "page_query", "page_inspect"]) assert.ok(names.includes(t), `lists ${t} before any extension said otherwise`);
  setExtensionInfo({ type: "extension.hello", version: "0.5.7", channel: "listed", capabilities: { pageEval: false } });
  res = await codex.request("tools/list", {});
  const listedNames = res.result.tools.map(t => t.name);
  assert.ok(!listedNames.includes("page_eval"), "page_eval hidden for the listed build");
  assert.ok(listedNames.includes("page_query") && listedNames.includes("page_inspect") && listedNames.includes("devtools_console"));
  res = await codex.request("tools/call", { name: "page_eval", arguments: { expression: "1+1", tabId: 7, requested_by_user: true } });
  assert.ok(res.result?.isError, JSON.stringify(res));
  assert.match(textOf(res), /not available in the Firefox Add-ons build/);
  assert.ok(!browserCalls.some(c => c.action === "eval"), "nothing reached the browser");
  const rawInit = async () => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${readToken("full")}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams("claude-code") }),
    });
    return r.text();
  };
  assert.match(await rawInit(), /page_eval is not available: the connected Ens\u014d is the Firefox Add-ons build|page_eval is not available: the connected Ensō is the Firefox Add-ons build/);
  res = await codex.request("tools/call", { name: "session_start", arguments: { task: "Check the layout" } });
  assert.match(textOf(res), /page_eval is not available/);
  setExtensionInfo({ type: "extension.hello", version: "0.5.7.1", channel: "unlisted", capabilities: { pageEval: true } });
  res = await codex.request("tools/list", {});
  assert.ok(res.result.tools.some(t => t.name === "page_eval"), "the direct download build lists page_eval");
  assert.match(await rawInit(), /page_eval is available \(the direct download build/);
  await codex.request("tools/call", { name: "session_end", arguments: {} });
  resetExtensionInfo();
  console.log("ok - page_eval is hidden and refused clearly with the Firefox Add-ons build, listed with the direct download build");

  // An explicit label (e.g. T3 Code running Claude Code underneath).
  const t3 = launch(["--client", "T3 Code"]);
  await t3.request("initialize", initParams("claude-code"));
  res = await t3.request("tools/call", { name: "page_click", arguments: { ref: 1, tabId: 7, requested_by_user: true, irreversible: false } });
  assert.ok(!res.result?.isError, JSON.stringify(res));
  assert.equal(browserCalls.filter(c => c.action === "click").at(-1).agent, "T3 Code", JSON.stringify(browserCalls.slice(-3)) + JSON.stringify(res));
  assert.equal(store.listActions({})[0].source, "T3 Code");
  await t3.close();

  // ---- read scope ----
  const reader = launch(["--read-only"]);
  await reader.request("initialize", initParams("claude-code"));
  res = await reader.request("tools/list", {});
  const readNames = res.result.tools.map(t => t.name);
  for (const t of ["tabs_list", "tab_read", "page_read", "page_screenshot", "devtools_console", "devtools_network", "history_search", "github_pr", "headless_read", "headless_screenshot"]) assert.ok(readNames.includes(t), `read scope lists ${t}`);
  for (const t of ["page_click", "page_type", "page_navigate", "page_eval", "session_fetch", "tabs_close", "tabs_open", "headless_start", "github_comment", "create_report"]) assert.ok(!readNames.includes(t), `read scope hides ${t}`);
  assert.ok(res.result.tools.every(t => t.annotations?.readOnlyHint === true));
  const clicksBefore = browserCalls.filter(c => c.action === "click").length;
  res = await reader.request("tools/call", { name: "page_click", arguments: { ref: 3, tabId: 7, requested_by_user: true, irreversible: false } });
  assert.ok(res.result?.isError || res.error, "write tool refused in read scope");
  assert.equal(browserCalls.filter(c => c.action === "click").length, clicksBefore, "nothing reached the browser");
  res = await reader.request("tools/call", { name: "tabs_list", arguments: {} });
  assert.ok(!res.result.isError);
  assert.equal(browserCalls.at(-1).agent, "Claude Code");
  await reader.close();
  // the read token over plain http gets the same treatment
  const rawRead = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${readToken("read")}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "page_navigate", arguments: { url: "https://example.com", requested_by_user: true, irreversible: false } } }),
  });
  assert.match(await rawRead.text(), /isError|not found|read-only/i);
  console.log("ok - read scope lists and runs only read-only tools");

  // ---- backwards compatibility: http + bearer, clientInfo from initialize ----
  const oldToken = readToken("full");
  const raw = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${oldToken}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: initParams("claude-code") }),
  });
  assert.equal(raw.status, 200);
  assert.match(await raw.text(), /zen-browser/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${oldToken}`, Origin: "https://evil.example" }, body: "{}" })).status, 403);
  console.log("ok - the http + bearer endpoint still works and still refuses browser origins");

  // ---- rotate: the old token stops working, the launcher keeps going ----
  const rot = spawnSync(process.execPath, [ENSO, "mcp", "rotate"], { env: process.env, encoding: "utf8" });
  assert.equal(rot.status, 0);
  assert.ok(!rot.stdout.includes(oldToken) && !rot.stdout.includes(readToken("full")), "rotate prints no token");
  assert.notEqual(readToken("full"), oldToken);
  assert.equal((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${oldToken}` }, body: "{}" })).status, 401);
  res = await codex.request("tools/call", { name: "tabs_list", arguments: {} });
  assert.ok(!res.result.isError, "launcher reads the new token itself");
  await codex.close();
  console.log("ok - enso mcp rotate: old token refused, launcher clients keep working");

  // ---- Zen not running ----
  const down = launch([], { ENSO_MCP_PORT: String(port + 2) });
  res = await down.request("initialize", initParams("claude-code"));
  assert.equal(res.result.serverInfo.name, "zen-browser");
  assert.match(res.result.instructions, /Zen isn't running/);
  res = await down.request("tools/list", {});
  assert.ok(res.result.tools.some(t => t.name === "tabs_list"), "tools come from the cache");
  res = await down.request("tools/call", { name: "tabs_list", arguments: {} });
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res), "Zen isn't running: open Zen and try again.");
  res = await down.request("ping", {});
  assert.deepEqual(res.result, {});
  await down.close();
  assert.equal(down.stderr(), "", "no noise on stderr when Zen is closed");
  console.log("ok - with Zen closed the launcher answers initialize, lists cached tools and returns a clear tool error");

  // ...and tells the client when Zen comes back.
  rmSync(path.join(data, "mcp-tools-cache.json"));
  const later = launch([], { ENSO_MCP_PORT: String(port + 3), ENSO_MCP_POLL_MS: "100" });
  await later.request("initialize", initParams("codex"));
  res = await later.request("tools/list", {});
  assert.deepEqual(res.result.tools, []);
  // Zen opens: a stand-in helper on that port answers the launcher's probe.
  const http = await import("node:http");
  const fakeHelper = http.createServer(async (req, rsp) => {
    let body = "";
    for await (const c of req) body += c;
    rsp.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: JSON.parse(body).id, result: {} }));
  });
  await new Promise(r => fakeHelper.listen(port + 3, "127.0.0.1", r));
  try {
    await later.wait(m => m.method === "notifications/tools/list_changed", 5000);
  } finally {
    fakeHelper.close();
  }
  await later.close();
  console.log("ok - with no cache the list is empty, and the client hears tools/list_changed when Zen opens");
} finally {
  httpServer?.close();
  rmSync(root, { recursive: true, force: true });
}
