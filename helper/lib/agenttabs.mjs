// Tabs external agents opened (tabs_open), and what happens to them when the
// agent goes away, so the user doesn't end up with tabs that look AI-managed
// forever.
//
//   - tabs_open marks each new tab "opened by <client> for <task>" (the agent's
//     key, task, space, URL, container);
//   - the user activating, clicking or typing in the tab makes it theirs: the
//     mark is dropped and Ensō never closes it (background.js reports it);
//   - when the agent has no live session left (session_end, Stop, the idle
//     timeout), its marked tabs become leftovers, and settings.agentLeftoverTabs
//     decides: "close" (default) closes them after LEFTOVER_CLOSE_MS without the
//     agent using them, if background.js finds them untouched, not active, not
//     pinned and not in a group the user made; "ask" lists them in the sidebar
//     ("Tabs agents left open") until the user closes or keeps them; "keep"
//     drops the mark and leaves them open;
//   - a tab Ensō closes goes to "Recently closed by Ensō" (with Reopen).
//
// Kept in the helper's memory: when the helper restarts (Zen restarts), tab
// ids may have been reused, so the marks start over rather than risk closing
// an unrelated tab.

export const LEFTOVER_CLOSE_MS = 30 * 60_000;
export const LEFTOVER_MODES = ["close", "ask", "keep"];
const MAX_CLOSED = 20;
const CLOSED_TTL_MS = 24 * 60 * 60_000;

/**
 * `isLive(key)`: whether the agent with that key still has a live session.
 * `closeTabs(tabs, { force })` asks background.js to close tabs → [{ tabId, closed, gone, skipped, url, title, cookieStoreId }].
 * `mode()`: settings.agentLeftoverTabs.
 */
export function createAgentTabs({ now = Date.now, isLive = () => false, closeTabs = async () => [], mode = () => "close", onChange = () => {}, closeAfterMs = LEFTOVER_CLOSE_MS, timers = true } = {}) {
  const tabs = new Map(); // tabId -> mark
  const groups = new Set(); // tab groups agents made (tabs_group): not "a group the user made"
  let closed = []; // recently closed by Ensō, newest first
  const listeners = new Set([onChange]);
  let closing = false;
  let seq = 0;
  const changed = () => listeners.forEach(fn => {
    try {
      fn();
    } catch {}
  });
  const currentMode = () => (LEFTOVER_MODES.includes(mode()) ? mode() : "close");

  const api = {
    configure(opts) {
      if (opts.closeTabs) closeTabs = opts.closeTabs;
      if (opts.mode) mode = opts.mode;
      if (opts.isLive) isLive = opts.isLive;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** tabs_open by an agent: owner { key, client, clientName, task, space }, opened [{ tabId, url, cookieStoreId? }]. */
    opened(owner, opened) {
      const t = now();
      for (const o of opened ?? []) {
        if (!Number.isInteger(o?.tabId)) continue;
        tabs.set(o.tabId, { tabId: o.tabId, url: String(o.url ?? ""), title: "", cookieStoreId: o.cookieStoreId ?? null, key: owner.key, client: owner.client ?? "An agent", clientName: owner.clientName ?? "", task: owner.task ?? "", space: owner.space ?? null, openedAt: t, usedAt: t, leftoverAt: null });
      }
      changed();
    },
    /** The agent acted on or read one of its tabs. */
    used(tabId, { url, title } = {}) {
      const m = tabs.get(tabId);
      if (!m) return;
      m.usedAt = now();
      if (url) m.url = url;
      if (title) m.title = title;
      if (m.leftoverAt != null && isLive(m.key)) m.leftoverAt = null;
    },
    /** The user activated, clicked or typed in it: it's theirs now. */
    touched(tabId) {
      if (tabs.delete(tabId)) changed();
    },
    /** Closed (by anyone). */
    removed(tabId) {
      if (tabs.delete(tabId)) changed();
    },
    /** "Keep" in the sidebar: the leftovers stay open, unmarked. */
    keep(tabIds = null) {
      let any = false;
      for (const [id, m] of tabs) if ((tabIds == null ? m.leftoverAt != null : tabIds.includes(id)) && tabs.delete(id)) any = true;
      if (any) changed();
    },
    group(groupId) {
      if (Number.isInteger(groupId) && groupId > -1) groups.add(groupId);
    },
    isMarked: tabId => tabs.has(tabId),
    mark: tabId => tabs.get(tabId) ?? null,

    /** Leftovers become due, get closed, or lose their mark, by mode. */
    async tick() {
      const t = now();
      let any = false;
      for (const m of tabs.values()) {
        const live = isLive(m.key);
        if (!live && m.leftoverAt == null) {
          m.leftoverAt = t;
          any = true;
        } else if (live && m.leftoverAt != null) {
          m.leftoverAt = null;
          any = true;
        }
      }
      const prune = closed.filter(c => t - c.closedAt < CLOSED_TTL_MS);
      if (prune.length !== closed.length) {
        closed = prune;
        any = true;
      }
      const m = currentMode();
      if (m === "keep") {
        for (const [id, x] of tabs) if (x.leftoverAt != null && tabs.delete(id)) any = true;
      } else if (m === "close" && !closing) {
        const due = [...tabs.values()].filter(x => x.leftoverAt != null && t - Math.max(x.leftoverAt, x.usedAt) >= closeAfterMs);
        if (due.length) {
          closing = true;
          try {
            await api.close(due.map(x => x.tabId), { force: false });
          } finally {
            closing = false;
          }
          any = false; // close() announced it
        }
      }
      if (any) changed();
    },

    /**
     * Close marked tabs: the user's "Close all" / ✕ (force: they asked, so the
     * active/pinned/group checks don't apply), or the timer (force false).
     */
    async close(tabIds, { force = true } = {}) {
      const list = tabIds.map(id => tabs.get(id)).filter(Boolean);
      if (!list.length) return [];
      let results = [];
      try {
        results = (await closeTabs(list.map(x => ({ tabId: x.tabId, url: x.url })), { force, agentGroups: [...groups] })) ?? [];
      } catch {
        return [];
      }
      const t = now();
      for (const r of results) {
        const m = tabs.get(r.tabId);
        if (!m) continue;
        if (r.closed) {
          tabs.delete(r.tabId);
          closed.unshift({ id: `cl-${t.toString(36)}-${++seq}`, url: r.url || m.url, title: r.title || m.title, cookieStoreId: r.cookieStoreId ?? m.cookieStoreId, client: m.client, task: m.task, space: m.space, closedAt: t, auto: !force });
        } else if (r.gone || r.touched) tabs.delete(r.tabId);
        else if (r.skipped) m.closeSkipped = r.skipped; // active, pinned or in the user's group: stays listed; the timer tries again later
      }
      closed = closed.slice(0, MAX_CLOSED);
      changed();
      return results;
    },

    /** Reopen: the entry leaves the list; the caller opens its URL. */
    reopen(id) {
      const c = closed.find(x => x.id === id);
      if (!c) return null;
      closed = closed.filter(x => x.id !== id);
      changed();
      return c;
    },

    /** For the UI and background.js. */
    state() {
      const t = now();
      const leftovers = [...tabs.values()]
        .filter(m => m.leftoverAt != null)
        .sort((a, b) => a.leftoverAt - b.leftoverAt)
        .map(m => ({
          tabId: m.tabId,
          url: m.url,
          title: m.title,
          client: m.client,
          task: m.task,
          space: m.space?.name ?? null,
          openedAt: new Date(m.openedAt).toISOString(),
          leftSince: new Date(m.leftoverAt).toISOString(),
          closesAt: currentMode() === "close" ? new Date(Math.max(m.leftoverAt, m.usedAt) + closeAfterMs).toISOString() : null,
          skipped: m.closeSkipped ?? null,
        }));
      return {
        mode: currentMode(),
        marked: [...tabs.keys()],
        leftovers,
        recentlyClosed: closed.map(c => ({ id: c.id, url: c.url, title: c.title, client: c.client, task: c.task, closedAt: new Date(c.closedAt).toISOString(), auto: c.auto })),
        at: new Date(t).toISOString(),
      };
    },
  };

  if (timers) {
    const timer = setInterval(() => api.tick().catch(() => {}), 15_000);
    timer.unref?.();
  }
  return api;
}
