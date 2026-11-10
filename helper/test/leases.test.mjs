// Tab leases and exact attribution (lib/agentsessions.mjs, lib/mcpserver.mjs):
//   - the registry on a fake clock: the first action takes a tab, actions renew
//     it, it lapses after LEASE_MS (not while the holder runs a tool or is
//     paused), a second session is refused for actions but not for reads and
//     shows as "waiting", hand-over, shared mode, session_end / Stop / dismiss
//     releasing it, tabs_close of a held tab, tabs_open claiming new tabs;
//   - end to end through host.mjs and its MCP endpoint: two launcher sessions of
//     Claude Code on one tab, the refusal text, reads still allowed,
//     session_start's warning, every page request carrying the acting
//     session's id (agentSession) and label to the extension, hand-over and
//     shared mode from Ensō, tabs_open in the background with tab ids.
// Everything runs in a throwaway HOME; nothing reaches a real browser.
//
//   node test/leases.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDirFor, isolatedEnv, stopAndRemove } from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createAgentSessions, leaseText, LEASE_MS, LEASE_TOOLS, HAND_OVER_TEXT, STOPPED_TEXT } = await import("../lib/agentsessions.mjs");

// ---------- the registry, on a fake clock ----------
{
  let t = Date.parse("2026-11-10T10:00:00Z");
  const reg = createAgentSessions({ now: () => t, timers: false });
  const a = { label: "Claude Code", name: "claude-code", session: "proc-a", via: "launcher" };
  const b = { label: "Claude Code", name: "claude-code", session: "proc-b", via: "launcher" };
  const codex = { label: "Codex", name: "codex-mcp-client", session: "proc-c", via: "launcher" };
  const act = (client, tool, tabId, extra = {}) => {
    const gate = reg.before(client, { tool, kind: "act", tabId, ...extra });
    if (gate.refuse) {
      reg.finish(reg.begin(client, { tool, title: tool, tabId }), { ok: false, refused: true, error: gate.refuse });
      return gate;
    }
    reg.finish(reg.begin(client, { tool, title: tool, tabId }), { ok: true });
    return gate;
  };
  const read = (client, tool, tabId) => reg.before(client, { tool, kind: "read", tabId });
  const byClient = (client, tabId) => reg.list().find(s => s.id === reg.peek(client, tabId)?.id);

  assert.deepEqual([...LEASE_TOOLS].sort(), ["page_back", "page_click", "page_eval", "page_navigate", "page_press", "page_scroll", "page_select", "page_type", "page_upload"]);

  // Acquired by the first action, renewed by later ones, lapses after LEASE_MS
  reg.start(a, { task: "Draft the methods section", tabId: 7 });
  assert.equal(reg.lease(7), null, "session_start alone doesn't take the tab");
  assert.equal(read(a, "page_read", 7).refuse, undefined);
  assert.equal(reg.lease(7), null, "reads don't take the tab");
  assert.equal(act(a, "page_click", 7).refuse, undefined);
  let lease = reg.lease(7);
  assert.equal(lease.holderId, reg.peek(a, 7).id);
  assert.equal(lease.client, "Claude Code");
  assert.equal(lease.task, "Draft the methods section");
  assert.equal(byClient(a, 7).control, "holder");
  t += LEASE_MS - 1000;
  act(a, "page_type", 7);
  t += LEASE_MS - 1000;
  assert.ok(reg.lease(7), "each action renews the lease");
  t += 2000;
  assert.equal(reg.lease(7), null, "lapses LEASE_MS after the last action");
  reg.sweep();
  assert.equal(byClient(a, 7).control, null);
  console.log("ok - a lease is taken by the first action, renewed by each action and lapses after ~90 s");

  // A long action keeps it; so does a pause
  act(a, "page_click", 7);
  const long = reg.begin(a, { tool: "page_upload", title: "Upload", tabId: 7 });
  t += LEASE_MS * 2;
  assert.ok(reg.lease(7), "not while the holder runs a tool");
  reg.finish(long, { ok: true });
  t += LEASE_MS - 1;
  assert.ok(reg.lease(7), "the end of a long action renews it");
  reg.pause(reg.peek(a, 7).id);
  t += LEASE_MS * 5;
  reg.sweep();
  assert.ok(reg.lease(7), "a paused session keeps its lease: the user may resume it");
  reg.resume(reg.peek(a, 7).id);
  t += LEASE_MS - 1;
  assert.ok(reg.lease(7), "resuming renews it");
  console.log("ok - a running tool and a pause keep the lease");

  // Another session: refused for actions, allowed to read, shown as waiting; another tab is free
  reg.start(b, { task: "Export the brief as PDF" });
  for (const tool of LEASE_TOOLS) {
    const g = reg.before(b, { tool, kind: "act", tabId: 7 });
    assert.equal(g.refuse, leaseText({ client: "Claude Code", task: "Draft the methods section", sameClient: true }), tool);
  }
  const refused = act(b, "page_click", 7);
  assert.match(refused.refuse, /^This tab is being used by another Claude Code session \(Draft the methods section\)\. Open your own tab with tabs_open, use headless_\*, or ask the user\. The user can hand the tab over to you in Ensō\.$/);
  assert.equal(act(codex, "page_type", 7).refuse, "This tab is being used by Claude Code (Draft the methods section). Open your own tab with tabs_open, use headless_*, or ask the user. The user can hand the tab over to you in Ensō.");
  for (const tool of ["page_read", "tab_read", "page_screenshot", "devtools_console", "devtools_network", "page_query", "page_inspect", "page_wait", "page_storage"]) assert.equal(read(b, tool, 7).refuse, undefined, `${tool} stays allowed`);
  const waiting = byClient(b, 7);
  assert.equal(waiting.control, "waiting");
  assert.equal(waiting.holderId, reg.peek(a, 7).id);
  assert.ok(waiting.waitingSince);
  assert.equal(waiting.waitingTool, "page_click");
  assert.ok(waiting.actions.at(-1).refused, "the refused click shows in its card");
  assert.equal(act(b, "page_click", 8).refuse, undefined, "its own tab is free");
  assert.equal(reg.lease(7).holderId, reg.peek(a, 7).id, "the refusal didn't move the lease");
  assert.equal(reg.before(b, { tool: "tabs_close", kind: "act", tabId: null, tabIds: [8, 7] }).refuse?.startsWith("This tab is being used by another Claude Code session"), true, "closing a held tab is refused too");
  assert.equal(reg.before(b, { tool: "tabs_close", kind: "act", tabId: null, tabIds: [8] }).refuse, undefined, "closing its own tab isn't");
  console.log("ok - a second session is refused for actions (with the holder and its task), allowed to read, and shown as waiting");

  // session_start naming a held tab: a warning
  assert.match(reg.leaseWarning(codex, 7), /^Warning: tab 7 is being used by Claude Code \(Draft the methods section\)\. You can read it, but your actions on it will be refused\./);
  assert.equal(reg.leaseWarning(a, 7), "", "no warning for the holder");
  assert.equal(reg.leaseWarning(codex, 99), "", "no warning for a free tab");
  console.log("ok - session_start on a held tab gets a warning");

  // Hand-over from Ensō: the lease moves, the new holder hears it once, the old one is refused
  assert.equal(reg.handOver(reg.peek(b, 7).id), true);
  assert.equal(reg.lease(7).holderId, reg.peek(b, 7).id);
  assert.equal(byClient(b, 7).control, "holder");
  assert.equal(byClient(a, 7).control, null);
  assert.deepEqual(read(b, "page_read", 7).messages, [HAND_OVER_TEXT], "the new holder is told once");
  assert.deepEqual(read(b, "page_read", 7).messages, []);
  assert.equal(act(b, "page_click", 7).refuse, undefined);
  assert.match(act(a, "page_click", 7).refuse, /another Claude Code session \(Export the brief as PDF\)/);
  assert.equal(byClient(a, 7).control, "waiting");
  console.log("ok - hand-over moves the lease to the chosen session");

  // Shared mode: everyone may act; off again: the last holder keeps it
  assert.equal(reg.share(7, true), true);
  assert.equal(byClient(a, 7).control, "shared");
  assert.equal(byClient(b, 7).control, "shared");
  assert.equal(act(a, "page_type", 7).refuse, undefined, "shared: the other session may act");
  assert.equal(act(codex, "page_click", 7).refuse, undefined, "and so may a third");
  assert.equal(reg.lease(7).shared, true);
  assert.equal(reg.leaseWarning(codex, 7), "", "no warning on a shared tab");
  reg.share(7, false);
  assert.equal(reg.lease(7).holderId, reg.peek(b, 7).id, "back to one at a time: the holder before sharing");
  assert.ok(act(codex, "page_click", 7).refuse);
  console.log("ok - shared mode lets every agent act; turning it off restores one holder");

  // Releasing: session_end, Stop, dismiss
  reg.endClient(b, { tabId: 7 });
  assert.equal(reg.lease(7), null, "session_end releases the tab");
  assert.equal(act(codex, "page_click", 7).refuse, undefined, "and the next to act takes it");
  assert.equal(reg.lease(7).client, "Codex");
  reg.stop(reg.peek(codex, 7).id);
  assert.equal(reg.lease(7), null, "a stopped session releases its tabs");
  assert.equal(reg.before(codex, { tool: "page_click", kind: "act", tabId: 7 }).refuse, STOPPED_TEXT);
  assert.equal(act(a, "page_click", 7).refuse, undefined);
  reg.dismiss(reg.peek(a, 7).id);
  assert.equal(reg.lease(7), null, "dismissing a session releases its tab");
  console.log("ok - session_end, Stop and dismiss release the lease");

  // tabs_open claims new tabs, but never a held one
  const d = { label: "Cursor", name: "cursor-vscode" }; // plain http: keyed by its label
  act(a, "page_click", 30);
  assert.equal(reg.claim(d, [31, 30]), true);
  assert.equal(reg.lease(31).client, "Cursor");
  assert.equal(reg.lease(30).client, "Claude Code", "a held tab isn't taken by tabs_open");
  assert.ok(act(a, "page_click", 31).refuse, "the opener's new tab is its own");
  console.log("ok - tabs_open claims the new tabs for the agent that opened them");
}

// ---------- end to end: host.mjs + its MCP endpoint ----------
const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-leases-")));
const port = 47100 + Math.floor(Math.random() * 800);
const env = isolatedEnv(home, { ENSO_MCP_PORT: String(port) });
const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
host.stderr.on("data", d => (stderr += d));
const inbox = [];
const extensionCalls = [];
let waiters = [];
let buf = Buffer.alloc(0);
function post(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  host.stdin.write(Buffer.concat([head, body]));
}
// A stand-in for background.js.
const TAB = { tabId: 42, url: "https://docs.example.com/document/d/x/edit", title: "Brief · Docs" };
let nextTab = 100;
function answer(msg) {
  extensionCalls.push(msg);
  const reply = { type: msg.type.replace("request", "response"), reqId: msg.reqId, ok: true };
  const page = { url: TAB.url, title: TAB.title };
  switch (msg.action) {
    case "active_tab": reply.result = TAB; break;
    case "snapshot": reply.result = { ...page, elements: [{ ref: 1, role: "button", name: "Share" }], text: "Brief" }; break;
    case "click": reply.result = { ...page, description: 'button "Share"' }; break;
    case "type": reply.result = { ...page, description: 'textbox "Body"' }; break;
    case "tabs_open": reply.result = msg.args.urls.map(url => ({ tabId: nextTab++, url })); break;
    default: reply.result = {};
  }
  post(reply);
}
host.stdout.on("data", chunk => {
  buf = Buffer.concat([buf, chunk]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
    buf = buf.subarray(4 + len);
    if (msg.type === "page.request" || msg.type === "browser.request") answer(msg);
    inbox.push(msg);
    waiters = waiters.filter(w => !(w.test(msg) && (w.resolve(msg), true)));
  }
});
function waitFor(test, ms = 10_000) {
  const hit = [...inbox].reverse().find(test);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting; stderr:\n${stderr}`)), ms);
    waiters.push({ test, resolve: m => (clearTimeout(timer), resolve(m)) });
  });
}
let rpc = 0;
async function call(name, args = {}, session = "launcher-a") {
  const token = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18", "X-Enso-Client": "claude-code/2.1.3" };
  if (session) headers["X-Enso-Session"] = session;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.text();
  const msg = (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return { isError: !!msg.result.isError, texts: msg.result.content.map(c => c.text) };
}
const latestAgents = () => [...inbox].reverse().find(m => m.type === "agents")?.sessions ?? [];
const settle = () => new Promise(r => setTimeout(r, 120));

try {
  post({ type: "hello" });
  await waitFor(m => m.type === "state", 20_000);
  for (let i = 0; i < 100; i++) {
    try {
      readFileSync(path.join(dataDirFor(home), "mcp-token"));
      if ((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" })).status === 401) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const ACT = { requested_by_user: true, irreversible: false };

  // Two Claude Code sessions (two launcher processes) on tab 42
  let r = await call("session_start", { task: "Draft the methods section", tabId: 42 }, "launcher-a");
  assert.equal(r.isError, false, r.texts.join("\n"));
  r = await call("page_click", { ref: 1, ...ACT }, "launcher-a");
  assert.equal(r.isError, false, r.texts.join("\n"));
  await settle();
  const sa = latestAgents().find(s => s.task === "Draft the methods section");
  assert.equal(sa.control, "holder");

  // Attribution: the page request names the exact session, not just the client
  const clickA = extensionCalls.filter(c => c.action === "click").at(-1);
  assert.equal(clickA.agent, "Claude Code");
  assert.equal(clickA.agentSession, sa.id, "the acting session's id goes to the extension");
  assert.equal(clickA.tabId, 42);

  r = await call("session_start", { task: "Export the brief as PDF", tabId: 42 }, "launcher-b");
  assert.equal(r.isError, false, "session_start on a held tab still succeeds");
  assert.match(r.texts.join("\n"), /Warning: tab 42 is being used by another Claude Code session \(Draft the methods section\)/);
  const clicks = extensionCalls.filter(c => c.action === "click").length;
  r = await call("page_click", { ref: 1, tabId: 42, ...ACT }, "launcher-b");
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), "This tab is being used by another Claude Code session (Draft the methods section). Open your own tab with tabs_open, use headless_*, or ask the user. The user can hand the tab over to you in Ensō.");
  assert.equal(extensionCalls.filter(c => c.action === "click").length, clicks, "nothing reached the page");
  r = await call("page_read", { tabId: 42 }, "launcher-b");
  assert.equal(r.isError, false, "reads stay allowed");
  const snapB = extensionCalls.filter(c => c.action === "snapshot").at(-1);
  await settle();
  let sb = latestAgents().find(s => s.task === "Export the brief as PDF");
  assert.equal(snapB.agentSession, sb.id, "reads inside a session carry its id too");
  assert.equal(sb.control, "waiting", "the refused session shows as waiting for the tab");
  assert.equal(sb.holderId, sa.id);
  assert.ok(sb.actions.some(x => x.refused && x.tool === "page_click"));
  console.log("ok - end to end: a second session is refused with the holder's task, reads pass, session_start warns");
  console.log("ok - every page request carries the acting session's id and label to the extension");

  // Hand-over from Ensō
  post({ type: "agents.handover", id: sb.id });
  await waitFor(m => m.type === "agents" && m.sessions.some(s => s.id === sb.id && s.control === "holder"));
  r = await call("page_click", { ref: 1, tabId: 42, ...ACT }, "launcher-b");
  assert.equal(r.isError, false, r.texts.join("\n"));
  assert.equal(r.texts[0], HAND_OVER_TEXT);
  assert.equal(extensionCalls.filter(c => c.action === "click").at(-1).agentSession, sb.id);
  r = await call("page_type", { ref: 1, text: "x", ...ACT }, "launcher-a");
  assert.equal(r.isError, true);
  assert.match(r.texts.at(-1), /another Claude Code session \(Export the brief as PDF\)/);
  console.log("ok - end to end: hand-over from Ensō moves the tab");

  // Shared mode from Ensō
  post({ type: "agents.share", tabId: 42, on: true });
  await waitFor(m => m.type === "agents" && m.sessions.filter(s => s.tabId === 42).every(s => s.control === "shared"));
  r = await call("page_type", { ref: 1, text: "x", ...ACT }, "launcher-a");
  assert.equal(r.isError, false, "shared: both may act");
  assert.equal(extensionCalls.filter(c => c.action === "type").at(-1).agentSession, sa.id);
  post({ type: "agents.share", tabId: 42, on: false });
  await waitFor(m => m.type === "agents" && m.sessions.some(s => s.id === sb.id && s.control === "holder"));
  console.log("ok - end to end: shared mode from Ensō");

  // session_end releases
  r = await call("session_end", { tabId: 42 }, "launcher-b");
  r = await call("page_click", { ref: 1, ...ACT }, "launcher-a");
  assert.equal(r.isError, false, "after session_end the other session can act");
  await settle();
  assert.equal(latestAgents().find(s => s.id === sa.id)?.control, "holder");
  console.log("ok - end to end: session_end releases the tab");

  // tabs_open: background by default for agents, tab ids in the reply, the tab is the opener's
  r = await call("tabs_open", { urls: ["https://example.org/"] }, "launcher-c");
  assert.equal(r.isError, false, r.texts.join("\n"));
  const open = extensionCalls.filter(c => c.action === "tabs_open").at(-1);
  assert.equal(open.args.background, true, "agents' tabs open in the background (no focus stolen)");
  assert.match(r.texts[0], /tab 100: https:\/\/example\.org\//);
  r = await call("tabs_open", { urls: ["https://example.net/"], background: false }, "launcher-c");
  assert.equal(extensionCalls.filter(c => c.action === "tabs_open").at(-1).args.background, false, "unless the agent asks");
  r = await call("page_click", { ref: 1, tabId: 100, ...ACT }, "launcher-a");
  assert.equal(r.isError, true, "another agent can't act in the tab it opened");
  r = await call("page_click", { ref: 1, tabId: 100, ...ACT }, "launcher-c");
  assert.equal(r.isError, false, "the opener can");
  console.log("ok - end to end: tabs_open opens in the background, replies with tab ids and claims the tab");

  // A plain http client without a session id: no agentSession outside a session (client-level fallback)
  const before = extensionCalls.length;
  r = await call("page_read", { tabId: 555 }, null);
  assert.equal(r.isError, false);
  const lone = extensionCalls.slice(before).find(c => c.action === "snapshot");
  assert.equal(lone.agent, "Claude Code");
  assert.equal(lone.agentSession, undefined, "a lone read names only the client");
  console.log("ok - calls outside a session name only the client (the extension's fallback)");
} finally {
  await stopAndRemove(host, home);
}
