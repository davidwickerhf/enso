// External agent sessions and steering (lib/agentsessions.mjs, lib/mcpserver.mjs):
//   - the registry on a fake clock: lifecycle, the 2-minute idle timeout,
//     paused sessions outliving it, tasks, tab-less calls folding into a tab,
//     typed-text masking, notes delivered exactly once, Stop's lifetime;
//   - end to end through host.mjs (native messaging, like Zen) and its MCP
//     endpoint: session_start, the live push of `agents` and `actions.added`
//     to the UI (also for page_eval), a note delivered on the next call only,
//     Pause refusing actions and Resume's hand-back note, Stop refusing calls,
//     and the old http + bearer use without a session id.
// Everything runs in a throwaway HOME; nothing reaches a real browser.
//
//   node test/agents.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createAgentSessions, maskTyped, clientKey, IDLE_MS, PAUSED_TTL_MS, STOP_TTL_MS, NOTE_PREFIX, PAUSED_TEXT, STOPPED_TEXT, HAND_BACK_TEXT } = await import("../lib/agentsessions.mjs");
const tick = () => new Promise(r => setTimeout(r, 0));

// ---------- the registry, on a fake clock ----------
{
  let t = Date.parse("2026-11-10T10:00:00Z");
  const pushes = [];
  const reg = createAgentSessions({ now: () => t, onChange: l => pushes.push(l), timers: false });
  const claude = { label: "Claude Code", name: "claude-code", session: "abc", via: "launcher" };
  const codex = { label: "Codex", name: "codex-mcp-client", session: "xyz", via: "launcher" };

  // Lifecycle and timeout
  const h1 = reg.begin(claude, { tool: "page_read", title: "Read the page", tabId: 5 });
  assert.equal(reg.list()[0].running, true);
  reg.finish(h1, { ok: true, url: "https://example.com/", pageTitle: "Example" });
  await tick();
  assert.ok(pushes.length >= 1, "changes are pushed");
  let [s] = reg.list();
  assert.equal(s.client, "Claude Code");
  assert.equal(s.tabId, 5);
  assert.equal(s.running, false);
  assert.equal(s.actions.length, 1);
  assert.equal(s.title, "Example");
  assert.ok(!("key" in s), "no client keys in what the UI gets");
  t += IDLE_MS - 1000;
  reg.sweep();
  assert.equal(reg.list().length, 1, "still active just under the idle timeout");
  t += 2000;
  reg.sweep();
  assert.equal(reg.list().length, 0, "ended after ~2 minutes without calls");
  console.log("ok - session lifecycle and the idle timeout");

  // Tasks, tab-less calls folding into the first tab, explicit end
  reg.start(claude, { task: "  Fill in the\nexpense form  " });
  const h2 = reg.begin(claude, { tool: "tabs_list", title: "List tabs", tabId: null });
  reg.finish(h2, { ok: true });
  assert.equal(reg.list().length, 1);
  assert.equal(reg.list()[0].tabId, null);
  reg.finish(reg.begin(claude, { tool: "page_click", title: "Click", tabId: 9 }), { ok: true, target: 'button "Save"' });
  [s] = reg.list();
  assert.equal(reg.list().length, 1, "the tab-less session folded into the tab session");
  assert.equal(s.tabId, 9);
  assert.equal(s.task, "Fill in the expense form");
  assert.equal(s.explicit, true);
  assert.deepEqual(s.actions.map(a => a.tool), ["tabs_list", "page_click"]);
  reg.finish(reg.begin(claude, { tool: "page_read", title: "Read", tabId: 10 }), { ok: true });
  assert.equal(reg.list().find(x => x.tabId === 10).task, "Fill in the expense form", "the task applies to new tabs too");
  assert.equal(reg.endClient(claude, { tabId: 10 }), 1);
  assert.deepEqual(reg.list().map(x => x.tabId), [9]);
  console.log("ok - session_start tasks, tab-less calls and session_end");

  // Masking typed text
  assert.equal(maskTyped("hunter2", 'password "Password"'), "••••••");
  assert.equal(maskTyped("x".repeat(100), 'textbox "Body"'), `${"x".repeat(40)}…`);
  const typed = reg.finish(reg.begin(claude, { tool: "page_type", title: "Type", tabId: 9 }), { ok: true, target: 'password "Password"', typed: "correct horse battery staple" });
  assert.equal(typed.typed, "••••••");
  assert.ok(!JSON.stringify(reg.list()).includes("correct horse"), "typed secrets are never kept");
  console.log("ok - typed text is truncated, and masked for password fields");

  // Notes: delivered to the next call from that client, on any tab, exactly once
  const id = reg.list().find(x => x.tabId === 9).id;
  assert.equal(reg.note(id, "   "), null, "empty notes are ignored");
  reg.note(id, "Use the work account,\nnot the personal one");
  assert.deepEqual(reg.before(codex, { tool: "page_read", kind: "read", tabId: 9 }).messages, [], "another client doesn't get it");
  assert.deepEqual(reg.before(claude, { tool: "page_read", kind: "read", tabId: 77 }).messages, [`${NOTE_PREFIX} Use the work account, not the personal one`]);
  assert.deepEqual(reg.before(claude, { tool: "page_read", kind: "read", tabId: 9 }).messages, [], "exactly once");
  assert.ok(reg.list().find(x => x.id === id).notes[0].deliveredAt, "marked delivered");
  console.log("ok - notes are delivered once, to the next call of that client");

  // Pause: actions on that tab and tab-less actions refused; reads elsewhere pass; idle timeout waits
  assert.equal(reg.pause(id), true);
  assert.equal(reg.before(claude, { tool: "page_click", kind: "act", tabId: 9 }).refuse, PAUSED_TEXT);
  assert.equal(reg.before(claude, { tool: "page_read", kind: "read", tabId: 9 }).refuse, PAUSED_TEXT, "the paused tab is the user's: no reading either");
  assert.equal(reg.before(claude, { tool: "tabs_close", kind: "act", tabId: null }).refuse, PAUSED_TEXT);
  assert.equal(reg.before(claude, { tool: "tabs_list", kind: "read", tabId: null }).refuse, undefined, "tab-less reads pass");
  assert.equal(reg.before(claude, { tool: "session_status", kind: "read", tabId: 9 }).refuse, undefined);
  assert.equal(reg.status(claude, { tabId: 9 }).paused, true);
  t += IDLE_MS * 3;
  reg.sweep();
  assert.ok(reg.get(id), "a paused session outlives the idle timeout");
  assert.equal(reg.resume(id), true);
  assert.deepEqual(reg.before(claude, { tool: "page_click", kind: "act", tabId: 9 }), { messages: [HAND_BACK_TEXT] }, "hand-back on the first call after Resume");
  assert.deepEqual(reg.before(claude, { tool: "page_click", kind: "act", tabId: 9 }).messages, [], "only once");
  reg.pause(id);
  t += PAUSED_TTL_MS + 1000;
  reg.sweep();
  assert.equal(reg.get(id), null, "a forgotten pause ends eventually");
  console.log("ok - pause refuses actions; resume hands back once");

  // Stop: every call of that client refused for STOP_TTL_MS, other clients unaffected
  reg.finish(reg.begin(claude, { tool: "page_read", title: "Read", tabId: 3 }), { ok: true });
  reg.finish(reg.begin(codex, { tool: "page_read", title: "Read", tabId: 4 }), { ok: true });
  const cid = reg.list().find(x => x.tabId === 3).id;
  reg.note(cid, "Never mind");
  assert.equal(reg.stop(cid), true);
  const st = reg.before(claude, { tool: "tabs_list", kind: "read", tabId: null });
  assert.equal(st.refuse, STOPPED_TEXT);
  assert.deepEqual(st.messages, [`${NOTE_PREFIX} Never mind`], "a refused call still carries notes");
  assert.equal(reg.list().find(x => x.tabId === 3).stopped, true);
  assert.equal(reg.before(codex, { tool: "page_click", kind: "act", tabId: 4 }).refuse, undefined);
  assert.equal(reg.before({ ...claude, session: "new-process" }, { tool: "page_read", kind: "read", tabId: 3 }).refuse, undefined, "a new agent session isn't stopped");
  t += STOP_TTL_MS + 1000;
  assert.equal(reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).refuse, undefined, "Stop expires");
  assert.equal(clientKey({ label: "Cursor", name: "cursor-vscode" }), "c:Cursor|cursor-vscode", "http clients without a session id are keyed by label");
  console.log("ok - stop refuses every call of that agent session");
}

// ---------- end to end: host.mjs + its MCP endpoint ----------
const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-agents-")));
const port = 47100 + Math.floor(Math.random() * 800);
const env = { HOME: home, PATH: "/usr/bin:/bin", ENSO_MCP_PORT: String(port), TMPDIR: tmpdir() };
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
// A stand-in for background.js: answers page and browser requests.
const TAB = { tabId: 42, url: "https://docs.example.com/document/d/x/edit", title: "Draft · Docs" };
function answer(msg) {
  extensionCalls.push(msg);
  const reply = { type: msg.type.replace("request", "response"), reqId: msg.reqId, ok: true };
  const page = { url: TAB.url, title: TAB.title };
  switch (msg.action) {
    case "active_tab": reply.result = TAB; break;
    case "eval": reply.result = { ok: true, world: "page", type: "number", json: "3", ...page, description: `JavaScript: ${msg.args.expression}` }; break;
    case "snapshot": reply.result = { ...page, elements: [{ ref: 1, role: "button", name: "Share" }], text: "Draft" }; break;
    case "click": reply.result = { ...page, description: 'button "Share"' }; break;
    case "type": reply.result = { ...page, description: msg.args.ref === 2 ? 'password "Password"' : 'textbox "Body"' }; break;
    case "tabs_list": reply.result = [{ ...TAB, active: true, groupId: -1 }]; break;
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
const nextFrom = (since, test, ms) => waitFor((m, i) => inbox.indexOf(m) >= since && test(m), ms);

let rpc = 0;
async function call(name, args = {}, { session = "launcher-1", client = "claude-code/2.1.3" } = {}) {
  const token = readFileSync(path.join(home, "Library/Application Support/Enso/mcp-token"), "utf8").trim();
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18" };
  if (client) headers["X-Enso-Client"] = client;
  if (session) headers["X-Enso-Session"] = session;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.text();
  const msg = (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return { isError: !!msg.result.isError, texts: msg.result.content.map(c => c.text) };
}
const latestAgents = () => [...inbox].reverse().find(m => m.type === "agents")?.sessions ?? [];

try {
  post({ type: "hello" });
  const state = await waitFor(m => m.type === "state", 20_000);
  assert.deepEqual(state.agents, [], "state carries the (empty) agent sessions");
  for (let i = 0; i < 100; i++) {
    try {
      readFileSync(path.join(home, "Library/Application Support/Enso/mcp-token"));
      if ((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" })).status === 401) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  // session_start → pushed
  let mark = inbox.length;
  let r = await call("session_start", { task: "Write the intro of the draft", tabId: 42 });
  assert.equal(r.isError, false, r.texts.join("\n"));
  assert.match(r.texts[0], /Session started\. Ensō shows "Claude Code · Write the intro of the draft" on tab 42/);
  let pushed = await nextFrom(mark, m => m.type === "agents" && m.sessions.some(s => s.task === "Write the intro of the draft"));
  const session = pushed.sessions[0];
  assert.equal(session.tabId, 42);
  assert.equal(session.client, "Claude Code");
  console.log("ok - session_start names the task, and the session is pushed to the UI");

  // page_eval without a tabId: the active tab, a live actions.added and a session step
  mark = inbox.length;
  r = await call("page_eval", { expression: "1+2", requested_by_user: true, irreversible: false });
  assert.equal(r.isError, false, r.texts.join("\n"));
  const evalReq = extensionCalls.find(c => c.action === "eval");
  assert.equal(evalReq.tabId, 42, "acts on the active tab the session follows");
  assert.equal(evalReq.agent, "Claude Code");
  const added = await nextFrom(mark, m => m.type === "actions.added" && m.action.action === "eval");
  assert.equal(added.action.source, "Claude Code");
  assert.equal(added.action.host, "docs.example.com");
  pushed = await nextFrom(mark, m => m.type === "agents" && m.sessions[0]?.actions.some(a => a.tool === "page_eval"));
  const evalStep = pushed.sessions[0].actions.find(a => a.tool === "page_eval");
  assert.equal(evalStep.target, "JavaScript: 1+2");
  assert.equal(pushed.sessions[0].running, false);
  console.log("ok - page_eval is pushed live (actions.added + agents) without reopening anything");

  // A note: delivered on the next call only
  post({ type: "agents.note", id: session.id, text: "Use the work account, not the personal one." });
  await waitFor(m => m.type === "agents" && m.sessions[0]?.notes.length === 1);
  await waitFor(m => m.type === "actions.added" && m.action.action === "note");
  r = await call("page_read", {});
  assert.equal(r.texts[0], `${NOTE_PREFIX} Use the work account, not the personal one.`);
  assert.match(r.texts[1], /URL: https:\/\/docs\.example\.com/);
  await waitFor(m => m.type === "agents" && m.sessions[0]?.notes[0]?.deliveredAt);
  r = await call("page_read", {});
  assert.ok(!r.texts.some(t => t.startsWith(NOTE_PREFIX)), "delivered exactly once");
  console.log("ok - a note from Ensō arrives at the start of the next tool result, once");

  // Pause: actions refused, nothing reaches the page; Resume: hand-back note once
  post({ type: "agents.pause", id: session.id });
  await waitFor(m => m.type === "agents" && m.sessions[0]?.paused);
  const clicksBefore = extensionCalls.filter(c => c.action === "click").length;
  r = await call("page_click", { ref: 1, requested_by_user: true, irreversible: false });
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), PAUSED_TEXT);
  assert.equal(extensionCalls.filter(c => c.action === "click").length, clicksBefore, "nothing reached the page");
  r = await call("tabs_list", {});
  assert.equal(r.isError, false, "tab-less reads still pass while paused");
  r = await call("session_status", {});
  assert.match(r.texts.at(-1), /Status: paused by the user \(tab 42\)/);
  post({ type: "agents.resume", id: session.id });
  await waitFor(m => m.type === "agents" && m.sessions[0] && !m.sessions[0].paused);
  r = await call("page_click", { ref: 1, requested_by_user: true, irreversible: false });
  assert.equal(r.isError, false);
  assert.equal(r.texts[0], HAND_BACK_TEXT);
  r = await call("page_click", { ref: 1, requested_by_user: true, irreversible: false });
  assert.notEqual(r.texts[0], HAND_BACK_TEXT);
  pushed = latestAgents();
  assert.ok(pushed[0].actions.some(a => a.refused && a.tool === "page_click"), "the refused click shows in the card");
  console.log("ok - pause refuses actions; resume brings a hand-back note once");

  // Typing: password values never leave the helper
  mark = inbox.length;
  await call("page_type", { ref: 2, text: "correct horse battery staple", requested_by_user: true, irreversible: false });
  pushed = await nextFrom(mark, m => m.type === "agents" && m.sessions[0]?.actions.at(-1)?.tool === "page_type");
  assert.equal(pushed.sessions[0].actions.at(-1).typed, "••••••");
  assert.ok(!inbox.some(m => m.type !== "page.request" && JSON.stringify(m).includes("correct horse")), "the typed password is not pushed or logged");
  console.log("ok - typed passwords are masked in the session");

  // Stop: every call of that session refused, a new session works
  post({ type: "agents.stop", id: session.id });
  await waitFor(m => m.type === "agents" && m.sessions[0]?.stopped);
  r = await call("page_read", {});
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), STOPPED_TEXT);
  r = await call("session_start", { task: "Try again" });
  assert.equal(r.isError, true, "session_start doesn't lift a Stop");
  r = await call("page_read", {}, { session: "launcher-2" });
  assert.equal(r.isError, false, "another agent session isn't affected");
  console.log("ok - stop refuses every further call of that session");

  // A lone read from an agent with no session doesn't open one (no pill, no ✦)
  const before = latestAgents().length;
  r = await call("page_read", {}, { session: "launcher-3" });
  assert.equal(r.isError, false);
  r = await call("tabs_list", {}, { session: "launcher-3" });
  await new Promise(res => setTimeout(res, 150));
  assert.equal(latestAgents().length, before, "reading alone doesn't start a session");
  console.log("ok - a lone read doesn't open a session");

  // Old http + bearer clients (no session header, no client header) still work
  r = await call("tabs_list", {}, { session: null, client: null });
  assert.equal(r.isError, false);
  console.log("ok - plain http + bearer calls work without a session id");
} finally {
  host.kill();
  rmSync(home, { recursive: true, force: true });
}
