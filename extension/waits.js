// page_wait: wait until a condition holds on a tab, instead of an agent
// polling with page_eval. Polls every 200 ms until the condition holds or
// timeoutMs (default 30 s, max 120 s) runs out, and survives navigations:
//   selector      an element matching `value` is visible (visible:false: present)
//   gone          no element matching `value` is visible (or present) any more
//   text          `value` (or /regex/) is in the page text
//   url           the tab's URL contains `value` (or matches /regex/)
//   network_idle  no request open for idleMs (default 500), page loaded;
//                 websockets, beacons and requests open over 15 s don't count
//   load          the tab finished loading
// selector, gone and text are answered by the page agent (probe), re-injected
// after a navigation; url, load and network_idle here, from the tab and the
// request log background.js keeps (webRequest).
//
// Loaded as a background script before background.js (globalThis.EnsoWaits)
// and by the helper's tests under Node (module.exports).

(function (root) {
  const MAX_WAIT_MS = 120_000; // helper/lib/timeouts.mjs MAX_TIMEOUT_MS
  const POLL_MS = 200;
  const NET_STALE_MS = 15_000;
  const IGNORED_TYPES = new Set(["websocket", "beacon", "ping"]);

  const clampMs = (ms, fallback) => (ms != null && Number.isFinite(Number(ms)) ? Math.min(MAX_WAIT_MS, Math.max(1_000, Number(ms))) : fallback);

  /** A text test: "/regex/flags" or a substring. */
  function matcher(value) {
    const re = /^\/(.+)\/([a-z]*)$/.exec(String(value ?? ""));
    if (re) {
      const rx = new RegExp(re[1], re[2]);
      return t => rx.test(String(t));
    }
    return t => String(t).includes(String(value ?? ""));
  }

  /** Open requests and how long the network has been quiet, from request-log entries { start, status, error, ms, type }. */
  function networkState(entries, since, now) {
    let inflight = 0;
    let last = since;
    for (const e of entries) {
      if (IGNORED_TYPES.has(e.type)) continue;
      const open = e.status == null && !e.error;
      if (open && now - e.start < NET_STALE_MS) inflight++;
      last = Math.max(last, e.start, open ? 0 : e.start + (e.ms ?? 0));
    }
    return { inflight, quietMs: Math.max(0, now - last) };
  }

  /**
   * deps: getTab(tabId) → { url, title, status }, isSensitive(url), probe(tabId, { for, value, visible }) → { met, detail },
   * requests(tabId) → request-log entries, now(), sleep(ms).
   * → waitFor(tabId, { for, value, visible, idleMs, timeoutMs }) → { met, timedOut?, ms, detail, url, title }
   */
  function createWaiter({ getTab, isSensitive = () => false, probe, requests = () => [], now = () => Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
    return async function waitFor(tabId, args = {}) {
      const kind = args.for;
      if (!["selector", "gone", "text", "url", "network_idle", "load"].includes(kind)) throw new Error(`Unknown wait condition ${kind}.`);
      if (["selector", "gone", "text", "url"].includes(kind) && !args.value) throw new Error(`Waiting for "${kind}" needs a value.`);
      const timeoutMs = clampMs(args.timeoutMs, 30_000);
      const idleMs = Math.min(10_000, Math.max(100, Number(args.idleMs) || 500));
      const start = now();
      const matchUrl = kind === "url" ? matcher(args.value) : null;
      let detail = "";
      for (;;) {
        let tab;
        try {
          tab = await getTab(tabId);
        } catch {
          throw new Error("The tab was closed while waiting.");
        }
        if (isSensitive(tab.url)) throw new Error("This is a private page (banking, health, tax or similar); page tools are off here.");
        let met = false;
        if (kind === "url") {
          met = matchUrl(tab.url ?? "");
          detail = `URL is ${tab.url}`;
        } else if (kind === "load") {
          met = tab.status === "complete";
          detail = `tab is ${tab.status ?? "unknown"}`;
        } else if (kind === "network_idle") {
          const n = networkState(requests(tabId), start, now());
          met = n.inflight === 0 && n.quietMs >= idleMs && tab.status === "complete";
          detail = n.inflight ? `${n.inflight} request${n.inflight === 1 ? "" : "s"} still open` : tab.status !== "complete" ? "page still loading" : `no requests for ${n.quietMs} ms`;
        } else {
          try {
            const r = await probe(tabId, { for: kind, value: args.value, visible: args.visible !== false });
            met = !!r?.met;
            detail = r?.detail ?? "";
          } catch (err) {
            if (/private page/.test(String(err?.message))) throw err;
            detail = `page not reachable yet (${String(err?.message ?? err).slice(0, 120)})`;
          }
        }
        const ms = now() - start;
        if (met) return { met: true, ms, detail, url: tab.url, title: tab.title };
        if (ms >= timeoutMs) return { met: false, timedOut: true, ms, detail, url: tab.url, title: tab.title };
        await sleep(Math.min(POLL_MS, Math.max(1, timeoutMs - ms)));
      }
    };
  }

  const api = { createWaiter, networkState, matcher, clampMs, MAX_WAIT_MS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EnsoWaits = api;
})(globalThis);
