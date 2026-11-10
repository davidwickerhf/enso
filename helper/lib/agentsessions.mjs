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
//
// Tab leases keep two agents from acting on one tab at once. The first agent
// session to perform an action on a tab (LEASE_TOOLS: click, type, upload,
// navigate, back, press, select, scroll, eval) holds the tab; every action
// renews it, and it ends with session_end, Stop, the session ending, or
// LEASE_MS without an action (never while the holder runs a tool or is
// paused: a paused agent may be resumed). Another session's actions on that
// tab (and tabs_close of it) are refused with LEASE text naming the holder and
// its task; reads stay open to everyone. The refused session shows as
// "waiting for the tab". The user can hand the tab over to another session or
// let every agent act on it ("shared"). tabs_open by an agent claims the new
// tabs for it. The user's own clicks and typing never take a lease.
//
// Session-access requests: when an agent is refused because a site isn't on
// the user's session-access list (session_fetch, headless_start with sites),
// the tool calls requestAccess() and the refusal says Ensō asked the user. One
// request per agent and origin; Ensō shows it on the page pill of a tab of
// that site and in the sidebar, with Allow / Not now. Only the user's click in
// Ensō's own UI or the pill (host.mjs "access.allow" / "access.dismiss", which
// only background.js can send) resolves it; no MCP tool can. The answer rides
// on the agent's next tool result as a note, like the hand-back. Requests end
// with the agent's sessions (session_end, Stop, idle), or after
// ACCESS_TTL_MS. Private sites never get one (the tools refuse those first).

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
export const HAND_OVER_TEXT = "Note from Ensō: the user handed this tab over to you. Another agent worked on it before; call page_read again before your next action.";
export const LEASE_MS = 90_000;
/** Tools that act on one tab and so need its lease. Reads (page_read, tab_read, screenshots, devtools, page_query, page_inspect, page_wait) don't. */
export const LEASE_TOOLS = new Set(["page_click", "page_type", "page_upload", "page_navigate", "page_back", "page_press", "page_select", "page_scroll", "page_eval"]);
export const SHARED_RISK_TEXT = "Every agent on this tab can act on it at once; they may overwrite or undo each other's changes.";
export const HAND_BACK_TEXT = "Note from Ensō: the user paused you and has now resumed. They may have changed the page meanwhile; call page_read again before your next action.";

export const ACCESS_TTL_MS = 30 * 60_000; // a request nobody answered is dropped after this
export const ACCESS_SHOWN_MS = 15_000; // an answered request stays visible this long, for the "Allowed" state
const MAX_ACCESS = 20;
/** The refusal for a site that isn't on the session-access list; Ensō has asked the user. */
export const accessRequestedText = origin => `${origin} isn't on Ensō's session-access list. Ensō has asked the user to allow it; you'll be told in a later tool result if they do. Don't retry in a loop.`;
/** The refusal after the user chose "Not now" for this site in this task. */
export const accessDeclinedText = origin => `${origin} isn't on Ensō's session-access list, and the user didn't allow it for this task. Don't ask again; continue without it or tell the user what you needed it for.`;
export const accessGrantedNote = origin => `Note from Ensō: The user allowed ${origin} for session access. You can retry.`;
export const accessDismissedNote = origin => `Note from Ensō: The user didn't allow ${origin}; don't ask again in this task.`;

/** The refusal an agent gets when another session holds the tab. */
export function leaseText({ client, task, sameClient }) {
  const who = sameClient ? `another ${client} session` : client;
  return `This tab is being used by ${who}${task ? ` (${task})` : ""}. Open your own tab with tabs_open, use headless_*, or ask the user. The user can hand the tab over to you in Ensō.`;
}

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
  const spaces = new Map(); // client key -> { id, name } (session_start's space): where its tabs open by default
  const leases = new Map(); // tabId -> { key, client, at }: the agent session that may act on the tab
  const sharedTabs = new Set(); // tabIds the user let every agent act on
  const access = new Map(); // request id -> { id, key, client, clientName, sessionId, tabId, origin, tool, at, status, resolvedAt, notified }
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

  /**
   * The live lease on a tab, or null (no side effects: sweep() drops dead ones).
   * Alive while its holder isn't stopped and (runs a tool, is paused, or acted within LEASE_MS).
   */
  function leaseOf(tabId) {
    if (tabId == null) return null;
    const l = leases.get(tabId);
    if (!l || isStopped(l.key)) return null;
    const s = sessions.get(slot(l.key, tabId));
    if (s && !s.ended && (s.running > 0 || s.paused)) return l;
    return now() - l.at <= LEASE_MS ? l : null;
  }

  /** The holder's label and task, for the refusal and the UI. */
  function holderInfo(l, tabId) {
    const s = sessions.get(slot(l.key, tabId));
    const live = s && !s.ended ? s : null;
    return { id: live?.id ?? null, client: live?.client ?? l.client, task: live?.task || tasks.get(l.key) || "" };
  }

  function release(key, tabId = null) {
    let any = false;
    for (const [t, l] of leases)
      if (l.key === key && (tabId == null || t === tabId)) {
        leases.delete(t);
        any = true;
      }
    return any;
  }

  /** Shared mode ends when no agent session is left on the tab. */
  function dropShared() {
    let any = false;
    for (const t of sharedTabs)
      if (![...sessions.values()].some(s => s.tabId === t && !s.ended)) {
        sharedTabs.delete(t);
        any = true;
      }
    return any;
  }

  /** Who may act on a tab: null when this client may (and takes or renews the lease), else the refusal text. */
  function acquire(client, key, tabId) {
    const l = leaseOf(tabId);
    if (l && l.key !== key && !sharedTabs.has(tabId)) {
      const h = holderInfo(l, tabId);
      return leaseText({ client: h.client, task: h.task, sameClient: h.client === (client.label ?? "An MCP client") });
    }
    if (!l) leases.set(tabId, { key, client: client.label ?? "An MCP client", at: now() });
    else l.at = now(); // in shared mode the holder stays; any action keeps the tab alive
    return null;
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
      s = { id: sid(), key, client: client.label ?? "An MCP client", clientName: client.name ?? "", via: client.via ?? "http", task: tasks.get(key) ?? "", tabId: tabId ?? null, url: url ?? "", title: title ?? "", startedAt: t, lastAt: t, running: 0, paused: false, pausedAt: null, stopped: isStopped(key), handBack: false, handedOver: false, waitingAt: null, waitingTool: null, actions: [], notes: [], ended: false, explicit: false, t3ThreadId: client.t3Thread ?? null, agentPid: client.agentPid ?? null };
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
      if (s.handedOver && (tabId == null || s.tabId === tabId)) {
        out.push(HAND_OVER_TEXT);
        s.handedOver = false;
      }
      for (const n of s.notes) {
        if (n.deliveredAt) continue;
        n.deliveredAt = new Date(at).toISOString();
        out.push(`${NOTE_PREFIX} ${n.text}`);
      }
    }
    for (const r of access.values()) {
      if (r.key !== key || r.notified || r.status === "pending") continue;
      r.notified = true;
      out.push(r.status === "granted" ? accessGrantedNote(r.origin) : accessDismissedNote(r.origin));
    }
    const ag = agents.get(key);
    if (ag) out.push(...takeInbox(ag, at, "image"));
    if (out.length) changed();
    return out;
  }

  /**
   * Drop requests whose agent has no live session left (they expire with the
   * session), that nobody answered within ACCESS_TTL_MS, or whose agent was stopped.
   */
  function pruneAccess() {
    let any = false;
    const t = now();
    for (const [id, r] of access) {
      const gone = !ofClient(r.key).length || isStopped(r.key);
      const stale = r.status === "pending" && t - r.at > ACCESS_TTL_MS;
      if (gone || stale) {
        access.delete(id);
        any = true;
      }
    }
    return any;
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
    before(client, { tool, kind = "act", tabId = null, tabIds = null }) {
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
      // Tab leases: an action on a tab another session holds is refused; otherwise it takes or renews the lease.
      if (LEASE_TOOLS.has(tool) && tabId != null) {
        const refuse = acquire(client, key, tabId);
        const s = ensure(client, tabId);
        if (refuse) {
          s.waitingAt = now();
          s.waitingTool = tool;
          changed();
          return { refuse, lease: true, messages: collect(key, tabId) };
        }
        s.waitingAt = null;
        changed();
      }
      if (tool === "tabs_close" && Array.isArray(tabIds)) {
        for (const t of tabIds) {
          const l = leaseOf(t);
          if (l && l.key !== key && !sharedTabs.has(t)) {
            const h = holderInfo(l, t);
            return { refuse: leaseText({ client: h.client, task: h.task, sameClient: h.client === (client.label ?? "An MCP client") }), lease: true, messages: collect(key, tabId) };
          }
        }
      }
      return { messages: collect(key, tabId) };
    },

    /**
     * session_start on a tab another session holds: a warning for the reply
     * (the session starts anyway: reads are open to everyone), else "".
     */
    leaseWarning(client, tabId) {
      const l = leaseOf(tabId);
      if (!l || l.key === clientKey(client) || sharedTabs.has(tabId)) return "";
      const h = holderInfo(l, tabId);
      const sameClient = h.client === (client.label ?? "An MCP client");
      return `Warning: tab ${tabId} is being used by ${sameClient ? `another ${h.client} session` : h.client}${h.task ? ` (${h.task})` : ""}. You can read it, but your actions on it will be refused. Prefer your own tab (tabs_open), headless_*, or ask the user; the user can hand the tab over to you in Ensō.`;
    },

    /** tabs_open by an agent: the new tabs are its own (taken only when free). */
    claim(client, tabIds = []) {
      const key = clientKey(client);
      let any = false;
      for (const t of tabIds) {
        if (!Number.isInteger(t) || leaseOf(t)) continue;
        leases.set(t, { key, client: client.label ?? "An MCP client", at: now() });
        any = true;
      }
      if (any) changed();
      return any;
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
      const l = LEASE_TOOLS.has(tool) && !entry.refused ? leaseOf(s.tabId) : null; // looked up while the tool still counts as running
      if (l && (l.key === s.key || sharedTabs.has(s.tabId))) l.at = now(); // a long action renews it when it ends, too
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

    /** session_start: the agent says what it is doing, and optionally in which Zen space ({ id, name }). */
    start(client, { task, tabId = null, url, title, space }) {
      const key = clientKey(client);
      const t = clean(task, MAX_TASK_CHARS);
      if (t) tasks.set(key, t);
      const sp = space?.id ? { id: String(space.id), name: clean(space.name, 60) } : null;
      if (sp) spaces.set(key, sp);
      else if (space === null) spaces.delete(key);
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
      if (tabId == null) {
        tasks.delete(key);
        spaces.delete(key);
      }
      release(key, tabId);
      for (const [k, s] of sessions) if (s.ended) sessions.delete(k);
      dropShared();
      pruneAccess();
      changed();
      return n;
    },

    /** The Zen space this agent said it works in (session_start), or null. */
    spaceOf(client) {
      return spaces.get(clientKey(client)) ?? null;
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
        space: spaces.get(key)?.name ?? null,
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
      const l = leaseOf(s.tabId); // while still paused, so a kept lease counts as live
      if (l && l.key === s.key) l.at = now(); // a fresh lease window
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
      release(s.key); // a stopped agent lets go of every tab
      for (const x of ofClient(s.key)) {
        x.stopped = true;
        x.paused = false;
        x.lastAt = now();
      }
      pruneAccess(); // a stopped agent's requests go
      changed();
      return true;
    },
    /** The user gives the tab of session `id` to that session (Ensō: "Hand over to …"). Ends shared mode there. */
    handOver(id) {
      const s = api.get(id);
      if (!s || s.tabId == null || s.stopped || isStopped(s.key)) return false;
      leases.set(s.tabId, { key: s.key, client: s.client, at: now() });
      sharedTabs.delete(s.tabId);
      s.waitingAt = null;
      s.handedOver = true;
      s.lastAt = now();
      changed();
      return true;
    },
    /** The user lets every agent on a tab act on it (on) or goes back to one at a time (off; the last to act keeps it). */
    share(tabId, on) {
      if (!Number.isInteger(tabId)) return false;
      if (on) sharedTabs.add(tabId);
      else sharedTabs.delete(tabId);
      for (const s of sessions.values()) if (s.tabId === tabId && on) s.waitingAt = null;
      changed();
      return true;
    },
    /** The lease on a tab as the UI and tests see it: { holderId, client, task, shared, endsAt } or null. */
    lease(tabId) {
      const l = leaseOf(tabId);
      if (!l) return sharedTabs.has(tabId) ? { holderId: null, client: null, task: "", shared: true, endsAt: null } : null;
      const h = holderInfo(l, tabId);
      return { holderId: h.id, client: h.client, task: h.task, shared: sharedTabs.has(tabId), endsAt: new Date(l.at + LEASE_MS).toISOString() };
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
     * A tool was refused because `origin` isn't on the session-access list:
     * record a request for the user (once per agent and origin) and return the
     * refusal text. → { text, request, status: "pending" | "dismissed" }.
     * A site the user already declined in this task isn't asked about again.
     */
    requestAccess(client, { origin, tool, tabId = null }) {
      const key = clientKey(client);
      const s = ensure(client, tabId);
      const mine = [...access.values()].find(r => r.key === key && r.origin === origin && r.status !== "granted");
      if (mine?.status === "dismissed") return { text: accessDeclinedText(origin), request: mine, status: "dismissed" };
      if (mine) {
        mine.tool = tool ?? mine.tool;
        return { text: accessRequestedText(origin), request: mine, status: "pending" };
      }
      // A granted one for the same origin (the user removed it from the list again): ask afresh.
      for (const [id, r] of access) if (r.key === key && r.origin === origin) access.delete(id);
      const r = { id: `ar-${sid()}`, key, client: client.label ?? "An MCP client", clientName: client.name ?? "", sessionId: s.id, tabId: s.tabId, origin, tool: tool ?? "", at: now(), status: "pending", resolvedAt: null, notified: false };
      access.set(r.id, r);
      if (access.size > MAX_ACCESS) access.delete(access.keys().next().value);
      changed();
      return { text: accessRequestedText(origin), request: r, status: "pending" };
    },

    /**
     * The user answered a request in Ensō: "granted" or "dismissed". Only for
     * pending requests; returns { id, origin, client } or null. host.mjs calls
     * this for "access.allow" / "access.dismiss", which only Ensō's own pages
     * and the trusted pill click (background.js) can send; the MCP server has no path here.
     */
    resolveAccess(id, decision) {
      const r = access.get(String(id ?? ""));
      if (!r || r.status !== "pending" || (decision !== "granted" && decision !== "dismissed")) return null;
      if (!ofClient(r.key).length) {
        access.delete(r.id);
        changed();
        return null;
      }
      r.status = decision;
      r.resolvedAt = now();
      r.notified = false;
      changed();
      return { id: r.id, origin: r.origin, client: r.client, status: r.status };
    },

    /**
     * Requests for the UI and the page pill: pending ones, and ones answered
     * within ACCESS_SHOWN_MS (for the "Allowed" state). sessionIds: the agent's live sessions.
     */
    accessList() {
      const t = now();
      return [...access.values()]
        .filter(r => r.status === "pending" || t - r.resolvedAt < ACCESS_SHOWN_MS)
        .filter(r => ofClient(r.key).length && !isStopped(r.key))
        .sort((a, b) => b.at - a.at)
        .map(r => ({ id: r.id, client: r.client, clientName: r.clientName, sessionId: r.sessionId, sessionIds: ofClient(r.key).map(x => x.id), tabId: r.tabId, origin: r.origin, tool: r.tool, at: new Date(r.at).toISOString(), status: r.status, resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null, told: r.notified }));
    },

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
          return { id: a.id, client: a.client, clientName: a.clientName, task: live[0]?.task || tasks.get(a.key) || "", space: spaces.get(a.key)?.name ?? null, tabIds: live.map(x => x.tabId).filter(x => x != null), sessionIds: live.map(x => x.id), active: live.some(x => x.running > 0) || t - a.lastAt < idleMs, t3ThreadId: a.t3ThreadId, lastAt: new Date(a.lastAt).toISOString(), pending: a.inbox.filter(i => !i.deliveredAt).length, inbox: a.inbox.map(({ image, ...i }) => ({ ...i })) };
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
      if (s.tabId != null) release(s.key, s.tabId);
      dropShared();
      pruneAccess();
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
      for (const [tabId, l] of leases) {
        const s = sessions.get(slot(l.key, tabId));
        if (leaseOf(tabId) && !(s?.ended)) continue;
        leases.delete(tabId);
        any = true;
      }
      if (dropShared()) any = true;
      if (pruneAccess()) any = true;
      // An answered request leaves the UI after ACCESS_SHOWN_MS: push once it has.
      for (const r of access.values()) if (r.status !== "pending" && !r.hidden && t - r.resolvedAt >= ACCESS_SHOWN_MS) { r.hidden = true; any = true; }
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
        space: spaces.get(s.key)?.name ?? null, // the Zen space it said it works in
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
        ...control(s),
      }));
  }

  /**
   * The session's part in its tab's lease: control "holder" (in control),
   * "shared" (the user let every agent act), "waiting" (its last action was
   * refused and the tab is still held by another), or null.
   */
  function control(s) {
    if (s.tabId == null) return { control: null, holderId: null, leaseEndsAt: null, waitingSince: null };
    const l = leaseOf(s.tabId);
    const h = l ? holderInfo(l, s.tabId) : null;
    const base = { holderId: h?.id ?? null, leaseEndsAt: l ? new Date(l.at + LEASE_MS).toISOString() : null, waitingSince: null };
    if (sharedTabs.has(s.tabId)) return { ...base, control: "shared" };
    if (l && l.key === s.key) return { ...base, control: "holder" };
    if (l && s.waitingAt) return { ...base, control: "waiting", waitingSince: new Date(s.waitingAt).toISOString(), waitingTool: s.waitingTool ?? null };
    return { ...base, control: null };
  }

  if (timers) {
    const timer = setInterval(() => api.sweep(), 10_000);
    timer.unref?.();
  }
  return api;
}
