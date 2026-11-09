// Drives host.mjs like Zen does (native messaging frames on stdin/stdout) and
// plays background.js: answers tabs_open by "signing in" at the mock server.
// Checks connections.add/start/status/disconnect/remove and the servers list.
// Runs with a throwaway data dir and its own MCP port, so it never touches the
// real helper's data; the Keychain item it creates is removed at the end.
//
//   node test/host-connect.test.mjs [--port-taken]   (--port-taken: callback on an ephemeral port)

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSecret } from "../lib/keychain.mjs";
import { startMockServer } from "./mock-oauth-mcp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(path.join(tmpdir(), "enso-host-"));
const port = 47900 + Math.floor(Math.random() * 90);
const portTaken = process.argv.includes("--port-taken");
const blocker = portTaken ? await new Promise(r => { const s = http.createServer().listen(port, "127.0.0.1", () => r(s)); }) : null;
const mock = await startMockServer();
const NAME = "enso-selftest";
// The user's overlay (config.local.json) adds a built-in OAuth server.
writeFileSync(path.join(dataDir, "config.local.json"), JSON.stringify({ oauthServers: { "example-notes": { url: "https://notes.example.com/mcp", label: "Example Notes" } } }));

const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env: { ...process.env, ENSO_DATA: dataDir, ENSO_MCP_PORT: String(port) }, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
host.stderr.on("data", d => (stderr += d));
const inbox = [];
let waiters = [];
let buf = Buffer.alloc(0);
host.stdout.on("data", chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
    buf = buf.subarray(4 + len);
    onHostMessage(msg);
  }
});
function post(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  host.stdin.write(Buffer.concat([head, body]));
}
let callbackUrl = null;
const closedTabs = [];
async function onHostMessage(msg) {
  if (msg.type === "browser.request") {
    let result = {};
    if (msg.action === "tabs_open") {
      const r = await fetch(msg.args.urls[0], { redirect: "manual" });
      callbackUrl = r.headers.get("location");
      setTimeout(() => fetch(callbackUrl).catch(() => {}), 50); // the "user" finishes signing in
      result = [{ tabId: 42, url: msg.args.urls[0] }];
    }
    if (msg.action === "tabs_close") closedTabs.push(...msg.args.tabIds);
    return post({ type: "browser.response", reqId: msg.reqId, ok: true, result });
  }
  inbox.push(msg);
  waiters = waiters.filter(w => !(w.test(msg) && (w.resolve(msg), true)));
}
function waitFor(test, ms = 15_000) {
  const hit = inbox.find(test);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const w = { test, resolve };
    waiters.push(w);
    setTimeout(() => reject(new Error(`timed out; stderr:\n${stderr}`)), ms);
  });
}
const server = msg => msg.servers?.find(s => s.name === NAME);

try {
  post({ type: "connections.status" });
  const st = await waitFor(m => m.type === "connections");
  const ex = st.connections.find(c => c.server === "example-notes");
  assert.equal(ex?.url, "https://notes.example.com/mcp");
  console.log(`ok - an OAuth server from config.local.json is listed (${ex.state})`);

  inbox.length = 0;
  post({ type: "connections.add", name: "bad name", url: mock.url });
  const bad = await waitFor(m => m.type === "connections" && m.done?.ok === false);
  assert.match(bad.done.error, /short name/);
  console.log("ok - invalid custom server is refused");

  inbox.length = 0;
  post({ type: "connections.add", name: NAME, url: mock.url, label: "Self-test notes" });
  await waitFor(m => m.type === "connections" && m.connections.some(c => c.server === NAME && c.state === "connecting"));
  const done = await waitFor(m => m.type === "connections" && m.done?.server === NAME);
  assert.equal(done.done.ok, true, done.done.error);
  const cb = new URL(callbackUrl);
  if (portTaken) assert.notEqual(Number(cb.port), port);
  else assert.equal(Number(cb.port), port);
  console.log(`ok - signed in through ${cb.origin}/oauth/callback`);

  const listed = await waitFor(m => m.type === "servers" && server(m)?.toolNames?.includes("echo"));
  const sv = server(listed);
  assert.equal(sv.status, "connected");
  assert.equal(sv.enabled, true);
  assert.equal(sv.auth.state, "connected");
  assert.equal(sv.auth.custom, true);
  assert.equal(sv.label, "Self-test notes");
  console.log("ok - servers list shows it connected, with its tool");

  assert.ok(await readSecret(`enso-mcp-${NAME}`));
  await new Promise(r => setTimeout(r, 1800));
  assert.deepEqual(closedTabs, [42]);
  console.log("ok - token in the Keychain; sign-in tab closed");

  inbox.length = 0;
  post({ type: "connections.disconnect", server: NAME });
  await waitFor(m => m.type === "servers" && server(m)?.auth?.state === "disconnected" && server(m).status === "needs-auth");
  assert.equal(await readSecret(`enso-mcp-${NAME}`), null);
  assert.ok(mock.stats.revoked >= 1);
  console.log("ok - disconnect revoked the token and removed the Keychain item");

  inbox.length = 0;
  post({ type: "connections.remove", server: NAME });
  await waitFor(m => m.type === "servers" && !server(m));
  console.log("ok - custom server removed");
} finally {
  host.stdin.end();
  host.kill();
  await mock.close();
  blocker?.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log("host connect checks passed");
