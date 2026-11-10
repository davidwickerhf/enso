// Session-access requests (lib/agentsessions.mjs requestAccess, lib/mcpserver.mjs,
// lib/devtools.mjs session_fetch, lib/headless.mjs headless_start, host.mjs
// "access.allow" / "access.dismiss"):
//   - the registry on a fake clock: a refusal records one request per agent
//     and origin (deduplicated), Allow and Not now ride on the agent's next
//     result exactly once, a declined site isn't asked about again, requests
//     expire with the agent's sessions (session_end, idle, Stop) and can't be
//     answered after that;
//   - end to end through host.mjs and its MCP endpoint: session_fetch and
//     headless_start refused with the "Ensō has asked the user" text, the
//     request in the `agents` push, private sites refused without a request,
//     no MCP tool or request that can allow a site, Allow from the UI message
//     path writing exactly that origin to settings.sessionAccess (and
//     sessionAccessAdded) with the note on the next result and the retry
//     going through, Not now, and expiry with session_end.
// Everything runs in a throwaway HOME; nothing reaches a real browser, the
// real helper or the real allowlist.
//
//   node test/access.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDirFor, isolatedEnv, stopAndRemove } from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createAgentSessions, accessRequestedText, accessDeclinedText, accessGrantedNote, accessDismissedNote, IDLE_MS, ACCESS_TTL_MS, ACCESS_SHOWN_MS } = await import("../lib/agentsessions.mjs");

// ---------- the registry, on a fake clock ----------
{
  let t = Date.parse("2026-11-10T10:00:00Z");
  const reg = createAgentSessions({ now: () => t, timers: false });
  const a = { label: "Claude Code", name: "claude-code", session: "proc-a", via: "launcher" };
  const b = { label: "Codex", name: "codex-mcp-client", session: "proc-b", via: "launcher" };
  const run = (client, tool, tabId = null) => reg.finish(reg.begin(client, { tool, title: tool, tabId }), { ok: false });

  // A refusal records a request; the same agent and origin again is the same request
  run(a, "session_fetch");
  let r1 = reg.requestAccess(a, { origin: "https://desec.io", tool: "session_fetch" });
  assert.equal(r1.status, "pending");
  assert.equal(r1.text, accessRequestedText("https://desec.io"));
  assert.equal(r1.text, "https://desec.io isn't on Ensō's session-access list. Ensō has asked the user to allow it; you'll be told in a later tool result if they do. Don't retry in a loop.");
  const again = reg.requestAccess(a, { origin: "https://desec.io", tool: "session_fetch" });
  assert.equal(again.request.id, r1.request.id, "deduplicated per agent and origin");
  assert.equal(reg.accessList().length, 1);
  const [shown] = reg.accessList();
  assert.equal(shown.client, "Claude Code");
  assert.equal(shown.origin, "https://desec.io");
  assert.equal(shown.tool, "session_fetch");
  assert.equal(shown.status, "pending");
  assert.deepEqual(shown.sessionIds, [reg.peek(a).id]);
  assert.ok(!("key" in shown), "no client keys in what the UI gets");
  reg.requestAccess(a, { origin: "https://api.example.org", tool: "session_fetch" });
  assert.equal(reg.accessList().length, 2, "another origin is another request");
  run(b, "headless_start");
  reg.requestAccess(b, { origin: "https://desec.io", tool: "headless_start" });
  assert.equal(reg.accessList().length, 3, "another agent asking for the same site is its own request");
  console.log("ok - a refusal records a request, deduplicated per agent and origin");

  // Nothing is delivered while it is pending
  assert.deepEqual(reg.before(a, { tool: "tabs_list", kind: "read" }).messages, []);

  // Allow (the UI) → the note on the agent's next result, exactly once
  const granted = reg.resolveAccess(r1.request.id, "granted");
  assert.deepEqual(granted, { id: r1.request.id, origin: "https://desec.io", client: "Claude Code", status: "granted" });
  assert.equal(reg.resolveAccess(r1.request.id, "dismissed"), null, "an answered request can't be answered again");
  assert.equal(reg.resolveAccess(r1.request.id, "granted"), null);
  assert.equal(reg.accessList().find(x => x.id === r1.request.id).status, "granted", "the granted state stays visible for a moment");
  assert.deepEqual(reg.before(b, { tool: "tabs_list", kind: "read" }).messages, [], "another agent doesn't get it");
  let msgs = reg.before(a, { tool: "tabs_list", kind: "read" }).messages;
  assert.deepEqual(msgs, [accessGrantedNote("https://desec.io")]);
  assert.equal(msgs[0], "Note from Ensō: The user allowed https://desec.io for session access. You can retry.");
  assert.deepEqual(reg.before(a, { tool: "tabs_list", kind: "read" }).messages, [], "delivered once");
  assert.equal(reg.accessList().find(x => x.id === r1.request.id).told, true);
  t += ACCESS_SHOWN_MS + 1;
  assert.equal(reg.accessList().find(x => x.id === r1.request.id), undefined, "the answered request leaves the UI after a moment");
  console.log("ok - Allow rides on the agent's next result exactly once");

  // Not now → its note, and the site isn't asked about again in this task
  const r2 = reg.accessList().find(x => x.origin === "https://api.example.org");
  reg.resolveAccess(r2.id, "dismissed");
  msgs = reg.before(a, { tool: "tabs_list", kind: "read" }).messages;
  assert.deepEqual(msgs, [accessDismissedNote("https://api.example.org")]);
  assert.equal(msgs[0], "Note from Ensō: The user didn't allow https://api.example.org; don't ask again in this task.");
  const declined = reg.requestAccess(a, { origin: "https://api.example.org", tool: "session_fetch" });
  assert.equal(declined.status, "dismissed");
  assert.equal(declined.text, accessDeclinedText("https://api.example.org"));
  assert.equal(reg.accessList().filter(x => x.status === "pending" && x.client === "Claude Code").length, 0, "no new prompt after Not now");
  console.log("ok - Not now: its note once, and no new request for that site in the task");

  // A granted site removed from the list again: a new request
  const fresh = reg.requestAccess(a, { origin: "https://desec.io", tool: "session_fetch" });
  assert.equal(fresh.status, "pending");
  assert.notEqual(fresh.request.id, r1.request.id);

  // Expiry with the session: session_end drops the agent's requests; they can't be answered after
  const pendingId = fresh.request.id;
  reg.endClient(a);
  assert.equal(reg.accessList().filter(x => x.client === "Claude Code").length, 0, "session_end drops the requests");
  assert.equal(reg.resolveAccess(pendingId, "granted"), null, "an expired request can't be allowed");
  // ... and a new session starts with a clean slate (the declined site may be asked about again)
  run(a, "session_fetch");
  assert.equal(reg.requestAccess(a, { origin: "https://api.example.org", tool: "session_fetch" }).status, "pending", "Not now lasts for the task, not forever");
  // Idle sessions end, and their requests with them
  t += IDLE_MS + 1;
  reg.sweep();
  assert.equal(reg.accessList().length, 0, "requests expire with idle sessions");
  // Stop drops them too
  run(b, "headless_start");
  const rb = reg.requestAccess(b, { origin: "https://staging.example.net", tool: "headless_start" });
  reg.stop(reg.peek(b).id);
  assert.equal(reg.accessList().length, 0, "Stop drops the agent's requests");
  assert.equal(reg.resolveAccess(rb.request.id, "granted"), null);
  // A request nobody answers lapses
  const c = { label: "Cursor", name: "cursor-vscode" };
  run(c, "session_fetch");
  const rc = reg.requestAccess(c, { origin: "https://slow.example.com", tool: "session_fetch" });
  t += ACCESS_TTL_MS + 1;
  reg.begin(c, { tool: "tabs_list", title: "", tabId: null }); // the session stays alive
  reg.sweep();
  assert.equal(reg.resolveAccess(rc.request.id, "granted"), null, "unanswered requests lapse after ACCESS_TTL_MS");
  console.log("ok - requests expire with the session (session_end, idle, Stop) and lapse unanswered");

  // Only resolveAccess (host.mjs, from the user's click) answers: unknown decisions do nothing
  const d = { label: "Claude Code", name: "claude-code", session: "proc-d" };
  run(d, "session_fetch");
  const rd = reg.requestAccess(d, { origin: "https://desec.io", tool: "session_fetch" });
  assert.equal(reg.resolveAccess(rd.request.id, "allow"), null);
  assert.equal(reg.resolveAccess("ar-nope", "granted"), null);
  assert.equal(reg.accessList()[0].status, "pending");
  console.log("ok - only a known pending request with granted/dismissed can be answered");
}

// ---------- end to end: host.mjs + its MCP endpoint ----------
const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-access-")));
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
const TAB = { tabId: 42, url: "https://desec.io/domains", title: "deSEC" };
function answer(msg) {
  extensionCalls.push(msg);
  const reply = { type: msg.type.replace("request", "response"), reqId: msg.reqId, ok: true };
  switch (msg.action) {
    case "active_tab": reply.result = TAB; break;
    case "session_fetch": reply.result = { status: 200, statusText: "OK", url: msg.args.url, headers: [{ name: "content-type", value: "application/json" }], body: "[]", bodyLength: 2, tabId: 42, openedTab: false, tabOrigin: "https://desec.io", tabTitle: "deSEC" }; break;
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
const token = () => readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
let rpc = 0;
async function rpcCall(method, params, { session = "launcher-a", headers: extra = {} } = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token()}`, "MCP-Protocol-Version": "2025-06-18", "X-Enso-Client": "claude-code/2.1.3", ...extra };
  if (session) headers["X-Enso-Session"] = session;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method, params }) });
  const body = await res.text();
  if (!res.ok) return { status: res.status, body };
  return (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
}
async function call(name, args = {}, session = "launcher-a") {
  const msg = await rpcCall("tools/call", { name, arguments: args }, { session });
  if (msg.error) return { isError: true, rpcError: msg.error, texts: [JSON.stringify(msg.error)] };
  return { isError: !!msg.result.isError, texts: msg.result.content.map(c => c.text) };
}
const settingsFile = () => JSON.parse(readFileSync(path.join(dataDirFor(home), "settings.json"), "utf8"));
const latestAccess = () => [...inbox].reverse().find(m => m.type === "agents")?.access ?? [];
const settle = () => new Promise(r => setTimeout(r, 150));

try {
  post({ type: "hello" });
  const state = await waitFor(m => m.type === "state", 20_000);
  assert.deepEqual(state.agentAccess, [], "the state carries the (empty) request list");
  for (let i = 0; i < 100; i++) {
    try {
      readFileSync(path.join(dataDirFor(home), "mcp-token"));
      if ((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" })).status === 401) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  // The instructions tell agents what to do when refused
  const init = await rpcCall("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.3" } });
  assert.match(init.result.instructions, /Ensō has already asked the user .*tell the user Ensō is asking, then wait or continue with other work/);
  assert.match(init.result.instructions, /never ask them to edit config files/);

  // session_fetch on a site that isn't allowed: refused, and Ensō asks the user
  let r = await call("session_start", { task: "Check the staging DNS records" });
  r = await call("session_fetch", { url: "https://desec.io/api/v1/domains/", requested_by_user: true });
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), accessRequestedText("https://desec.io"));
  assert.equal(extensionCalls.filter(c => c.action === "session_fetch").length, 0, "nothing reached the browser");
  await settle();
  let acc = latestAccess();
  assert.equal(acc.length, 1);
  assert.equal(acc[0].origin, "https://desec.io");
  assert.equal(acc[0].client, "Claude Code");
  assert.equal(acc[0].tool, "session_fetch");
  assert.equal(acc[0].status, "pending");
  const agentsMsg = [...inbox].reverse().find(m => m.type === "agents");
  const step = agentsMsg.sessions.find(s => acc[0].sessionIds.includes(s.id)).actions.at(-1);
  assert.equal(step.tool, "session_fetch");
  assert.equal(step.refused, true, "the card shows the step as refused (Ensō asked), not as a failure");
  r = await call("session_fetch", { url: "https://desec.io/api/v1/domains/other", requested_by_user: true });
  assert.equal(r.texts.at(-1), accessRequestedText("https://desec.io"));
  await settle();
  assert.equal(latestAccess().length, 1, "a retry doesn't add a second request");
  console.log("ok - end to end: session_fetch refused with the request text; one request in the agents push");

  // headless_start with a site that isn't allowed: refused per site, one request each
  r = await call("headless_start", { sites: ["staging.example.org"] });
  assert.equal(r.isError, true);
  assert.equal(r.texts.at(-1), `${accessRequestedText("https://staging.example.org")}\nYou can start without that site meanwhile.`);
  await settle();
  acc = latestAccess();
  assert.equal(acc.length, 2);
  const headlessReq = acc.find(x => x.origin === "https://staging.example.org");
  const desecReq = acc.find(x => x.origin === "https://desec.io");
  assert.equal(headlessReq.tool, "headless_start");
  console.log("ok - end to end: headless_start refused with the request text; its own request");

  // Private sites: refused as before, never a request
  r = await call("session_fetch", { url: "https://www.mybank.example/accounts", requested_by_user: true });
  assert.equal(r.isError, true);
  assert.match(r.texts.at(-1), /private site .*session requests are off here/);
  r = await call("headless_start", { sites: ["online.healthportal.example"] });
  assert.equal(r.isError, true);
  assert.match(r.texts.at(-1), /Private sites can't be copied/);
  r = await call("session_fetch", { url: "https://checkout.paypal.com/x", requested_by_user: true });
  assert.match(r.texts.at(-1), /private site/);
  await settle();
  assert.equal(latestAccess().length, 2, "no request for private sites");
  assert.ok(!latestAccess().some(x => /bank|health|paypal/.test(x.origin)));
  console.log("ok - private sites are refused as before and never prompt");

  // No MCP path can allow a site
  const list = await rpcCall("tools/list", {});
  const names = list.result.tools.map(t => t.name);
  assert.ok(!names.some(n => /access|allow|grant|permission|settings/i.test(n)), `no tool to allow session access: ${names.join(", ")}`);
  for (const name of ["access_allow", "session_access_allow", "settings_update"]) {
    r = await call(name, { id: desecReq.id, origin: "https://desec.io" });
    assert.equal(r.isError, true, `${name} doesn't exist`);
  }
  // Native-protocol message types sent as MCP methods do nothing either
  for (const method of ["access.allow", "settings.update"]) {
    const m = await rpcCall(method, { id: desecReq.id, patch: { sessionAccess: { "https://desec.io": "allow" } } });
    assert.ok(m.error || m.status, `${method} over MCP is rejected`);
  }
  // A request from a web page (Origin header) is refused outright
  const fromPage = await rpcCall("tools/call", { name: "session_fetch", arguments: { url: "https://desec.io/" } }, { headers: { Origin: "https://desec.io" } });
  assert.equal(fromPage.status, 403);
  // The tools' own arguments can't allow either
  r = await call("session_fetch", { url: "https://desec.io/api/v1/domains/", requested_by_user: true, allow: true, sessionAccess: "allow" });
  assert.equal(r.isError, true);
  await settle();
  assert.equal(settingsFile().sessionAccess, undefined, "settings.sessionAccess untouched by anything over MCP");
  assert.equal(latestAccess().find(x => x.id === desecReq.id).status, "pending");
  console.log("ok - no MCP tool, method or argument (and no web page) can allow a site");

  // Allow from Ensō (the UI message path): exactly that origin is added, the agent hears it next
  post({ type: "access.allow", id: desecReq.id });
  const saved = await waitFor(m => m.type === "settings" && m.settings?.sessionAccess?.["https://desec.io"] === "allow");
  assert.deepEqual(saved.settings.sessionAccess, { "https://desec.io": "allow" }, "exactly the requested origin");
  assert.equal(saved.settings.sessionAccessAdded["https://desec.io"].by, "Claude Code");
  assert.deepEqual(settingsFile().sessionAccess, { "https://desec.io": "allow" });
  const logged = await waitFor(m => m.type === "actions.added" && m.action.action === "session_access");
  assert.match(logged.action.target, /allowed https:\/\/desec\.io for Claude Code/);
  await waitFor(m => m.type === "agents" && m.access.some(x => x.id === desecReq.id && x.status === "granted"));
  r = await call("tabs_list", {});
  assert.equal(r.texts[0], accessGrantedNote("https://desec.io"), "the next result starts with the note");
  r = await call("session_fetch", { url: "https://desec.io/api/v1/domains/", requested_by_user: true });
  assert.equal(r.isError, false, r.texts.join("\n"));
  assert.ok(!r.texts.some(x => x.startsWith("Note from Ensō: The user allowed")), "the note came once");
  assert.equal(extensionCalls.filter(c => c.action === "session_fetch").length, 1, "the retry reached the browser");
  assert.match(r.texts.at(-1), /GET https:\/\/desec\.io\/api\/v1\/domains\/ → 200/);
  // Allowing twice does nothing more
  post({ type: "access.allow", id: desecReq.id });
  await settle();
  assert.deepEqual(settingsFile().sessionAccess, { "https://desec.io": "allow" });
  console.log("ok - end to end: Allow from the UI adds exactly that origin; the next result carries the note; the retry works");

  // Not now on the headless request
  post({ type: "access.dismiss", id: headlessReq.id });
  await waitFor(m => m.type === "agents" && m.access.some(x => x.id === headlessReq.id && x.status === "dismissed"));
  r = await call("tabs_list", {});
  assert.equal(r.texts[0], accessDismissedNote("https://staging.example.org"));
  r = await call("headless_start", { sites: ["staging.example.org"] });
  assert.equal(r.texts.at(-1), `${accessDeclinedText("https://staging.example.org")}\nYou can start without that site meanwhile.`);
  await settle();
  assert.equal(latestAccess().filter(x => x.status === "pending").length, 0, "no new prompt after Not now");
  assert.equal(settingsFile().sessionAccess["https://staging.example.org"], undefined);
  console.log("ok - end to end: Not now tells the agent and isn't asked again in the task");

  // Expiry with the session
  r = await call("session_fetch", { url: "https://api.other.example/v1", requested_by_user: true });
  await settle();
  const last = latestAccess().find(x => x.origin === "https://api.other.example");
  assert.equal(last.status, "pending");
  r = await call("session_end", {});
  await waitFor(m => m.type === "agents" && m.access.length === 0);
  post({ type: "access.allow", id: last.id });
  await settle();
  assert.equal(settingsFile().sessionAccess["https://api.other.example"], undefined, "an expired request can't be allowed");
  console.log("ok - end to end: requests expire with the session and can't be allowed after");
} finally {
  await stopAndRemove(host, home);
}
