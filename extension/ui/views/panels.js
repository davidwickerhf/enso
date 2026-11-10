// Full-page side panels: navigation + conversation list on the left, and the
// context panel (current page, pages and actions of this conversation, memory)
// on the right.

import { h, icon, clear, iconButton, hostBadge, extLink, spaceIcon } from "../dom.js";
import { scopeToggle } from "./history.js";
import { relTime, hostOf, describeAction, actionIcon, fullDate } from "../format.js";
import { renderMarkdown } from "../markdown.js";
import { openReport } from "../transport.js";
import { favicon, MOD } from "./composer.js";
import { needsAttention } from "./settings.js";

export function createNav(store, ctx) {
  const { state: s, actions } = store;
  const items = h("nav", { class: "nav-items", aria: { label: "Main" } });
  const convs = h("div", { class: "nav-convs" });
  const reports = h("div", { class: "nav-reports" });
  const search = h("input", { type: "search", class: "search-input", placeholder: "Search", aria: { label: "Search conversations" } });
  search.addEventListener("focus", () => { if (s.ui.view !== "history") actions.go("history"); });
  search.addEventListener("input", () => { if (s.ui.view !== "history") actions.go("history"); ctx.historySearch(search.value); });
  const foot = h("div", { class: "nav-foot" });
  const el = h("aside", { class: "nav", aria: { label: "Conversations" } },
    h("div", { class: "nav-brand" }, h("span", { class: "brand-mark", aria: { hidden: "true" } }), h("span", { class: "brand-name" }, "Ensō"),
      iconButton("plus", `New chat (${MOD}N)`, () => ctx.newChat(), { class: "nav-new" })),
    h("label", { class: "search nav-search" }, icon("search"), search),
    items,
    h("div", { class: "nav-scroll" }, h("div", { class: "nav-scope" }), convs, reports),
    foot);

  function navItem(view, iconName, label, attn = false) {
    const on = s.ui.view === view;
    return h("button", { type: "button", class: ["nav-item", on && "on"], aria: { current: on ? "page" : null }, onclick: () => actions.go(view) }, icon(iconName), h("span", null, label),
      attn ? h("span", { class: "attn-dot", title: "Something in Settings needs you" }, h("span", { class: "sr-only" }, " (needs attention)")) : null);
  }

  function render() {
    clear(items, navItem("home", "home", "Home"), navItem("activity", "activity", "Activity"), navItem("tools", "tool", "Tools"), navItem("settings", "sliders", "Settings", needsAttention(s)));
    const waiting = new Set([...s.approvals.values()].map(a => a.conversationId));
    const list = store.visibleConversations();
    clear(el.querySelector(".nav-scope"), h("h3", { class: "nav-label" }, "Conversations"), s.space ? scopeToggle(store, true) : null);
    clear(convs, list.length ? h("ul", null, list.slice(0, 60).map(c => h("li", null,
      h("button", { type: "button", class: ["nav-conv", s.ui.view === "chat" && s.ui.currentId === c.id && "on"], title: c.title, onclick: () => actions.open(c.id) },
        s.running.has(c.id) ? h("span", { class: "live-dot", title: "Answering" }) : waiting.has(c.id) ? h("span", { class: "attn-dot", title: "Waiting for your approval" }) : c.space ? h("span", { class: "conv-space", title: `Space: ${c.space.name}` }, spaceIcon(c.space, "tiny")) : null,
        h("span", { class: "nav-conv-title" }, c.title || "Untitled"),
        h("span", { class: "nav-conv-time" }, shortTime(c.updatedAt)))))) : h("p", { class: "muted small pad" }, s.conversations.length ? `Nothing in ${s.space?.name ?? "this space"} yet.` : "No conversations yet."),
      list.length > 60 ? h("button", { type: "button", class: "link-btn pad", onclick: () => actions.go("history") }, "All conversations") : null);
    const rlist = s.reports ?? [];
    clear(reports, rlist.length ? [h("h3", { class: "nav-label" }, "Reports"), h("ul", null, rlist.slice(0, 12).map(r => h("li", null, h("button", { type: "button", class: "nav-conv", title: r.title, onclick: () => openReport(r.id) }, icon("report"), h("span", { class: "nav-conv-title" }, r.title), h("span", { class: "nav-conv-time" }, shortTime(r.createdAt))))))] : null);
    const eng = s.settings?.engine === "api" ? "API key" : "Subscription";
    const connected = (s.servers ?? []).filter(x => x.status === "connected" && x.enabled !== false).length;
    clear(foot, h("button", { type: "button", class: "nav-status", onclick: () => actions.go("tools"), title: "Engine and tools" },
      h("span", { class: ["status-dot", s.connection === "connected" ? "ok" : "warn"] }),
      h("span", null, `${eng} · ${s.settings?.model?.replace(/^claude-/, "") ?? ""}`),
      h("span", { class: "muted" }, `${connected} tools`)));
  }

  render();
  return {
    el,
    update(topics) { if (["conversations", "ui", "approvals", "reports", "settings", "servers", "connection", "state", "space", "setup", "t3"].some(t => topics.has(t)) || [...topics].some(t => t.startsWith("conv:"))) render(); },
  };
}

function shortTime(at) {
  const r = relTime(at);
  return r.replace(" min ago", "m").replace(" h ago", "h").replace("just now", "now");
}

export function createContext(store, ctx) {
  const { state: s, actions } = store;
  const pageEl = h("section", { class: "ctx-block" });
  const convEl = h("section", { class: "ctx-block" });
  const actsEl = h("section", { class: "ctx-block" });
  const memEl = h("section", { class: "ctx-block" });
  const el = h("aside", { class: "context", aria: { label: "Context" } }, pageEl, convEl, actsEl, memEl);

  function head(iconName, title, extra) {
    return h("h3", { class: "ctx-title" }, icon(iconName), h("span", null, title), extra ?? null);
  }

  function renderPage() {
    const t = s.tab;
    clear(pageEl, head("page", "This page"),
      !t ? h("p", { class: "muted small" }, "No web page open.")
        : t.sensitive ? h("div", { class: "ctx-page private" }, h("span", { class: "page-chip-icon" }, icon("lock")), h("span", { class: "ctx-page-text" }, h("strong", null, "Private page — not shared"), h("small", null, hostOf(t.url))))
        : [h("a", { class: "ctx-page", href: t.url, target: "_blank", rel: "noreferrer noopener", title: t.url }, h("span", { class: "page-chip-icon" }, favicon(t.url, t.favIconUrl)), h("span", { class: "ctx-page-text" }, h("strong", null, t.title || hostOf(t.url)), h("small", null, hostOf(t.url)))),
           h("div", { class: "setting compact" }, h("div", { class: "setting-text" }, h("label", null, "Include with messages")),
             h("button", { type: "button", role: "switch", class: "switch", aria: { checked: String(s.ui.includePage), label: "Include this page with messages" }, onclick: () => actions.setIncludePage(!s.ui.includePage) }, h("span", { class: "knob" })))]);
  }

  function currentConv() {
    const id = s.ui.view === "chat" ? s.ui.currentId : null;
    return id ? { id, sum: store.summary(id), c: store.conv(id) } : null;
  }

  function renderConv() {
    const cur = currentConv();
    const pages = cur?.sum?.pages ?? [];
    convEl.hidden = !cur;
    if (!cur) return;
    clear(convEl, head("layers", "Pages in this conversation"),
      pages.length ? h("ul", { class: "ctx-list" }, pages.map(p => h("li", null, h("a", { href: p.url, target: "_blank", rel: "noreferrer noopener", title: p.url }, hostBadge(hostOf(p.url)), h("span", null, p.title || p.url))))) : h("p", { class: "muted small" }, "No pages yet."));
  }

  function renderActs() {
    const cur = currentConv();
    let acts;
    if (cur?.c) acts = cur.c.events.filter(e => e.kind === "page.action").slice().reverse();
    else acts = (s.recentActions ?? []).slice(0, 6);
    clear(actsEl, head("activity", cur ? "Actions in this conversation" : "Recent page actions", h("button", { type: "button", class: "link-btn", onclick: () => actions.go("activity") }, "Log")),
      acts.length ? h("ol", { class: "ctx-acts" }, acts.map(a => h("li", { class: a.ok === false ? "failed" : "" },
        h("span", { class: ["act-icon", a.ok === false && "bad"] }, icon(actionIcon(a.action))),
        h("span", { class: "ctx-act-main" }, h("span", null, describeAction(a.action, a.target, a.url)), h("small", { title: fullDate(a.at) }, relTime(a.at)))))) : h("p", { class: "muted small" }, cur ? "Nothing done on pages yet." : "No page actions yet."));
  }

  function renderMem() {
    const text = s.memory.text ?? "";
    const preview = text.split("\n").slice(0, 14).join("\n");
    clear(memEl, head("bookmark", "Memory", h("button", { type: "button", class: "link-btn", onclick: () => ctx.editMemory() }, "Edit")),
      !s.memory.loaded ? h("div", { class: "skel w75" }) : text.trim() ? h("div", { class: "ctx-memory md small" }, renderMarkdown(preview)) : h("p", { class: "muted small" }, "Nothing remembered yet."));
  }

  function renderAll() { renderPage(); renderConv(); renderActs(); renderMem(); }
  renderAll();
  return {
    el,
    update(topics) {
      if (topics.has("tab") || topics.has("ui")) renderPage();
      if (topics.has("ui") || topics.has("conversations")) renderConv();
      if (topics.has("ui") || topics.has("dashboard") || topics.has(`conv:${s.ui.currentId}`)) renderActs();
      if (topics.has("memory")) renderMem();
    },
  };
}
