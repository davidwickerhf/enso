// Connection to the rest of Ensō.
// In the extension: a long-lived port to background.js ({ name: "ui" }), which
// relays to the native host. Outside the extension (a plain http server during
// development) it falls back to ui/mock.js, an in-page fake host.

const ext = globalThis.browser?.runtime?.connect ? globalThis.browser : null;

/**
 * connect({ onMessage, onStatus }) → { kind, send(msg) }
 * onStatus("connected" | "reconnecting") lets the UI show a banner.
 */
export async function connect({ onMessage, onStatus }) {
  if (!ext) {
    const { createMockHost } = await import("./mock.js");
    const host = createMockHost();
    host.onMessage(msg => onMessage(msg));
    onStatus?.("connected");
    return { kind: "mock", send: msg => host.postMessage(msg) };
  }

  let port = null;
  let retry = 0;
  const queue = [];

  function open() {
    port = ext.runtime.connect({ name: "ui" });
    port.onMessage.addListener(msg => {
      retry = 0;
      onMessage(msg);
    });
    port.onDisconnect.addListener(() => {
      port = null;
      onStatus?.("reconnecting");
      const delay = Math.min(8000, 500 * 2 ** retry++);
      setTimeout(() => {
        open();
        port.postMessage({ type: "hello" });
      }, delay);
    });
    onStatus?.("connected");
    while (queue.length) port.postMessage(queue.shift());
  }
  open();

  return {
    kind: "extension",
    send(msg) {
      if (port) port.postMessage(msg);
      else queue.push(msg);
    },
  };
}

/** Open the pinned full-page app (no host message). No-op in the mock. */
export function openFullPage(hash = "") {
  if (ext?.tabs?.create) ext.tabs.create({ url: ext.runtime.getURL(`full.html${hash}`) });
}

/** Open a conversation in the full-page app (used by report pages). */
export function openConversation(id) {
  const hash = `#conversation=${encodeURIComponent(id)}`;
  if (ext?.tabs?.create) ext.tabs.create({ url: ext.runtime.getURL(`full.html${hash}`) });
  else location.href = `full.html${hash}`;
}

/** Open a report in a new tab (in the mock: this tab, so it stays testable). */
export function openReport(id) {
  const path = `report.html?id=${encodeURIComponent(id)}`;
  if (ext?.tabs?.create) ext.tabs.create({ url: ext.runtime.getURL(path) });
  else location.href = path;
}

export const inExtension = !!ext;

/**
 * Browser APIs for the new-tab search box, used directly from the page:
 * { tabs(), bookmarks(q), history(q), open(url), search(query), switchTo(tabId, windowId) }.
 * Outside the extension it's the mock's fake browser.
 */
let browserApi = null;
export async function getBrowserApi() {
  if (browserApi) return browserApi;
  if (!ext) {
    const { mockBrowser } = await import("./mock.js");
    return (browserApi = mockBrowser);
  }
  const self = await ext.tabs.getCurrent?.().catch(() => null);
  browserApi = {
    async tabs() {
      const tabs = await ext.tabs.query({});
      return tabs.filter(t => t.id !== self?.id && /^https?:/.test(t.url ?? "")).map(t => ({ tabId: t.id, windowId: t.windowId, title: t.title, url: t.url, favIconUrl: t.favIconUrl }));
    },
    async bookmarks(q) {
      if (!ext.bookmarks?.search) return [];
      return (await ext.bookmarks.search(q)).filter(b => b.url).slice(0, 8).map(b => ({ title: b.title, url: b.url }));
    },
    async history(q) {
      if (!ext.history?.search) return [];
      const items = await ext.history.search({ text: q, maxResults: 40, startTime: 0 });
      // Skip search-results pages (they'd only repeat old queries with huge URLs), keep one entry per page.
      const isSearchPage = u => /^https?:\/\/([^/]*\.)?(google\.[a-z.]+\/search|bing\.com\/search|duckduckgo\.com\/\?|search\.brave\.com\/search|ecosia\.org\/search|kagi\.com\/search|startpage\.com\/)/i.test(u);
      const seen = new Set();
      return items
        .filter(i => !isSearchPage(i.url))
        .filter(i => { const k = i.url.replace(/[?#].*$/, ""); if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0))
        .slice(0, 12)
        .map(i => ({ title: i.title, url: i.url, visitCount: i.visitCount }));
    },
    async engine() {
      if (!ext.search?.get) return null;
      const engines = await ext.search.get();
      return engines.find(e => e.isDefault)?.name ?? null;
    },
    async suggestions(q, kind, signal) {
      const url = kind === "google"
        ? `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`
        : `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`;
      const res = await fetch(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
      const data = await res.json();
      return (Array.isArray(data?.[1]) ? data[1] : []).filter(x => typeof x === "string").slice(0, 6);
    },
    async open(url) {
      if (self?.id != null) await ext.tabs.update(self.id, { url });
      else location.href = url;
    },
    async search(query) {
      if (ext.search?.search) await ext.search.search({ query, ...(self?.id != null && { tabId: self.id }) });
      else await this.open(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`);
    },
    async switchTo(tabId, windowId) {
      await ext.tabs.update(tabId, { active: true });
      if (windowId != null && ext.windows?.update) await ext.windows.update(windowId, { focused: true });
    },
  };
  return browserApi;
}
