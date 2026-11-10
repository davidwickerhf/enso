// Tools (claude.ai connectors and MCP servers): the look of each tool, a
// popover with details anchored to an icon or row, and the Tools page with
// an "Add more" catalog modelled on Dia's Settings → Apps.

import { h, icon, clear } from "../dom.js";
import { loadingOr } from "./helperstate.js";

const CONNECTORS_URL = "https://claude.ai/customize/connectors";

// Known tools: icon (drawn) or a letter in a tinted circle.
const LOOKS = [
  { re: /gmail|outlook mail/i, icon: "mail", order: 0 },
  { re: /calendar/i, icon: "calendar", order: 1 },
  { re: /drive/i, icon: "folder", order: 2 },
  { re: /docs/i, icon: "page", order: 3 },
  { re: /microsoft|m365|outlook|teams|sharepoint|onedrive/i, letter: "M", tint: "#d83b01", order: 4 },
  { re: /study|canvas|course|learn/i, icon: "book", order: 5 },
  { re: /language|tutor|duolingo|anki/i, icon: "languages", order: 6 },
  { re: /slack/i, letter: "S", tint: "#611f69", order: 7 },
  { re: /notion/i, letter: "N", tint: "#2f2f2f", order: 8 },
  { re: /linear/i, letter: "L", tint: "#5e6ad2", order: 9 },
  { re: /github/i, letter: "G", tint: "#24292f", order: 10 },
  { re: /atlassian|jira|confluence/i, letter: "A", tint: "#0052cc", order: 11 },
  { re: /figma/i, letter: "F", tint: "#a259ff", order: 12 },
  { re: /asana/i, letter: "A", tint: "#f06a6a", order: 13 },
  { re: /monday/i, letter: "m", tint: "#6161ff", order: 14 },
];

export const labelOf = sv => sv.label || String(sv.name ?? "").replace(/^claude\.ai\s+/i, "");
const lookOf = sv => LOOKS.find(l => l.re.test(`${labelOf(sv)} ${sv.name ?? ""}`)) ?? null;

export function toolGlyph(sv, cls = "") {
  const look = lookOf(sv);
  if (look?.icon) return h("span", { class: `tool-glyph ${cls}`.trim(), aria: { hidden: "true" } }, icon(look.icon));
  const letter = look?.letter ?? (labelOf(sv).match(/[A-Za-z0-9]/)?.[0] ?? "?").toUpperCase();
  const glyph = h("span", { class: `tool-glyph letter ${cls}`.trim(), aria: { hidden: "true" } }, letter);
  if (look?.tint) glyph.style.setProperty("--tint", look.tint);
  return glyph;
}

export function sortTools(list) {
  return [...list].sort((a, b) => (lookOf(a)?.order ?? 50) - (lookOf(b)?.order ?? 50) || labelOf(a).localeCompare(labelOf(b)));
}

/** Signed in through Ensō, but the server itself failed (e.g. it answered with HTTP 500). */
export const signedInButFailing = sv => sv.auth?.state === "connected" && sv.status === "failed";

export function statusOf(sv) {
  if (sv.enabled === false) return { key: "off", text: "Off" };
  if (signedInButFailing(sv)) return { key: "failed", text: "Signed in · server error" };
  const auth = { connecting: { key: "pending", text: "Waiting for sign-in…" }, expired: { key: "auth", text: "Sign-in expired" }, error: { key: "failed", text: "Sign-in failed" }, disconnected: { key: "auth", text: "Not connected" } }[sv.auth?.state];
  if (auth) return auth;
  return { connected: { key: "ok", text: "Connected" }, "needs-auth": { key: "auth", text: "Needs sign-in" }, pending: { key: "pending", text: "Connecting…" }, failed: { key: "failed", text: "Failed" } }[sv.status] ?? { key: "pending", text: sv.status ?? "" };
}

/** "mcp__claude_ai_Gmail__search_threads" / "search_threads" → "Search threads" */
export function humanTool(name) {
  const base = String(name).split("__").pop().replace(/[_-]+/g, " ").trim();
  return base ? base[0].toUpperCase() + base.slice(1) : String(name);
}

/** Sign-in state and buttons for a server Ensō signs in to itself (sv.auth, OAuth). */
function connectBlock(store, sv) {
  const a = sv.auth;
  const label = labelOf(sv);
  const connect = (text, cls = "primary") => h("button", { type: "button", class: `btn small ${cls}`, onclick: () => store.actions.connectServer(sv.name) }, text);
  const block = (p, ...buttons) => h("div", { class: "tp-connect" }, p, h("div", { class: "tp-connect-actions" }, buttons));
  switch (a.state) {
    case "connected": {
      if (sv.status !== "failed") return null;
      const probing = store.state.probing?.has(sv.name);
      // "The server returned a server error (HTTP 500)." says the same thing again: keep just the code then.
      const code = /HTTP (\d{3})/.exec(sv.error ?? "")?.[1];
      const detail = code && /^The server returned/.test(sv.error) ? null : sv.error;
      return block(h("p", { class: "tp-auth bad" }, `Signed in · the server returned an error${code ? ` (HTTP ${code})` : ""}.`, detail ? h("span", { class: "tp-err-detail" }, ` ${detail}`) : null),
        h("button", { type: "button", class: "btn small primary", disabled: probing, onclick: () => store.actions.probeServer(sv.name) }, probing ? "Retrying…" : "Retry"));
    }
    case "connecting":
      return block(h("p", { class: "tp-auth" }, `Finish signing in to ${label} in the tab that just opened.`),
        a.authUrl ? h("a", { class: "btn small", href: a.authUrl, target: "_blank", rel: "noreferrer noopener" }, "Open sign-in again", icon("arrowUpRight")) : null,
        connect("Start over", "ghost"));
    case "expired":
      return block(h("p", { class: "tp-auth" }, `Your sign-in to ${label} has expired. Sign in again to keep using it.`), connect("Reconnect"));
    case "error":
      return block(h("p", { class: "tp-auth bad" }, a.error || "The sign-in didn't finish."), connect("Try again"));
    default:
      return block(h("p", { class: "tp-auth" }, `Sign in to ${label} so Ensō can use it. The sign-in page opens in a new tab.`), connect(`Connect ${label}`));
  }
}

/** Details shared by the popover and the expanded row on the Tools page. */
export function serverDetails(store, sv, ctx, { onDone } = {}) {
  const st = statusOf(sv);
  const label = labelOf(sv);
  const names = sv.toolNames ?? [];
  let showAll = false;
  const listEl = h("div", { class: "tp-tools" });
  const renderNames = () => {
    const shown = showAll ? names : names.slice(0, 8);
    clear(listEl, names.length
      ? [h("ul", null, shown.map(n => h("li", null, humanTool(n)))), names.length > 8 ? h("button", { type: "button", class: "link-btn", onclick: () => { showAll = !showAll; renderNames(); } }, showAll ? "Show fewer" : `+${names.length - 8} more`) : null]
      : h("p", { class: "muted small" }, typeof sv.tools === "number" && sv.tools ? `${sv.tools} tools. Their names appear after your first chat on the subscription engine.` : "Tool names appear after your first chat on the subscription engine."));
  };
  renderNames();
  const sw = h("button", { type: "button", role: "switch", class: "switch", aria: { checked: String(sv.enabled !== false), label: `Use ${label}` }, onclick: () => {
    const on = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(on));
    store.actions.toggleTool(sv.name, on);
  } }, h("span", { class: "knob" }));
  const oauth = !!sv.auth;
  const needsAuth = oauth ? sv.auth.state !== "connected" : sv.status === "needs-auth";
  return h("div", { class: "tp-details" },
    sv.about ? h("p", { class: "tp-about" }, sv.about) : null,
    oauth ? connectBlock(store, sv) : null,
    sv.detail ? builtInStatus(store, sv) : needsAuth && !oauth ? h("p", { class: "tp-auth" }, "Sign in to use it. ", sv.connectUrl ? h("a", { href: sv.connectUrl, target: "_blank", rel: "noreferrer noopener" }, "Sign in ↗") : "See chat/host/config.json.") : null,
    sv.examples?.length && !needsAuth && sv.enabled !== false && !signedInButFailing(sv) ? h("div", { class: "tp-examples" }, h("span", { class: "tp-sub" }, "Try"),
      sv.examples.slice(0, 3).map(ex => h("button", { type: "button", class: "tp-example", onclick: () => { onDone?.(); ctx.ask(`Using ${label}: ${ex}`); } }, icon("sparkle"), h("span", null, ex)))) : null,
    h("details", { class: "tp-can" }, h("summary", null, "What it can do", names.length ? h("span", { class: "muted" }, ` · ${names.length}`) : null), listEl),
    h("div", { class: "tp-foot" },
      h("label", { class: "tp-switch" }, sw, h("span", null, sv.enabled === false ? "Off" : "On")),
      oauth ? h("span", { class: "tp-connect-actions" },
        sv.auth.state === "connected" ? h("button", { type: "button", class: "btn small ghost", onclick: () => store.actions.disconnectServer(sv.name) }, "Disconnect") : null,
        sv.auth.custom ? h("button", { type: "button", class: "btn small ghost danger", onclick: () => store.actions.removeServer(sv.name) }, "Remove") : null) : null,
      sv.connectUrl ? h("a", { class: "btn small ghost", href: sv.connectUrl, target: "_blank", rel: "noreferrer noopener" }, needsAuth ? "Sign in" : "Manage", icon("arrowUpRight")) : null),
    st.key === "failed" && !oauth ? h("p", { class: "tp-auth bad" }, "It failed to start. Check chat/host/config.json or its sign-in.") : null);
}

/** Built-in tools (GitHub): their status line, and a token box that saves to the Keychain. */
function builtInStatus(store, sv) {
  const g = store.state.github ?? {};
  const line = h("p", { class: ["tp-detail", sv.status === "connected" ? "ok" : "tp-auth"] }, sv.detail.split(/`([^`]+)`/).map((part, i) => (i % 2 ? h("code", null, part) : part)));
  if (!sv.tokenEntry) return line;
  const input = h("input", { type: "password", class: "tp-token-input", placeholder: "ghp_… or github_pat_…", autocomplete: "off", spellcheck: "false", aria: { label: "GitHub token" } });
  const submit = () => { if (input.value.trim()) { store.actions.saveGithubToken(input.value.trim()); input.value = ""; } };
  input.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); submit(); } });
  const note = g.saving ? "Checking the token…" : g.saved?.ok === false ? g.saved.error : g.saved?.ok ? `Saved for ${g.saved.login}.` : "No GitHub CLI? Paste a token (classic with repo, read:org, notifications; or fine-grained). It is checked, then stored in your macOS Keychain.";
  return h("div", { class: "tp-token" }, line,
    h("form", { class: "tp-token-row", onsubmit: e => { e.preventDefault(); submit(); } }, input, h("button", { type: "submit", class: "btn small", disabled: !!g.saving }, "Save")),
    h("p", { class: ["tp-token-note", g.saved?.ok === false && "bad"] }, note));
}

function head(sv) {
  const st = statusOf(sv);
  return h("div", { class: "tp-head" }, toolGlyph(sv, "big"),
    h("div", { class: "tp-title" }, h("strong", null, labelOf(sv)), h("span", { class: `tp-status s-${st.key}` }, h("i"), st.text, sv.source ? h("span", { class: "muted" }, ` · ${sv.source === "claude.ai connector" ? "claude.ai" : sv.source === "built in" ? "built in" : "MCP"}`) : null)));
}

// ---- popover ---------------------------------------------------------------

let current = null;

export function closeToolPopover() {
  if (!current) return;
  const { el, anchor, cleanup } = current;
  current = null;
  cleanup();
  el.remove();
  anchor?.setAttribute("aria-expanded", "false");
  if (anchor?.isConnected) anchor.focus();
}

export function openToolPopover(store, sv, anchor, ctx) {
  if (current?.anchor === anchor) return closeToolPopover();
  closeToolPopover();
  const el = h("div", { class: "tool-popover", role: "dialog", aria: { label: labelOf(sv) } },
    head(sv), serverDetails(store, sv, ctx, { onDone: closeToolPopover }),
    h("button", { type: "button", class: "link-btn tp-manage-all", onclick: () => { closeToolPopover(); store.actions.go("tools"); } }, "All tools", icon("chevronRight")));
  document.body.append(el);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 10 + el.offsetHeight < window.innerHeight;
    el.style.left = `${left}px`;
    el.style.top = `${below ? r.bottom + 10 : Math.max(12, r.top - 10 - el.offsetHeight)}px`;
  };
  place();
  const onDoc = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeToolPopover(); };
  const onKey = e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeToolPopover(); }
    if (e.key === "Tab") {
      const f = [...el.querySelectorAll("button, a[href], summary")].filter(x => !x.disabled);
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDoc), 0);
  el.addEventListener("keydown", onKey);
  window.addEventListener("resize", place);
  current = { el, anchor, cleanup: () => { document.removeEventListener("pointerdown", onDoc); window.removeEventListener("resize", place); } };
  anchor.setAttribute("aria-expanded", "true");
  el.querySelector("button, a[href]")?.focus();
}

// ---- Tools page --------------------------------------------------------------

const CATALOG = [
  { key: "m365", name: "Microsoft 365", adds: "Outlook mail and calendar, Teams chats and meetings, SharePoint and OneDrive files.", note: "Your organisation's admin must allow it.", match: /microsoft|m365|outlook|teams/i },
  { key: "slack", name: "Slack", adds: "Search channels and threads, catch up on what you missed.", match: /slack/i },
  { key: "notion", name: "Notion", adds: "Search and edit your Notion pages and databases.", match: /notion/i },
  { key: "linear", name: "Linear", adds: "Issues, projects and cycles: triage and update work.", match: /linear/i },
  { key: "github", name: "GitHub", adds: "Repositories, pull requests and issues.", match: /github/i },
  { key: "atlassian", name: "Atlassian", adds: "Jira issues and Confluence pages.", match: /atlassian|jira|confluence/i },
  { key: "figma", name: "Figma", adds: "Read designs and comments from your files.", match: /figma/i },
  { key: "asana", name: "Asana", adds: "Tasks and projects across your teams.", match: /asana/i },
  { key: "monday", name: "monday.com", adds: "Boards, items, updates and docs: see and update your team's work.", match: /monday/i, mcp: { name: "monday", url: "https://mcp.monday.com/mcp", label: "monday.com" } },
  { key: "gmail", name: "Gmail", adds: "Search, read and draft email.", match: /gmail/i },
  { key: "gcal", name: "Google Calendar", adds: "Events, free time and scheduling.", match: /calendar/i },
  { key: "gdrive", name: "Google Drive", adds: "Find and read files in Drive.", match: /drive/i },
];

export function createToolsPage(store, ctx) {
  const { state: s } = store;
  const open = new Set();
  const seen = new Set(); // servers already auto-expanded because they need a sign-in

  // Add a custom server (kept across renders so typing survives updates).
  const nameIn = h("input", { type: "text", class: "input", placeholder: "notes", pattern: "[A-Za-z0-9][A-Za-z0-9_\\-]{0,40}", required: true, autocomplete: "off", spellcheck: "false" });
  const urlIn = h("input", { type: "url", class: "input", placeholder: "https://example.com/mcp", required: true, autocomplete: "off", spellcheck: "false" });
  const addErr = h("p", { class: "tp-auth bad", role: "alert", hidden: true });
  let adding = null;
  const addForm = h("form", { class: "cat-tile custom add-server", novalidate: true, oninput: () => { addErr.hidden = true; }, onsubmit: e => {
    e.preventDefault();
    const name = nameIn.value.trim();
    const url = urlIn.value.trim();
    let problem = null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/.test(name)) problem = "Give it a short name: letters, digits, - or _.";
    else {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(u.hostname))) problem = "Use an https:// URL.";
      } catch { problem = "That isn't a valid URL."; }
    }
    addErr.hidden = !problem;
    addErr.textContent = problem ?? "";
    if (problem) return;
    adding = name;
    open.add(name);
    store.actions.addServer({ name, url });
  } },
    h("div", { class: "cat-top" }, h("span", { class: "tool-glyph big" }, icon("server")), h("strong", null, "Custom MCP server")),
    h("p", { class: "cat-adds" }, "Any MCP server that signs in with OAuth. Ensō opens its sign-in page and keeps the token in your Keychain."),
    h("label", { class: "field" }, h("span", null, "Name"), nameIn),
    h("label", { class: "field" }, h("span", null, "MCP URL"), urlIn),
    addErr,
    h("button", { type: "submit", class: "btn small primary" }, "Connect"),
    h("p", { class: "cat-note" }, "Servers with an API key instead go under ", h("code", null, "extraServers"), " in ", h("code", null, "config.local.json"), " (Ensō's data folder)", "."));
  const listEl = h("div", { class: "tools-groups" });
  const catalogEl = h("div", { class: "catalog" });
  const el = h("section", { class: "page-view tools-view", aria: { label: "Tools" } },
    h("header", { class: "page-head" }, h("h2", null, "Tools"), h("p", { class: "muted" }, "What Ensō can use: your claude.ai connectors and MCP servers. Switch one off to keep it out of future chats.")),
    listEl,
    h("section", { class: "settings-block add-more" }, h("h3", null, "Add more"),
      h("p", { class: "block-desc" }, "Connect apps on claude.ai; on the subscription engine they show up in Ensō automatically. Or add any MCP server that signs in with OAuth."),
      catalogEl));

  function row(sv) {
    const st = statusOf(sv);
    const isOpen = open.has(sv.name);
    const count = sv.toolNames?.length || (typeof sv.tools === "number" ? sv.tools : 0);
    const btn = h("button", { type: "button", class: "tr-head", aria: { expanded: String(isOpen) }, onclick: () => { if (open.has(sv.name)) open.delete(sv.name); else open.add(sv.name); render(); } },
      toolGlyph(sv),
      h("span", { class: "tr-main" }, h("span", { class: "tr-label" }, labelOf(sv)), h("span", { class: "tr-about" }, sv.about || (count ? `${count} tools` : ""))),
      h("span", { class: `tp-status s-${st.key}` }, h("i"), st.text),
      icon("chevronRight", "chev"));
    return h("li", { class: ["tool-row", isOpen && "open", st.key === "off" && "is-off"] }, btn, isOpen ? serverDetails(store, sv, ctx) : null);
  }

  function render() {
    const all = sortTools(s.servers ?? []);
    for (const x of all) if (x.auth && x.auth.state !== "connected" && x.enabled !== false && !seen.has(x.name)) (seen.add(x.name), open.add(x.name));
    const r = s.connectionResult;
    if (adding && r?.server === adding) {
      if (r.ok || !r.add) { nameIn.value = ""; urlIn.value = ""; }
      addErr.hidden = r.ok || !r.add;
      addErr.textContent = r.add && !r.ok ? r.error : "";
      adding = null;
    }
    const groups = [
      ["Connected via claude.ai", all.filter(x => x.source === "claude.ai connector" || /^claude\.ai /i.test(x.name ?? ""))],
      ["Built into Ensō", all.filter(x => x.source === "built in")],
      ["MCP servers", all.filter(x => x.source !== "built in" && !(x.source === "claude.ai connector" || /^claude\.ai /i.test(x.name ?? "")))],
    ];
    clear(listEl, groups.filter(([, l]) => l.length).map(([title, l]) => h("section", { class: "tools-group" }, h("h3", { class: "group-label" }, title), h("ul", { class: "tool-rows" }, l.map(row)))),
      all.length ? null : s.ready ? h("p", { class: "muted" }, "No tools yet.") : loadingOr(store, "state", "Loading your tools…"));
    const names = all.map(x => `${labelOf(x)} ${x.name}`);
    clear(catalogEl, CATALOG.map(c => {
      const have = all.find(x => c.match.test(`${labelOf(x)} ${x.name}`));
      const connected = have && have.status === "connected";
      return h("div", { class: ["cat-tile", connected && "have"] },
        h("div", { class: "cat-top" }, toolGlyph({ label: c.name }, "big"), h("strong", null, c.name)),
        h("p", { class: "cat-adds" }, c.adds),
        c.note ? h("p", { class: "cat-note" }, c.note) : null,
        connected ? h("span", { class: "cat-state" }, icon("check"), "Connected")
          // Signed in, but the server returned an error: say so and re-probe, don't start a new sign-in.
          : have && signedInButFailing(have) ? h("span", { class: "cat-failing" }, h("span", { class: "cat-state bad", title: have.error ?? "" }, icon("alert"), "Signed in · server error"),
            h("button", { type: "button", class: "btn small", disabled: s.probing?.has(have.name), onclick: () => store.actions.probeServer(have.name) }, s.probing?.has(have.name) ? "Retrying…" : "Retry"))
          : have?.status === "needs-auth" && !have.auth ? h("a", { class: "btn small", href: have.connectUrl || CONNECTORS_URL, target: "_blank", rel: "noreferrer noopener" }, "Sign in", icon("arrowUpRight"))
          // Already added through Ensō but not signed in (e.g. an abandoned sign-in): start the sign-in again instead of adding it twice.
          : have?.auth ? h("button", { type: "button", class: "btn small primary", onclick: () => store.actions.connectServer(have.name) }, have.auth.state === "connecting" ? "Start sign-in again" : "Sign in")
          : c.mcp ? h("button", { type: "button", class: "btn small primary", onclick: () => { adding = c.mcp.name; store.actions.addServer(c.mcp); } }, "Connect")
          : h("a", { class: "btn small", href: CONNECTORS_URL, target: "_blank", rel: "noreferrer noopener" }, "Connect on claude.ai", icon("arrowUpRight")));
    }), addForm);
    void names;
  }

  render();
  return {
    el,
    update(topics) { if (topics.has("servers") || topics.has("state") || topics.has("github") || (!s.ready && (topics.has("waits") || topics.has("helper")))) render(); },
    show() { render(); },
  };
}
