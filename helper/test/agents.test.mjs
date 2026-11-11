// External agent sessions and steering (lib/agentsessions.mjs, lib/mcpserver.mjs):
//   - the registry on a fake clock: lifecycle, the 2-minute idle timeout,
//     paused sessions outliving it, tasks, tab-less calls folding into a tab,
//     typed-text masking, notes delivered exactly once; Stop ending the task
//     (sessions, leases and presence gone, actions refused, session_status and
//     session_end still allowed), session_start after a Stop recording one
//     deduplicated request, Allow / Allow again / Keep stopped / Dismiss, and
//     the 30-minute expiry;
//   - end to end through host.mjs (native messaging, like Zen) and its MCP
//     endpoint: session_start, the live push of `agents` and `actions.added`
//     to the UI (also for page_eval), a note delivered on the next call only,
//     Pause refusing actions and Resume's hand-back note, Stop refusing calls
//     while session_status / session_end work, the restart request in the
//     push, no MCP path that lifts a stop, Keep stopped and Allow from the UI,
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
import { dataDirFor, isolatedEnv, stopAndRemove } from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createAgentSessions, maskTyped, clientKey, IDLE_MS, PAUSED_TTL_MS, STOP_TTL_MS, NOTE_PREFIX, PAUSED_TEXT, STOPPED_TEXT, HAND_BACK_TEXT, RESTART_REQUESTED_TEXT, RESTART_KEPT_TEXT, restartAllowedNote } = await import("../lib/agentsessions.mjs");
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

  // Stop ends the task: sessions, leases and presence go at once; further actions are refused
  reg.finish(reg.begin(claude, { tool: "page_read", title: "Read", tabId: 3 }), { ok: true, url: "https://admin.example.com/privacy", pageTitle: "Privacy" });
  reg.before(claude, { tool: "page_click", kind: "act", tabId: 3 });
  reg.finish(reg.begin(claude, { tool: "page_click", title: "Click", tabId: 3 }), { ok: true, target: 'button "DPA"' });
  reg.finish(reg.begin(codex, { tool: "page_read", title: "Read", tabId: 4 }), { ok: true });
  reg.start(claude, { task: "Find the DPA options" });
  assert.ok(reg.lease(3), "claude holds tab 3");
  const cid = reg.list().find(x => x.tabId === 3).id;
  reg.note(cid, "Never mind");
  assert.equal(reg.stop(cid), true);
  assert.equal(reg.list().filter(x => x.client === "Claude Code").length, 0, "a stopped agent's sessions end at once (no Stopped pill left over)");
  assert.equal(reg.lease(3), null, "its leases go");
  assert.equal(reg.isLive(clientKey(claude)), false);
  let [rec] = reg.stoppedList();
  assert.equal(rec.client, "Claude Code");
  assert.equal(rec.task, "Find the DPA options");
  assert.equal(rec.tabId, 3);
  assert.equal(rec.title, "Privacy");
  assert.equal(rec.lastStep.tool, "page_click");
  assert.equal(rec.request, null);
  assert.ok(!JSON.stringify(rec).includes("abc"), "no client key (the launcher's session id) reaches the UI");
  const firstRefusal = reg.before(claude, { tool: "page_click", kind: "act", tabId: 3 });
  assert.deepEqual(firstRefusal.messages, [`${NOTE_PREFIX} Never mind`], "a note sent before the Stop still reaches the agent, once");
  for (const [tool, kind, tabId] of [["page_click", "act", 3], ["page_read", "read", 3], ["tabs_list", "read", null], ["tabs_open", "act", null], ["github_comment", "act", null], ["inbox_read", "read", null]]) {
    const r = reg.before(claude, { tool, kind, tabId });
    assert.equal(r.refuse, STOPPED_TEXT, `${tool} is refused when stopped`);
    assert.equal(r.stopped, true);
  }
  assert.match(STOPPED_TEXT, /call session_start with the new task: Ensō will ask them to allow it/);
  assert.equal(reg.before(codex, { tool: "page_click", kind: "act", tabId: 4 }).refuse, undefined, "other agents are unaffected");
  assert.equal(reg.before({ ...claude, session: "new-process" }, { tool: "page_read", kind: "read", tabId: 3 }).refuse, undefined, "a new agent process isn't stopped");
  console.log("ok - stop ends the task at once and refuses further actions");

  // session_end and session_status always work when stopped
  const stat = reg.before(claude, { tool: "session_status", kind: "read" });
  assert.equal(stat.refuse, undefined, "session_status isn't refused");
  assert.equal(reg.before(claude, { tool: "session_end", kind: "read" }).refuse, undefined, "session_end isn't refused");
  let st = reg.status(claude);
  assert.equal(st.stopped, true);
  assert.equal(st.restart, null);
  assert.deepEqual(st.messages, [], "the note was delivered once already");
  assert.equal(reg.endClient(claude), 0, "ending a stopped agent is fine");
  assert.equal(reg.isStopped(claude), true, "session_end doesn't lift a Stop");
  assert.equal(reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).refuse, STOPPED_TEXT);
  console.log("ok - session_end and session_status work when stopped and don't lift it");

  // session_start after a Stop: one pending request (deduplicated), never a silent resume
  const pushed = pushes.length;
  let rr = reg.requestRestart(claude, { task: "Download the signed DPA" });
  assert.deepEqual(rr, { status: "pending", text: RESTART_REQUESTED_TEXT });
  assert.match(RESTART_REQUESTED_TEXT, /Ensō has asked the user to allow this new task; call session_status to check\. Don't retry in a loop\./);
  assert.equal(reg.isStopped(claude), true, "asking doesn't resume");
  assert.equal(reg.list().filter(x => x.client === "Claude Code").length, 0, "no session until the user allows");
  const firstAt = reg.stoppedList()[0].request.at;
  t += 5000;
  rr = reg.requestRestart(claude, { task: "Download the signed DPA as PDF" });
  rr = reg.requestRestart(claude, { task: "Download the signed DPA as PDF" });
  assert.equal(rr.status, "pending");
  assert.equal(reg.stoppedList().length, 1, "one stopped entry per agent");
  [rec] = reg.stoppedList();
  assert.equal(rec.request.status, "pending");
  assert.equal(rec.request.task, "Download the signed DPA as PDF", "the latest task");
  assert.equal(rec.request.at, firstAt, "deduplicated: still the first request");
  await tick();
  assert.ok(pushes.length > pushed, "the request is pushed to Ensō");
  st = reg.status(claude);
  assert.deepEqual(st.restart, { task: "Download the signed DPA as PDF", status: "pending" });
  assert.equal(reg.before(claude, { tool: "page_click", kind: "act", tabId: 3 }).refuse, STOPPED_TEXT, "still refused while Ensō asks");
  console.log("ok - session_start after a stop records one pending request (deduplicated)");

  // Allow: the stop ends, the requested task starts, the agent hears it once
  assert.equal(reg.allowAgain("st-nope"), null, "unknown ids do nothing");
  const allowed = reg.allowAgain(rec.id);
  assert.deepEqual(allowed, { id: rec.id, client: "Claude Code", task: "Download the signed DPA as PDF" });
  assert.equal(reg.isStopped(claude), false);
  assert.equal(reg.stoppedList().length, 0);
  const resumed = reg.list().find(x => x.client === "Claude Code");
  assert.equal(resumed.task, "Download the signed DPA as PDF");
  assert.equal(resumed.stopped, false);
  st = reg.status(claude);
  assert.equal(st.stopped, false);
  assert.deepEqual(st.messages, [restartAllowedNote("Download the signed DPA as PDF")]);
  assert.equal(reg.before(claude, { tool: "page_click", kind: "act", tabId: 3 }).refuse, undefined, "actions work again");
  assert.equal(reg.allowAgain(rec.id), null, "a used grant can't be replayed");
  console.log("ok - Allow lifts the stop and starts the new task");

  // "Allow again" on the stopped card without a request: the stop ends, the agent starts a session itself
  reg.stop(reg.peek(claude).id);
  [rec] = reg.stoppedList();
  assert.ok(reg.allowAgain(rec.id));
  assert.equal(reg.isStopped(claude), false);
  assert.equal(reg.list().filter(x => x.client === "Claude Code").length, 0, "no task to start");
  assert.deepEqual(reg.status(claude).messages, [restartAllowedNote("")]);
  console.log("ok - Allow again without a request lifts the stop");

  // Keep stopped: refusals continue and say so; no new request until it expires; Dismiss hides only
  reg.start(claude, { task: "Another go" });
  reg.stop(reg.peek(claude).id);
  reg.requestRestart(claude, { task: "Try once more" });
  [rec] = reg.stoppedList();
  assert.equal(reg.keepStopped(rec.id), true);
  assert.equal(reg.keepStopped(rec.id), false, "only a pending request");
  assert.equal(reg.stoppedList()[0].request.status, "kept");
  assert.deepEqual(reg.requestRestart(claude, { task: "Please" }), { status: "kept", text: RESTART_KEPT_TEXT });
  assert.equal(reg.stoppedList()[0].request.task, "Try once more", "kept: not asked again");
  assert.equal(reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).refuse, RESTART_KEPT_TEXT);
  assert.deepEqual(reg.status(claude).restart, { task: "Try once more", status: "kept" });
  assert.equal(reg.hideStopped(rec.id), true);
  assert.equal(reg.stoppedList().length, 0, "dismissed from the sidebar");
  assert.equal(reg.isStopped(claude), true, "but still stopped");
  console.log("ok - Keep stopped keeps refusing and tells the agent; Dismiss only hides");

  // Expiry: the stop and its request go 30 minutes after the last of Stop, request and answer; then the normal flow
  t += STOP_TTL_MS - 1000;
  assert.equal(reg.isStopped(claude), true);
  t += 2000;
  reg.sweep();
  assert.equal(reg.isStopped(claude), false, "Stop expires");
  assert.equal(reg.stoppedList().length, 0);
  assert.equal(reg.requestRestart(claude, { task: "x" }), null, "no prompt after expiry");
  assert.equal(reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).refuse, undefined);
  reg.start(codex, { task: "c" });
  reg.stop(reg.peek(codex).id);
  t += 20 * 60_000;
  reg.requestRestart(codex, { task: "again" });
  t += 20 * 60_000;
  assert.equal(reg.stoppedList()[0].request.status, "pending", "a fresh request gets its own 30 minutes");
  t += 11 * 60_000;
  assert.equal(reg.isStopped(codex), false, "an unanswered request expires with the stop");
  assert.equal(reg.allowAgain(reg.stoppedList()[0]?.id), null, "an expired request can't be allowed");
  assert.equal(clientKey({ label: "Cursor", name: "cursor-vscode" }), "c:Cursor|cursor-vscode", "http clients without a session id are keyed by label");
  // An http client (no launcher session id) is allowed back under its own key
  const cursor = { label: "Cursor", name: "cursor-vscode", via: "http" };
  reg.start(cursor, { task: "c" });
  reg.stop(reg.peek(cursor).id);
  reg.requestRestart(cursor, { task: "Back" });
  reg.allowAgain(reg.stoppedList()[0].id);
  assert.equal(reg.peek(cursor)?.task, "Back", "http clients resume under the same key");
  console.log("ok - the stop and its request expire after 30 minutes; then session_start works as usual");
}

// ---------- end to end: host.mjs + its MCP endpoint ----------
const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-agents-")));
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
  const token = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18" };
  if (client) headers["X-Enso-Client"] = client;
  if (session) headers["X-Enso-Session"] = session;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.text();
  const msg = (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return { isError: !!msg.result.isError, texts: msg.result.content.map(c => c.text) };
}
const latestAgentsMsg = () => [...inbox].reverse().find(m => m.type === "agents");
const latestAgents = () => latestAgentsMsg()?.sessions ?? [];

try {
  post({ type: "hello" });
  const state = await waitFor(m => m.type === "state", 20_000);
  assert.deepEqual(state.agents, [], "state carries the (empty) agent sessions");
  for (let i = 0; i < 100; i++) {
    try {
      readFileSync(path.join(dataDirFor(home), "mcp-token"));
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

  // Stop: the task ends (session gone from the push), actions refused, session_status / session_end still work
  post({ type: "agents.stop", id: session.id });
  pushed = await waitFor(m => m.type === "agents" && !m.sessions.some(s => s.id === session.id) && m.stopped?.length === 1);
  assert.equal(pushed.stopped[0].client, "Claude Code");
  assert.equal(pushed.stopped[0].request, null);
  r = await call("page_read", {});
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), STOPPED_TEXT);
  r = await call("session_status", {});
  assert.equal(r.isError, false);
  assert.match(r.texts.at(-1), /Status: stopped: the user stopped this task\. .*call session_start with the new task and Ensō will ask them to allow it/);
  r = await call("session_end", {});
  assert.equal(r.isError, false, "session_end works when stopped");
  assert.match(r.texts.at(-1), /Session ended\. The user stopped this task in Ensō/);
  r = await call("page_read", {});
  assert.equal(r.texts.at(-1), STOPPED_TEXT, "session_end doesn't lift the stop");
  r = await call("page_read", {}, { session: "launcher-2" });
  assert.equal(r.isError, false, "another agent session isn't affected");
  console.log("ok - end to end: stop refuses actions; session_status and session_end still work");

  // session_start after the Stop: Ensō asks the user once; the agent is told to check session_status
  mark = inbox.length;
  r = await call("session_start", { task: "Download the signed DPA" });
  assert.equal(r.isError, true, "session_start doesn't resume silently");
  assert.equal(r.texts.at(-1), RESTART_REQUESTED_TEXT);
  r = await call("session_start", { task: "Download the signed DPA as PDF" });
  assert.equal(r.texts.at(-1), RESTART_REQUESTED_TEXT);
  pushed = await nextFrom(mark, m => m.type === "agents" && m.stopped?.[0]?.request?.task === "Download the signed DPA as PDF");
  assert.equal(pushed.stopped.length, 1, "one request per agent");
  assert.equal(pushed.stopped[0].request.status, "pending");
  const stopId = pushed.stopped[0].id;
  r = await call("session_status", {});
  assert.match(r.texts.at(-1), /Ensō is asking the user to allow your new task \("Download the signed DPA as PDF"\)/);
  console.log("ok - end to end: session_start after a stop asks the user once");

  // No MCP path can lift a stop: no such tool, no native message types as methods, no arguments
  const token = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
  const rpcRaw = async (method, params, extra = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18", "X-Enso-Client": "claude-code/2.1.3", "X-Enso-Session": "launcher-1", ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method, params }) });
    const body = await res.text();
    if (!res.ok) return { status: res.status };
    return (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
  };
  const toolNames = (await rpcRaw("tools/list", {})).result.tools.map(t => t.name);
  assert.ok(!toolNames.some(n => /allow|grant|resume|unstop|restart|keep/i.test(n)), `no tool lifts a stop: ${toolNames.join(", ")}`);
  for (const name of ["agents_allow", "session_resume", "session_allow"]) assert.equal((await call(name, { id: stopId }).catch(() => ({ isError: true }))).isError, true, `${name} doesn't exist`);
  for (const method of ["agents.allow", "agents.keep", "agents.resume"]) {
    const m = await rpcRaw(method, { id: stopId });
    assert.ok(m.error || m.status, `${method} over MCP is rejected`);
  }
  assert.equal((await rpcRaw("tools/call", { name: "session_start", arguments: { task: "x" } }, { Origin: "https://evil.example" })).status, 403, "no web page");
  for (const [name, args] of [["session_start", { task: "Download the signed DPA as PDF", allow: true, id: stopId, requested_by_user: true }], ["session_end", { id: stopId }], ["session_status", { allow: true }], ["inbox_read", {}], ["page_click", { ref: 1, requested_by_user: true, id: stopId }]]) await call(name, args).catch(() => {});
  r = await call("page_read", {});
  assert.equal(r.texts.at(-1), STOPPED_TEXT, "still stopped after every MCP path");
  pushed = latestAgentsMsg();
  assert.equal(pushed.stopped[0].request.status, "pending");
  console.log("ok - no MCP tool, method or argument (and no web page) lifts a stop");

  // Keep stopped from Ensō: refused with the kept text
  post({ type: "agents.keep", id: stopId });
  await waitFor(m => m.type === "agents" && m.stopped?.[0]?.request?.status === "kept");
  r = await call("session_start", { task: "Please" });
  assert.equal(r.texts.at(-1), RESTART_KEPT_TEXT);
  r = await call("page_read", {});
  assert.equal(r.texts.at(-1), RESTART_KEPT_TEXT);
  console.log("ok - end to end: Keep stopped keeps refusing and says so");

  // Allow again from Ensō (the UI message path): the stop ends and the requested task starts
  mark = inbox.length;
  post({ type: "agents.allow", id: stopId });
  pushed = await nextFrom(mark, m => m.type === "agents" && !m.stopped?.length && m.sessions.some(s => s.task === "Download the signed DPA as PDF"));
  const logged = await nextFrom(mark, m => m.type === "actions.added" && m.action.action === "agent_allow");
  assert.match(logged.action.target, /allowed Claude Code to use Zen again: Download the signed DPA as PDF/);
  r = await call("session_status", {});
  assert.match(r.texts.join("\n"), /Status: running: you may continue/);
  assert.ok(r.texts.includes(restartAllowedNote("Download the signed DPA as PDF")), "told once that the user allowed it");
  r = await call("page_read", {});
  assert.equal(r.isError, false, "actions work again");
  console.log("ok - end to end: Allow from Ensō lifts the stop and starts the new task");

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

  // A screenshot from Ensō to a connected agent: image content on its next call, inbox_read, the prompt hook
  await call("tabs_list", {}, { session: "launcher-9" });
  const ag9 = (await waitFor(m => m.type === "agents" && (m.connected ?? []).length >= 1)).connected[0];
  assert.equal(ag9.client, "Claude Code");
  const png = Buffer.from("89504e470d0a1a0a00000000", "hex").toString("base64");
  const shot = async (reqId, message) => {
    const at = inbox.length;
    post({ type: "send.screenshot", reqId, target: { kind: "agent", id: ag9.id }, image: `data:image/png;base64,${png}`, message, url: "https://docs.example.com/x", title: "Doc" });
    return nextFrom(at, m => m.type === "send.result" && m.reqId === reqId);
  };
  let sres = await shot("s1", "Look here");
  assert.equal(sres.ok, true, sres.error);
  assert.equal(sres.route, "inbox");
  const raw = async (name, args, session) => {
    const tk = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${tk}`, "MCP-Protocol-Version": "2025-06-18", "X-Enso-Client": "claude-code/2.1.3", "X-Enso-Session": session, "X-Enso-Agent-Pid": String(process.pid) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }) });
    const body = await res.text();
    const msg = (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
    return msg.result.content;
  };
  let content = await raw("tabs_list", {}, "launcher-9");
  assert.equal(content[0].text, "Screenshot from the user (via Ensō): Look here, Doc, https://docs.example.com/x");
  assert.deepEqual(content[1], { type: "image", data: png, mimeType: "image/png" });
  content = await raw("tabs_list", {}, "launcher-9");
  assert.ok(!content.some(c => c.type === "image"), "delivered once");
  sres = await shot("s2", "Second one");
  assert.equal(sres.ok, true, sres.error);
  content = await raw("inbox_read", {}, "launcher-9");
  assert.equal(content[1]?.type, "image", `inbox_read returns waiting screenshots: ${JSON.stringify(content).slice(0, 300)}`);
  await shot("s3", "For the hook");
  const tk = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
  const hook = await (await fetch(`http://127.0.0.1:${port}/inbox`, { method: "POST", headers: { Authorization: `Bearer ${tk}`, "Content-Type": "application/json" }, body: JSON.stringify({ pids: [1, process.pid] }) })).json();
  assert.equal(hook.items.length, 1);
  assert.match(hook.items[0], /For the hook.*Saved at .*[Ee]nso[\\/]screenshots[\\/].*\.png/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/inbox`, { method: "POST", body: "{}" })).status, 401, "the hook route needs the full token");
  console.log("ok - a screenshot sent to a connected agent arrives as image content, via inbox_read, or via the prompt hook");
} finally {
  await stopAndRemove(host, home);
}
