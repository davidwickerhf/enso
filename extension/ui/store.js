// The one store. Holds everything from `state` plus loaded conversations, folds
// protocol messages into it, and tells views which parts changed ("topics").
//
// Topics: connection, state, conversations, conv:<id>, dashboard, settings,
// servers, approvals, history, actions, memory, ui, tab, github.

export function createStore() {
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
    paths: null,             // { data, localConfig } on this Mac
    dashboard: { data: null, loading: false, error: null },
    github: { data: null, loading: false, error: null, at: 0, saving: false, saved: null }, // new-tab widget + token entry
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
    ui: { view: "home", currentId: null, includePage: true, pendingSend: null, notice: null, scope: "space" },
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
          s.history.results = msg.results ?? [];
          s.history.loading = false;
          emit("history");
        }
        return;
      case "actions.results": {
        const who = actionRequests.shift() ?? (s.actions.filter ? null : "log");
        if (who === "recent") { s.recentActions = msg.actions ?? []; emit("dashboard"); }
        if (who === "log") { s.actions.results = msg.actions ?? []; s.actions.loading = false; emit("actions"); }
        return;
      }
      case "dashboard":
        if (msg.loading) s.dashboard = { ...s.dashboard, loading: true, error: null };
        else s.dashboard = { data: msg.data ?? s.dashboard.data, loading: false, error: msg.error ?? null };
        emit("dashboard");
        return;
      case "github":
        s.github = { ...s.github, data: msg.data ?? s.github.data, loading: false, error: msg.error ?? null, at: Date.now() };
        emit("github");
        return;
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
        s.space = space ?? null;
        emit("tab");
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
    const hash = view === "chat" && currentId && currentId !== "draft" ? `#conversation=${encodeURIComponent(currentId)}` : view === "home" || view === "chat" ? "" : `#${view}`;
    if (location.hash !== hash) history.replaceState(null, "", hash || location.pathname + location.search);
  }

  function readHash() {
    const m = location.hash.match(/^#conversation=(.+)$/);
    if (m) return { view: "chat", id: decodeURIComponent(m[1]) };
    const view = location.hash.slice(1);
    return ["history", "activity", "settings", "reports", "tools"].includes(view) ? { view } : { view: "home" };
  }

  // ---- actions (UI → host) ----------------------------------------------

  const actions = {
    attach(t) { transport = t; s.transportKind = t.kind; },
    setConnection(status) { s.connection = status; emit("connection"); },
    hello() {
      send({ type: "hello" });
      send({ type: "page.current" });
      send({ type: "reports.list" });
    },

    go(view) {
      s.ui.view = view;
      if (view !== "chat") s.ui.currentId = view === "home" ? null : s.ui.currentId;
      if (view === "activity" && !s.actions.results) actions.listActions(s.actions.filter);
      if (view === "settings" && !s.memory.loaded) send({ type: "memory.get" });
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
      if (!c.loaded) c.loading = true;
      send({ type: "conversation.open", id });
      syncHash();
      emit("ui", `conv:${id}`);
    },
    restoreFromHash() {
      const r = readHash();
      if (r.view === "chat") actions.open(r.id);
      else actions.go(r.view);
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
      const scoped = s.ui.scope === "space" && s.space;
      send({ type: "history.search", query, ...(scoped && { spaceId: s.space.id }) });
      emit("history");
    },
    listActions(filter = null, who = "log") {
      if (who === "log") { s.actions.filter = filter; s.actions.loading = true; emit("actions"); }
      actionRequests.push(who);
      send({ type: "actions.list", ...(filter?.host && { host: filter.host }), limit: who === "recent" ? 8 : 200 });
    },
    refreshDashboard() {
      s.dashboard = { ...s.dashboard, loading: true, error: null };
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
    /** Onboarding and Settings → Profile: name, about, and { spaceId: hint } (empty text removes a hint). */
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
    loadMemory(spaceId = null) { send({ type: "memory.get", ...(spaceId && { spaceId }) }); },
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
    getReport(id) { send({ type: "report.get", id }); },
  };

  try { const sc = localStorage.getItem("enso.scope"); if (sc === "all" || sc === "space") s.ui.scope = sc; } catch { /* ignore */ }

  /** Conversations for lists: this space by default, all spaces when toggled (or without a current space). */
  function visibleConversations() {
    if (s.ui.scope !== "space" || !s.space) return s.conversations;
    return s.conversations.filter(c => c.space?.id === s.space.id);
  }

  return {
    state: s,
    visibleConversations,
    receive,
    actions,
    summary,
    conv: id => s.convs.get(id) ?? null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit,
  };
}
