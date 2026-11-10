// Live sessions of external agents (Claude Code, Codex, Cursor…) acting in Zen
// through the zen-browser MCP server, and the user's steering of them from
// Ensō: notes, Pause/Resume and Stop.
//
// A session is one agent on one tab: (client key, tabId). The client key is
// the launcher's per-process id (X-Enso-Session), else the client's label and
// name for plain http clients. A session starts with the first call on a tab
// (or with session_start) and ends after IDLE_MS without calls, or on
// session_end. Everything is in memory only; nothing here is written to disk.
// A session started by a T3 Code agent also knows its T3 thread (t3ThreadId,
// from the launcher's X-Enso-T3-Thread header); it ends with the session.
//
// Steering rides on the agent's own tool calls, since MCP can't push into the
// agent's conversation:
//   - notes are prepended to the next tool result of that client (exactly once);
//   - Pause refuses the client's calls on that tab (and its tab-less actions)
//     until Resume; the first call after Resume carries a hand-back note;
//   - Stop refuses every further call of that client (STOP_TTL_MS).
//
// Screenshots the user sends to an agent (Ensō's "Send screenshot") wait in the
// session's inbox and ride on the next tool result as MCP image content, after
// a "Screenshot from the user (via Ensō): …" line; inbox_read fetches them on
// demand; a Claude Code UserPromptSubmit hook (`enso inbox --session-env`) gets
// them as text with the saved PNG's path, matched by the agent's process id.
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
export const SCREENSHOT_PREFIX = "Screenshot from the user (via Ensō):";
export const AGENT_TTL_MS = 12 * 3600_000; // a launcher not heard from in 12 h is forgotten
export const MAX_INBOX = 5; // screenshots waiting per session (each up to a few MB in memory)
export const PAUSED_TEXT = "The user paused you on this tab. Wait, then call session_status or retry later; don't work around it (no other tabs, no other tools for this step).";
export const STOPPED_TEXT = "The user stopped this task in Ensō. Don't continue in the browser; tell the user you stopped.";
export const HAND_BACK_TEXT = "Note from Ensō: the user paused you and has now resumed. They may have changed the page meanwhile; call page_read again before your next action.";

const clean = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Is this process still running? Unknown pids count as alive. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

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
export function createAgentSessions({ now = Date.now, onChange = () => {}, idleMs = IDLE_MS, timers = true, alive = pidAlive } = {}) {
  const agents = new Map(); // client key -> connected agent (launcher process): inbox, pid, T3 thread
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
      s = { id: sid(), key, client: client.label ?? "An MCP client", clientName: client.name ?? "", via: client.via ?? "http", task: tasks.get(key) ?? "", tabId: tabId ?? null, url: url ?? "", title: title ?? "", startedAt: t, lastAt: t, running: 0, paused: false, pausedAt: null, stopped: isStopped(key), handBack: false, actions: [], notes: [], ended: false, explicit: false, t3ThreadId: client.t3Thread ?? null, agentPid: client.agentPid ?? null };
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
    if (client.t3Thread) s.t3ThreadId = client.t3Thread;
    if (client.agentPid) s.agentPid = client.agentPid;
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
    const ag = agents.get(key);
    if (ag) out.push(...takeInbox(ag, at, "image"));
    if (out.length) changed();
    return out;
  }

  /** Remember an agent process (any request from its launcher), so it can be sent screenshots while idle. */
  function seen(client) {
    if (!client?.session) return null; // only launcher clients have a stable per-process key
    const key = clientKey(client);
    let ag = agents.get(key);
    const fresh = !ag;
    if (!ag) agents.set(key, (ag = { id: `ag-${sid()}`, key, client: client.label ?? "An MCP client", clientName: client.name ?? "", agentPid: null, t3ThreadId: null, firstAt: now(), lastAt: now(), inbox: [] }));
    ag.lastAt = now();
    if (client.label && ag.client === "An MCP client") ag.client = client.label;
    if (client.agentPid) ag.agentPid = client.agentPid;
    if (client.t3Thread) ag.t3ThreadId = client.t3Thread;
    if (fresh) changed();
    return ag;
  }

  /**
   * Undelivered screenshots of a session, marked delivered. as "image": a text
   * line plus MCP image content; as "path": one text line naming the saved PNG.
   */
  function takeInbox(ag, at, as) {
    const out = [];
    for (const item of ag.inbox) {
      if (item.deliveredAt) continue;
      item.deliveredAt = new Date(at).toISOString();
      item.via = as === "image" ? "tool result" : "prompt hook";
      const line = `${SCREENSHOT_PREFIX} ${item.text}`;
      if (as === "image" && item.image) out.push(line, { type: "image", data: item.image.data, mimeType: item.image.mimeType });
      else out.push(`${line}${item.path ? ` Saved at ${item.path} (open it to see the image).` : ""}`);
      item.image = null; // delivered: don't keep the bytes around
    }
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
    /**
     * The user sent a screenshot to this agent session. item: { text, image: { data (base64), mimeType }, path }.
     * Returns the queued entry (without image bytes) or null.
     */
    queue(agentId, item = {}) {
      const ag = [...agents.values()].find(a => a.id === agentId);
      if (!ag || isStopped(ag.key)) return null;
      const entry = { id: sid(), kind: "screenshot", text: clean(item.text, 2000), path: String(item.path ?? ""), image: item.image ?? null, at: new Date(now()).toISOString(), deliveredAt: null };
      ag.inbox.push(entry);
      if (ag.inbox.length > MAX_INBOX) ag.inbox.splice(0, ag.inbox.length - MAX_INBOX);
      changed();
      return { ...entry, image: undefined };
    },

    seen,

    /**
     * Agents connected through the launcher that can be sent screenshots: alive
     * (their process still runs, when known) and seen within AGENT_TTL_MS.
     */
    connected() {
      const t = now();
      return [...agents.values()]
        .filter(a => t - a.lastAt < AGENT_TTL_MS && alive(a.agentPid))
        .sort((a, b) => b.lastAt - a.lastAt)
        .map(a => {
          const live = ofClient(a.key).sort((x, y) => y.lastAt - x.lastAt);
          return { id: a.id, client: a.client, clientName: a.clientName, task: live[0]?.task || tasks.get(a.key) || "", tabIds: live.map(x => x.tabId).filter(x => x != null), sessionIds: live.map(x => x.id), active: live.some(x => x.running > 0) || t - a.lastAt < idleMs, t3ThreadId: a.t3ThreadId, lastAt: new Date(a.lastAt).toISOString(), pending: a.inbox.filter(i => !i.deliveredAt).length, inbox: a.inbox.map(({ image, ...i }) => ({ ...i })) };
        });
    },

    /** inbox_read: everything waiting for this client (notes, screenshots as images), marked delivered. */
    inbox(client, { tabId = null } = {}) {
      return collect(clientKey(client), tabId);
    },

    /**
     * The prompt hook: text for the sessions whose agent process is one of pids
     * (the hook's ancestors) or that run in this T3 thread. Screenshots are named by path.
     */
    takeForAgent({ pids = [], t3Thread = "" } = {}) {
      const want = new Set(pids.map(Number).filter(Number.isInteger));
      const at = now();
      const out = [];
      for (const ag of agents.values()) {
        const mine = (ag.agentPid && want.has(ag.agentPid)) || (t3Thread && ag.t3ThreadId === t3Thread);
        if (!mine) continue;
        for (const s of ofClient(ag.key))
          for (const n of s.notes) {
            if (n.deliveredAt) continue;
            n.deliveredAt = new Date(at).toISOString();
            out.push(`${NOTE_PREFIX} ${n.text}`);
          }
        out.push(...takeInbox(ag, at, "path"));
      }
      if (out.length) changed();
      return out;
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
      for (const [k, a] of agents)
        if (t - a.lastAt > AGENT_TTL_MS || !alive(a.agentPid)) {
          agents.delete(k);
          any = true;
        }
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
        t3ThreadId: s.t3ThreadId ?? null, // the T3 Code thread this agent runs in, when its launcher said so
        agentId: agents.get(s.key)?.id ?? null, // the connected agent (target for screenshots)
      }));
  }

  if (timers) {
    const timer = setInterval(() => api.sweep(), 10_000);
    timer.unref?.();
  }
  return api;
}
