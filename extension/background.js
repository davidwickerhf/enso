// Ensō background: keeps the connection to the helper (../helper), fans
// its messages out to every open UI (sidebar, new tab, full page, reports),
// adds tab context to chat messages, and carries out page and browser actions
// for the helper. Message contract: ../PROTOCOL.md.

const HOST = "enso";
const MAX_PAGE_CHARS = 150_000;

let native = null;
const uis = new Set();
let sensitivePatterns = ["*bank*", "*health*", "*patient*"];
let spaces = []; // Zen spaces from the helper: [{ id, name, icon, containerId, urls }]

// ---------- Zen spaces ----------
// Extensions can't see Zen's spaces, but each space has its own container, and
// tabs of other spaces are hidden. Match the tab's container first; when
// several spaces share a container, pick the one whose tabs overlap most with
// the currently visible tabs.
const containerOf = tab => {
  const m = /firefox-container-(\d+)/.exec(tab?.cookieStoreId ?? "");
  return m ? Number(m[1]) : 0;
};
async function spaceOf(tab) {
  if (!tab || !spaces.length) return null;
  const candidates = spaces.filter(sp => sp.containerId === containerOf(tab));
  if (candidates.length <= 1) return candidates[0] ? pickSpace(candidates[0]) : null;
  const visible = new Set((await browser.tabs.query({ windowId: tab.windowId, hidden: false })).map(t => t.url));
  const score = sp => sp.urls.filter(u => visible.has(u)).length;
  return pickSpace(candidates.sort((a, b) => score(b) - score(a))[0]);
}
const pickSpace = sp => ({ id: sp.id, name: sp.name, icon: sp.icon, containerId: sp.containerId });

// Zen doesn't hide other spaces' tabs from extensions, so "this space" is
// decided by space detection (container, then the space's known tab URLs).
async function inCurrentSpace(tabs) {
  const current = await spaceOf(await activeTab());
  if (!current) return tabs.map(t => ({ tab: t, space: null, here: true }));
  return Promise.all(tabs.map(async t => {
    const sp = await spaceOf(t);
    return { tab: t, space: sp, here: !sp || sp.id === current.id };
  }));
}

// ---------- helpers ----------

const globToRegExp = g => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
function isSensitive(url) {
  try {
    const host = new URL(url).hostname;
    return sensitivePatterns.some(p => globToRegExp(p).test(host));
  } catch {
    return false;
  }
}
const isWeb = url => /^https?:/i.test(url ?? "");

// The window the user last worked in. When Zen loses focus no window is
// "focused", and falling back to the first window showed whatever space that
// window had open (e.g. BISS) instead of the one the user just left.
let lastWindowId = null;
browser.windows.getLastFocused({ windowTypes: ["normal"] }).then(w => { lastWindowId ??= w?.id ?? null; }).catch(() => {});

async function activeTab() {
  const wins = await browser.windows.getAll({ windowTypes: ["normal"] });
  const win = wins.find(w => w.focused) ?? wins.find(w => w.id === lastWindowId) ?? (await browser.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null)) ?? wins[0];
  if (!win) return null;
  if (win.focused) lastWindowId = win.id;
  const [tab] = await browser.tabs.query({ active: true, windowId: win.id });
  return tab ?? null;
}

const tabInfo = t => (t ? { tabId: t.id, title: t.title ?? "", url: t.url ?? "", favIconUrl: t.favIconUrl ?? "", active: !!t.active, sensitive: isSensitive(t.url) } : null);

async function ensureAgent(tabId) {
  try {
    const pong = await browser.tabs.sendMessage(tabId, { enso: true, action: "text", args: {} });
    if (pong?.ok) return;
  } catch {}
  await browser.tabs.executeScript(tabId, { file: "/pageagent.js", runAt: "document_idle" });
}

// `who`: the external agent acting (e.g. "Codex"), shown on the page ribbon; Ensō's own turns leave it unset ("Claude").
async function agent(tabId, action, args, who) {
  const tab = await browser.tabs.get(tabId);
  if (!isWeb(tab.url)) throw new Error("This tab isn't a web page, so it can't be read or operated.");
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health or similar); page tools are off here.");
  if (tab.discarded) throw new Error("This tab is unloaded (Zen unloads tabs it hasn't shown for a while), so it can't be read or operated until it is opened or reloaded.");
  try {
    await ensureAgent(tabId);
  } catch (err) {
    throw new Error(`Could not reach this page (${err?.message || "it may still be loading or be a restricted page"}).`);
  }
  const res = await browser.tabs.sendMessage(tabId, { enso: true, action, args, ...(who ? { agent: who } : {}) });
  if (!res?.ok) throw new Error(res?.error ?? "The page did not answer.");
  return res.result;
}

function waitForLoad(tabId, timeoutMs = 30_000) {
  return new Promise(resolve => {
    const done = () => {
      browser.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      browser.tabs.get(tabId).then(t => resolve({ url: t.url, title: t.title }), () => resolve({}));
    };
    const listener = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
  });
}

async function readTab(tabId) {
  const tab = await browser.tabs.get(tabId);
  if (!isWeb(tab.url) || isSensitive(tab.url)) return { tabId, url: tab.url, title: tab.title, text: "" };
  try {
    const r = await agent(tabId, "text", {});
    return { tabId, url: r.url, title: r.title, text: r.text.slice(0, MAX_PAGE_CHARS) };
  } catch {
    return { tabId, url: tab.url, title: tab.title, text: "(this tab is not loaded; only its title and URL are known)" };
  }
}

// ---------- developer tools: console, network, storage, session requests ----------
// Console capture starts per tab on first use (devtools_console) and is
// re-armed at every navigation of that tab. Network requests are recorded for
// all web tabs (ring buffer). Private sites are never recorded. Cookie,
// authorization and token values are redacted before anything is stored.

const CONSOLE_MAX = 1000;
const NET_MAX = 500;
const consoleTabs = new Map(); // tabId -> { entries, dropped }
const netTabs = new Map(); // tabId -> [entry]
const netById = new Map(); // requestId -> entry
const tabTop = new Map(); // tabId -> top-level URL (for the private-site check)

const SECRET_NAME = /(cookie|authorization|auth|token|secret|passw|pwd|session|sess|jwt|bearer|credential|api[-_]?key|apikey|private|signature|sig$|csrf|xsrf|otp|code_verifier)/i;
const looksSecret = v => /^eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*$/.test(v) || /^(Bearer|Basic|token)\s+\S{8,}/i.test(v) || /^(gh[pousr]_|github_pat_|sk-|xox[abpr]-|AKIA)[A-Za-z0-9_-]{8,}/.test(v);
const redactHeaders = list => (list ?? []).map(({ name, value }) => ({ name, value: SECRET_NAME.test(name) || looksSecret(String(value ?? "")) ? "[redacted]" : String(value ?? "").slice(0, 300) }));
function redactUrl(url) {
  try {
    const u = new URL(url);
    let changed = false;
    for (const [k, v] of [...u.searchParams]) {
      if (SECRET_NAME.test(k) || /^(code|key|state|access_token|id_token|refresh_token)$/i.test(k) || looksSecret(v)) {
        u.searchParams.set(k, "[redacted]");
        changed = true;
      }
    }
    if (u.password) {
      u.username = "[redacted]";
      u.password = "";
      changed = true;
    }
    return changed ? u.toString() : url;
  } catch {
    return url;
  }
}

function pushConsole(tabId, entries) {
  const buf = consoleTabs.get(tabId);
  if (!buf) return;
  for (const e of entries) {
    buf.entries.push(e);
    if (buf.entries.length > CONSOLE_MAX) {
      buf.entries.shift();
      buf.dropped++;
    }
  }
}

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.ensoConsole && sender.tab?.id != null && Array.isArray(msg.entries)) pushConsole(sender.tab.id, msg.entries.slice(0, 300));
});

// Re-arm console capture as early as possible after a captured tab navigates.
browser.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0 || !consoleTabs.has(tabId)) return;
  pushConsole(tabId, [{ t: Date.now(), level: "nav", text: isSensitive(url) ? "(a private site: not captured)" : url }]);
  if (!isWeb(url) || isSensitive(url)) return;
  try {
    await browser.tabs.executeScript(tabId, { file: "/pageagent.js", runAt: "document_start" });
    await browser.tabs.sendMessage(tabId, { enso: true, action: "console_start", args: {} });
  } catch {}
});

async function consoleRead(tabId, args) {
  const tab = await browser.tabs.get(tabId);
  if (!isWeb(tab.url)) throw new Error("This tab isn't a web page.");
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health or similar); developer tools are off here.");
  let started = false;
  if (!consoleTabs.has(tabId)) {
    consoleTabs.set(tabId, { entries: [], dropped: 0 });
    started = true;
    await agent(tabId, "console_start", {});
  } else {
    try {
      const r = await agent(tabId, "console_flush", {});
      pushConsole(tabId, r.entries ?? []);
      if (!r.capturing) await agent(tabId, "console_start", {}); // agent re-injected without capture
    } catch {}
  }
  const buf = consoleTabs.get(tabId);
  const min = { all: null, debug: null, log: ["log", "info", "warn", "error", "nav"], info: ["info", "warn", "error", "nav"], warn: ["warn", "error", "nav"], error: ["error", "nav"] }[args.level ?? "all"];
  const list = buf.entries.filter(e => e.t > (args.since ?? 0) && (!min || min.includes(e.level)));
  return { tabId, url: tab.url, now: Date.now(), started, dropped: buf.dropped, entries: list.slice(-(args.limit ?? 200)) };
}

const netFilter = { urls: ["<all_urls>"] };
browser.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0 || !isWeb(d.url)) return;
  if (d.type === "main_frame") tabTop.set(d.tabId, d.url);
  if (isSensitive(tabTop.get(d.tabId) ?? d.url) || isSensitive(d.url)) return;
  const entry = { id: d.requestId, start: d.timeStamp, t: d.timeStamp, method: d.method, url: d.url, type: d.type, initiator: d.originUrl && d.originUrl !== d.url ? d.originUrl.slice(0, 200) : null, thirdParty: d.thirdParty ?? null };
  const list = netTabs.get(d.tabId) ?? [];
  list.push(entry);
  if (list.length > NET_MAX) netById.delete(list.shift().id);
  netTabs.set(d.tabId, list);
  netById.set(d.requestId, entry);
}, netFilter);
browser.webRequest.onSendHeaders.addListener(d => {
  const e = netById.get(d.requestId);
  if (e) e.requestHeaders = redactHeaders(d.requestHeaders);
}, netFilter, ["requestHeaders"]);
browser.webRequest.onCompleted.addListener(d => {
  const e = netById.get(d.requestId);
  if (!e) return;
  netById.delete(d.requestId);
  e.status = d.statusCode;
  e.ms = Math.round(d.timeStamp - e.start);
  e.fromCache = !!d.fromCache;
  e.ip = d.ip ?? null;
  const len = Number((d.responseHeaders ?? []).find(h => h.name.toLowerCase() === "content-length")?.value);
  e.resSize = d.responseSize || (Number.isFinite(len) ? len : null);
  e.reqSize = d.requestSize || null;
  e.responseHeaders = redactHeaders(d.responseHeaders);
}, netFilter, ["responseHeaders"]);
browser.webRequest.onErrorOccurred.addListener(d => {
  const e = netById.get(d.requestId);
  if (!e) return;
  netById.delete(d.requestId);
  e.error = d.error;
  e.ms = Math.round(d.timeStamp - e.start);
}, netFilter);
browser.tabs.onRemoved.addListener(tabId => {
  for (const e of netTabs.get(tabId) ?? []) netById.delete(e.id);
  netTabs.delete(tabId);
  consoleTabs.delete(tabId);
  tabTop.delete(tabId);
});

async function networkLog(args) {
  const tabId = args.tabId ?? (await activeTab())?.id;
  if (tabId == null) throw new Error("No tab; open a web page first.");
  const tab = await browser.tabs.get(tabId);
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health or similar); developer tools are off here.");
  let match = () => true;
  if (args.filter) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(args.filter);
    if (re) {
      const rx = new RegExp(re[1], re[2]);
      match = u => rx.test(u);
    } else match = u => u.toLowerCase().includes(args.filter.toLowerCase());
  }
  const type = (args.type ?? "").toLowerCase().replace(/^(xhr|fetch)$/, "xmlhttprequest");
  const all = (netTabs.get(tabId) ?? []).filter(e => e.t > (args.since ?? 0) && match(e.url) && (!type || e.type === type) && (!args.failedOnly || e.error || e.status >= 400));
  const requests = all.slice(-(args.limit ?? 100)).map(({ start, requestHeaders, responseHeaders, ...e }) => ({ ...e, url: redactUrl(e.url), initiator: e.initiator ? redactUrl(e.initiator) : null, ...(args.includeHeaders ? { requestHeaders, responseHeaders } : {}) }));
  return { tabId, url: tab.url, now: Date.now(), total: all.length, requests, recording: netTabs.has(tabId) };
}

async function containerName(cookieStoreId) {
  if (!cookieStoreId || cookieStoreId === "firefox-default") return null;
  try {
    return (await browser.contextualIdentities.get(cookieStoreId)).name;
  } catch {
    return cookieStoreId;
  }
}

async function storageRead(tabId, args) {
  const tab = await browser.tabs.get(tabId);
  const r = await agent(tabId, "storage", { includeValues: !!args.includeValues });
  const host = new URL(tab.url).hostname;
  const storeId = tab.cookieStoreId;
  const seen = new Map();
  for (const query of [{ url: tab.url }, { domain: host }]) {
    for (const c of await browser.cookies.getAll({ ...query, ...(storeId ? { storeId } : {}) }).catch(() => [])) {
      // Names and flags only: the value never leaves the browser.
      seen.set(`${c.name}|${c.domain}|${c.path}`, { name: c.name, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session, expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString().slice(0, 10) : null, partitioned: !!c.partitionKey });
    }
  }
  return { ...r, cookies: [...seen.values()], container: await containerName(storeId) };
}

/** A request inside a tab of the target origin, so it carries the user's session there. */
async function sessionFetch(args) {
  if (!isWeb(args.url)) throw new Error("Only http(s) URLs.");
  if (isSensitive(args.url)) throw new Error("This is a private site (banking, health or similar); session requests are off here.");
  const origin = new URL(args.url).origin;
  const active = await activeTab();
  const sameOrigin = (await browser.tabs.query({})).filter(t => {
    try {
      return new URL(t.url).origin === origin;
    } catch {
      return false;
    }
  });
  // Prefer a loaded tab in the current space's container, then any loaded tab of the site.
  let tab = sameOrigin.find(t => !t.discarded && t.status === "complete" && t.cookieStoreId === active?.cookieStoreId) ?? sameOrigin.find(t => !t.discarded && t.status === "complete");
  let opened = null;
  if (!tab) {
    const storeId = sameOrigin[0]?.cookieStoreId ?? active?.cookieStoreId;
    opened = await browser.tabs.create({ url: `${origin}/`, active: false, ...(storeId ? { cookieStoreId: storeId } : {}), ...(active?.windowId != null ? { windowId: active.windowId } : {}) });
    await waitForLoad(opened.id, 30_000);
    tab = await browser.tabs.get(opened.id);
  }
  try {
    const r = await agent(tab.id, "fetch", { url: args.url, method: args.method ?? "GET", headers: args.headers ?? {}, body: args.body, maxChars: args.maxChars });
    return { ...r, tabId: opened ? null : tab.id, openedTab: !!opened, container: await containerName(tab.cookieStoreId) };
  } finally {
    if (opened) browser.tabs.remove(opened.id).catch(() => {});
  }
}

/**
 * The current cookies of sites the user allowed, for the helper to copy into the
 * headless browser's throwaway profile (they go to the helper only, never to
 * Claude). Container: the one he has the site open in (current space first),
 * else the one holding most of the site's cookies.
 */
async function siteCookies(hosts) {
  const tabs = await browser.tabs.query({});
  const active = await activeTab();
  const out = {};
  for (const h of hosts) {
    if (isSensitive(`https://${h}/`)) continue;
    const on = tabs.filter(t => {
      try {
        const host = new URL(t.url).hostname;
        return host === h || host.endsWith(`.${h}`);
      } catch {
        return false;
      }
    });
    let storeId = (on.find(t => t.cookieStoreId === active?.cookieStoreId) ?? on.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0])?.cookieStoreId;
    if (!storeId) {
      const stores = ["firefox-default", ...(await browser.contextualIdentities.query({}).catch(() => [])).map(c => c.cookieStoreId)];
      let best = null;
      for (const st of stores) {
        const n = (await browser.cookies.getAll({ domain: h, storeId: st }).catch(() => [])).length;
        if (n && (!best || n > best.n)) best = { st, n };
      }
      storeId = best?.st ?? "firefox-default";
    }
    const cookies = await browser.cookies.getAll({ domain: h, storeId }).catch(() => []);
    out[h] = {
      container: containerOf({ cookieStoreId: storeId }) || "default",
      containerName: await containerName(storeId),
      cookies: cookies.map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, expirationDate: c.expirationDate ?? null, session: c.session })),
    };
  }
  return out;
}

// ---------- page and browser actions for the helper ----------

async function pageAction(tabId, action, args, who) {
  tabId ??= (await activeTab())?.id; // external callers (Claude Code via MCP) may omit the tab
  if (!tabId) throw new Error("No tab to act on; open a web page first.");
  if (action === "console") return consoleRead(tabId, args);
  if (action === "storage") return storageRead(tabId, args);
  if (action === "navigate") {
    if (!isWeb(args.url)) throw new Error("Only http(s) URLs can be opened.");
    await browser.tabs.update(tabId, { url: args.url });
    return waitForLoad(tabId);
  }
  if (action === "back") {
    await browser.tabs.goBack(tabId);
    return waitForLoad(tabId, 15_000);
  }
  if (action === "screenshot") {
    const tab = await browser.tabs.get(tabId);
    if (isSensitive(tab.url)) throw new Error("This is a private page; screenshots are off here.");
    return { dataUrl: await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" }) };
  }
  return agent(tabId, action, args, who);
}

async function browserAction(action, args) {
  switch (action) {
    case "tabs_list": {
      // Zen mirrors tabs across windows and loads only the active space's tabs into a window,
      // so "this space" = the window the user is using; allSpaces widens it.
      const tabs = (await browser.tabs.query(args.allSpaces ? { windowType: "normal" } : { windowType: "normal", lastFocusedWindow: true })).filter(t => isWeb(t.url) || t.active); // keep the active tab even if it's an Ensō page
      const rows = await inCurrentSpace(tabs);
      return rows.filter(r => args.allSpaces || r.here).map(({ tab: t, space }) => ({ tabId: t.id, title: t.title, url: t.url, groupId: t.groupId ?? -1, active: t.active, windowId: t.windowId, space: space?.name ?? null }));
    }
    case "tab_text":
      return readTab(args.tabId);
    case "tabs_open": {
      // Open in the current space's container so the tabs land in that space with its logins.
      const cookieStoreId = (await activeTab())?.cookieStoreId;
      const opened = [];
      for (const url of args.urls) {
        if (!isWeb(url)) continue;
        const t = await browser.tabs.create({ url, active: !args.background && opened.length === 0, ...(cookieStoreId ? { cookieStoreId } : {}) });
        opened.push({ tabId: t.id, url });
      }
      return opened;
    }
    case "tabs_close":
      await browser.tabs.remove(args.tabIds);
      return {};
    case "tabs_group": {
      if (!browser.tabs.group) throw new Error("This browser version has no tab-group API.");
      const groupId = await browser.tabs.group(args.groupId != null ? { tabIds: args.tabIds, groupId: args.groupId } : { tabIds: args.tabIds });
      if (args.title || args.color) await browser.tabGroups.update(groupId, { ...(args.title ? { title: args.title } : {}), ...(args.color ? { color: args.color } : {}) });
      return { groupId };
    }
    case "tabs_ungroup":
      await browser.tabs.ungroup(args.tabIds);
      return {};
    case "group_update": {
      const { groupId, ...rest } = args;
      await browser.tabGroups.update(groupId, rest);
      return {};
    }
    case "history_search": {
      const days = args.days ?? 30;
      const items = await browser.history.search({ text: args.text ?? "", startTime: Date.now() - days * 86_400_000, maxResults: Math.min(args.max ?? 25, 100) });
      return items.filter(i => !isSensitive(i.url)).map(i => ({ url: i.url, title: i.title, lastVisit: new Date(i.lastVisitTime).toISOString(), visits: i.visitCount }));
    }
    case "open_report":
      await browser.tabs.create({ url: browser.runtime.getURL(`report.html?id=${encodeURIComponent(args.id)}`) });
      return {};
    case "network_log":
      return networkLog(args);
    case "session_fetch":
      return sessionFetch(args);
    case "site_cookies":
      return siteCookies(args.hosts ?? []);
  }
  throw new Error(`Unknown browser action ${action}`);
}

// ---------- the helper connection ----------

function broadcast(msg) {
  for (const port of uis) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

function connectNative() {
  if (native) return native;
  native = browser.runtime.connectNative(HOST);
  native.onMessage.addListener(async msg => {
    if (msg.type === "page.request" || msg.type === "browser.request") {
      const reply = { type: msg.type.replace("request", "response"), reqId: msg.reqId };
      try {
        reply.result = msg.type === "page.request" ? await pageAction(msg.tabId, msg.action, msg.args ?? {}, typeof msg.agent === "string" ? msg.agent : undefined) : await browserAction(msg.action, msg.args ?? {});
        reply.ok = true;
      } catch (err) {
        reply.ok = false;
        reply.error = String(err.message ?? err);
      }
      native?.postMessage(reply);
      return;
    }
    if (msg.type === "state" && Array.isArray(msg.sensitiveHosts)) sensitivePatterns = msg.sensitiveHosts;
    if ((msg.type === "state" || msg.type === "spaces") && Array.isArray(msg.spaces)) {
      spaces = msg.spaces;
      pushCurrentPage();
    }
    broadcast(msg);
  });
  native.onDisconnect.addListener(port => {
    const reason = port.error?.message || "the helper stopped";
    native = null;
    broadcast({ type: "event", conversationId: null, event: { kind: "error", code: "host_disconnected", text: `Lost the chat helper: ${reason}. Run scripts/install.sh if this keeps happening.` } });
  });
  // Space detection must work with no Ensō page open (e.g. Claude Code calling over MCP).
  native.postMessage({ type: "spaces.list" });
  return native;
}

async function forward(msg) {
  const host = connectNative();
  if (msg.type === "chat.send") {
    const tab = await activeTab();
    msg.space = await spaceOf(tab);
    if (tab && isWeb(tab.url)) {
      const sensitive = isSensitive(tab.url);
      msg.page = { tabId: tab.id, url: tab.url, title: tab.title };
      if (msg.includePage && !sensitive) msg.page.text = (await readTab(tab.id)).text;
      if (msg.attachScreenshot && !sensitive) msg.page.screenshot = await browser.tabs.captureVisibleTab(tab.windowId, { format: "png" }).catch(() => undefined);
    }
    if (msg.mentionedTabIds?.length) msg.mentionedTabs = await Promise.all(msg.mentionedTabIds.slice(0, 20).map(id => readTab(id).catch(() => null))).then(r => r.filter(Boolean));
  }
  host.postMessage(msg);
}

// ---------- UIs ----------

async function pushCurrentPage(port) {
  const tab = await activeTab();
  const msg = { type: "page.current", tab: tab && isWeb(tab.url) ? tabInfo(tab) : null, space: await spaceOf(tab) };
  port ? port.postMessage(msg) : broadcast(msg);
}

browser.runtime.onConnect.addListener(port => {
  if (port.name !== "ui") return;
  uis.add(port);
  port.onDisconnect.addListener(() => uis.delete(port));
  connectNative();
  pushCurrentPage(port);
  port.onMessage.addListener(async msg => {
    if (msg.type === "tabs.list") {
      const tabs = (await browser.tabs.query({ windowType: "normal" })).filter(t => isWeb(t.url));
      const win = (await activeTab())?.windowId;
      const rows = await inCurrentSpace(tabs);
      rows.sort((a, b) => Number(b.here) - Number(a.here) || Number(b.tab.windowId === win) - Number(a.tab.windowId === win) || Number(b.tab.active) - Number(a.tab.active));
      // "hidden" keeps its protocol meaning: the tab belongs to another Zen space.
      port.postMessage({ type: "tabs", tabs: rows.map(r => ({ ...tabInfo(r.tab), hidden: !r.here, space: r.space?.name ?? null })) });
      return;
    }
    if (msg.type === "page.current") return pushCurrentPage(port);
    forward(msg).catch(err => port.postMessage({ type: "event", conversationId: msg.conversationId ?? null, event: { kind: "error", text: String(err.message ?? err) } }));
  });
});

browser.tabs.onActivated.addListener(() => pushCurrentPage());
browser.tabs.onUpdated.addListener((_id, info, tab) => tab.active && (info.status === "complete" || info.title) && pushCurrentPage());
browser.windows.onFocusChanged.addListener(async windowId => {
  // Zen losing focus (another app in front) changes nothing for Ensō: keep showing the last window's space.
  if (windowId === browser.windows.WINDOW_ID_NONE) return;
  const w = await browser.windows.get(windowId).catch(() => null);
  if (w?.type !== "normal") return;
  lastWindowId = windowId;
  pushCurrentPage();
});
browser.windows.onRemoved.addListener(id => { if (id === lastWindowId) lastWindowId = null; });

// ---------- new tabs: keyboard focus in Ensō's box, not the address bar ----------
// Firefox focuses the address bar for every tab opened on the new-tab URL
// (isBlankPageURL), so typing would land there. Tabs created through
// tabs.create with an explicit url skip that, so a fresh new tab is swapped
// for an identical one (same position, container and space). "#f" keeps it
// from repeating; Firefox ignores the hash when matching the new-tab URL, so
// the address bar stays empty.
const NEWTAB = browser.runtime.getURL("newtab.html");
const fresh = new Set(); // tabs just created by the user, waiting to show which page they load
const ours = new Set(); // tabs this script created: never swap these again
const isNewTabUrl = u => u === NEWTAB || u === "about:newtab" || u === "about:home";
let swapping = false;

async function swapForFocus(tabId) {
  fresh.delete(tabId);
  if (ours.has(tabId) || swapping) return;
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab?.active || !isNewTabUrl(tab.url)) return;
  swapping = true;
  try {
    const created = await browser.tabs.create({ url: `${NEWTAB}#f`, index: tab.index, active: true, windowId: tab.windowId, ...(tab.cookieStoreId ? { cookieStoreId: tab.cookieStoreId } : {}) });
    ours.add(created.id);
    fresh.delete(created.id);
    await browser.tabs.remove(tabId);
  } catch {
  } finally {
    swapping = false;
  }
}

browser.tabs.onCreated.addListener(tab => {
  if (swapping || ours.has(tab.id) || (tab.url ?? "").includes("#f")) return; // our own replacement
  if (isNewTabUrl(tab.url)) return void setTimeout(() => swapForFocus(tab.id), 30);
  if (tab.url === "about:blank") {
    fresh.add(tab.id); // the real URL arrives in onUpdated
    setTimeout(() => fresh.delete(tab.id), 3000);
  }
});
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (!info.url || !fresh.has(tabId)) return;
  if (info.url.includes("#f")) return void fresh.delete(tabId);
  if (isNewTabUrl(info.url)) swapForFocus(tabId);
});
browser.tabs.onRemoved.addListener(tabId => {
  fresh.delete(tabId);
  ours.delete(tabId);
});

// ---------- toolbar button and menu ----------

browser.browserAction.onClicked.addListener(() => browser.sidebarAction.toggle());
browser.menus.create({ id: "enso-full", title: "Open Ensō as a page", contexts: ["browser_action"] });
browser.menus.create({ id: "enso-ask", title: "Ask Ensō about this", contexts: ["selection", "link", "page"] });
browser.menus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "enso-full") browser.tabs.create({ url: browser.runtime.getURL("full.html") });
  if (info.menuItemId === "enso-ask") {
    await browser.sidebarAction.open();
    const text = info.selectionText ? `About this passage: "${info.selectionText}"` : info.linkUrl ? `About this link: ${info.linkUrl}` : `About this page (${tab?.title ?? ""})`;
    setTimeout(() => broadcast({ type: "composer.prefill", text }), 600);
  }
});

connectNative();
