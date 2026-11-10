// The one store. Holds everything from `state` plus loaded conversations, folds
// protocol messages into it, and tells views which parts changed ("topics").
//
// Topics: connection, state, conversations, conv:<id>, dashboard, settings,
// servers, approvals, history, actions, memory, ui, tab, github, agents
// (external agents' live sessions), agents-focus (the page pill was clicked),
// shot (the screenshot send sheet), t3 (T3 Code connection), toast,
// helper (is the native helper installed and running: the first-run guide),
// setup (the checks behind Settings → Setup, Connections and Agents), helperLog (the helper's log tail for
// Copy diagnostics), waits (a request to the helper went
// unanswered for too long: views show "Couldn't load" with Retry).
//
// Waiting for the helper: every request whose answer a view shows a spinner for
// is registered with wait(key, resend) and settled by its answer. A view asks
// loadState(key): "down" (the helper isn't running: show views/helperstate.js's
// card), "timeout" (no answer within WAIT_MS: "Couldn't load" + Retry) or
// "loading". So nothing shows "Loading…" forever.

import { isSupportedOs } from "./platform.js";

export const WAIT_MS = 8000;

export function createStore({ waitMs = WAIT_MS } = {}) {
  const listeners = new Set();
  let pending = new Set();
  let scheduled = false;
  let transport = null;
  let localSeq = 0;
  const actionRequests = []; // FIFO of who asked for actions.list ("recent" | "log")

  const s = {
    connection: "connecting",
    transportKind: null,
    ready: false,
    settings: null,
    engines: null,
    servers: [],
    connections: [],         // servers Ensō signs in to itself (OAuth): [{ server, state, error?, … }]
    connectionResult: null,  // last { server, ok, error?, add? } from a sign-in
    conversations: [],
    activeConversationId: null,
    profile: null,           // { name, about, summary, set, onboarding, spaceHints: { spaceId: text } }
    profileSaving: false,
    paths: null,             // { data, localConfig } on this computer (from the helper)
    dashboard: { data: null, loading: false, error: null },
    github: { data: null, loading: false, error: null, at: 0, saving: false, saved: null }, // new-tab widget + token entry
    tasks: { data: null, loading: false, error: null, at: 0, completing: new Set(), lastError: null, added: [] }, // Tasks widget (task apps, tasks.widget); added: keys a chat just created
    monday: { data: null, loading: false, at: 0, added: [] }, // monday.com widget (monday.widget): data.state ok | not-connected | error
    probing: new Set(),      // servers being re-probed from Retry (connections.probe)
    convs: new Map(),        // id → { events, ids, loaded, loading, running }
    running: new Set(),      // conversation ids with a turn in progress
    approvals: new Map(),    // toolUseId → { conversationId, event, sent? }
    history: { query: "", results: null, loading: false },
    actions: { filter: null, results: null, loading: false },
    recentActions: null,
    memory: { text: "", loaded: false, saving: false, savedAt: null },
    tab: null,               // page.current: { tabId, title, url, favIconUrl, sensitive } | null
    tabs: [],                // tabs.list
    spaces: [],              // Zen spaces
    space: null,             // current space (from page.current)
    spaceMemory: { spaceId: null, text: "", loaded: false, saving: false, savedAt: null },
    skills: [],
    sensitiveHosts: [],
    reports: null,           // reports.list
    report: null,            // report.get (report page)
    globalError: null,       // event with conversationId null (e.g. host_disconnected)
    prefill: null,           // composer.prefill text waiting for the composer
    agents: [],              // live sessions of external agents (Claude Code, Codex…): see docs/PROTOCOL.md "agents"
    agentNotes: new Map(),   // local id → { sessionId, text, at } notes sent but not yet echoed by the helper
    agentFocus: null,        // { tabId, at } when the page pill asked for the agent card
    connectedAgents: [],     // agents connected through `enso mcp` (screenshot targets): [{ id, client, task, tabIds, active, t3ThreadId, pending }]
    // The screenshot send sheet (views/send.js): capture → targets → send.
    shot: null,              // { image, mode, tab, consoleErrors, capturing, error, targets, target, picker, sending, includePage, includeErrors, message, remember }
    t3: { status: null, busy: null, done: null }, // T3 Code connection (Settings), from the helper's `t3` messages
    // The native helper as background.js sees it (`helper.status`): connecting | connected | missing | failed | stopped | restarting.
    helper: { state: "connecting", reason: null, at: 0, everConnected: false, lastError: null, failures: 0, connectedAt: null },
    platform: null,          // runtime.getPlatformInfo().os ("mac", "linux", "win"…); supported ones: ui/platform.js SUPPORTED_OSES
    helperLog: null,         // last `helper.log` answer (Copy diagnostics): { version, node, platform, file, lines, at }
    waits: new Map(),        // key → { since, timedOut, resend }: requests the UI shows a spinner for (see wait())
    setup: { status: null, busy: null, done: null, loading: false }, // Settings → Setup (`setup` messages)
    toast: null,             // { text, kind, action?: { label, run } }
    ui: { view: "home", currentId: null, includePage: true, pendingSend: null, notice: null, scope: "space", settingsSection: null },
  };

  function emit(...topics) {
    for (const t of topics) pending.add(t);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const topicsNow = pending;
      pending = new Set();
      for (const fn of listeners) fn(topicsNow);
    });
  }

  function send(msg) {
    transport?.send(msg);
  }

  /** A request whose answer a view waits for. resend() asks again (Retry, or when the helper is back). */
  function wait(key, resend) {
    const entry = { since: Date.now(), timedOut: false, resend };
    s.waits.set(key, entry);
    setTimeout(() => {
      if (s.waits.get(key) !== entry) return;
      entry.timedOut = true;
      emit("waits");
    }, waitMs);
  }
  function settle(key) {
    const w = s.waits.get(key);
    if (!w) return;
    s.waits.delete(key);
    if (w.timedOut) emit("waits");
  }

  function conv(id) {
    let c = s.convs.get(id);
    if (!c) {
      c = { events: [], ids: new Set(), loaded: false, loading: false, running: false };
      s.convs.set(id, c);
    }
    return c;
  }

  function summary(id) {
    return s.conversations.find(c => c.id === id) ?? null;
  }

  function upsertSummary(sum) {
    const i = s.conversations.findIndex(c => c.id === sum.id);
    if (i >= 0) s.conversations[i] = { ...s.conversations[i], ...sum };
    else s.conversations.unshift(sum);
    s.conversations.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
  }

  // ---- event folding ----------------------------------------------------

  function push(c, ev) {
    if (ev.id && c.ids.has(ev.id)) return false;
    if (ev.id) c.ids.add(ev.id);
    c.events.push(ev);
    return true;
  }

  function foldStreaming(c, ev, kind) {
    // Replace the matching streamed item in place, so its position in the turn is kept.
    const streamed = c.events.filter(e => e.kind === kind && e.streaming);
    const match = streamed.find(e => e.messageId === ev.messageId || e.messageId === ev.id) ?? streamed[0];
    if (c.ids.has(ev.id)) {
      if (match) c.events.splice(c.events.indexOf(match), 1);
      return;
    }
    if (match) {
      c.events[c.events.indexOf(match)] = ev;
      c.ids.add(ev.id);
    } else push(c, ev);
  }

  function applyEvent(conversationId, c, ev, live) {
    switch (ev.kind) {
      case "assistant.delta":
      case "thinking.delta": {
        const kind = ev.kind === "assistant.delta" ? "assistant" : "thinking";
        if (c.ended) return; // late delta after turn.end (e.g. after Stop)
        let item = c.events.find(e => e.streaming && e.kind === kind && e.messageId === ev.messageId);
        if (!item) {
          item = { kind, id: `stream:${kind}:${ev.messageId}`, messageId: ev.messageId, streaming: true, text: "", at: ev.at ?? new Date().toISOString() };
          c.events.push(item);
        }
        item.text += ev.text ?? "";
        if (live) { c.running = true; s.running.add(conversationId); }
        return;
      }
      case "assistant":
      case "thinking":
        foldStreaming(c, ev, ev.kind);
        return;
      case "user": {
        const t = String(ev.text ?? "").trim();
        const local = c.events.find(e => e.kind === "user" && e.local && (e.text.trim() === t || e.matchText === t)) ?? c.events.find(e => e.kind === "user" && e.local);
        if (local) {
          c.events[c.events.indexOf(local)] = ev;
          if (ev.id) c.ids.add(ev.id);
        } else push(c, ev);
        return;
      }
      case "turn.start":
        push(c, ev);
        c.ended = false;
        c.running = true;
        s.running.add(conversationId);
        return;
      case "turn.end":
        push(c, ev);
        finishTurn(conversationId, c);
        return;
      case "approval.request":
        push(c, ev);
        if (live) s.approvals.set(ev.toolUseId, { conversationId, event: ev });
        emit("approvals");
        return;
      case "approval.resolved":
        push(c, ev);
        s.approvals.delete(ev.toolUseId);
        emit("approvals");
        return;
      default:
        push(c, ev);
    }
  }

  function finishTurn(conversationId, c) {
    c.running = false;
    c.ended = true;
    s.running.delete(conversationId);
    for (const e of c.events) if (e.streaming) e.streaming = false;
    // Unanswered approvals of a finished turn can't be answered any more.
    for (const [id, a] of s.approvals) if (a.conversationId === conversationId) s.approvals.delete(id);
    if (s.activeConversationId === conversationId) s.activeConversationId = null;
    emit("approvals", "conversations");
  }

  // ---- incoming messages ------------------------------------------------

  function receive(msg) {
    switch (msg.type) {
      case "state": {
        settle("state");
        const first = !s.ready;
        s.ready = true;
        s.settings = msg.settings ?? s.settings;
        s.engines = msg.engines ?? s.engines;
        s.servers = msg.servers ?? [];
        s.connections = msg.connections ?? s.connections;
        s.conversations = [...(msg.conversations ?? [])];
        s.activeConversationId = msg.activeConversationId ?? null;
        if (s.activeConversationId) s.running.add(s.activeConversationId);
        s.profile = msg.profile ?? null;
        s.paths = msg.paths ?? s.paths;
        s.skills = msg.skills ?? s.skills;
        s.sensitiveHosts = msg.sensitiveHosts ?? [];
        if (msg.reports) s.reports = msg.reports;
        if (msg.spaces) s.spaces = msg.spaces;
        if (s.globalError?.code === "host_disconnected") s.globalError = null;
        if (msg.dashboard) s.dashboard = { ...s.dashboard, data: msg.dashboard };
        if (Array.isArray(msg.agents)) { s.agents = msg.agents; emit("agents"); }
        if (Array.isArray(msg.connectedAgents)) s.connectedAgents = msg.connectedAgents;
        if (first && s.settings) s.ui.includePage = s.settings.includePageByDefault !== false;
        emit("state", "settings", "servers", "conversations", "dashboard", "ui", "skills", "reports", "banner", "profile");
        return;
      }
      case "conversation.created": {
        upsertSummary(msg.conversation);
        const id = msg.conversation.id;
        emit("conversations");
        const p = s.ui.pendingSend;
        if (p && !p.conversationId) {
          p.conversationId = id;
          const c = conv(id);
          c.loaded = true;
          s.running.delete("draft");
          const draft = s.convs.get("draft");
          if (draft) { for (const e of draft.events) push(c, e); s.convs.delete("draft"); }
          c.running = true;
          s.running.add(id);
          s.ui.currentId = id;
          s.ui.pendingSend = null;
          send({ type: "chat.send", conversationId: id, ...p.payload });
          syncHash();
          emit("ui", `conv:${id}`);
        }
        return;
      }
      case "conversation.updated":
        upsertSummary(msg.conversation);
        emit("conversations", `conv:${msg.conversation.id}`);
        return;
      case "conversation.deleted":
        s.conversations = s.conversations.filter(c => c.id !== msg.id);
        s.convs.delete(msg.id);
        if (s.ui.currentId === msg.id) { s.ui.currentId = null; s.ui.view = "home"; syncHash(); emit("ui"); }
        emit("conversations");
        return;
      case "conversation.loaded": {
        settle(`conv:${msg.id}`);
        if (msg.conversation) upsertSummary(msg.conversation);
        const old = s.convs.get(msg.id);
        const fresh = { events: [], ids: new Set(), loaded: true, loading: false, running: s.running.has(msg.id) };
        s.convs.set(msg.id, fresh);
        const live = msg.id === s.activeConversationId || s.running.has(msg.id);
        for (const ev of msg.events ?? []) applyEvent(msg.id, fresh, ev, live);
        if (!live) for (const e of fresh.events) e.streaming = false;
        // keep local-only items that the snapshot doesn't have yet
        if (old) for (const e of old.events) if ((e.streaming || e.local) && !fresh.ids.has(e.id)) applyEvent(msg.id, fresh, e, true);
        emit(`conv:${msg.id}`, "conversations", "approvals");
        return;
      }
      case "event": {
        const { conversationId: id, event: ev } = msg;
        if (!ev) return;
        if (!id) {
          // Global (connection-level) event: a banner, not part of a conversation.
          if (ev.kind === "error" || ev.kind === "notice") {
            s.globalError = { ...ev, at: ev.at ?? new Date().toISOString() };
            if (ev.code === "host_disconnected") {
              // Turns can't finish without the host: unblock the composer.
              s.running.clear();
              s.approvals.clear();
              for (const c of s.convs.values()) { c.running = false; for (const e of c.events) e.streaming = false; }
              emit("approvals", "conversations", ...[...s.convs.keys()].map(k => `conv:${k}`));
            }
            emit("banner");
          }
          return;
        }
        // Track turn state and approvals even for conversations we haven't loaded.
        const c = s.convs.get(id) ?? (s.ui.currentId === id ? conv(id) : null);
        if (c) applyEvent(id, c, ev, true);
        else {
          if (ev.kind === "turn.start") s.running.add(id);
          if (ev.kind === "turn.end") { s.running.delete(id); for (const [k, a] of s.approvals) if (a.conversationId === id) s.approvals.delete(k); }
          if (ev.kind === "approval.request") s.approvals.set(ev.toolUseId, { conversationId: id, event: ev });
          if (ev.kind === "approval.resolved") s.approvals.delete(ev.toolUseId);
          emit("approvals");
        }
        if (ev.kind === "turn.start" || ev.kind === "turn.end") {
          const sum = summary(id);
          if (sum && ev.at) { sum.updatedAt = ev.at; upsertSummary(sum); }
          emit("conversations");
        }
        emit(`conv:${id}`);
        return;
      }
      case "history.results":
        if (msg.query === s.history.query) {
          settle("history");
          s.history.results = msg.results ?? [];
          s.history.loading = false;
          emit("history");
        }
        return;
      case "actions.results": {
        const who = actionRequests.shift() ?? (s.actions.filter ? null : "log");
        if (who === "recent") { s.recentActions = msg.actions ?? []; emit("dashboard"); }
        if (who === "log") { settle("actions"); s.actions.results = msg.actions ?? []; s.actions.loading = false; emit("actions"); }
        return;
      }
      case "actions.added": {
        // Pushed live by the helper (external agents' actions, notes): Activity and "recent" update without a reload.
        const a = msg.action;
        if (!a) return;
        if (s.recentActions) { s.recentActions = [a, ...s.recentActions.filter(x => x.id !== a.id)].slice(0, 8); emit("dashboard", "recent"); }
        const f = s.actions.filter;
        if (s.actions.results && (!f?.host || f.host === a.host)) { s.actions.results = [a, ...s.actions.results.filter(x => x.id !== a.id)]; emit("actions"); }
        return;
      }
      case "capture.active":
        s.capturing = !!msg.on;
        emit("shot");
        return;
      case "screenshot.captured": {
        if (msg.cancelled) { s.shot = null; emit("shot"); return; }
        if (msg.error) { s.shot = null; showToast(msg.error, "bad"); emit("shot"); return; }
        const errors = Array.isArray(msg.consoleErrors) ? msg.consoleErrors : null;
        s.shot = { image: msg.image, mode: msg.mode, tab: msg.tab, consoleErrors: errors, targets: null, target: null, picker: false, sending: false, includePage: true, includeErrors: false, message: "", remember: false, error: null };
        send({ type: "send.targets", tabId: msg.tab?.tabId ?? null, url: msg.tab?.url ?? "" });
        emit("shot");
        return;
      }
      case "send.targets": {
        if (!s.shot) return;
        if (msg.error) { s.shot.error = msg.error; emit("shot"); return; }
        s.shot.targets = msg;
        if (!s.shot.target) s.shot.target = msg.target;
        if (!s.shot.target) s.shot.picker = true; // nothing known: choose first
        emit("shot");
        return;
      }
      case "send.result": {
        if (!s.shot) return;
        if (!msg.ok) { s.shot.sending = false; s.shot.error = msg.error || "Couldn't send the screenshot."; emit("shot"); return; }
        const how = msg.kind === "agent" ? (msg.queued ? "it gets it with its next step" : "") : msg.route === "path" ? "as a file path" : "";
        const threadId = s.shot.target?.kind === "t3" ? s.shot.target.id : null;
        s.shot = null;
        showToast(`Sent to ${msg.title}${how ? ` · ${how}` : ""}`, "good", msg.kind === "t3" && msg.openUrl && threadId ? { label: "Open in T3", run: () => actions.openT3(threadId) } : null);
        emit("shot");
        return;
      }
      case "screenshot.saved":
        if (!msg.ok) { showToast(msg.error || "Couldn't save the screenshot.", "bad"); return; }
        navigator.clipboard?.writeText(msg.path).then(() => showToast(`Saved and copied the path: ${msg.path}`, "good"), () => showToast(`Saved at ${msg.path}`, "good"));
        s.shot = null;
        emit("shot");
        return;
      case "t3":
        s.t3 = { status: msg.status ?? s.t3.status, busy: null, done: msg.done ?? null };
        emit("t3");
        return;
      case "helper.status": {
        const was = s.helper.state;
        s.helper = { state: msg.state, reason: msg.reason ?? null, at: msg.at ?? Date.now(), everConnected: s.helper.everConnected || msg.state === "connected", lastError: msg.lastError ?? s.helper.lastError ?? null, failures: msg.failures ?? 0, connectedAt: msg.connectedAt ?? null };
        // Back after being away (installed just now, restarted after an update): fetch everything again,
        // including whatever a view was still waiting for.
        if (msg.state === "connected" && was !== "connected" && was !== "connecting") {
          actions.hello();
          for (const [key, w] of [...s.waits]) if (key !== "state") w.resend?.();
          if (!s.waits.has("setup") && (s.setup.status || s.ui.view === "settings")) send({ type: "setup.status" });
        }
        if (msg.state === "connected" && s.globalError?.code === "host_disconnected") { s.globalError = null; emit("banner"); }
        emit("helper");
        return;
      }
      case "helper.restarting":
        s.helper = { ...s.helper, state: "restarting" };
        emit("helper");
        return;
      case "helper.log":
        settle("helperLog");
        s.helperLog = { version: msg.version ?? null, node: msg.node ?? null, platform: msg.platform ?? null, file: msg.file ?? null, lines: Array.isArray(msg.lines) ? msg.lines : [], at: Date.now() };
        emit("helperLog");
        return;
      case "setup":
        settle("setup");
        s.setup = { status: msg.status ?? s.setup.status, busy: msg.done ? null : s.setup.busy, done: msg.done ?? s.setup.done, loading: false };
        emit("setup");
        return;
      case "agents": {
        if (Array.isArray(msg.connected)) s.connectedAgents = msg.connected;
        s.agents = Array.isArray(msg.sessions) ? msg.sessions : [];
        // Drop local "sending" notes the helper now knows about.
        for (const [id, n] of s.agentNotes) {
          const sess = s.agents.find(x => x.id === n.sessionId);
          if (!sess || sess.notes.some(x => x.text === n.text)) s.agentNotes.delete(id);
        }
        emit("agents");
        return;
      }
      case "agents.focus":
        s.agentFocus = { tabId: msg.tabId, at: Date.now() };
        emit("agents-focus");
        return;
      case "dashboard":
        settle("dashboard");
        if (msg.loading) s.dashboard = { ...s.dashboard, loading: true, error: null };
        else s.dashboard = { data: msg.data ?? s.dashboard.data, loading: false, error: msg.error ?? null };
        emit("dashboard");
        return;
      case "github":
        s.github = { ...s.github, data: msg.data ?? s.github.data, loading: false, error: msg.error ?? null, at: Date.now() };
        emit("github");
        return;
      case "tasks":
        s.tasks = { ...s.tasks, data: msg.data ?? s.tasks.data, loading: false, error: msg.error ?? null, at: Date.now(), added: msg.added ?? [] };
        emit("tasks");
        return;
      case "monday":
        s.monday = { ...s.monday, data: msg.data ?? s.monday.data, loading: false, at: Date.now(), added: msg.added ?? [] };
        emit("monday");
        emit("tasks"); // monday items with a due date also show in Tasks
        return;
      case "connections.probed": {
        const probing = new Set(s.probing);
        probing.delete(msg.server);
        s.probing = probing;
        emit("servers");
        return;
      }
      case "tasks.completed": {
        const completing = new Set(s.tasks.completing);
        completing.delete(`${msg.server}|${msg.id}`);
        s.tasks = { ...s.tasks, completing, lastError: msg.ok ? null : msg.error || "Couldn't complete the task." };
        emit("tasks");
        return;
      }
      case "github.saved":
        s.github = { ...s.github, saving: false, saved: msg };
        if (msg.ok) actions.loadGithub(true);
        emit("github");
        return;
      case "settings":
        s.settings = msg.settings;
        emit("settings");
        return;
      case "engines":
        s.engines = msg.engines ?? s.engines;
        emit("settings");
        return;
      case "profile":
        s.profile = msg.profile ?? s.profile;
        s.profileSaving = false;
        s.profileSavedAt = new Date();
        emit("profile");
        return;
      case "composer.prefill":
        s.prefill = String(msg.text ?? "");
        emit("prefill");
        return;
      case "skills":
        s.skills = msg.skills ?? [];
        emit("skills");
        return;
      case "reports":
        s.reports = msg.reports ?? [];
        emit("reports");
        return;
      case "report":
        s.report = msg.report ?? null;
        s.reportMissing = !msg.report;
        emit("report");
        return;
      case "tabs":
        s.tabs = msg.tabs ?? [];
        emit("tabs");
        return;
      case "page.current": {
        s.tab = msg.tab ?? null;
        const space = msg.space !== undefined ? msg.space : msg.tab?.space !== undefined && typeof msg.tab.space === "object" ? msg.tab.space : s.space;
        const changed = (space?.id ?? null) !== (s.space?.id ?? null);
        const prevSpaceId = s.space?.id ?? null;
        s.space = space ?? null;
        emit("tab");
        if (changed) followSpace(prevSpaceId, s.space?.id ?? null);
        if (changed) {
          s.spaceMemory = { spaceId: s.space?.id ?? null, text: "", loaded: false, saving: false, savedAt: null };
          if (s.history.query.trim() && s.ui.scope === "space") actions.search(s.history.query);
          emit("space", "conversations", "memory");
        }
        return;
      }
      case "spaces":
        s.spaces = msg.spaces ?? [];
        emit("space");
        return;
      case "servers":
        s.servers = msg.servers ?? [];
        emit("servers");
        return;
      case "connections":
        s.connections = msg.connections ?? [];
        if (msg.done) s.connectionResult = msg.done;
        emit("servers");
        return;
      case "memory":
        settle(msg.spaceId ? `memory:${msg.spaceId}` : "memory");
        if (msg.spaceId) {
          if (msg.spaceId !== (s.space?.id ?? null)) return;
          s.spaceMemory = { ...s.spaceMemory, spaceId: msg.spaceId, text: msg.text ?? "", loaded: true, saving: false, savedAt: s.spaceMemory.saving ? new Date() : s.spaceMemory.savedAt };
          emit("memory");
          return;
        }
        s.memory = { ...s.memory, text: msg.text ?? "", loaded: true, saving: false, savedAt: s.memory.saving ? new Date() : s.memory.savedAt };
        emit("memory");
        return;
      default:
        // Unknown message: ignore (forward compatible).
    }
  }

  // ---- routing ------------------------------------------------------------

  function syncHash() {
    const { view, currentId } = s.ui;
    const hash = view === "chat" && currentId && currentId !== "draft" ? `#conversation=${encodeURIComponent(currentId)}`
      : view === "home" || view === "chat" ? ""
      : view === "settings" && s.ui.settingsSection ? `#settings/${s.ui.settingsSection}`
      : `#${view}`;
    if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname + location.search);
  }

  function readHash() {
    const m = location.hash.match(/^#conversation=(.+)$/);
    if (m) return { view: "chat", id: decodeURIComponent(m[1]) };
    // #settings/<section> opens one section; #setup (the old Setup page) is Settings → Setup now.
    const st = location.hash.match(/^#settings(?:\/([a-z-]+))?$/);
    if (st) return { view: "settings", section: st[1] ?? null };
    const view = location.hash.slice(1);
    if (view === "setup") return { view: "settings", section: "setup" };
    return ["history", "activity", "reports", "tools"].includes(view) ? { view } : { view: "home" };
  }

  // ---- actions (UI → host) ----------------------------------------------

  const actions = {
    attach(t) { transport = t; s.transportKind = t.kind; },
    setConnection(status) { s.connection = status; emit("connection"); },
    hello() {
      wait("state", () => actions.hello());
      send({ type: "hello" });
      send({ type: "page.current" });
      send({ type: "reports.list" });
    },

    /** go("settings", { section: "agents" }) opens one section of Settings; go("setup") is Settings → Setup. */
    go(view, { section = null } = {}) {
      if (view === "setup") { view = "settings"; section = "setup"; }
      if (view === "settings") s.ui.settingsSection = section;
      s.ui.view = view;
      if (view !== "chat") s.ui.currentId = view === "home" ? null : s.ui.currentId;
      if (view === "activity" && !s.actions.results) actions.listActions(s.actions.filter);
      if (view === "settings" && !s.memory.loaded) actions.loadMemory();
      syncHash();
      emit("ui");
    },
    newChat() {
      s.ui.currentId = null;
      s.ui.view = "home";
      syncHash();
      emit("ui");
    },
    open(id) {
      s.ui.currentId = id;
      s.ui.view = "chat";
      const c = conv(id);
      if (!c.loaded) {
        c.loading = true;
        wait(`conv:${id}`, () => send({ type: "conversation.open", id }));
      }
      send({ type: "conversation.open", id });
      syncHash();
      emit("ui", `conv:${id}`);
    },
    restoreFromHash() {
      const r = readHash();
      if (r.view === "chat") actions.open(r.id);
      else actions.go(r.view, { section: r.section ?? null });
    },

    /**
     * Send a message. opts: { includePage, skill, mentionedTabIds, attachScreenshot, attachments }
     * attachments: [{ name, mimeType, dataBase64, size }]
     */
    send(text, opts = {}) {
      text = String(text ?? "").trim();
      const skill = opts.skill ?? null;
      if (!text && !skill) return;
      const sensitive = !!s.tab?.sensitive;
      const includePage = !sensitive && (opts.includePage ?? s.ui.includePage);
      const mentioned = (opts.mentionedTabIds ?? []).map(Number);
      const attachments = opts.attachments ?? [];
      const payload = {
        text,
        includePage,
        ...(skill && { skill }),
        ...(mentioned.length && { mentionedTabIds: mentioned }),
        ...(opts.attachScreenshot && !sensitive && { attachScreenshot: true }),
        ...(attachments.length && { attachments: attachments.map(({ name, mimeType, dataBase64 }) => ({ name, mimeType, dataBase64 })) }),
      };
      const local = {
        kind: "user", id: `local:${++localSeq}`, local: true, at: new Date().toISOString(),
        text: skill ? `/${skill}${text ? ` ${text}` : ""}` : text,
        matchText: text,
        page: includePage && s.tab ? { url: s.tab.url, title: s.tab.title } : null,
        tabs: mentioned.map(id => s.tabs.find(t => t.tabId === id)).filter(Boolean).map(t => ({ url: t.url, title: t.title })),
        attachments: attachments.map(a => ({ name: a.name, mimeType: a.mimeType })),
        screenshot: !!payload.attachScreenshot,
      };
      const id = s.ui.view === "chat" ? s.ui.currentId : null;
      if (id === "draft") return; // still creating the previous one
      if (id) {
        const c = conv(id);
        c.loaded = true;
        push(c, local);
        c.running = true;
        c.ended = false;
        s.running.add(id);
        send({ type: "chat.send", conversationId: id, ...payload });
        emit(`conv:${id}`, "conversations");
        return;
      }
      // No conversation yet: create one, then send when it exists.
      const draft = { events: [local], ids: new Set([local.id]), loaded: true, loading: false, running: true };
      s.convs.set("draft", draft);
      s.running.add("draft");
      s.ui.pendingSend = { payload };
      s.ui.currentId = "draft";
      s.ui.view = "chat";
      send({ type: "conversation.new" });
      syncHash();
      emit("ui", "conv:draft");
    },
    stop() {
      const id = s.ui.currentId;
      if (id && id !== "draft") send({ type: "chat.stop", conversationId: id });
    },
    reply(toolUseId, decision) {
      const a = s.approvals.get(toolUseId);
      if (a) a.sent = decision;
      send({ type: "approval.reply", id: toolUseId, decision });
      emit("approvals", a ? `conv:${a.conversationId}` : "ui");
    },
    rename(id, title) {
      title = title.trim();
      const sum = summary(id);
      if (!title || !sum || sum.title === title) return;
      sum.title = title;
      send({ type: "conversation.rename", id, title });
      emit("conversations", `conv:${id}`);
    },
    remove(id) {
      send({ type: "conversation.delete", id });
      receive({ type: "conversation.deleted", id }); // optimistic
    },
    search(query) {
      s.history.query = query;
      if (!query.trim()) { s.history.results = null; s.history.loading = false; emit("history"); return; }
      s.history.loading = true;
      wait("history", () => actions.search(s.history.query));
      const scoped = s.ui.scope === "space" && s.space;
      send({ type: "history.search", query, ...(scoped && { spaceId: s.space.id }) });
      emit("history");
    },
    listActions(filter = null, who = "log") {
      if (who === "log") { s.actions.filter = filter; s.actions.loading = true; wait("actions", () => actions.listActions(s.actions.filter)); emit("actions"); }
      actionRequests.push(who);
      send({ type: "actions.list", ...(filter?.host && { host: filter.host }), limit: who === "recent" ? 8 : 200 });
    },
    refreshDashboard() {
      s.dashboard = { ...s.dashboard, loading: true, error: null };
      wait("dashboard", () => actions.refreshDashboard());
      send({ type: "dashboard.refresh" });
      emit("dashboard");
    },
    /** GitHub widget rows; the helper caches ~5 minutes, so this is cheap. */
    loadGithub(force = false) {
      if (s.github.loading) return;
      s.github = { ...s.github, loading: true };
      send({ type: "github.widget", force });
      emit("github");
    },
    /** Tasks widget rows from task apps; the helper caches ~5 minutes (maxAge: accept data at most this old, in ms). */
    loadTasks(force = false, maxAge) {
      if (s.tasks.loading) return;
      s.tasks = { ...s.tasks, loading: true };
      send({ type: "tasks.widget", force, ...(maxAge ? { maxAge } : {}) });
      emit("tasks");
    },
    /** monday.com widget: items assigned to me and recent updates; the helper caches ~5 minutes. */
    loadMonday(force = false, maxAge) {
      if (s.monday.loading) return;
      s.monday = { ...s.monday, loading: true };
      send({ type: "monday.widget", force, ...(maxAge ? { maxAge } : {}) });
      emit("monday");
    },
    /** Tick in the Tasks widget: the helper marks it done at the app (update_task) and sends a fresh list. */
    completeTask(server, id) {
      s.tasks = { ...s.tasks, completing: new Set(s.tasks.completing).add(`${server}|${id}`), lastError: null };
      send({ type: "tasks.complete", server, id });
      emit("tasks");
    },
    saveGithubToken(token) {
      s.github = { ...s.github, saving: true, saved: null };
      send({ type: "github.token", token });
      emit("github");
    },
    updateSettings(patch) {
      s.settings = { ...s.settings, ...patch, ...(patch.dashboard && { dashboard: { ...s.settings?.dashboard, ...patch.dashboard } }) };
      send({ type: "settings.update", patch });
      emit("settings");
    },
    /** Onboarding and Settings → You & memory: name, about, and { spaceId: hint } (empty text removes a hint). */
    saveProfile({ name, about, spaceHints }) {
      s.profileSaving = true;
      send({ type: "profile.save", name, about, ...(spaceHints && { spaceHints }) });
      emit("profile");
    },
    skipOnboarding() {
      s.profile = { ...(s.profile ?? {}), onboarding: false };
      send({ type: "profile.save", skip: true });
      emit("profile");
    },
    loadMemory(spaceId = null) {
      wait(spaceId ? `memory:${spaceId}` : "memory", () => actions.loadMemory(spaceId));
      send({ type: "memory.get", ...(spaceId && { spaceId }) });
    },
    saveMemory(text, spaceId = null) {
      if (spaceId) s.spaceMemory = { ...s.spaceMemory, saving: true };
      else s.memory = { ...s.memory, saving: true };
      send({ type: "memory.set", text, ...(spaceId && { spaceId }) });
      emit("memory");
    },
    toggleTool(name, enabled) {
      s.servers = s.servers.map(x => (x.name === name ? { ...x, enabled } : x));
      send({ type: "tools.toggle", name, enabled });
      emit("servers");
    },
    connectServer(name) { s.connectionResult = null; send({ type: "connections.start", server: name }); emit("servers"); },
    disconnectServer(name) { send({ type: "connections.disconnect", server: name }); },
    /** Retry for a server that is signed in but failed: re-probe it with the stored token (no new sign-in). */
    probeServer(name) { s.probing = new Set(s.probing).add(name); send({ type: "connections.probe", server: name }); emit("servers"); },
    addServer({ name, url, label }) { s.connectionResult = null; send({ type: "connections.add", name, url, ...(label && { label }) }); emit("servers"); },
    removeServer(name) { send({ type: "connections.remove", server: name }); },
    setScope(scope) {
      s.ui.scope = scope;
      try { localStorage.setItem("enso.scope", scope); } catch { /* ignore */ }
      if (s.history.query.trim()) actions.search(s.history.query);
      emit("conversations", "ui");
    },
    dismissBanner() { s.globalError = null; emit("banner"); },
    takePrefill() { const t = s.prefill; s.prefill = null; return t; },
    setIncludePage(v) { s.ui.includePage = !!v; emit("ui"); },
    listTabs() { send({ type: "tabs.list" }); },
    currentPage() { send({ type: "page.current" }); },
    saveSkill(skill) { send({ type: "skills.save", skill }); },
    deleteSkill(name) { s.skills = s.skills.filter(k => k.name !== name); send({ type: "skills.delete", name }); emit("skills"); },
    listReports() { send({ type: "reports.list" }); },

    // External agents (lib/agentsessions.mjs): steering from the agent card and the Agents list.
    pauseAgent(id) { setAgent(id, { paused: true }); send({ type: "agents.pause", id }); },
    resumeAgent(id) { setAgent(id, { paused: false }); send({ type: "agents.resume", id }); },
    stopAgent(id) { setAgent(id, { stopped: true, paused: false }); send({ type: "agents.stop", id }); },
    dismissAgent(id) { s.agents = s.agents.filter(x => x.id !== id); send({ type: "agents.dismiss", id }); emit("agents"); },
    noteAgent(id, text) {
      text = String(text ?? "").trim();
      if (!text) return;
      s.agentNotes.set(`n${++localSeq}`, { sessionId: id, text: text.replace(/\s+/g, " ").slice(0, 1000), at: new Date().toISOString() });
      send({ type: "agents.note", id, text });
      emit("agents");
    },
    switchToTab(tabId) { send({ type: "agents.switch", tabId }); },
    getReport(id) { send({ type: "report.get", id }); },

    // Screenshots to agents (views/send.js). capture() asks background.js; the mock fakes it.
    captureScreenshot(mode = "region") { s.shot = { capturing: true, mode }; emit("shot"); send({ type: "screenshot.capture", mode }); },
    closeShot() { s.shot = null; emit("shot"); },
    captureKey(key) { send({ type: "capture.key", key }); },
    startConsole(tabId, always) { send({ type: "console.start", tabId, always: !!always }); if (s.shot) { s.shot.consoleErrors = []; emit("shot"); } },
    patchShot(patch) { if (!s.shot) return; Object.assign(s.shot, patch); emit("shot"); },
    sendShot() {
      const sh = s.shot;
      if (!sh?.image || !sh.target || sh.sending) return;
      sh.sending = true; sh.error = null;
      if (sh.remember && sh.tab?.tabId != null) {
        const t = targetInfo(sh.target);
        let host = ""; try { host = new URL(sh.tab.url).host; } catch { /* not a URL */ }
        send({ type: "send.link", link: { type: "tab", tabId: sh.tab.tabId, host, kind: sh.target.kind, id: sh.target.id, title: t?.title ?? "", pageTitle: sh.tab.title ?? "" } });
      }
      send({ type: "send.screenshot", target: sh.target, image: sh.image, message: sh.message, url: sh.tab?.url ?? "", title: sh.tab?.title ?? "", includePage: sh.includePage, consoleErrors: sh.includeErrors ? sh.consoleErrors ?? [] : [] });
      emit("shot");
    },
    async copyShot() {
      const sh = s.shot;
      if (!sh?.image) return;
      try {
        const blob = await (await fetch(sh.image)).blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        s.shot = null;
        showToast(`Image copied: paste it into Claude Code, Codex or OpenCode with ${s.platform === "mac" ? "⌘V (Ctrl+V in some terminals)" : "Ctrl+V (Ctrl+Shift+V in some terminals)"}.`, "good");
        emit("shot");
      } catch (err) {
        s.shot.error = `Couldn't copy the image (${err?.message ?? err}). Try “Save + copy path”.`;
        emit("shot");
      }
    },
    saveShot() { const sh = s.shot; if (sh?.image) send({ type: "screenshot.save", image: sh.image, url: sh.tab?.url ?? "" }); },
    linkHost(host, projectId, projectTitle) { send({ type: "send.link", link: { type: "host", host, projectId, projectTitle } }); },
    unlink(link) { send({ type: "send.unlink", link }); },
    t3Status() { send({ type: "t3.status" }); },
    t3Connect() { s.t3 = { ...s.t3, busy: "connect", done: null }; emit("t3"); send({ type: "t3.connect" }); },
    t3Disconnect() { s.t3 = { ...s.t3, busy: "disconnect", done: null }; emit("t3"); send({ type: "t3.disconnect" }); },
    openT3(threadId) { send({ type: "t3.open", threadId }); },
    dismissToast() { s.toast = null; emit("toast"); },
    // First-run guide: ask background.js to try the helper again now.
    helperRetry() { send({ type: "helper.retry" }); },
    /** Which system this is (install command, paths, shortcuts; ui/platform.js). os: for the mock's ?platform=. */
    async detectPlatform(os) {
      try { os = os ?? (await globalThis.browser?.runtime?.getPlatformInfo?.())?.os; } catch { /* not in the extension */ }
      if (os && os !== s.platform) { s.platform = os; emit("helper", "waits"); }
    },
    // "Try again" on the helper-not-running card and on "Couldn't load": reconnect, then ask again.
    retryLoad(key) {
      if (store.helperDown()) { send({ type: "helper.retry" }); return; }
      const w = s.waits.get(key);
      if (w?.resend) w.resend();
      else actions.hello();
      emit("waits");
    },
    // Copy diagnostics: the helper's version and the end of its log (redacted there). Resolves null without an answer.
    requestHelperLog(timeout = 2500) {
      if (s.helper.state !== "connected") return Promise.resolve(null);
      const asked = Date.now();
      return new Promise(resolve => {
        const off = subscribe(topics => {
          if (topics.has("helperLog") && s.helperLog && s.helperLog.at >= asked) { off(); clearTimeout(t); resolve(s.helperLog); }
        });
        const t = setTimeout(() => { off(); resolve(null); }, timeout);
        send({ type: "helper.log", lines: 40 });
      });
    },
    // Settings → Setup. setupRun options may carry a key or token: it goes to the helper only, and is never kept here.
    setupStatus(fresh = false) { s.setup = { ...s.setup, loading: !s.setup.status }; wait("setup", () => actions.setupStatus(fresh)); emit("setup"); send({ type: "setup.status", fresh }); },
    setupRun(step, options = {}) { s.setup = { ...s.setup, busy: step, busyFor: typeof options.client === "string" ? options.client : null, done: null }; emit("setup"); send({ type: "setup.run", step, options }); },
    clearSetupDone() { s.setup = { ...s.setup, done: null }; emit("setup"); },
  };

  /** Title and subtitle of a send target from the last targets list. */
  function targetInfo(target) {
    const tg = s.shot?.targets;
    if (!target || !tg) return null;
    if (target.kind === "agent") {
      const a = tg.agents?.find(x => x.id === target.id) ?? s.connectedAgents.find(x => x.id === target.id);
      return a ? { title: a.client, sub: a.task || (a.active ? "Working now" : "Connected, idle"), agent: a } : { title: "An agent", sub: "No longer connected" };
    }
    const t = tg.threads?.find(x => x.id === target.id);
    return t ? { title: t.title, sub: [t.projectTitle, t.waiting ? "Waiting for you" : t.running ? "Running" : null].filter(Boolean).join(" · "), thread: t } : { title: "A T3 thread", sub: "Not in the recent list" };
  }

  let toastTimer = null;
  function showToast(text, kind = "info", action = null) {
    s.toast = { text, kind, action, at: Date.now() };
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { s.toast = null; emit("toast"); }, action ? 9000 : 5000);
    emit("toast");
  }

  function setAgent(id, patch) {
    s.agents = s.agents.map(x => (x.id === id ? { ...x, ...patch } : x));
    emit("agents");
  }

  try { const sc = localStorage.getItem("enso.scope"); if (sc === "all" || sc === "space") s.ui.scope = sc; } catch { /* ignore */ }

  /** Conversations for lists: this space by default, all spaces when toggled (or without a current space). */
  // Chats follow the Zen space: switching spaces puts away the chat open in the
  // old one and brings back the last chat open in the new one (or a new chat).
  // Running chats keep running; they're only out of sight.
  const LAST_CHAT_KEY = "enso.lastChatBySpace";
  const lastChats = () => { try { return JSON.parse(localStorage.getItem(LAST_CHAT_KEY) || "{}"); } catch { return {}; } };
  function followSpace(fromId, toId) {
    const view = s.ui.view;
    if (view !== "chat" && view !== "home") return; // don't pull people out of Settings, History…
    const cur = s.ui.currentId;
    if (cur === "draft" || s.ui.pendingSend) return; // something is being sent right now
    const spaceOf = id => s.conversations.find(c => c.id === id)?.space?.id ?? null;
    const last = lastChats();
    if (fromId) {
      last[fromId] = view === "chat" && cur ? cur : null;
      try { localStorage.setItem(LAST_CHAT_KEY, JSON.stringify(last)); } catch { /* private mode */ }
    }
    if (view === "chat" && cur && (spaceOf(cur) === toId || spaceOf(cur) === null)) return; // already belongs here (or to no space)
    const back = toId ? last[toId] : null;
    if (back && spaceOf(back) === toId) actions.open(back);
    else if (view === "chat") actions.newChat();
  }

  function visibleConversations() {
    if (s.ui.scope !== "space" || !s.space) return s.conversations;
    return s.conversations.filter(c => c.space?.id === s.space.id);
  }

  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  /** True on a system the helper doesn't run on (not in ui/platform.js SUPPORTED_OSES). */
  const unsupported = () => !isSupportedOs(s.platform);

  /**
   * The helper as background.js last saw it, when it isn't running (missing | failed | stopped); else null.
   * On an unsupported system it can't run at all: down (with unsupported: true) unless it somehow connected.
   */
  function helperDown() {
    if (unsupported() && s.helper.state !== "connected") return { ...s.helper, unsupported: true };
    return ["missing", "failed", "stopped"].includes(s.helper.state) ? s.helper : null;
  }

  /** What a view waiting on `key` shows: "down" | "timeout" | "loading". */
  function loadState(key) {
    if (helperDown()) return "down";
    return s.waits.get(key)?.timedOut ? "timeout" : "loading";
  }

  const store = {
    state: s,
    visibleConversations,
    receive,
    actions,
    summary,
    conv: id => s.convs.get(id) ?? null,
    targetInfo,
    subscribe,
    emit,
    helperDown,
    loadState,
    unsupported,
  };
  return store;
}
