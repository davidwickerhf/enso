// background.js's side of session-access requests, in a Node vm with a
// stand-in for the WebExtension APIs (no browser):
//   - an `agents` push with a request sends it to the pill of every tab on
//     that site (and only those), with or without an agent on the tab;
//   - Allow / Not now clicked in pill.html (sender is the extension frame,
//     pill.js saw event.isTrusted) goes to the helper as access.allow /
//     access.dismiss with the request id, and only then;
//   - nothing else in a page can send it: an untrusted click, the content
//     script's fallback click, a message from the page's own frame claiming
//     to be the pill, a click on a tab that isn't on the requested site, an
//     unknown or answered request, a "ui" port from a web page, or a raw
//     access.allow runtime message.
//
//   node test/background-access.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = p => readFileSync(path.join(here, "../../extension", p), "utf8");
const BASE = "moz-extension://enso-test/";

const TABS = [
  { id: 5, windowId: 1, url: "https://desec.io/domains", title: "deSEC", active: true, status: "complete" },
  { id: 6, windowId: 1, url: "https://other.example/", title: "Other", active: false, status: "complete" },
  { id: 7, windowId: 1, url: "https://api.desec.io/v1", title: "API", active: false, status: "complete" },
  { id: 8, windowId: 1, url: "https://www.mybank.example/", title: "Bank", active: false, status: "complete" },
];
const posted = []; // to the helper
const plain = x => JSON.parse(JSON.stringify(x)); // values from the vm's realm
const toTabs = []; // tabs.sendMessage calls
const runtimeListeners = [];
const connectListeners = [];
let nativeListener = null;
let pickResult = { sessionId: null, access: null }; // what the content script answers to pill_pick

const nativePort = { postMessage: m => posted.push(m), onMessage: { addListener: fn => (nativeListener = fn) }, onDisconnect: { addListener() {} } };
const handlers = {
  "runtime.getURL": p => BASE + String(p).replace(/^\//, ""),
  "runtime.getManifest": () => ({ version: "0.5.7" }),
  "runtime.connectNative": () => nativePort,
  "runtime.onMessage.addListener": fn => runtimeListeners.push(fn),
  "runtime.onConnect.addListener": fn => connectListeners.push(fn),
  "tabs.query": async () => TABS,
  "tabs.get": async id => TABS.find(t => t.id === id) ?? Promise.reject(new Error("no tab")),
  "tabs.sendMessage": async (tabId, msg) => {
    toTabs.push({ tabId, msg });
    if (msg.action === "ping") return { ok: true };
    if (msg.action === "pill_pick") return { ok: true, result: pickResult };
    return { ok: true, result: {} };
  },
  "windows.getAll": async () => [{ id: 1, focused: true, type: "normal" }],
  "windows.getLastFocused": async () => ({ id: 1, type: "normal" }),
  "sidebarAction.open": async () => {},
  "sidebarAction.isOpen": async () => true,
};
// Everything else: a callable, chainable no-op whose calls resolve to [].
function api(pathName) {
  return new Proxy(function () {}, {
    get(_t, k) {
      if (k === "then" || typeof k === "symbol") return undefined;
      return api(pathName ? `${pathName}.${k}` : String(k));
    },
    apply(_t, _this, args) {
      const h = handlers[pathName];
      if (h) return h(...args);
      if (pathName.endsWith(".addListener") || pathName.endsWith(".removeListener")) return undefined;
      return Promise.resolve([]);
    },
  });
}
const context = vm.createContext({ browser: api(""), console, setTimeout, clearTimeout, setInterval, clearInterval, URL, TextEncoder, TextDecoder, structuredClone, queueMicrotask, crypto: globalThis.crypto, atob, btoa });
for (const f of ["channel.js", "transfer.js", "waits.js", "ui/route.js", "background.js"]) vm.runInContext(ext(f), context, { filename: f });

const flush = () => new Promise(r => setTimeout(r, 30));
const fromHelper = msg => nativeListener(msg);
const pillSender = tab => ({ tab, url: `${BASE}pill.html`, frameId: 3 });
const pageSender = tab => ({ tab, url: tab.url, frameId: 0 });
const tellRuntime = (msg, sender) => runtimeListeners.forEach(fn => fn(msg, sender));
const accessPosts = () => plain(posted).filter(m => m.type === "access.allow" || m.type === "access.dismiss");

const REQ = { id: "ar-1", client: "Claude Code", origin: "https://desec.io", status: "pending", sessionIds: ["s1"] };

await flush();
// ---- the request goes to the pill of tabs on that site ----
fromHelper({ type: "agents", sessions: [], access: [REQ] });
await flush();
const presence = toTabs.filter(c => c.msg.action === "presence");
const byTab = plain(Object.fromEntries(presence.map(c => [c.tabId, c.msg.args])));
assert.deepEqual(byTab[5].access, [{ id: "ar-1", label: "Claude Code", origin: "https://desec.io", status: "pending" }]);
assert.deepEqual(byTab[5].agents, [], "no agent needed on the tab");
assert.ok(byTab[7]?.access?.length, "a subdomain tab of the site shows it too");
assert.equal(byTab[6], undefined, "another site's tab doesn't");
assert.equal(byTab[8], undefined, "a private site's tab never does");
console.log("ok - a request reaches the pill of every tab on that site, and only those");

// ---- Allow clicked in pill.html (trusted) → access.allow to the helper ----
pickResult = { sessionId: null, access: { id: "ar-1", choice: "allow" } };
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pillSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [{ type: "access.allow", id: "ar-1", via: "pill" }]);
assert.ok(toTabs.some(c => c.msg.action === "pill_pick" && c.msg.args.x === 300 && c.msg.args.y === 50), "the content script is asked which button was under the click");
posted.length = 0;
pickResult = { sessionId: null, access: { id: "ar-1", choice: "dismiss" } };
tellRuntime({ ensoPill: "click", opened: false, x: 240, y: 50, trusted: true }, pillSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [{ type: "access.dismiss", id: "ar-1", via: "pill" }]);
console.log("ok - Allow / Not now clicked in the pill frame (trusted) reach the helper");

// ---- nothing else in the page can ----
posted.length = 0;
pickResult = { sessionId: null, access: { id: "ar-1", choice: "allow" } };
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: false }, pillSender(TABS[0]));
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50 }, pillSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [], "an untrusted (synthetic) click doesn't count");
tellRuntime({ ensoPillFallback: true, sessionId: null, access: { id: "ar-1", choice: "allow" } }, pageSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [], "the content script's fallback click never allows");
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pageSender(TABS[0]));
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, { tab: TABS[0], url: "https://desec.io/pill.html", frameId: 0 });
await flush();
assert.deepEqual(accessPosts(), [], "the page's own frame can't pose as the pill");
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pillSender(TABS[1]));
await flush();
assert.deepEqual(accessPosts(), [], "a pill on another site's tab can't allow this request");
pickResult = { sessionId: null, access: { id: "ar-unknown", choice: "allow" } };
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pillSender(TABS[0]));
pickResult = { sessionId: null, access: { id: "ar-1", choice: "grant-everything" } };
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pillSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [], "unknown requests and choices do nothing");
tellRuntime({ type: "access.allow", id: "ar-1" }, pageSender(TABS[0]));
tellRuntime({ type: "access.allow", id: "ar-1" }, { url: "https://desec.io/" });
await flush();
assert.deepEqual(accessPosts(), [], "a raw access.allow runtime message isn't forwarded");
// A "ui" port from a web page is disconnected before it can send anything
let disconnected = false;
const pagePort = { name: "ui", sender: { url: "https://desec.io/", tab: TABS[0] }, disconnect: () => (disconnected = true), onMessage: { addListener: () => assert.fail("a page's port got a message listener") }, onDisconnect: { addListener() {} }, postMessage() {} };
connectListeners.forEach(fn => fn(pagePort));
assert.equal(disconnected, true);
// An answered request can't be allowed from the pill
fromHelper({ type: "agents", sessions: [], access: [{ ...REQ, status: "granted" }] });
await flush();
pickResult = { sessionId: null, access: { id: "ar-1", choice: "allow" } };
tellRuntime({ ensoPill: "click", opened: false, x: 300, y: 50, trusted: true }, pillSender(TABS[0]));
await flush();
assert.deepEqual(accessPosts(), [], "only pending requests");
console.log("ok - untrusted clicks, the fallback, the page's frame, other sites' tabs, unknown or answered requests and page ports can't allow");

// ---- Ensō's own pages (a "ui" port from the extension) forward Allow ----
let onUiMessage = null;
const uiPort = { name: "ui", sender: { url: `${BASE}sidebar.html` }, disconnect: () => assert.fail("Ensō's page was disconnected"), onMessage: { addListener: fn => (onUiMessage = fn) }, onDisconnect: { addListener() {} }, postMessage() {} };
connectListeners.forEach(fn => fn(uiPort));
onUiMessage({ type: "access.allow", id: "ar-2" });
await flush();
assert.deepEqual(accessPosts(), [{ type: "access.allow", id: "ar-2" }], "the sidebar's Allow goes to the helper (which checks the request)");
console.log("ok - Allow from Ensō's own pages goes to the helper");

// ---- the request leaves the pill when it is gone ----
toTabs.length = 0;
fromHelper({ type: "agents", sessions: [], access: [] });
await flush();
assert.ok(toTabs.some(c => c.tabId === 5 && c.msg.action === "presence" && c.msg.args.off), "the pill goes when the request is answered and gone");
console.log("ok - the pill's request row goes with the request");
process.exit(0);
