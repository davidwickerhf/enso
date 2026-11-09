// History (conversation list + search, rename, delete) and the Activity log of
// page actions, filterable by site.

import { h, icon, clear, hostBadge, iconButton, spaceIcon } from "../dom.js";
import { relTime, dayLabel, hostOf, describeAction, actionIcon, fullDate, plural } from "../format.js";

export function createHistory(store, ctx) {
  const { state: s, actions } = store;
  const ui = { renaming: null, confirming: null };
  let debounce = 0;
  const input = h("input", { type: "search", class: "search-input", placeholder: "Search conversations…", aria: { label: "Search conversations" }, autocomplete: "off" });
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => actions.search(input.value), 180);
  });
  input.addEventListener("keydown", e => { if (e.key === "Escape" && input.value) { e.stopPropagation(); input.value = ""; actions.search(""); } });
  const listEl = h("div", { class: "history-list" });
  const scopeEl = h("div", { class: "scope-row" });
  const el = h("section", { class: "page-view history-view", aria: { label: "History" } },
    h("header", { class: "page-head" }, h("h2", null, "History"), h("p", { class: "muted" }, `${plural(s.conversations.length, "conversation")}`)),
    h("label", { class: "search" }, icon("search"), input),
    scopeEl,
    listEl);

  function highlight(text, query) {
    const q = query.trim().toLowerCase();
    if (!q) return text;
    const out = [];
    let rest = String(text ?? "");
    let i;
    while (q && (i = rest.toLowerCase().indexOf(q)) >= 0) {
      out.push(rest.slice(0, i), h("mark", null, rest.slice(i, i + q.length)));
      rest = rest.slice(i + q.length);
    }
    out.push(rest);
    return out;
  }

  function convRow(c) {
    const hosts = [...new Set((c.pages ?? []).map(p => hostOf(p.url)).filter(Boolean))];
    const running = s.running.has(c.id);
    const waiting = [...s.approvals.values()].some(a => a.conversationId === c.id);
    if (ui.renaming === c.id) {
      const field = h("input", { type: "text", class: "rename-input", value: c.title ?? "", aria: { label: "Conversation title" } });
      const done = save => { ui.renaming = null; if (save) actions.rename(c.id, field.value); render(); };
      field.addEventListener("keydown", e => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } });
      field.addEventListener("blur", () => done(true));
      requestAnimationFrame(() => { field.focus(); field.select(); });
      return h("li", { class: "conv-row editing" }, field);
    }
    if (ui.confirming === c.id) {
      return h("li", { class: "conv-row confirming", role: "alert" },
        h("span", null, "Delete “", c.title || "Untitled", "”?"),
        h("span", { class: "row-actions visible" },
          h("button", { type: "button", class: "btn small danger", onclick: () => { ui.confirming = null; actions.remove(c.id); } }, "Delete"),
          h("button", { type: "button", class: "btn small ghost", onclick: () => { ui.confirming = null; render(); } }, "Cancel")));
    }
    return h("li", { class: ["conv-row", s.ui.currentId === c.id && "current"] },
      h("button", { type: "button", class: "conv-open", onclick: () => actions.open(c.id) },
        h("span", { class: "conv-top" },
          h("span", { class: "conv-title" }, c.space ? h("span", { class: "conv-space", title: `Space: ${c.space.name}` }, spaceIcon(c.space, "tiny")) : null, running ? h("span", { class: "live-dot", title: "Answering" }) : null, waiting ? h("span", { class: "attn-dot", title: "Waiting for your approval" }) : null, c.title || "Untitled"),
          h("span", { class: "conv-time", title: fullDate(c.updatedAt) }, relTime(c.updatedAt))),
        c.preview ? h("span", { class: "conv-preview" }, c.preview) : null,
        h("span", { class: "conv-meta" },
          hosts.slice(0, 3).map(x => h("span", { class: "host" }, hostBadge(x), x)),
          hosts.length > 3 ? h("span", { class: "host more" }, `+${hosts.length - 3}`) : null,
          c.actionCount ? h("span", { class: "count", title: "Page actions" }, icon("cursor"), c.actionCount) : null,
          c.messageCount ? h("span", { class: "count", title: "Messages" }, icon("chat"), c.messageCount) : null)),
      h("span", { class: "row-actions" },
        iconButton("pencil", "Rename", () => { ui.renaming = c.id; render(); }, { class: "small" }),
        iconButton("trash", "Delete", () => { ui.confirming = c.id; render(); }, { class: "small" })));
  }

  function render() {
    const list = store.visibleConversations();
    el.querySelector(".page-head .muted").textContent = plural(list.length, "conversation");
    clear(scopeEl, s.space ? scopeToggle(store) : null);
    const q = s.history.query;
    if (q.trim()) {
      if (s.history.loading && !s.history.results) { clear(listEl, h("div", { class: "list-loading" }, h("span", { class: "spinner" }), "Searching…")); return; }
      const results = s.history.results ?? [];
      clear(listEl, results.length
        ? h("ul", { class: "result-list" }, results.map(r => h("li", null, h("button", { type: "button", class: "result", onclick: () => actions.open(r.conversationId) },
            h("span", { class: "conv-top" }, h("span", { class: "conv-title" }, highlight(r.title, q)), h("span", { class: "conv-time" }, relTime(r.at))),
            r.snippet ? h("span", { class: "conv-preview" }, highlight(r.snippet, q)) : null))))
        : h("div", { class: "empty-state" }, icon("search"), h("p", null, "Nothing matches “", q, "”.")));
      return;
    }
    if (!list.length) {
      if (s.conversations.length) { clear(listEl, h("div", { class: "empty-state" }, icon("chat"), h("p", null, `No conversations in ${s.space?.name ?? "this space"} yet.`), h("button", { type: "button", class: "btn", onclick: () => store.actions.setScope("all") }, "Show all spaces"))); return; }
      clear(listEl, h("div", { class: "empty-state" }, icon("chat"), h("p", null, "No conversations yet."), h("button", { type: "button", class: "btn", onclick: () => ctx.focusComposer() }, "Start one")));
      return;
    }
    const groups = new Map();
    for (const c of list) {
      const label = dayLabel(c.updatedAt);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(c);
    }
    clear(listEl, [...groups].map(([label, convs]) => h("div", { class: "group" }, h("h3", { class: "group-label" }, label), h("ul", { class: "conv-list" }, convs.map(convRow)))));
  }

  render();
  return {
    el,
    update(topics) { if (["history", "conversations", "approvals", "ui", "space"].some(t => topics.has(t))) render(); },
    show() { render(); },
    focus() { input.focus(); },
  };
}

/** "This space | All spaces" toggle shared by History and the full-page list. */
export function scopeToggle(store, compact = false) {
  const { state: s, actions } = store;
  const opt = (v, label) => h("button", { type: "button", role: "radio", class: ["seg", s.ui.scope === v && "on"], aria: { checked: String(s.ui.scope === v) }, onclick: () => s.ui.scope !== v && actions.setScope(v) }, label);
  return h("div", { class: ["segmented", "scope", compact && "compact"], role: "radiogroup", aria: { label: "Which conversations" } },
    opt("space", [spaceIcon(s.space, "tiny"), compact ? "This space" : `This space · ${s.space.name}`]), opt("all", "All spaces"));
}

export function createActivity(store) {
  const { state: s, actions } = store;
  let knownHosts = [];
  const filterEl = h("div", { class: "filter-chips", role: "group", aria: { label: "Filter by site" } });
  const listEl = h("div", { class: "activity-list" });
  const el = h("section", { class: "page-view activity-view", aria: { label: "Activity" } },
    h("header", { class: "page-head" }, h("h2", null, "Activity"), h("p", { class: "muted" }, "What Ensō did on web pages, newest first.")),
    filterEl, listEl);

  function render() {
    const results = s.actions.results;
    const current = s.actions.filter?.host ?? null;
    if (results && !current) knownHosts = [...new Set(results.map(a => a.host || hostOf(a.url)).filter(Boolean))];
    clear(filterEl,
      h("button", { type: "button", class: ["filter-chip", !current && "on"], aria: { pressed: String(!current) }, onclick: () => actions.listActions(null) }, "All sites"),
      knownHosts.map(host => h("button", { type: "button", class: ["filter-chip", current === host && "on"], aria: { pressed: String(current === host) }, onclick: () => actions.listActions({ host }) }, hostBadge(host), host)));
    if (!results) { clear(listEl, h("div", { class: "list-loading" }, h("span", { class: "spinner" }), "Loading…")); return; }
    if (!results.length) { clear(listEl, h("div", { class: "empty-state" }, icon("cursor"), h("p", null, current ? `No actions on ${current} yet.` : "No page actions yet. Ask it to fill a form or click through a site."))); return; }
    const groups = new Map();
    for (const a of results) {
      const label = new Date(a.at).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(a);
    }
    clear(listEl, [...groups].map(([label, acts]) => h("div", { class: "group" }, h("h3", { class: "group-label" }, label),
      h("ol", { class: "action-list" }, acts.map(a => h("li", { class: ["action-row", a.ok === false && "failed"] },
        h("span", { class: "action-time", title: fullDate(a.at) }, new Date(a.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })),
        h("span", { class: ["act-icon", a.ok === false && "bad"] }, icon(actionIcon(a.action))),
        h("span", { class: "action-main" },
          h("span", { class: "action-title" }, describeAction(a.action, a.target, a.url), a.ok === false ? h("span", { class: "badge bad" }, "failed") : null),
          h("a", { class: "action-page", href: a.url, target: "_blank", rel: "noreferrer noopener", title: a.url }, hostBadge(a.host || hostOf(a.url)), h("span", null, a.title || a.url))),
        a.conversationId ? h("button", { type: "button", class: "link-btn", onclick: () => actions.open(a.conversationId) }, "Conversation", icon("chevronRight")) : null))))));
  }

  render();
  return {
    el,
    update(topics) { if (topics.has("actions")) render(); },
    show() { if (!s.actions.results && !s.actions.loading) actions.listActions(null); render(); },
  };
}
