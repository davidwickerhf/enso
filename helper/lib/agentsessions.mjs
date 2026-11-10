// Live sessions of external agents (Claude Code, Codex, Cursor…) acting in Zen
// through the zen-browser MCP server, and the user's steering of them from
// Ensō: notes, Pause/Resume and Stop.
//
// A session is one agent on one tab: (client key, tabId). The client key is
// the launcher's per-process id (X-Enso-Session), else the client's label and
// name for plain http clients. A session starts with the first call on a tab
// (or with session_start) and ends after IDLE_MS without calls, or on
// session_end. Everything is in memory only; nothing here is written to disk.
//
// Steering rides on the agent's own tool calls, since MCP can't push into the
// agent's conversation:
//   - notes are prepended to the next tool result of that client (exactly once);
//   - Pause refuses the client's calls on that tab (and its tab-less actions)
//     until Resume; the first call after Resume carries a hand-back note;
//   - Stop refuses every further call of that client (STOP_TTL_MS).
//
// Typed text is never kept in full: page_type records at most 40 characters,
// and nothing typed into a password field.

import { randomBytes } from "node:crypto";

export const IDLE_MS = 120_000;
export const PAUSED_TTL_MS = 30 * 60_000;
export const STOP_TTL_MS = 30 * 60_000;
const MAX_ACTIONS = 30;
const MAX_NOTES = 20;
export const MAX_NOTE_CHARS = 1000;
export const MAX_TASK_CHARS = 200;

export const NOTE_PREFIX = "Message from the user (via Ensō):";
export const PAUSED_TEXT = "The user paused you on this tab. Wait, then call session_status or retry later; don't work around it (no other tabs, no other tools for this step).";
export const STOPPED_TEXT = "The user stopped this task in Ensō. Don't continue in the browser; tell the user you stopped.";
export const HAND_BACK_TEXT = "Note from Ensō: the user paused you and has now resumed. They may have changed the page meanwhile; call page_read again before your next action.";

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Stable key for "the same agent": launcher session id, else label + raw name. */
export function clientKey(client = {}) {
  return client.session ? `s:${client.session}` : `c:${client.label ?? ""}|${client.name ?? ""}`;
}

/** What to show for typed text: a short preview, or a mask for password fields. */
export function maskTyped(text, target = "") {
  if (/^password\b|password/i.test(String(target))) return "••••••";
  const t = clean(text, 400);
  if (!t) return "";
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
}

/**
 * createAgentSessions({ now, onChange }) → registry. `onChange(list)` is called
 * (coalesced) whenever the visible state changes.
 */
export function createAgentSessions({ now = Date.now, onChange = () => {}, idleMs = IDLE_MS, timers = true } = {}) {
  const sessions = new Map(); // `${key}#${tabId ?? "-"}` -> session
  const stopped = new Map(); // client key -> stoppedAt
  const tasks = new Map(); // client key -> task (from session_start), applies to new tabs too
  const listeners = new Set([onChange]);
  let scheduled = false;

  const changed = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const l = list();
      for (const fn of listeners) {
        try {
          fn(l);
        } catch {}
      }
    });
  };

  const sid = () => randomBytes(6).toString("hex");
  const slot = (key, tabId) => `${key}#${tabId ?? "-"}`;
  const ofClient = key => [...sessions.values()].filter(s => s.key === key && !s.ended);

  function isStopped(key) {
    const at = stopped.get(key);
    if (at == null) return false;
    if (now() - at > STOP_TTL_MS) {
      stopped.delete(key);
      return false;
    }
    return true;
  }

  /** The session of this client on this tab, created when missing. Tab-less calls use the latest tab session. */
  function ensure(client, tabId, { url, title } = {}) {
    const key = clientKey(client);
    if (tabId == null) {
      const latest = ofClient(key).sort((a, b) => b.lastAt - a.lastAt)[0];
      if (latest) return latest;
    }
    let s = sessions.get(slot(key, tabId));
    if (s && s.ended) s = null;
    if (!s) {
      const t = now();
      s = { id: sid(), key, client: client.label ?? "An MCP client", clientName: client.name ?? "", via: client.via ?? "http", task: tasks.get(key) ?? "", tabId: tabId ?? null, url: url ?? "", title: title ?? "", startedAt: t, lastAt: t, running: 0, paused: false, pausedAt: null, stopped: isStopped(key), handBack: false, actions: [], notes: [], ended: false, explicit: false };
      // A tab-less session (tabs_list, GitHub…) folds into the first tab session.
      const loose = tabId != null ? sessions.get(slot(key, null)) : null;
      if (loose && !loose.ended) {
        s.actions = loose.actions;
        s.notes = loose.notes;
        s.startedAt = loose.startedAt;
        s.task ||= loose.task;
        s.explicit = loose.explicit;
        sessions.delete(slot(key, null));
      }
      sessions.set(slot(key, tabId), s);
    }
    if (url) s.url = url;
    if (title) s.title = title;
    return s;
  }

  /** Notes waiting for this client, and the hand-back note; marks them delivered. */
  function collect(key, tabId) {
    const out = [];
    const at = now();
    for (const s of ofClient(key)) {
      if (s.handBack && (tabId == null || s.tabId === tabId || s.tabId == null)) {
        out.push(HAND_BACK_TEXT);
        s.handBack = false;
      }
      for (const n of s.notes) {
        if (n.deliveredAt) continue;
        n.deliveredAt = new Date(at).toISOString();
        out.push(`${NOTE_PREFIX} ${n.text}`);
      }
    }
    if (out.length) changed();
    return out;
  }

  const api = {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * Before a tool runs. { tool, kind, tabId } → { refuse?: text, messages: [text] }.
     * Notes are collected here, so a refused call still carries them.
     */
    before(client, { tool, kind = "act", tabId = null }) {
      const key = clientKey(client);
      if (tool === "session_status") return { messages: [] };
      if (isStopped(key)) return { refuse: STOPPED_TEXT, messages: collect(key, tabId) };
      const paused = ofClient(key).filter(s => s.paused);
      if (paused.length) {
        // Calls on a paused tab are refused; so are actions without a tab (tabs_close, GitHub writes…).
        const onPausedTab = tabId != null && paused.some(s => s.tabId === tabId);
        const tabLessAct = tabId == null && kind !== "read";
        if (onPausedTab || tabLessAct) return { refuse: PAUSED_TEXT, messages: collect(key, tabId) };
      }
      return { messages: collect(key, tabId) };
    },

    /** A tool starts running: the session shows as live. Returns a handle for finish(). */
    begin(client, { tool, title, tabId = null, url, pageTitle }) {
      const s = ensure(client, tabId, { url, title: pageTitle });
      s.running++;
      s.lastAt = now();
      changed();
      return { s, tool, title };
    },

    /** A tool finished. entry: { ok, target, url, pageTitle, error, irreversible, typed } */
    finish(handle, entry = {}) {
      const { s, tool, title } = handle;
      s.running = Math.max(0, s.running - 1);
      s.lastAt = now();
      if (entry.url) s.url = entry.url;
      if (entry.pageTitle) s.title = entry.pageTitle;
      const action = {
        id: sid(),
        at: new Date(s.lastAt).toISOString(),
        tool,
        title: title ?? tool,
        target: clean(entry.target, 160),
        ok: entry.ok !== false,
        irreversible: !!entry.irreversible,
      };
      if (entry.typed != null) action.typed = maskTyped(entry.typed, entry.target);
      if (entry.ok === false && entry.error) action.error = clean(entry.error, 200);
      if (entry.refused) action.refused = true;
      s.actions.push(action);
      if (s.actions.length > MAX_ACTIONS) s.actions.splice(0, s.actions.length - MAX_ACTIONS);
      changed();
      return action;
    },

    /** session_start: the agent says what it is doing. */
    start(client, { task, tabId = null, url, title }) {
      const key = clientKey(client);
      const t = clean(task, MAX_TASK_CHARS);
      if (t) tasks.set(key, t);
      for (const s of ofClient(key)) if (t) s.task = t;
      const s = ensure(client, tabId, { url, title });
      if (t) s.task = t;
      s.explicit = true;
      s.lastAt = now();
      changed();
      return s;
    },

    /** session_end from the agent: end its sessions (one tab, or all). */
    endClient(client, { tabId = null } = {}) {
      const key = clientKey(client);
      let n = 0;
      for (const s of ofClient(key)) {
        if (tabId != null && s.tabId !== tabId) continue;
        s.ended = true;
        n++;
      }
      if (tabId == null) tasks.delete(key);
      for (const [k, s] of sessions) if (s.ended) sessions.delete(k);
      changed();
      return n;
    },

    status(client, { tabId = null } = {}) {
      const key = clientKey(client);
      const mine = ofClient(key);
      const onTab = tabId != null ? mine.find(s => s.tabId === tabId) : null;
      return {
        stopped: isStopped(key),
        paused: onTab ? onTab.paused : mine.some(s => s.paused),
        pausedTabs: mine.filter(s => s.paused).map(s => s.tabId),
        task: tasks.get(key) ?? onTab?.task ?? mine[0]?.task ?? "",
        sessions: mine.length,
        messages: collect(key, tabId),
      };
    },

    // ---- from the user (Ensō UI) ----

    pause(id) {
      const s = api.get(id);
      if (!s || s.paused) return !!s;
      s.paused = true;
      s.pausedAt = now();
      s.handBack = false;
      changed();
      return true;
    },
    resume(id) {
      const s = api.get(id);
      if (!s || !s.paused) return !!s;
      s.paused = false;
      s.pausedAt = null;
      s.handBack = true;
      s.lastAt = now(); // a fresh idle window
      changed();
      return true;
    },
    stop(id) {
      const s = api.get(id);
      if (!s) return false;
      stopped.set(s.key, now());
      for (const x of ofClient(s.key)) {
        x.stopped = true;
        x.paused = false;
        x.lastAt = now();
      }
      changed();
      return true;
    },
    note(id, text) {
      const s = api.get(id);
      const t = clean(text, MAX_NOTE_CHARS);
      if (!s || !t) return null;
      const note = { id: sid(), text: t, at: new Date(now()).toISOString(), deliveredAt: null };
      s.notes.push(note);
      if (s.notes.length > MAX_NOTES) s.notes.splice(0, s.notes.length - MAX_NOTES);
      changed();
      return note;
    },
    /** The user dismissed a session's card (Stop already refused it, or it is idle). */
    dismiss(id) {
      const s = api.get(id);
      if (!s) return false;
      s.ended = true;
      sessions.delete(slot(s.key, s.tabId));
      changed();
      return true;
    },

    /** The live session of this client on this tab (or its latest one for tab-less calls), without creating one. */
    peek(client, tabId = null) {
      const key = clientKey(client);
      if (tabId == null) return ofClient(key).sort((a, b) => b.lastAt - a.lastAt)[0] ?? null;
      const s = sessions.get(slot(key, tabId));
      return s && !s.ended ? s : null;
    },

    get(id) {
      for (const s of sessions.values()) if (s.id === id && !s.ended) return s;
      return null;
    },

    /** End idle sessions. Paused ones wait up to PAUSED_TTL_MS. */
    sweep() {
      const t = now();
      let any = false;
      for (const [k, s] of sessions) {
        const limit = s.paused ? PAUSED_TTL_MS : idleMs;
        if (s.running === 0 && t - (s.pausedAt ?? s.lastAt) > limit) {
          s.ended = true;
          sessions.delete(k);
          any = true;
        }
      }
      for (const [k, at] of stopped) if (t - at > STOP_TTL_MS) stopped.delete(k);
      if (any) changed();
      return any;
    },

    list,
  };

  /** What the UI gets (no client keys: those are session ids of other processes). */
  function list() {
    const t = now();
    return [...sessions.values()]
      .filter(s => !s.ended)
      .sort((a, b) => b.lastAt - a.lastAt)
      .map(s => ({
        id: s.id,
        client: s.client,
        clientName: s.clientName,
        task: s.task,
        tabId: s.tabId,
        url: s.url,
        title: s.title,
        startedAt: new Date(s.startedAt).toISOString(),
        lastAt: new Date(s.lastAt).toISOString(),
        endsAt: new Date((s.paused ? s.pausedAt + PAUSED_TTL_MS : s.lastAt + idleMs)).toISOString(),
        running: s.running > 0,
        paused: s.paused,
        stopped: s.stopped || isStopped(s.key),
        explicit: s.explicit,
        idleMs: t - s.lastAt,
        actions: s.actions.slice(-MAX_ACTIONS),
        notes: s.notes.map(n => ({ ...n })),
      }));
  }

  if (timers) {
    const timer = setInterval(() => api.sweep(), 10_000);
    timer.unref?.();
  }
  return api;
}
