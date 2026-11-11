// Zen spaces for agents, offline, with a fake Zen profile and stand-in browsers:
//   - lib/zenspaces.mjs: spaces from zen-sessions.jsonlz4, finding a space by
//     name / id / unique prefix, a missing space's error listing the valid
//     names, Space routing rules and the force-container pref;
//   - spaces_list: names, ids, containers, the space on screen, the session's
//     space and the user's hints;
//   - tabs_open: space → the space object sent to the extension, the default
//     from the agent session (MCP) or the conversation (Ensō's chat), a missing
//     space's clear error, and honest replies for each placement;
//   - session_start { space } through the MCP server (in memory): the session
//     keeps the space, list() and the reply show it, an unknown space is refused;
//   - background.js in a vm: the space's cookieStoreId, the window that shows
//     the space, the current space decided from the window's tabs, a missing
//     container, `inView` for tabs Zen moved away; the space on the pill presence.
//
//   node test/spaces.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "enso-spaces-"));
process.env.ENSO_DATA = path.join(root, "data");
process.env.HOME = root;
process.env.USERPROFILE = root;
process.env.APPDATA = path.join(root, "AppData", "Roaming");

// mozLz4 with one all-literal LZ4 block (what Zen's reader accepts).
function mozLz4(obj) {
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  const parts = [];
  let n = data.length;
  if (n < 15) parts.push(Buffer.from([n << 4]));
  else {
    parts.push(Buffer.from([0xf0]));
    n -= 15;
    while (n >= 255) {
      parts.push(Buffer.from([255]));
      n -= 255;
    }
    parts.push(Buffer.from([n]));
  }
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from("mozLz40\0", "latin1"), size, ...parts, data]);
}

const zenRoot = process.platform === "darwin" ? path.join(root, "Library", "Application Support", "zen") : process.platform === "win32" ? path.join(root, "AppData", "Roaming", "zen") : path.join(root, ".zen");
const profile = path.join(zenRoot, "Profiles", "test.Default");
mkdirSync(profile, { recursive: true });
writeFileSync(path.join(zenRoot, "profiles.ini"), "[Profile0]\nName=Default\nIsRelative=1\nPath=Profiles/test.Default\nDefault=1\n");
const P = "{11111111-aaaa}";
const W = "{22222222-bbbb}";
const G = "{33333333-cccc}";
writeFileSync(path.join(profile, "zen-sessions.jsonlz4"), mozLz4({
  spaces: [
    { uuid: P, name: "Personal", icon: "chrome://browser/skin/zen-icons/selectable/grid-2x2.svg", containerTabId: 0 },
    { uuid: W, name: "Northwind", icon: "briefcase", containerTabId: 6 },
    { uuid: G, name: "Garden club", icon: "heart", containerTabId: 7 },
  ],
  tabs: [
    { zenWorkspace: P, entries: [{ url: "https://news.example.org/" }], index: 1 },
    { zenWorkspace: P, entries: [{ url: "https://mail.example.org/" }], index: 1 },
    { zenWorkspace: W, entries: [{ url: "https://deploy.northwind.example.com/" }], index: 1 },
    { zenWorkspace: G, entries: [{ url: "https://harborgarden.example.org/" }], index: 1 },
  ],
}));
writeFileSync(path.join(profile, "zen-space-routing.jsonlz4"), mozLz4({ routes: [{ id: "r1", reference: "wiki.northwind.example.com", matchType: "contains", openIn: W }, { id: "r2", reference: "", matchType: "contains", openIn: G }] }));
writeFileSync(path.join(profile, "prefs.js"), 'user_pref("zen.workspaces.active", "x");\n');

try {
  const zs = await import("../lib/zenspaces.mjs");
  const store = await import("../lib/store.mjs");

  // ---- lib/zenspaces.mjs ----
  const spaces = zs.listSpaces();
  assert.deepEqual(spaces.map(s => [s.name, s.containerId, s.icon]), [["Personal", 0, "grid-2x2"], ["Northwind", 6, "briefcase"], ["Garden club", 7, "heart"]]);
  assert.equal(zs.findSpace("northwind").space.id, W, "any case");
  assert.equal(zs.findSpace(W).space.name, "Northwind", "by id");
  assert.equal(zs.findSpace("22222222-BBBB").space.name, "Northwind", "id without braces");
  assert.equal(zs.findSpace("Gard").space.name, "Garden club", "a unique prefix");
  assert.equal(zs.findSpace("BISS").error, 'There\'s no Zen space called "BISS". The user\'s spaces are: Personal, Northwind, Garden club. Use one of these names (spaces_list describes them).');
  assert.match(zs.findSpace("x", []).error, /can't see any Zen spaces/);
  assert.equal(zs.routeFor("https://wiki.northwind.example.com/page"), W);
  assert.equal(zs.routeFor("https://other.example/"), null, "an empty rule matches nothing");
  assert.equal(zs.zenPrefs().forceContainerWorkspace, false, "Zen's default");
  writeFileSync(path.join(profile, "prefs.js"), 'user_pref("zen.workspaces.force-container-workspace", true);\n');
  assert.equal(zs.zenPrefs().forceContainerWorkspace, true);
  writeFileSync(path.join(profile, "prefs.js"), "");
  console.log("ok - zenspaces: spaces, find by name/id/prefix, a clear error, routes, the force pref");

  // ---- spaces_list ----
  store.updateSettings({ spaceHints: { [W]: "Work at Northwind: deploys, the wiki" } });
  const { browserToolByName, describeOpened } = await import("../lib/browsertools.mjs");
  const calls = [];
  const fakeCtx = (extra = {}) => ({
    external: true,
    claimTabs() {},
    sessionSpace: () => null,
    async browser(action, args) {
      calls.push({ action, args });
      if (action === "spaces_info") return { current: P, containers: { 6: "Northwind", 7: "Garden" } };
      if (action === "tabs_open") return extra.reply?.(args) ?? { opened: args.urls.map((url, i) => ({ tabId: 40 + i, url, inView: true })), placement: args.space ? "exact" : "current", currentSpace: "Personal", container: args.space?.containerId ? args.space.name : null };
      return null;
    },
    ...extra,
  });
  const list = await browserToolByName.get("spaces_list").run({}, fakeCtx({ sessionSpace: () => ({ id: W, name: "Northwind" }) }));
  const listText = list.content[0].text;
  assert.match(listText, /^The user's Zen spaces:\n- Personal \(on screen now\): id \{11111111-aaaa\}, icon grid-2x2, no container \(the default logins\)\n/);
  assert.match(listText, /- Northwind \(your session's space\): id \{22222222-bbbb\}, icon briefcase, container "Northwind"\. About: Work at Northwind: deploys, the wiki\n/);
  assert.match(listText, /- Garden club: id \{33333333-cccc\}, icon heart, container "Garden"\n/);
  assert.match(listText, /tabs_open \{ urls, space: "<name>" \}/);
  console.log("ok - spaces_list: names, ids, containers, on screen, the session's space, hints");

  // ---- tabs_open routing ----
  const open = browserToolByName.get("tabs_open");
  calls.length = 0;
  let r = await open.run({ urls: ["https://deploy.northwind.example.com/logs"], space: "northwind" }, fakeCtx());
  let sent = calls.find(c => c.action === "tabs_open").args;
  assert.equal(sent.space.id, W);
  assert.equal(sent.space.containerId, 6);
  assert.equal(sent.background, true, "background for external agents");
  assert.equal(sent.spaces.length, 3, "fresh spaces go along");
  assert.match(r.content[0].text, /^Opened 1 tab\(s\) in Northwind, with its container \(Northwind's logins\) in the background:\n- tab 40: https:\/\/deploy/);

  calls.length = 0;
  await open.run({ urls: ["https://x.example/"] }, fakeCtx({ sessionSpace: () => ({ id: G, name: "Garden club" }) }));
  assert.equal(calls.find(c => c.action === "tabs_open").args.space.id, G, "the session's space by default");
  calls.length = 0;
  r = await open.run({ urls: ["https://x.example/"] }, fakeCtx({ external: false, space: { id: W, name: "Northwind" } }));
  sent = calls.find(c => c.action === "tabs_open").args;
  assert.equal(sent.space.id, W, "Ensō's chat: the conversation's space");
  assert.equal(sent.background, false);
  assert.match(r.content[0].text, /\(this conversation's space\)/);
  calls.length = 0;
  r = await open.run({ urls: ["https://x.example/"] }, fakeCtx());
  assert.equal(calls.find(c => c.action === "tabs_open").args.space, undefined, "no space: the one on screen");
  assert.match(r.content[0].text, /^Opened 1 tab\(s\) in Personal in the background:/);
  await assert.rejects(open.run({ urls: ["https://x.example/"], space: "BISS" }, fakeCtx()), /no Zen space called "BISS"\. The user's spaces are: Personal, Northwind, Garden club/);
  console.log("ok - tabs_open: space → container and space, defaults from the session / conversation, a missing space");

  // replies per placement
  const nw = spaces[1];
  const base = { opened: [{ tabId: 5, url: "https://deploy.northwind.example.com/", inView: true }], target: nw, from: "asked", background: true, external: true, spaces, prefs: { forceContainerWorkspace: false }, routes: [] };
  let t = describeOpened({ ...base, r: { placement: "window", currentSpace: "Personal", container: "Northwind" } });
  assert.match(t, /^Opened 1 tab\(s\) in Northwind, with its container \(Northwind's logins\), in the Zen window that shows Northwind, in the background:/);
  t = describeOpened({ ...base, r: { placement: "current", currentSpace: "Personal", container: "Northwind" } });
  assert.match(t, /^Opened 1 tab\(s\) with Northwind's container \(its logins\), but in the space on screen, Personal, not in Northwind, in the background\. Zen only lets Ensō put a tab in a space that some window shows; .*zen\.workspaces\.force-container-workspace/);
  t = describeOpened({ ...base, opened: [{ tabId: 5, url: "https://wiki.northwind.example.com/x", inView: false }], routes: zs.listRoutes(), r: { placement: "current", currentSpace: "Personal", container: "Northwind" } });
  assert.match(t, /tab 5: https:\/\/wiki\.northwind\.example\.com\/x \(Zen's Space routing rule moved it to Northwind\)/);
  t = describeOpened({ ...base, opened: [{ tabId: 5, url: "https://a.example/", inView: false }], prefs: { forceContainerWorkspace: true }, r: { placement: "current", currentSpace: "Personal" } });
  assert.match(t, /Zen moved it to Northwind and switched the window there, because zen\.workspaces\.force-container-workspace is on/);
  console.log("ok - tabs_open replies: exact, another window, current space with the container (said, not silent), moved by Zen");

  // ---- session_start { space } over MCP (in memory) ----
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { buildServer } = await import("../lib/mcpserver.mjs");
  const { createAgentSessions } = await import("../lib/agentsessions.mjs");
  const sessions = createAgentSessions({ timers: false });
  const client = { name: "claude-code", version: "1", label: "Claude Code", scope: "full", via: "launcher", session: "abc" };
  const opened = [];
  const browserRequest = async (type, action, args) => {
    if (action === "tabs_open") {
      opened.push(args);
      return { opened: args.urls.map((url, i) => ({ tabId: 70 + i, url, inView: true })), placement: "current", currentSpace: "Personal", container: "Northwind" };
    }
    if (action === "active_tab") return { tabId: 1 };
    return null;
  };
  const connect = async () => {
    const server = buildServer({ browserRequest, sessions, client });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const c = new Client({ name: "t", version: "1" });
    await c.connect(b);
    return c;
  };
  let c = await connect();
  let res = await c.callTool({ name: "session_start", arguments: { task: "Check the deploy log", space: "BISS" } });
  assert.ok(res.isError);
  assert.match(res.content[0].text, /no Zen space called "BISS"\. The user's spaces are: Personal, Northwind, Garden club.*The session wasn't started/);
  res = await c.callTool({ name: "session_start", arguments: { task: "Check the deploy log", space: "Northwind" } });
  assert.match(res.content[0].text, /^Session started\. Ensō shows "Claude Code · Northwind · Check the deploy log"/);
  assert.match(res.content[0].text, /Your tabs open in the Zen space Northwind by default/);
  assert.equal(sessions.list()[0].space, "Northwind", "the agent card gets the space");
  assert.equal(sessions.status(client).space, "Northwind");
  res = await c.callTool({ name: "tabs_open", arguments: { urls: ["https://deploy.northwind.example.com/"] } });
  assert.equal(opened.at(-1).space.id, W, "tabs_open defaults to the session's space");
  assert.match(res.content[0].text, /with Northwind's container \(its logins\) \(your session's space\), but in the space on screen, Personal/);
  res = await c.callTool({ name: "spaces_list", arguments: {} });
  assert.match(res.content[0].text, /- Northwind \(your session's space\)/);
  await c.callTool({ name: "session_end", arguments: {} });
  assert.equal(sessions.spaceOf(client), null, "session_end forgets the space");
  const tools = (await c.listTools()).tools;
  assert.ok(tools.find(x => x.name === "session_start").inputSchema.properties.space);
  assert.ok(tools.find(x => x.name === "tabs_open").inputSchema.properties.space);
  console.log("ok - session_start { space }: kept for tabs_open, shown as \"Claude Code · Northwind · …\", an unknown space refused");

  // ---- background.js in a vm ----
  const ext = p => readFileSync(path.join(here, "../../extension", p), "utf8");
  let TABS = [];
  let WINS = [];
  const IDS = [{ cookieStoreId: "firefox-container-6", name: "Northwind" }, { cookieStoreId: "firefox-container-7", name: "Garden" }];
  const created = [];
  const toTabs = [];
  let nativeListener = null;
  let moveAway = false; // Zen moves the new tab out of the shown space (a routing rule)
  const nativePort = { postMessage: m => posted.push(m), onMessage: { addListener: fn => (nativeListener = fn) }, onDisconnect: { addListener() {} } };
  const posted = [];
  let nextId = 100;
  const handlers = {
    "runtime.getURL": p => "moz-extension://t/" + p,
    "runtime.getManifest": () => ({ version: "0.5.7" }),
    "runtime.connectNative": () => nativePort,
    "tabs.query": async q => TABS.filter(t => (q.windowId == null || t.windowId === q.windowId) && (q.active == null || t.active === q.active) && !t.away),
    "tabs.get": async id => TABS.find(t => t.id === id),
    "tabs.create": async o => {
      created.push(o);
      const t = { id: nextId++, url: o.url, windowId: o.windowId ?? 1, active: !!o.active, cookieStoreId: o.cookieStoreId ?? "firefox-default", away: moveAway };
      TABS.push(t);
      return t;
    },
    "tabs.sendMessage": async (tabId, msg) => (toTabs.push({ tabId, msg }), { ok: true, result: {} }),
    "windows.getAll": async () => WINS,
    "windows.getLastFocused": async () => WINS[0],
    "contextualIdentities.get": async id => IDS.find(c => c.cookieStoreId === id) ?? Promise.reject(new Error("No contextual identity")),
    "contextualIdentities.query": async () => IDS,
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
  const flush = () => new Promise(r => setTimeout(r, 30));
  await flush();
  let reqId = 0;
  const request = async (action, args) => {
    const id = ++reqId;
    nativeListener({ type: "browser.request", reqId: id, action, args });
    for (let i = 0; i < 100; i++) {
      const reply = posted.find(m => m.reqId === id);
      if (reply) return JSON.parse(JSON.stringify(reply));
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error("no reply");
  };
  // Window 1 shows Personal; its active tab has Northwind's container (an old agent tab), which alone would say "Northwind".
  WINS = [{ id: 1, focused: true, type: "normal" }];
  TABS = [
    { id: 1, windowId: 1, url: "https://deploy.northwind.example.com/", active: true, cookieStoreId: "firefox-container-6" },
    { id: 2, windowId: 1, url: "https://news.example.org/", active: false, cookieStoreId: "firefox-default" },
    { id: 3, windowId: 1, url: "https://mail.example.org/", active: false, cookieStoreId: "firefox-default" },
  ];
  let rep = await request("tabs_open", { urls: ["https://deploy.northwind.example.com/logs", "about:config"], background: true, space: nw, spaces });
  assert.equal(rep.ok, true, rep.error);
  assert.deepEqual(created.map(o => [o.url, o.cookieStoreId, o.windowId, o.active]), [["https://deploy.northwind.example.com/logs", "firefox-container-6", 1, false]], "only http(s); the space's container, the current window, background");
  assert.equal(rep.result.placement, "current");
  assert.equal(rep.result.currentSpace, "Personal", "decided from the window's tabs, not the active tab's container");
  assert.equal(rep.result.container, "Northwind");
  assert.equal(rep.result.opened[0].inView, true);
  console.log("ok - background: the space's container in the current space, which is told from the window's tabs");

  created.length = 0;
  rep = await request("tabs_open", { urls: ["https://news.example.org/today"], background: false, space: spaces[0], spaces });
  assert.deepEqual(created.map(o => [o.cookieStoreId, o.windowId, o.active]), [["firefox-default", 1, true]]);
  assert.equal(rep.result.placement, "exact", "Personal is on screen");

  // A second window shows Garden club: open there.
  WINS = [{ id: 1, focused: true, type: "normal" }, { id: 2, focused: false, type: "normal" }];
  TABS.push({ id: 9, windowId: 2, url: "https://harborgarden.example.org/", active: true, cookieStoreId: "firefox-container-7" });
  created.length = 0;
  rep = await request("tabs_open", { urls: ["https://harborgarden.example.org/plots"], background: true, space: spaces[2], spaces });
  assert.deepEqual(created.map(o => [o.cookieStoreId, o.windowId, o.active]), [["firefox-container-7", 2, false]]);
  assert.equal(rep.result.placement, "window");

  // Zen moved the tab away (a routing rule): inView false.
  moveAway = true;
  rep = await request("tabs_open", { urls: ["https://wiki.northwind.example.com/x"], background: true, space: nw, spaces });
  assert.equal(rep.result.opened[0].inView, false);
  moveAway = false;

  // The space's container was deleted.
  rep = await request("tabs_open", { urls: ["https://a.example/"], background: true, space: { ...nw, containerId: 99 }, spaces });
  assert.equal(rep.ok, false);
  assert.match(rep.error, /container of the Zen space "Northwind" no longer exists/);

  rep = await request("spaces_info", { spaces });
  assert.equal(rep.result.current, P);
  assert.deepEqual(rep.result.containers, { 6: "Northwind", 7: "Garden" });
  console.log("ok - background: the window showing the space, the space on screen, a moved tab, a deleted container, spaces_info");

  // The space reaches the page pill's presence.
  nativeListener({ type: "agents", sessions: [{ id: "s1", client: "Claude Code", task: "Check the deploy log", space: "Northwind", tabId: 1, running: true }], access: [] });
  await flush();
  const presence = toTabs.filter(x => x.msg.action === "presence" && x.tabId === 1).at(-1);
  assert.equal(JSON.parse(JSON.stringify(presence.msg.args.agents))[0].space, "Northwind");
  console.log("ok - the session's space goes to the page pill");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("spaces checks passed");
