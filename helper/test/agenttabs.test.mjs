// Tabs agents open and leave behind (lib/agenttabs.mjs), offline, with a fake clock
// and stand-in browsers:
//   - tabs_open over MCP marks the new tabs "opened by <client> for <task>";
//     the agent's session ending (session_end, Stop, the idle timeout) makes
//     them leftovers; the agent coming back makes them its own again;
//   - the user's use (activation, trusted click / key) drops the mark: never closed;
//   - "close" (default): closed 30 min after they were last used, only when
//     background.js finds them untouched, inactive, unpinned and not in the
//     user's group (agents' own groups don't count); closed ones go to
//     "Recently closed by Ensō", and Reopen takes them out of it;
//   - "ask": listed, never closed by the timer; "Close all" / ✕ close, "Keep" unmarks;
//   - "keep": the marks go, nothing is closed;
//   - background.js in a vm: activation by tabs.create isn't the user's, a
//     later activation or a trusted input message is; closing leftovers with
//     its checks; presence is cleared when sessions end, and pills left by an
//     earlier copy of background.js (an extension reload) are cleared on start.
//
//   node test/agenttabs.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "enso-agenttabs-"));
process.env.ENSO_DATA = path.join(root, "data");
process.env.HOME = root;

try {
  const { createAgentTabs, LEFTOVER_CLOSE_MS } = await import("../lib/agenttabs.mjs");
  const { createAgentSessions } = await import("../lib/agentsessions.mjs");
  assert.equal(LEFTOVER_CLOSE_MS, 30 * 60_000);

  let clock = 1_000_000;
  const now = () => clock;
  const MIN = 60_000;
  const sessions = createAgentSessions({ now, timers: false });
  const claude = { name: "claude-code", label: "Claude Code", via: "launcher", session: "s1" };
  // A stand-in for background.js's closeLeftovers.
  const browserTabs = new Map();
  const closeCalls = [];
  const closeTabs = async (tabs, { force, agentGroups }) => {
    closeCalls.push({ tabs: tabs.map(t => t.tabId), force, agentGroups });
    return tabs.map(({ tabId }) => {
      const t = browserTabs.get(tabId);
      if (!t) return { tabId, gone: true };
      if (!force && (t.active || t.pinned || (t.groupId > -1 && !agentGroups.includes(t.groupId)))) return { tabId, skipped: t.active ? "active" : t.pinned ? "pinned" : "group" };
      browserTabs.delete(tabId);
      return { tabId, closed: true, url: t.url, title: t.title, cookieStoreId: t.cookieStoreId };
    });
  };
  let mode = "close";
  const tabs = createAgentTabs({ now, isLive: key => sessions.isLive(key), closeTabs, mode: () => mode, timers: false });
  const open = (ids, owner = claude) => {
    for (const id of ids) browserTabs.set(id, { url: `https://site.example/${id}`, title: `Page ${id}`, cookieStoreId: "firefox-container-6", active: false, pinned: false, groupId: -1 });
    const st = sessions.status(owner);
    tabs.opened({ key: sessions.keyOf(owner), client: owner.label, clientName: owner.name, task: st.task, space: sessions.spaceOf(owner) }, ids.map(tabId => ({ tabId, url: `https://site.example/${tabId}`, cookieStoreId: "firefox-container-6" })));
  };

  // ---- marking, leftovers on session end, coming back ----
  sessions.start(claude, { task: "Check the deploy log", space: { id: "{w}", name: "Northwind" } });
  open([11, 12, 13]);
  assert.deepEqual(tabs.state().marked, [11, 12, 13]);
  await tabs.tick();
  assert.equal(tabs.state().leftovers.length, 0, "the agent is live: not leftovers");
  sessions.endClient(claude);
  await tabs.tick();
  let st = tabs.state();
  assert.deepEqual(st.leftovers.map(l => l.tabId), [11, 12, 13]);
  assert.equal(st.leftovers[0].client, "Claude Code");
  assert.equal(st.leftovers[0].task, "Check the deploy log");
  assert.equal(st.leftovers[0].space, "Northwind");
  assert.equal(st.leftovers[0].closesAt, new Date(clock + 30 * MIN).toISOString());
  sessions.start(claude, { task: "Back again" });
  await tabs.tick();
  assert.equal(tabs.state().leftovers.length, 0, "the agent came back: its tabs again");
  sessions.stop(sessions.list()[0].id);
  await tabs.tick();
  assert.equal(tabs.state().leftovers.length, 3, "Stop ends it too");
  const idle = { name: "codex", label: "Codex", via: "launcher", session: "idle" };
  sessions.start(idle, { task: "Idle one" });
  open([14], idle);
  await tabs.tick();
  assert.equal(tabs.mark(14).leftoverAt, null);
  clock += 3 * MIN;
  sessions.sweep(); // the idle timeout
  await tabs.tick();
  assert.ok(tabs.state().leftovers.some(l => l.tabId === 14), "the idle timeout ends it too");
  tabs.keep([14]);
  clock -= 3 * MIN;
  console.log("ok - tabs_open marks tabs; session_end, Stop or the idle timeout makes them leftovers; the agent coming back takes them back");

  // ---- the user's use drops the mark ----
  tabs.touched(12);
  assert.deepEqual(tabs.state().marked, [11, 13], "touched: the user's now");
  // ---- auto-close timing (close mode) ----
  browserTabs.get(13).pinned = true;
  clock += 29 * MIN;
  await tabs.tick();
  assert.equal(closeCalls.length, 0, "not before 30 min");
  clock += 1 * MIN;
  await tabs.tick();
  assert.deepEqual(closeCalls.at(-1), { tabs: [11, 13], force: false, agentGroups: [] });
  st = tabs.state();
  assert.deepEqual(st.marked, [13], "11 closed; the pinned 13 stays");
  assert.equal(st.leftovers[0].skipped, "pinned");
  assert.equal(st.recentlyClosed.length, 1);
  assert.equal(st.recentlyClosed[0].url, "https://site.example/11");
  assert.equal(st.recentlyClosed[0].auto, true);
  assert.ok(browserTabs.has(12), "the touched tab is never closed");
  console.log("ok - close mode: untouched leftovers close after 30 min unused; touched and pinned ones stay; recently closed recorded");

  // agent use resets the clock; agents' own groups don't protect a tab, the user's do
  const claude2 = { name: "claude-code", label: "Claude Code", via: "launcher", session: "s2" };
  sessions.start(claude2, { task: "Group things" });
  open([21, 22], claude2);
  tabs.group(500);
  browserTabs.get(21).groupId = 500; // the agent's group
  browserTabs.get(22).groupId = 900; // the user's group
  sessions.endClient(claude2);
  await tabs.tick();
  clock += 20 * MIN;
  tabs.used(21, { url: "https://site.example/21b" });
  clock += 10 * MIN;
  await tabs.tick();
  assert.ok(closeCalls.at(-1).tabs.includes(22) && !closeCalls.at(-1).tabs.includes(21), "21 was used 10 min ago: not due");
  assert.ok(browserTabs.has(22), "in the user's group: kept");
  clock += 20 * MIN;
  await tabs.tick();
  assert.ok(!browserTabs.has(21), "in an agent's group: closed");
  console.log("ok - the agent's use resets the 30 min; a group the agent made doesn't protect a tab, the user's does");

  // reopen
  const id = tabs.state().recentlyClosed.find(c => c.url.endsWith("/21"))?.id;
  assert.ok(id);
  const c = tabs.reopen(id);
  assert.equal(c.cookieStoreId, "firefox-container-6", "reopens in the same container");
  assert.ok(!tabs.state().recentlyClosed.some(x => x.id === id));
  assert.equal(tabs.reopen("nope"), null);
  console.log("ok - Reopen gives the URL and container back and leaves the list");

  // ---- ask mode ----
  mode = "ask";
  const claude3 = { name: "claude-code", label: "Claude Code", via: "launcher", session: "s3" };
  sessions.start(claude3, { task: "Ask mode" });
  open([31, 32, 33], claude3);
  sessions.endClient(claude3);
  const before = closeCalls.length;
  await tabs.tick();
  clock += 5 * 60 * MIN;
  await tabs.tick();
  assert.equal(closeCalls.length, before, "ask: never closed by the timer");
  st = tabs.state();
  assert.equal(st.mode, "ask");
  assert.ok([31, 32, 33].every(x => st.leftovers.some(l => l.tabId === x)));
  assert.equal(st.leftovers.find(l => l.tabId === 31).closesAt, null);
  browserTabs.get(31).active = true;
  await tabs.close([31], { force: true });
  assert.ok(!browserTabs.has(31), "✕ closes even the active tab: the user asked");
  tabs.keep([32]);
  assert.ok(!tabs.isMarked(32) && browserTabs.has(32), "Keep: open and unmarked");
  await tabs.close(tabs.state().leftovers.map(l => l.tabId), { force: true });
  assert.equal(tabs.state().leftovers.length, 0, "Close all");
  console.log("ok - ask mode: listed and never closed by the timer; ✕, Close all and Keep");

  // ---- keep mode ----
  mode = "keep";
  const claude4 = { name: "claude-code", label: "Claude Code", via: "launcher", session: "s4" };
  sessions.start(claude4, { task: "Keep mode" });
  open([41], claude4);
  sessions.endClient(claude4);
  const n = closeCalls.length;
  await tabs.tick();
  assert.equal(tabs.isMarked(41), false, "keep: the mark goes");
  assert.equal(closeCalls.length, n, "nothing closed");
  assert.ok(browserTabs.has(41));
  console.log("ok - keep mode: leftovers lose the mark and stay open");

  // ---- MCP: tabs_open marks the tab for the agent and its task ----
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildServer } = await import("../lib/mcpserver.mjs");
  const s2 = createAgentSessions({ now, timers: false });
  const t2 = createAgentTabs({ now, isLive: key => s2.isLive(key), timers: false });
  const browserRequest = async (type, action, args) => (action === "tabs_open" ? { opened: args.urls.map((url, i) => ({ tabId: 80 + i, url, inView: true, cookieStoreId: "firefox-default" })), placement: "current", currentSpace: null } : action === "active_tab" ? { tabId: 1 } : action === "tabs_group" ? { groupId: 77 } : {});
  const server = buildServer({ browserRequest, sessions: s2, tabsOpened: t2, client: claude });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mc = new Client({ name: "t", version: "1" });
  await mc.connect(b);
  await mc.callTool({ name: "session_start", arguments: { task: "Read the changelog" } });
  const res = await mc.callTool({ name: "tabs_open", arguments: { urls: ["https://a.example/", "https://b.example/"] } });
  assert.match(res.content[0].text, /close the tabs you opened \(tabs_close\) and call session_end/);
  assert.deepEqual(t2.state().marked, [80, 81]);
  assert.equal(t2.mark(80).task, "Read the changelog");
  await mc.callTool({ name: "tabs_close", arguments: { tabIds: [81], requested_by_user: true } });
  assert.deepEqual(t2.state().marked, [80], "tabs_close unmarks");
  await mc.callTool({ name: "session_end", arguments: {} });
  await t2.tick();
  assert.deepEqual(t2.state().leftovers.map(l => l.tabId), [80]);
  console.log("ok - over MCP: tabs_open marks for the agent's task, tabs_close unmarks, session_end leaves leftovers");

  // ---- background.js in a vm ----
  const ext = p => readFileSync(path.join(here, "../../extension", p), "utf8");
  const posted = [];
  const toTabs = [];
  const injected = [];
  const runtimeListeners = [];
  const activated = [];
  const removedL = [];
  let nativeListener = null;
  const storage = { "enso.presenceTabs": [7, 99] }; // an earlier background copy had presence on tabs 7 and 99
  const TABS = new Map([
    [5, { id: 5, windowId: 1, url: "https://a.example/", title: "A", active: true, pinned: false, groupId: -1 }],
    [7, { id: 7, windowId: 1, url: "https://b.example/", title: "B", active: false, pinned: false, groupId: -1 }],
  ]);
  let nextId = 200;
  const removed = [];
  const nativePort = { postMessage: m => posted.push(m), onMessage: { addListener: fn => (nativeListener = fn) }, onDisconnect: { addListener() {} } };
  const handlers = {
    "runtime.getURL": p => "moz-extension://t/" + String(p).replace(/^\//, ""),
    "runtime.getManifest": () => ({ version: "0.5.7" }),
    "runtime.connectNative": () => nativePort,
    "runtime.onMessage.addListener": fn => runtimeListeners.push(fn),
    "tabs.onActivated.addListener": fn => activated.push(fn),
    "tabs.onRemoved.addListener": fn => removedL.push(fn),
    "storage.local.get": async k => ({ [k]: storage[k] }),
    "storage.local.set": async o => Object.assign(storage, o),
    "tabs.get": async id => TABS.get(id) ?? Promise.reject(new Error("no tab")),
    "tabs.query": async () => [...TABS.values()],
    "tabs.create": async o => {
      const t = { id: nextId++, windowId: 1, url: o.url, title: "", active: !!o.active, pinned: false, groupId: -1, cookieStoreId: o.cookieStoreId ?? "firefox-default" };
      TABS.set(t.id, t);
      return t;
    },
    "tabs.remove": async id => (removed.push(id), TABS.delete(id)),
    "tabs.sendMessage": async (tabId, msg) => {
      toTabs.push({ tabId, msg });
      if (msg.action === "ping") return injected.includes(tabId) ? { ok: true } : Promise.reject(new Error("no receiver")); // an orphaned old copy doesn't answer
      return { ok: true, result: {} };
    },
    "tabs.executeScript": async tabId => void injected.push(tabId),
    "windows.getAll": async () => [{ id: 1, focused: true, type: "normal" }],
    "windows.getLastFocused": async () => ({ id: 1, type: "normal" }),
    "contextualIdentities.query": async () => [],
  };
  function api(name) {
    return new Proxy(function () {}, {
      get(_t, k) {
        if (k === "then" || typeof k === "symbol") return undefined;
        return api(name ? `${name}.${k}` : String(k));
      },
      apply(_t, _this, args) {
        const h = handlers[name];
        if (h) return h(...args);
        if (name.endsWith(".addListener") || name.endsWith(".removeListener")) return undefined;
        return Promise.resolve([]);
      },
    });
  }
  const context = vm.createContext({ browser: api(""), console, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder, TextDecoder, structuredClone, queueMicrotask, crypto: globalThis.crypto, atob, btoa });
  for (const f of ["channel.js", "transfer.js", "waits.js", "ui/route.js", "background.js"]) vm.runInContext(ext(f), context, { filename: f });
  const flush = (ms = 40) => new Promise(r => setTimeout(r, ms));
  await flush(80);
  // restart: the old copy's pill on tab 7 is cleared (a fresh page agent, then presence off); tab 99 is gone
  assert.ok(injected.includes(7), "a fresh page agent on tab 7 removes the old copy's pill");
  assert.ok(toTabs.some(x => x.tabId === 7 && x.msg.action === "presence" && x.msg.args.off === true), "then presence off");
  assert.ok(!injected.includes(99));
  console.log("ok - after an extension reload, pills left on tabs by the earlier copy are cleared");

  let reqId = 0;
  const request = async (action, args) => {
    const rid = ++reqId;
    nativeListener({ type: "browser.request", reqId: rid, action, args });
    for (let i = 0; i < 100; i++) {
      const r = posted.find(m => m.reqId === rid);
      if (r) return JSON.parse(JSON.stringify(r));
      await flush(10);
    }
    throw new Error("no reply");
  };
  // presence while a session is live, gone when it ends
  nativeListener({ type: "agents", sessions: [{ id: "x1", client: "Claude Code", task: "T", tabId: 5, running: true }], access: [], agentTabs: { marked: [] } });
  await flush();
  assert.ok(toTabs.some(x => x.tabId === 5 && x.msg.action === "presence" && x.msg.args.agents?.length === 1));
  assert.deepEqual(JSON.parse(JSON.stringify(storage["enso.presenceTabs"])), [5], "tabs with presence are remembered for the next start");
  nativeListener({ type: "agents", sessions: [], access: [], agentTabs: { marked: [] } });
  await flush();
  assert.ok(toTabs.some(x => x.tabId === 5 && x.msg.action === "presence" && x.msg.args.off === true), "the session ended: presence off");
  assert.deepEqual(JSON.parse(JSON.stringify(storage["enso.presenceTabs"])), []);
  // helper restart: the state message has no sessions → off too
  nativeListener({ type: "agents", sessions: [{ id: "x2", client: "Codex", task: "T", tabId: 7, running: false }], access: [] });
  await flush();
  nativeListener({ type: "state", agents: [], agentAccess: [], settings: {} });
  await flush();
  assert.ok(toTabs.filter(x => x.tabId === 7 && x.msg.args?.off === true).length >= 2, "a restarted helper (no sessions) clears presence");
  console.log("ok - presence goes when sessions end and when a restarted helper has none");

  // activation by tabs.create isn't the user's; a later one is; a trusted input message is
  const opened = await request("tabs_open", { urls: ["https://c.example/", "https://d.example/"], background: false });
  const [c1, c2] = opened.result.opened.map(o => o.tabId);
  nativeListener({ type: "agents", sessions: [], access: [], agentTabs: { marked: [c1, c2] } });
  await flush();
  activated.forEach(fn => fn({ tabId: c1 }));
  assert.ok(!posted.some(m => m.type === "agentTabs.touched" && m.tabId === c1), "tabs.create's own activation doesn't count");
  await flush(1600);
  activated.forEach(fn => fn({ tabId: c1 }));
  assert.ok(posted.some(m => m.type === "agentTabs.touched" && m.tabId === c1), "the user's activation does");
  runtimeListeners.forEach(fn => fn({ ensoUserInput: true }, { tab: { id: c2 }, frameId: 0, url: "https://d.example/" }));
  assert.ok(posted.some(m => m.type === "agentTabs.touched" && m.tabId === c2), "a trusted click / key in the page does");
  // closing leftovers: checks
  nativeListener({ type: "agents", sessions: [], access: [], agentTabs: { marked: [5, 7] } });
  await flush();
  TABS.get(7).groupId = 3;
  let r = await request("tabs_close_leftovers", { tabs: [{ tabId: 5 }, { tabId: 7 }, { tabId: 12345 }, { tabId: c1 }], force: false, agentGroups: [] });
  assert.deepEqual(r.result.map(x => [x.tabId, x.skipped ?? (x.closed ? "closed" : x.gone ? "gone" : x.touched ? "touched" : "?")]), [[5, "active"], [7, "group"], [12345, "gone"], [c1, "touched"]]);
  r = await request("tabs_close_leftovers", { tabs: [{ tabId: 7 }], force: false, agentGroups: [3] });
  assert.equal(r.result[0].closed, true, "an agent's group doesn't protect it");
  assert.equal(r.result[0].url, "https://b.example/");
  r = await request("tabs_reopen", { url: "https://b.example/", cookieStoreId: "firefox-container-6" });
  assert.equal(TABS.get(r.result.tabId).cookieStoreId, "firefox-container-6");
  removedL.forEach(fn => fn(c2));
  console.log("ok - background: the user's activation and input release a tab; leftover closing checks; reopen in the same container");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("agent tab checks passed");
