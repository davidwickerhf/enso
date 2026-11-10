// Ensō background: keeps the connection to the helper (../helper), fans
// its messages out to every open UI (sidebar, new tab, full page, reports),
// adds tab context to chat messages, and carries out page and browser actions
// for the helper. Message contract: ../PROTOCOL.md.

const HOST = "enso";
const MAX_PAGE_CHARS = 150_000;

let native = null;
const uis = new Set();
// Private sites (banking, payment, password managers, health, tax and
// government): a copy of sensitiveHosts in helper/config.json, used until the
// helper sends its list (which can add the user's own). A helper test keeps
// the two equal.
const DEFAULT_SENSITIVE = [
  "*.paypal.com",
  "*.wise.com",
  "*.revolut.com",
  "*.bunq.com",
  "*.n26.com",
  "*.monzo.com",
  "*.chase.com",
  "*.americanexpress.com",
  "*.1password.com",
  "*.bitwarden.com",
  "*.lastpass.com",
  "*.dashlane.com",
  "*bank*",
  "*health*",
  "*patient*",
  "*.belastingdienst.nl",
  "*.toeslagen.nl",
  "mijn.overheid.nl",
  "*.mijnoverheid.nl",
  "*.digid.nl",
  "*.irs.gov",
  "*.ssa.gov",
  "*.login.gov",
  "*.tax.service.gov.uk",
  "*.hmrc.gov.uk",
  "*.account.gov.uk",
  "*.elster.de",
  "*.impots.gouv.fr",
  "*.agenziaentrate.gov.it",
  "*.agenciatributaria.gob.es",
  "*.myminfin.be",
  "*.ato.gov.au",
  "my.gov.au",
  "*.ird.govt.nz",
];
let sensitivePatterns = DEFAULT_SENSITIVE;
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
// `*.example.com` also covers example.com itself.
const sensitiveRegExp = p => (p.startsWith("*.") ? new RegExp(`^(.*\\.)?${globToRegExp(p.slice(2)).source.slice(1)}`, "i") : globToRegExp(p));
function isSensitive(url) {
  try {
    const host = new URL(url).hostname;
    return sensitivePatterns.some(p => sensitiveRegExp(p).test(host));
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
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health, tax or similar); page tools are off here.");
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

// Console capture starts by itself on development sites (localhost, LAN
// addresses, .local/.test/.localhost) and on sites the user turned it on for
// ("Always on <site>" in the screenshot sheet); elsewhere when asked.
const DEV_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^/]+\.(localhost|local|test))$/i;
let consoleHosts = new Set();
browser.storage.local.get("consoleHosts").then(r => { consoleHosts = new Set(r.consoleHosts ?? []); }).catch(() => {});
const hostOfUrl = u => { try { return new URL(u).hostname; } catch { return ""; } };
const autoConsole = url => { const h = hostOfUrl(url); return !!h && (DEV_HOST.test(h) || consoleHosts.has(h)); };

async function startConsole(tabId, url) {
  if (!consoleTabs.has(tabId)) consoleTabs.set(tabId, { entries: [], dropped: 0 });
  pushConsole(tabId, [{ t: Date.now(), level: "nav", text: url }]);
  try {
    await browser.tabs.executeScript(tabId, { file: "/pageagent.js", runAt: "document_start" });
    await browser.tabs.sendMessage(tabId, { enso: true, action: "console_start", args: {} });
  } catch {}
}

// Re-arm console capture as early as possible after a captured tab navigates.
browser.webNavigation.onCommitted.addListener(async ({ tabId, frameId, url }) => {
  if (frameId !== 0) return;
  if (!consoleTabs.has(tabId)) {
    if (isWeb(url) && !isSensitive(url) && autoConsole(url)) await startConsole(tabId, url);
    return;
  }
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
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health, tax or similar); developer tools are off here.");
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
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health, tax or similar); developer tools are off here.");
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
  if (isSensitive(args.url)) throw new Error("This is a private site (banking, health, tax or similar); session requests are off here.");
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
    case "active_tab": {
      // The tab a page tool acts on when the caller gives none (for agent sessions and Pause).
      const t = await activeTab();
      return t ? { tabId: t.id, url: t.url ?? "", title: t.title ?? "" } : {};
    }
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


// ---------- external agents: presence on the page, in the tab title and on the toolbar ----------
// The helper pushes `agents` (live sessions of MCP clients, lib/agentsessions.mjs).
// For each tab with a session: the page pill and "✦ " title prefix (pageagent.js
// "presence") and a copper per-tab badge on Ensō's toolbar button. Zen's own tab
// list can't be styled by extensions; the title prefix is what shows there.

const AGENT_BADGE = "#d9643a";
const AGENT_BADGE_PAUSED = "#8a7f74";
let agentSessions = [];
let titlePrefixOn = true; // settings.agentTitlePrefix
const presenceSent = new Map(); // tabId -> last presence sent (JSON)

function setAgentBadge(tabId, s) {
  const ba = browser.browserAction;
  ba.setBadgeText({ tabId, text: s.stopped ? "" : "AI" }).catch?.(() => {});
  ba.setBadgeBackgroundColor({ tabId, color: s.paused ? AGENT_BADGE_PAUSED : AGENT_BADGE }).catch?.(() => {});
  ba.setBadgeTextColor?.({ tabId, color: "#ffffff" })?.catch?.(() => {});
  ba.setTitle({ tabId, title: `Ensō · ${s.client}${s.task ? `: ${s.task}` : " is working on this tab"}${s.paused ? " (paused)" : ""}` }).catch?.(() => {});
}
function clearAgentBadge(tabId) {
  const ba = browser.browserAction;
  ba.setBadgeText({ tabId, text: null }).catch?.(() => {});
  ba.setTitle({ tabId, title: null }).catch?.(() => {});
}

async function syncPresence() {
  const byTab = new Map();
  for (const s of agentSessions) if (Number.isInteger(s.tabId) && !byTab.has(s.tabId)) byTab.set(s.tabId, s); // newest first
  for (const [tabId, s] of byTab) {
    const p = { label: s.client, task: s.task, running: !!s.running, paused: !!s.paused, stopped: !!s.stopped, titlePrefix: titlePrefixOn };
    const key = JSON.stringify(p);
    if (presenceSent.get(tabId) === key) continue;
    presenceSent.set(tabId, key);
    setAgentBadge(tabId, s);
    agent(tabId, "presence", p).catch(() => {}); // unloaded or private tabs: no pill
  }
  for (const tabId of [...presenceSent.keys()]) {
    if (byTab.has(tabId)) continue;
    presenceSent.delete(tabId);
    clearAgentBadge(tabId);
    browser.tabs.sendMessage(tabId, { enso: true, action: "presence", args: { off: true } }, { frameId: 0 }).catch(() => {});
  }
}

// A navigation drops the content script (and Firefox resets tab-specific badges): show it again.
browser.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== "complete" || !presenceSent.has(tabId)) return;
  presenceSent.delete(tabId);
  syncPresence();
});
browser.tabs.onRemoved.addListener(tabId => presenceSent.delete(tabId));

// The pill: pill.html (an extension frame over it) opens the sidebar on click;
// the content script's own click handler is the fallback when the frame can't load.
async function pillClicked(tab, opened) {
  broadcast({ type: "agents.focus", tabId: tab.id });
  if (opened) return;
  const open = await browser.sidebarAction.isOpen({ windowId: tab.windowId }).catch(() => false);
  if (!open) browser.tabs.sendMessage(tab.id, { enso: true, action: "pill_hint", args: { text: "Press ⌘E for Ensō" } }, { frameId: 0 }).catch(() => {});
}
browser.runtime.onMessage.addListener((msg, sender) => {
  if (!sender.tab) return;
  if (msg?.ensoPill && sender.url === browser.runtime.getURL("pill.html")) {
    if (msg.ensoPill === "ready") browser.tabs.sendMessage(sender.tab.id, { enso: true, action: "pill_ready", args: {} }, { frameId: 0 }).catch(() => {});
    if (msg.ensoPill === "click") pillClicked(sender.tab, !!msg.opened);
  } else if (msg?.ensoPillFallback && sender.frameId === 0) {
    // Not a user action as far as Firefox is concerned, so open() is usually refused; then focus or hint.
    let opening;
    try {
      opening = browser.sidebarAction.open();
    } catch (err) {
      opening = Promise.reject(err);
    }
    opening.then(() => pillClicked(sender.tab, true), () => pillClicked(sender.tab, false));
  }
});

// ---------- screenshots to agents ("Send screenshot", ⌘⇧2) ----------
// Captures the visible area, a dragged region (pageagent.js "region_select") or the
// full page (Firefox's captureTab takes a rect in page coordinates, beyond the
// viewport), then hands the image to Ensō's UI, which shows the send sheet. The
// helper sends it on (lib/screenshots.mjs); nothing is captured on private sites.

const MAX_SHOT_SIDE = 16_384; // px of the captured image
const MAX_SHOT_PIXELS = 36_000_000;
let capturingTab = null; // tab showing the region overlay; Ensō's pages forward Enter/F/Esc to it
let pendingCapture = null; // a capture made while no Ensō page was open (the shortcut opens the sidebar)

function consoleErrorsOf(tabId) {
  const buf = consoleTabs.get(tabId);
  if (!buf) return null; // console capture never ran on this tab
  return buf.entries.filter(e => e.level === "error").slice(-20).map(e => ({ t: e.t, text: String(e.text ?? "").slice(0, 600), source: e.source ?? "" }));
}

async function captureScreenshot(mode = "region") {
  const tab = await activeTab();
  if (!tab || !isWeb(tab.url)) throw new Error("Open a web page to take a screenshot of it.");
  if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health, tax or similar); screenshots are off here.");
  if (tab.discarded) throw new Error("This tab is unloaded; open it first.");
  let rect = null;
  let scale = 1;
  if (mode === "region") {
    capturingTab = tab.id;
    broadcast({ type: "capture.active", on: true });
    let sel;
    try {
      sel = await agent(tab.id, "region_select", {});
    } finally {
      capturingTab = null;
      broadcast({ type: "capture.active", on: false });
    }
    if (sel?.cancelled) return { cancelled: true };
    mode = sel?.mode ?? "visible";
    if (mode === "region") rect = sel.rect;
  }
  if (mode === "full") {
    const size = await agent(tab.id, "page_size", {});
    const w = Math.min(size.width, MAX_SHOT_SIDE);
    const h = Math.min(size.height, MAX_SHOT_SIDE * 4);
    rect = { x: 0, y: 0, width: w, height: h };
    const dpr = size.dpr || 1;
    scale = Math.min(1, MAX_SHOT_SIDE / (h * dpr), Math.sqrt(MAX_SHOT_PIXELS / (w * h * dpr * dpr))) || 1;
  }
  const opts = { format: "png", ...(rect ? { rect } : {}), ...(scale < 1 ? { scale } : {}) };
  let image = await browser.tabs.captureTab(tab.id, opts);
  // T3 takes images up to 10 MB: a huge PNG goes as JPEG instead.
  if (image.length * 0.75 > 9_500_000) image = await browser.tabs.captureTab(tab.id, { ...opts, format: "jpeg", quality: 88 });
  return { image, mode, tab: tabInfo(tab), consoleErrors: consoleErrorsOf(tab.id), at: Date.now() };
}

async function screenshotFor(port, mode) {
  let msg;
  try {
    msg = { type: "screenshot.captured", ...(await captureScreenshot(mode)) };
  } catch (err) {
    msg = { type: "screenshot.captured", error: String(err.message ?? err) };
  }
  if (port) return port.postMessage(msg);
  // The shortcut: the sidebar shows the send sheet (it may still be opening).
  const sidebars = [...uis].filter(p => String(p.sender?.url ?? "").includes("/sidebar.html"));
  if (sidebars.length) for (const p of sidebars) p.postMessage(msg);
  else pendingCapture = msg; // it gets it when it connects
}

browser.commands.onCommand.addListener(command => {
  if (command !== "send-screenshot") return;
  // open() must run in the user-input handler, before anything is awaited.
  try {
    browser.sidebarAction.open().catch(() => {});
  } catch {}
  screenshotFor(null, "region");
});

browser.tabs.onRemoved.addListener(tabId => native?.postMessage({ type: "send.tab_closed", tabId })); // tab → thread links end with the tab

// ---------- the helper connection ----------

function broadcast(msg) {
  for (const port of uis) {
    try {
      port.postMessage(msg);
    } catch {}
  }
}

// Helper state for the UIs (`helper.status`, docs/PROTOCOL.md): connecting |
// connected | missing (no native-messaging manifest: install.sh hasn't run) |
// failed (the manifest is there but the helper exited before saying anything) |
// stopped (it ran, then went away) | restarting (it said it would, after an update).
// While it isn't connected, connecting is retried: every 2 s while an Ensō page
// is open (so the first-run guide moves on by itself once install.sh is done),
// slower otherwise. Zen reads the manifest on every connectNative call, so no
// restart is needed after installing.
// For Copy diagnostics the status also carries `lastError` ({ message, state, at,
// ranMs }: the last time the port closed with or without a reason, kept after a
// reconnect), `failures` (attempts in a row that failed or crashed soon after
// starting) and `connectedAt`.
let helper = { state: "connecting", reason: null, at: Date.now(), lastError: null, failures: 0, connectedAt: null };
let helperGotMessage = false;
let helperRetryTimer = null;
let helperFailures = 0;
let helperRestarting = false;
let helperConnectedAt = 0;

function setHelper(state, reason = null, lastError = helper.lastError) {
  helper = { state, reason, at: Date.now(), lastError, failures: helperFailures, connectedAt: helperConnectedAt || null };
  broadcast({ type: "helper.status", ...helper });
}

function scheduleHelperRetry(now = false) {
  clearTimeout(helperRetryTimer);
  const open = uis.size > 0;
  const delay = now ? 0
    : helper.state === "restarting" || helper.state === "stopped" ? Math.min(30_000, 500 * 2 ** helperFailures)
    : helper.state === "missing" ? (open ? 2000 : 60_000)
    : open ? Math.min(30_000, 2000 * 2 ** Math.min(helperFailures, 4)) : 5 * 60_000;
  helperRetryTimer = setTimeout(() => {
    helperRetryTimer = null;
    if (!native) connectNative();
  }, delay);
}

function connectNative() {
  if (native) return native;
  helperGotMessage = false;
  try {
    native = browser.runtime.connectNative(HOST);
  } catch (err) {
    native = null;
    const message = String(err?.message ?? err);
    setHelper("missing", message, { message, state: "missing", at: Date.now(), ranMs: 0 });
    scheduleHelperRetry();
    return null;
  }
  native.onMessage.addListener(async msg => {
    if (!helperGotMessage) {
      helperGotMessage = true;
      helperConnectedAt = Date.now();
      helperRestarting = false;
      setHelper("connected");
    }
    if (msg.type === "helper.restarting") helperRestarting = true;
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
    if ((msg.type === "state" || msg.type === "settings") && msg.settings) {
      const on = msg.settings.agentTitlePrefix !== false;
      if (on !== titlePrefixOn) {
        titlePrefixOn = on;
        presenceSent.clear();
        syncPresence();
      }
    }
    if (msg.type === "agents" || (msg.type === "state" && Array.isArray(msg.agents))) {
      agentSessions = (msg.type === "agents" ? msg.sessions : msg.agents) ?? [];
      syncPresence();
    }
    if ((msg.type === "state" || msg.type === "spaces") && Array.isArray(msg.spaces)) {
      spaces = msg.spaces;
      pushCurrentPage();
    }
    broadcast(msg);
  });
  native.onDisconnect.addListener(port => {
    // Why the port closed: Firefox puts it on port.error (older versions: runtime.lastError).
    const reason = port.error?.message || browser.runtime.lastError?.message || null;
    const wasUp = helperGotMessage;
    native = null;
    // Back off when it keeps failing, or keeps crashing soon after starting.
    helperFailures = wasUp && Date.now() - helperConnectedAt > 30_000 ? 0 : helperFailures + 1;
    const state = /no such native application/i.test(reason ?? "") ? "missing" : helperRestarting ? "restarting" : wasUp ? "stopped" : "failed";
    if (state === "restarting") helperFailures = 0;
    const lastError = state === "restarting" ? helper.lastError : { message: reason, state, at: Date.now(), ranMs: wasUp ? Date.now() - helperConnectedAt : 0 };
    if (state === "missing") setHelper("missing", reason, lastError);
    else if (state === "restarting") setHelper("restarting", null, lastError);
    else if (state === "stopped") {
      setHelper("stopped", reason ?? "the helper stopped", lastError);
      broadcast({ type: "event", conversationId: null, event: { kind: "error", code: "host_disconnected", text: `Lost Ensō's helper${reason ? `: ${reason}` : ""}. Reconnecting by itself…` } });
    } else setHelper("failed", reason ?? "the helper exited as soon as it started", lastError);
    scheduleHelperRetry();
  });
  // Space detection must work with no Ensō page open (e.g. Claude Code calling over MCP).
  native.postMessage({ type: "spaces.list" });
  return native;
}

async function forward(msg) {
  const host = connectNative();
  if (!host) return;
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
  // Only Ensō's own pages: notes to agents and Pause/Stop must never come from page content.
  if (!String(port.sender?.url ?? "").startsWith(browser.runtime.getURL(""))) return void port.disconnect();
  uis.add(port);
  port.onDisconnect.addListener(() => uis.delete(port));
  port.postMessage({ type: "helper.status", ...helper });
  if (!connectNative()) scheduleHelperRetry();
  else if (helper.state !== "connected" && helperRetryTimer) scheduleHelperRetry(); // a page is open now: retry at the faster pace
  pushCurrentPage(port);
  port.postMessage({ type: "agents", sessions: agentSessions });
  if (pendingCapture && String(port.sender?.url ?? "").includes("/sidebar.html")) {
    if (Date.now() - (pendingCapture.at ?? Date.now()) < 60_000) port.postMessage(pendingCapture);
    pendingCapture = null;
  }
  port.onMessage.addListener(async msg => {
    if (msg.type === "screenshot.capture") return screenshotFor(port, msg.mode);
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
    if (msg.type === "helper.retry") {
      if (native && helper.state === "connected") port.postMessage({ type: "helper.status", ...helper });
      else scheduleHelperRetry(true);
      return;
    }
    if (msg.type === "console.start") {
      const tab = await browser.tabs.get(Number(msg.tabId)).catch(() => null);
      if (!tab || !isWeb(tab.url) || isSensitive(tab.url)) return;
      if (msg.always) {
        const h = hostOfUrl(tab.url);
        if (h) { consoleHosts.add(h); browser.storage.local.set({ consoleHosts: [...consoleHosts] }).catch(() => {}); }
      }
      await startConsole(tab.id, tab.url);
      return;
    }
    if (msg.type === "capture.key") {
      if (capturingTab != null) agent(capturingTab, "region_key", { key: msg.key }).catch(() => {});
      return;
    }
    if (msg.type === "agents.switch") {
      // Agents list: go to the tab an agent works in (in whatever space it is).
      const t = await browser.tabs.get(Number(msg.tabId)).catch(() => null);
      if (t) {
        await browser.tabs.update(t.id, { active: true }).catch(() => {});
        await browser.windows.update(t.windowId, { focused: true }).catch(() => {});
      }
      return;
    }
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
    // Load the replacement in the background, right after the original, and
    // switch only once it has drawn: switching to a tab that is still blank is
    // what showed as a white flash between two drawings of the page.
    const created = await browser.tabs.create({ url: `${NEWTAB}#f`, index: tab.index + 1, active: false, windowId: tab.windowId, ...(tab.cookieStoreId ? { cookieStoreId: tab.cookieStoreId } : {}) });
    ours.add(created.id);
    fresh.delete(created.id);
    await loaded(created.id, 1500);
    const still = await browser.tabs.get(tabId).catch(() => null);
    if (!still?.active || !isNewTabUrl(still.url)) {
      // The user already moved on (typed in the address bar, switched tabs): keep their tab.
      await browser.tabs.remove(created.id).catch(() => {});
      return;
    }
    await browser.tabs.update(created.id, { active: true });
    await browser.tabs.remove(tabId);
  } catch {
  } finally {
    swapping = false;
  }
}

/** Resolves when the tab has finished loading, or after `ms`. */
function loaded(tabId, ms) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (done) return; done = true; browser.tabs.onUpdated.removeListener(onUpd); clearTimeout(timer); resolve(); };
    const onUpd = (id, info) => { if (id === tabId && info.status === "complete") finish(); };
    const timer = setTimeout(finish, ms);
    browser.tabs.onUpdated.addListener(onUpd);
    browser.tabs.get(tabId).then(t => { if (t?.status === "complete") finish(); }).catch(finish);
  });
}

// Off by default: the swap opens a second tab and closes the first, which Zen
// shows as an extra tab appearing and vanishing. Settings can turn it on
// (storage.local newTabFocus) for people who prefer typing straight into Ensō.
let newTabFocus = false;
browser.storage.local.get("newTabFocus").then(r => { newTabFocus = r.newTabFocus === true; }).catch(() => {});
browser.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.newTabFocus) newTabFocus = changes.newTabFocus.newValue === true; });

browser.tabs.onCreated.addListener(tab => {
  if (!newTabFocus) return;
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
