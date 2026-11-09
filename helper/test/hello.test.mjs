// Starts host.mjs the way Zen does (native messaging: a 4-byte little-endian
// length, then UTF-8 JSON, on stdin/stdout) in a throwaway home folder, and
// checks the first-run path: data copied from an old zen-chat folder, `hello`
// answered with `state`, onboarding due, a clear message when Claude Code is
// missing, the profile saved, and the local MCP server keeping its old token.
// Nothing outside the temporary folder is read or written (HOME is replaced,
// and Claude Code is kept out of reach so no model call is made).
//
//   node test/hello.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-hello-")));
const support = path.join(home, "Library/Application Support");
const legacy = path.join(support, "zen-chat");
const data = path.join(support, "Enso");
const port = 48000 + Math.floor(Math.random() * 900);

// An install from before the rename.
mkdirSync(path.join(legacy, "conversations"), { recursive: true });
const conv = { id: "11111111-2222-3333-4444-555555555555", title: "Plan the offsite", createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-01T09:05:00.000Z", engine: "subscription", messageCount: 1, actionCount: 0, pages: [], preview: "Here is a plan" };
writeFileSync(path.join(legacy, "conversations", "index.json"), JSON.stringify({ conversations: [conv] }));
writeFileSync(path.join(legacy, "conversations", `${conv.id}.jsonl`), JSON.stringify({ id: "e1", at: conv.createdAt, kind: "user", text: "Plan the offsite" }) + "\n");
writeFileSync(path.join(legacy, "mcp-token"), "f".repeat(64));
writeFileSync(path.join(legacy, "settings.json"), JSON.stringify({ effort: "medium" }));

const env = { HOME: home, PATH: "/usr/bin:/bin", ENSO_MCP_PORT: String(port), TMPDIR: tmpdir() };
const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
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
    inbox.push(msg);
    waiters = waiters.filter(w => !(w.test(msg) && (w.resolve(msg), true)));
  }
});
function post(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  host.stdin.write(Buffer.concat([head, body]));
}
function waitFor(test, ms = 15_000) {
  const hit = inbox.find(test);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    waiters.push({ test, resolve });
    setTimeout(() => reject(new Error(`timed out; stderr:\n${stderr}`)), ms);
  });
}

try {
  post({ type: "hello" });
  const st = await waitFor(m => m.type === "state");
  assert.equal(st.paths.data, data);
  assert.equal(st.settings.effort, "medium", "settings came over from zen-chat");
  assert.deepEqual(st.conversations.map(c => c.title), ["Plan the offsite"]);
  assert.equal(st.profile.set, false);
  assert.equal(st.profile.onboarding, true);
  assert.equal(st.engines.subscription.available, false);
  assert.match(st.engines.subscription.reason, /Claude Code isn't installed/);
  assert.ok(Array.isArray(st.sensitiveHosts) && st.sensitiveHosts.includes("*bank*"));
  assert.ok(existsSync(path.join(data, ".migrated-from-zen-chat")));
  assert.equal(readFileSync(path.join(data, "mcp-token"), "utf8"), "f".repeat(64));
  console.log(`ok - hello answered with state (${st.conversations.length} conversation copied from zen-chat, onboarding due)`);

  const dash = await waitFor(m => m.type === "dashboard" && m.error);
  assert.match(dash.error, /Claude Code/);
  console.log("ok - without Claude Code the dashboard says so");

  post({ type: "profile.save", name: "Maya", about: "Product designer at Northwind.\nShort answers, please.", spaceHints: { "{space-work}": "Northwind work: Figma, Linear." } });
  const prof = await waitFor(m => m.type === "profile" && m.profile.set);
  assert.equal(prof.profile.name, "Maya");
  assert.equal(prof.profile.onboarding, false);
  assert.equal(prof.profile.summary, "Product designer at Northwind.");
  const settings = await waitFor(m => m.type === "settings" && m.settings.onboardingDone);
  assert.equal(settings.settings.spaceHints["{space-work}"], "Northwind work: Figma, Linear.");
  assert.equal(readFileSync(path.join(data, "profile.md"), "utf8"), "# Maya\n\nProduct designer at Northwind.\nShort answers, please.\n");
  console.log("ok - profile.save writes profile.md and the space hints");

  post({ type: "tasks.widget" });
  const tasks = await waitFor(m => m.type === "tasks");
  assert.deepEqual(tasks.data.tasks, []);
  assert.deepEqual(tasks.data.servers, []);
  post({ type: "tasks.complete", server: "commonfold", id: "not-listed" });
  const completed = await waitFor(m => m.type === "tasks.completed");
  assert.equal(completed.ok, false);
  assert.match(completed.error, /isn't in the current list/);
  console.log("ok - tasks.widget with no task app connected is empty; tasks.complete refuses tasks it didn't list");

  // The zen-browser MCP server keeps the token Claude Code was registered with.
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    up = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" }).then(() => true, () => false);
    if (!up) await new Promise(r => setTimeout(r, 100));
  }
  const noToken = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", body: "{}" });
  assert.equal(noToken.status, 401);
  const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${"f".repeat(64)}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
  });
  assert.equal(init.status, 200);
  assert.match(await init.text(), /zen-browser/);
  console.log("ok - MCP server on the same port accepts the migrated token");
} finally {
  host.stdin.end();
  host.kill();
  rmSync(home, { recursive: true, force: true });
}
console.log("hello checks passed");
