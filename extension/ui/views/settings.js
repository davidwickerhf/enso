// Settings, in sections. Full page and new tab: a short nav on the left and one
// section at a time. Sidebar: a list of sections that drills into one, with a
// back button in the top bar. A search box filters rows across every section
// by label and keywords. Deep links: #settings/<section> (see store.js).
//
// Sections: General, You & memory, Skills, Connections, Agents & screenshots,
// Privacy & safety, Setup, Advanced. Switches and pickers save at once (with a
// short "Saved"); text you type (profile, memory, skills) has its own Save.
// The helper-backed setup steps (Claude, GitHub, agents, token) come from
// createSetupKit in setup.js.

import { h, icon, clear, iconButton } from "../dom.js";
import { renderMarkdown } from "../markdown.js";
import { relTime } from "../format.js";
import { sortTools, labelOf, statusOf, toolGlyph, openToolPopover, signedInButFailing } from "./tools.js";
import { profileFields, spaceHintFields } from "./onboarding.js";
import { SCREENSHOT_SHORTCUT } from "./send.js";
import { setupSummary, createSetupKit, switchRow, SITE, vaultOf } from "./setup.js";
import { inExtension } from "../transport.js";
import { loadingOr } from "./helperstate.js";
import { readSearchSuggestions, writeSearchSuggestions } from "../omnibox.js";
import { EDITION, PAGE_EVAL, PAGE_EVAL_NOTE } from "../edition.js";

// "Type straight into Ensō on new tabs" lives in the extension's own storage
// (browser.storage.local.newTabFocus), not in the helper's settings:
// background.js reads it and listens for changes. The mock uses localStorage.
const NEW_TAB_FOCUS = "newTabFocus";
async function readNewTabFocus() {
  try {
    if (inExtension) return (await globalThis.browser.storage.local.get(NEW_TAB_FOCUS))[NEW_TAB_FOCUS] === true;
    return localStorage.getItem(`enso.${NEW_TAB_FOCUS}`) === "true";
  } catch { return false; }
}
async function writeNewTabFocus(on) {
  try {
    if (inExtension) await globalThis.browser.storage.local.set({ [NEW_TAB_FOCUS]: !!on });
    else localStorage.setItem(`enso.${NEW_TAB_FOCUS}`, String(!!on));
  } catch { /* storage unavailable: nothing to keep */ }
}

const MODELS = [
  ["claude-opus-5-5", "Claude Opus 5.5"],
  ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
  ["claude-haiku-5-5", "Claude Haiku 5.5"],
];
const REFRESH = [[0, "Off"], [1440, "Once a day"], [15, "Every 15 min"], [30, "Every 30 min"], [60, "Every hour"], [120, "Every 2 hours"], [240, "Every 4 hours"]];

export const SECTIONS = [
  { id: "general", label: "General", icon: "sliders", desc: "Which Claude answers, how long it thinks, and what it sees by default.", docs: "engines" },
  { id: "memory", label: "You & memory", icon: "brain", desc: "What Ensō knows about you, everywhere and in each Zen space.", docs: "memory" },
  { id: "skills", label: "Skills", icon: "command", desc: "Your own slash commands. Type / at the start of a message.", docs: "skills" },
  { id: "connections", label: "Connections", icon: "link", desc: "Tools, GitHub and T3 Code.", docs: "tools" },
  { id: "agents", label: "Agents & screenshots", icon: "cursor", desc: "Let Claude Code, Codex, Cursor and OpenCode use Zen, and choose where screenshots go.", docs: "other-agents" },
  { id: "privacy", label: "Privacy & safety", icon: "shield", desc: "What runs without asking, where agents may use your sign-ins, and what leaves this computer.", docs: "privacy-data" },
  { id: "setup", label: "Setup", icon: "check", desc: "The helper and Claude on this computer. The helper checks each item.", docs: "install" },
  { id: "advanced", label: "Advanced", icon: "tool", desc: "For developers and unusual setups. Most people never change these.", docs: "troubleshooting" },
];
const SECTION_IDS = SECTIONS.map(x => x.id);
export const sectionLabel = id => SECTIONS.find(x => x.id === id)?.label ?? null;

/** Tools that are on but can't be used until someone signs in again. */
const toolsNeedingSignIn = s => (s.servers ?? []).filter(x => x.enabled !== false && (x.status === "needs-auth" || ["expired", "error", "disconnected"].includes(x.auth?.state) || signedInButFailing(x)));

/**
 * What needs the user, per section: { setup, connections, agents } → short text or null.
 * Used for the dots in the Settings nav, the top bar and the app nav.
 */
export function settingsAttention(s) {
  const st = s.setup?.status;
  const out = { setup: null, connections: null, agents: null };
  const sum = setupSummary(st, s.settings);
  if (sum?.todo.length) out.setup = sum.todo[0];
  else if (!st && s.settings && s.engines?.[s.settings.engine]?.available === false) out.setup = s.settings.engine === "api" ? "Add an API key" : "Set up Claude Code";
  const tools = toolsNeedingSignIn(s);
  const t3 = s.t3?.status;
  if (t3?.connected && t3.tokenValid === false) out.connections = "Reconnect T3 Code";
  else if (st?.github?.error) out.connections = "GitHub sign-in failed";
  else if (tools.length) out.connections = `${tools.length} tool${tools.length === 1 ? " needs" : "s need"} a sign-in`;
  if (st?.agents?.clients?.some(c => c.registration === "http")) out.agents = "Re-register an agent";
  return out;
}
export const needsAttention = s => Object.values(settingsAttention(s)).some(Boolean);

/** Where Settings opens without a section in the full page: Setup when something there is missing. */
export const defaultSection = s => (settingsAttention(s).setup ? "setup" : "general");

let uid = 0;
const nextId = p => `${p}-${++uid}`;
const searchKey = (...parts) => parts.flat().filter(x => typeof x === "string").join(" ").toLowerCase();

function segmented(name, options, value, onChange) {
  return h("div", { class: "segmented", role: "radiogroup", aria: { label: name } },
    options.map(([v, label, disabled, title]) => h("button", { type: "button", role: "radio", class: ["seg", v === value && "on"], aria: { checked: String(v === value) }, disabled, title, onclick: () => v !== value && onChange(v) }, label)));
}

/** A row: label and one line on the left, the control on the right (or below, `stacked`). */
function row({ label, desc, control, keys = "", forId, stacked = false, extra }) {
  const descId = desc ? nextId("rd") : null;
  return h("div", { class: ["setting", "set-row", stacked && "stacked"], dataset: { search: searchKey(label, typeof desc === "string" ? desc : "", keys) } },
    h("div", { class: "setting-text" },
      forId ? h("label", { for: forId }, label) : h("span", { class: "set-label" }, label),
      desc ? h("p", { id: descId }, desc) : null),
    control, extra);
}

function group(title, ...rows) {
  const items = rows.flat().filter(Boolean);
  if (!items.length) return null;
  return h("div", { class: "set-group" }, title ? h("h3", { class: "set-group-title" }, title) : null, h("div", { class: "set-card" }, items));
}

const learnMore = (path, text = "Learn more") => h("a", { class: "set-learn", href: `${SITE}/${path}`, target: "_blank", rel: "noopener" }, text, icon("arrowUpRight"));

export function createSettings(store, ctx) {
  const { state: s, actions } = store;
  const here = () => (s.platform === "mac" || !s.platform ? "this Mac" : "this computer");
  const drill = document.documentElement.dataset.mode === "sidebar";
  const prof = { dirty: false, draft: null, error: null };
  const mem = { dirty: false, preview: false, draft: "", scope: "global" };
  const skillUi = { editing: null, error: null }; // null | "new" | name
  let query = "";
  let newTabFocus = false;
  readNewTabFocus().then(v => { newTabFocus = v; renderSection("general"); });
  let searchSuggestions = false;
  readSearchSuggestions().then(v => { searchSuggestions = v; renderSection("general", "privacy"); });
  // The address-bar row (views/addressbar.js, PR #25): built once and moved into General on each render.
  // Loaded lazily so Settings works the same on a build without it.
  let addressBar = null;
  import("./addressbar.js").then(m => { addressBar = m.createAddressBarSetting?.(store) ?? null; if (addressBar) renderSection("general"); }, () => {});

  // While a section waits for the helper: #26's loading state (spinner, "Couldn't load" + Retry,
  // or the helper-not-running card). Sections that showed one re-render on "waits"/"helper".
  const waitingIn = new Set();
  let rendering = null;
  const loading = (key, text) => { if (rendering) waitingIn.add(rendering); return h("div", { class: "set-row set-loading" }, loadingOr(store, key, text)); };

  const kit = createSetupKit(store, { rerender: () => renderSection("setup", "connections", "agents", "advanced"), isActive: () => el.isConnected });

  // ---- shell -------------------------------------------------------------
  const saved = h("span", { class: "set-saved", role: "status", aria: { live: "polite" } });
  let savedTimer = null;
  function flashSaved() {
    clear(saved, icon("check"), "Saved");
    saved.classList.add("on");
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { saved.classList.remove("on"); }, 1600);
  }
  /** Save a settings patch now, with the short "Saved". */
  const save = patch => { actions.updateSettings(patch); flashSaved(); };

  const search = h("input", { type: "search", class: "search-input set-search", placeholder: "Search settings", aria: { label: "Search settings", controls: "set-sections" }, autocomplete: "off", spellcheck: "false" });
  const searchBox = h("label", { class: "search set-searchbox" }, icon("search"), search);
  const noMatch = h("p", { class: "set-empty muted", hidden: true });
  const navList = h("ul", { class: "set-nav-list" });
  const nav = h("nav", { class: "set-nav", aria: { label: "Settings sections" } }, navList);
  const rootList = h("div", { class: "set-root" });
  const sectionsHost = h("div", { class: "set-sections", id: "set-sections" });
  const sectionEls = {};
  const bodies = {};
  for (const sec of SECTIONS) {
    bodies[sec.id] = h("div", { class: "set-body" });
    const head = h("header", { class: "set-head" },
      h("h2", { id: `set-h-${sec.id}`, tabindex: "-1" }, sec.label),
      h("p", { class: "set-desc" }, sec.desc, " ", learnMore(`docs/${sec.docs}`)));
    sectionEls[sec.id] = h("section", { class: "set-section", id: `set-${sec.id}`, dataset: { section: sec.id, search: searchKey(sec.label, sec.desc) }, aria: { labelledby: `set-h-${sec.id}` } }, head, h("div", { class: "set-attn-slot" }), bodies[sec.id]);
    sectionsHost.append(sectionEls[sec.id]);
  }

  const el = h("section", { class: ["page-view", "settings-view", drill ? "drill" : "split"], aria: { label: "Settings" } },
    drill
      ? h("div", { class: "set-main" }, h("div", { class: "set-top" }, searchBox, saved), rootList, noMatch, sectionsHost)
      : h("div", { class: "set-layout" },
          h("aside", { class: "set-side" }, h("h2", { class: "set-title" }, "Settings"), searchBox, nav),
          h("div", { class: "set-main" }, h("div", { class: "set-top" }, saved), noMatch, sectionsHost)));

  const current = () => {
    const sec = s.ui.settingsSection;
    if (SECTION_IDS.includes(sec)) return sec;
    return drill ? null : defaultSection(s);
  };
  const open = id => actions.go("settings", { section: id });

  // ---- nav, root list, search -------------------------------------------
  function attnDot(text) {
    return text ? h("span", { class: "attn-dot", title: text }, h("span", { class: "sr-only" }, ` (needs attention: ${text})`)) : null;
  }

  function renderNav() {
    const attn = settingsAttention(s);
    const cur = current();
    if (!drill) {
      clear(navList, SECTIONS.map(sec => h("li", null,
        h("a", { href: `#settings/${sec.id}`, class: ["set-nav-item", !query && cur === sec.id && "on", sec.id === "advanced" && "quiet"], aria: { current: !query && cur === sec.id ? "page" : null },
          onclick: e => { e.preventDefault(); clearSearch(); open(sec.id); } },
          icon(sec.icon), h("span", null, sec.label), attnDot(attn[sec.id])))));
      return;
    }
    const first = attn.setup ? ["setup", attn.setup] : attn.connections ? ["connections", attn.connections] : attn.agents ? ["agents", attn.agents] : null;
    clear(rootList,
      first ? h("button", { type: "button", class: "set-callout warn", onclick: () => open(first[0]) }, icon("alert"), h("span", null, h("strong", null, first[1]), h("span", { class: "muted" }, ` · ${sectionLabel(first[0])}`)), icon("chevronRight", "chev")) : null,
      h("ul", { class: "set-root-list" }, SECTIONS.map(sec => h("li", null,
        h("a", { href: `#settings/${sec.id}`, class: ["set-root-item", sec.id === "advanced" && "quiet"], onclick: e => { e.preventDefault(); open(sec.id); } },
          h("span", { class: "set-root-icon" }, icon(sec.icon)),
          h("span", { class: "set-root-text" }, h("strong", null, sec.label), h("span", null, sec.desc)),
          attnDot(attn[sec.id]),
          icon("chevronRight", "chev"))))));
  }

  function applyView() {
    const cur = current();
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    el.classList.toggle("searching", !!words.length);
    let total = 0;
    for (const sec of SECTIONS) {
      const secEl = sectionEls[sec.id];
      if (!words.length) {
        secEl.hidden = cur !== sec.id;
        for (const r of secEl.querySelectorAll(".set-row, .set-group")) r.hidden = false;
        continue;
      }
      const whole = words.every(w => secEl.dataset.search.includes(w));
      let hits = 0;
      for (const r of secEl.querySelectorAll(".set-row")) {
        const show = whole || words.every(w => (r.dataset.search ?? "").includes(w));
        r.hidden = !show;
        if (show) hits++;
      }
      for (const g of secEl.querySelectorAll(".set-group")) g.hidden = ![...g.querySelectorAll(".set-row")].some(r => !r.hidden);
      secEl.hidden = !hits;
      total += hits;
    }
    if (drill) rootList.hidden = !!words.length || !!cur;
    if (drill) searchBox.hidden = !!cur && !words.length;
    noMatch.hidden = !words.length || total > 0;
    noMatch.textContent = `No settings match “${query.trim()}”.`;
  }

  function clearSearch() { if (!query) return; query = ""; search.value = ""; renderNav(); applyView(); }

  search.addEventListener("input", () => { query = search.value; renderNav(); applyView(); });
  search.addEventListener("keydown", e => {
    if (e.key === "Escape" && query) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
    if (e.key === "Enter" || (e.key === "ArrowDown" && query)) {
      const first = sectionsHost.querySelector(".set-section:not([hidden]) .set-row:not([hidden]) :is(button, input, select, textarea, a)");
      if (first) { e.preventDefault(); first.focus(); }
      else if (e.key === "ArrowDown" && !drill) { e.preventDefault(); navList.querySelector("a")?.focus(); }
    }
  });
  // Arrow keys move through the section nav (and the sidebar's list).
  function arrowNav(container, selector) {
    container.addEventListener("keydown", e => {
      const items = [...container.querySelectorAll(selector)];
      const i = items.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, to))].focus();
    });
  }
  arrowNav(navList, ".set-nav-item");
  arrowNav(rootList, ".set-root-item, .set-callout");

  // ---- sections ---------------------------------------------------------
  const renderers = {};

  function attnSlot(id, text, action) {
    const slot = sectionEls[id].querySelector(".set-attn-slot");
    clear(slot, text ? h("div", { class: "set-callout warn static", role: "note" }, icon("alert"), h("span", null, text), action) : null);
  }

  renderers.general = () => {
    const st = s.settings;
    if (!st) return [loading("state", "Loading settings…")];
    const eng = s.engines ?? {};
    const models = MODELS.some(([v]) => v === st.model) ? MODELS : [[st.model, st.model], ...MODELS];
    const modelId = nextId("set-model");
    const refreshId = nextId("set-refresh");
    const e = eng[st.engine] ?? {};
    const engineDesc = e.available === false
      ? [st.engine === "api" ? "No API key yet. " : "Claude Code isn't ready. ", h("button", { type: "button", class: "link-btn", onclick: () => open("setup") }, "Fix in Setup")]
      : st.engine === "api" ? "Pay per use with your Anthropic API key." : `Your Claude plan, through Claude Code${eng.subscription?.version ? ` ${String(eng.subscription.version).replace(/\s*\(Claude Code\)/, "")}` : ""}.`;
    const brief = s.dashboard.data?.generatedAt ? `Last updated ${relTime(s.dashboard.data.generatedAt)}.` : "Not updated yet.";
    return [
      group("Claude",
        row({ label: "Engine", desc: engineDesc, keys: "subscription api key claude code plan", control: segmented("Engine", [["subscription", "Subscription"], ["api", "API key"]], st.engine, v => save({ engine: v })) }),
        row({ label: "Model", forId: modelId, keys: "opus sonnet haiku", control: h("select", { class: "select", id: modelId, onchange: ev => save({ model: ev.target.value }) }, models.map(([v, l]) => h("option", { value: v, selected: v === st.model }, l))) }),
        row({ label: "Effort", desc: "Higher effort thinks longer before answering.", keys: "thinking reasoning", control: segmented("Effort", [["low", "Low"], ["medium", "Medium"], ["high", "High"]], st.effort, v => save({ effort: v })) })),
      group("Conversations",
        switchRow("Include the current page", "New messages start with the page chip on. Private pages are never shared.", st.includePageByDefault, v => { save({ includePageByDefault: v }); actions.setIncludePage(v); }, { keys: "page chip context tab default" })),
      group("New tab & Home",
        switchRow("Type straight into Ensō on new tabs", "Zen puts the cursor in the address bar. With this on, Ensō swaps each new tab for one that gets the cursor; Zen briefly shows the extra tab.", newTabFocus,
          v => { newTabFocus = v; writeNewTabFocus(v); flashSaved(); renderSection("general"); }, { keys: "new tab focus cursor address bar keyboard type" }),
        switchRow("Search suggestions while typing", "Sends what you type in the new tab's box to your search engine (Google or DuckDuckGo) for suggestions. Off: only your tabs, bookmarks and history are suggested.", searchSuggestions,
          v => { searchSuggestions = v; writeSearchSuggestions(v); flashSaved(); renderSection("general", "privacy"); }, { keys: "search suggestions google duckduckgo autocomplete omnibox typing network" }),
        row({ label: "Refresh the brief", forId: refreshId, desc: `${brief} Off: only when you press refresh. Each refresh sends your profile, memory and what your tools return to Anthropic.`, keys: "dashboard briefing home new tab auto-refresh widgets",
          control: h("select", { class: "select", id: refreshId, onchange: ev => save({ dashboard: { autoRefreshMinutes: Number(ev.target.value) } }) }, REFRESH.map(([v, l]) => h("option", { value: v, selected: v === (st.dashboard?.autoRefreshMinutes ?? 0) }, l))) }),
        row({ label: "Widgets", desc: "Arrange them on the new tab with the layout button in its top bar.", keys: "new tab widgets layout customize" })),
      addressBar ? group(null, h("div", { class: "set-row set-block", dataset: { search: "address bar url bar search engine zen default ask" } }, addressBar.el)) : null,
    ];
  };

  renderers.memory = () => {
    if (!s.ready) return [loading("state", "Loading…")];
    return [profileGroups(), memoryGroup()];
  };

  function profileGroups() {
    const p = s.profile;
    if (!prof.dirty || !prof.draft) prof.draft = { name: p?.name ?? "", about: p?.about ?? "", spaceHints: { ...(p?.spaceHints ?? {}) } };
    const draft = prof.draft;
    const status = h("span", { class: "muted small", aria: { live: "polite" } }, s.profileSaving ? "Saving…" : prof.dirty ? "Unsaved changes" : s.profileSavedAt ? `Saved ${relTime(s.profileSavedAt)}` : "");
    const saveBtn = h("button", { type: "submit", class: "btn primary small", disabled: !prof.dirty || s.profileSaving }, "Save");
    const revert = h("button", { type: "button", class: "btn ghost small", disabled: !prof.dirty, onclick: () => { prof.dirty = false; prof.error = null; renderSection("memory"); } }, "Revert");
    const touched = () => {
      if (prof.dirty) return;
      prof.dirty = true; saveBtn.disabled = false; revert.disabled = false; status.textContent = "Unsaved changes";
    };
    const fields = profileFields(store, draft, { idPrefix: "set-pf", onInput: touched });
    const spaces = s.spaces ?? [];
    const submit = () => {
      if (!draft.name.trim()) { prof.error = "Your name can't be empty."; renderSection("memory"); return; }
      // Send every known space, so a cleared field removes its note.
      const hints = Object.fromEntries(spaces.map(sp => [sp.id, draft.spaceHints?.[sp.id] ?? ""]));
      actions.saveProfile({ name: draft.name, about: draft.about, spaceHints: hints });
      prof.dirty = false; prof.error = null;
    };
    return h("form", { class: "profile-form", onsubmit: ev => { ev.preventDefault(); submit(); } },
      group("About you", h("div", { class: "set-row set-block", dataset: { search: "profile name about you who you are" } }, fields.el)),
      spaces.length ? group("Zen spaces",
        h("div", { class: "set-row set-block", dataset: { search: "zen spaces space notes what each space is for work personal" } },
          h("p", { class: "set-note" }, "What each space is for. Chats started in a space get its note."),
          spaceHintFields(spaces, draft, { idPrefix: "set-sh", onInput: touched }))) : null,
      prof.error ? h("p", { class: "form-error", role: "alert" }, prof.error) : null,
      h("div", { class: "form-actions set-actions" }, saveBtn, revert, status));
  }

  function memoryGroup() {
    const space = s.space;
    if (mem.scope === "space" && !space) mem.scope = "global";
    const scoped = mem.scope === "space";
    const src = scoped ? s.spaceMemory : s.memory;
    const scope = space ? segmented("Which memory", [["global", "Everywhere"], ["space", space.name]], mem.scope, v => {
      if (mem.dirty && !confirm("Discard unsaved memory changes?")) return;
      mem.dirty = false; mem.scope = v;
      if (v === "space" && !s.spaceMemory.loaded) actions.loadMemory(space.id);
      renderSection("memory");
    }) : null;
    const desc = scoped ? `Facts Ensō uses only in ${space.name}, on top of the ones it uses everywhere.` : "Facts Ensō saved when you told it something to remember. One per line, in Markdown.";
    const head = h("div", { class: "set-mem-head" }, h("p", { class: "set-note" }, desc), h("div", { class: "set-mem-tabs" }, scope, segmented("Memory view", [[false, "Edit"], [true, "Preview"]], mem.preview, v => { mem.preview = v; renderSection("memory"); })));
    const keys = "memory remember facts markdown everywhere space";
    if (!src.loaded) waitingIn.add("memory");
    if (!src.loaded) return group("Memory", h("div", { class: "set-row set-block", dataset: { search: keys } }, head, loadingOr(store, scoped ? `memory:${space.id}` : "memory", "Loading memory…")));
    if (!mem.dirty) mem.draft = src.text;
    const area = h("textarea", { class: "memory-editor", spellcheck: "true", aria: { label: scoped ? `Memory for ${space.name} (Markdown)` : "Memory (Markdown)" }, hidden: mem.preview, placeholder: scoped ? `Notes for ${space.name}: projects, people, preferences…` : "" });
    area.value = mem.draft;
    const status = h("span", { class: "muted small", aria: { live: "polite" } }, src.saving ? "Saving…" : mem.dirty ? "Unsaved changes" : src.savedAt ? `Saved ${relTime(src.savedAt)}` : "");
    const saveBtn = h("button", { type: "button", class: "btn primary small", disabled: !mem.dirty || src.saving, onclick: () => { actions.saveMemory(mem.draft, scoped ? space.id : null); mem.dirty = false; } }, "Save");
    const revert = h("button", { type: "button", class: "btn ghost small", disabled: !mem.dirty, onclick: () => { mem.dirty = false; renderSection("memory"); } }, "Revert");
    area.addEventListener("input", () => {
      mem.draft = area.value;
      if (!mem.dirty) { mem.dirty = true; saveBtn.disabled = false; revert.disabled = false; status.textContent = "Unsaved changes"; }
    });
    area.addEventListener("keydown", ev => { if ((ev.metaKey || ev.ctrlKey) && ev.key === "s") { ev.preventDefault(); saveBtn.click(); } });
    return group("Memory", h("div", { class: "set-row set-block set-memory", dataset: { search: keys } },
      head, area,
      mem.preview ? h("div", { class: "memory-preview md" }, renderMarkdown(mem.draft)) : null,
      h("div", { class: "form-actions set-actions" }, saveBtn, revert, status)));
  }

  function skillForm(skill) {
    const name = h("input", { type: "text", class: "input", value: skill?.name ?? "", placeholder: "summarize-paper", pattern: "[a-z0-9][a-z0-9\\-]*", aria: { label: "Command name" }, disabled: !!skill });
    const desc = h("input", { type: "text", class: "input", value: skill?.description ?? "", placeholder: "Summarise a paper for my study notes", aria: { label: "Description" } });
    const prompt = h("textarea", { class: "input mono", rows: 5, placeholder: "Summarise this paper in my study-note format. Focus on {input}.", aria: { label: "Prompt" } });
    prompt.value = skill?.prompt ?? "";
    const submit = () => {
      const n = name.value.trim().replace(/^\//, "").toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(n)) { skillUi.error = "Use lowercase letters, digits and dashes for the name."; renderSection("skills"); return; }
      if (!prompt.value.trim()) { skillUi.error = "The prompt can't be empty."; renderSection("skills"); return; }
      if (!skill && s.skills.some(k => k.name === n)) { skillUi.error = `/${n} already exists.`; renderSection("skills"); return; }
      actions.saveSkill({ name: n, description: desc.value.trim(), prompt: prompt.value });
      skillUi.editing = null; skillUi.error = null; renderSection("skills");
    };
    return h("form", { class: "skill-form", onsubmit: ev => { ev.preventDefault(); submit(); } },
      h("label", { class: "field" }, h("span", null, "Command"), h("span", { class: "with-prefix" }, h("span", { class: "prefix" }, "/"), name)),
      h("label", { class: "field" }, h("span", null, "Description"), desc),
      h("label", { class: "field" }, h("span", null, "Prompt"), prompt, h("small", { class: "muted" }, "Use {input} where the text typed after the command goes.")),
      skillUi.error ? h("p", { class: "form-error", role: "alert" }, skillUi.error) : null,
      h("div", { class: "form-actions" }, h("button", { type: "submit", class: "btn primary small" }, "Save skill"), h("button", { type: "button", class: "btn ghost small", onclick: () => { skillUi.editing = null; skillUi.error = null; renderSection("skills"); } }, "Cancel")));
  }

  renderers.skills = () => {
    if (!s.ready) return [loading("state", "Loading skills…")];
    const list = s.skills ?? [];
    const mine = list.filter(k => !k.builtIn);
    const builtIn = list.filter(k => k.builtIn);
    const skillRow = k => skillUi.editing === k.name ? h("div", { class: "set-row set-block", dataset: { search: searchKey("skill", k.name, k.description) } }, skillForm(k))
      : h("div", { class: "set-row set-skill", dataset: { search: searchKey("skill slash command", k.name, k.description) } },
        h("span", { class: "skill-name" }, `/${k.name}`),
        h("span", { class: "skill-desc" }, k.description ?? ""),
        k.builtIn ? null : h("span", { class: "row-actions visible" },
          iconButton("pencil", `Edit /${k.name}`, () => { skillUi.editing = k.name; skillUi.error = null; renderSection("skills"); }, { class: "small" }),
          iconButton("trash", `Delete /${k.name}`, () => actions.deleteSkill(k.name), { class: "small" })));
    return [
      group("Your skills",
        mine.map(skillRow),
        skillUi.editing === "new" ? h("div", { class: "set-row set-block", dataset: { search: "new skill" } }, skillForm(null))
          : h("div", { class: "set-row set-add", dataset: { search: "new skill add create slash command" } }, h("button", { type: "button", class: "btn small", onclick: () => { skillUi.editing = "new"; skillUi.error = null; renderSection("skills"); } }, icon("plus"), "New skill"))),
      builtIn.length ? group("Built in", builtIn.map(skillRow)) : null,
    ];
  };

  function t3Row() {
    const t3 = s.t3.status;
    const busy = s.t3.busy;
    const done = s.t3.done;
    const state = !t3 ? ["", "Checking…"]
      : !t3.connected ? ["", t3.cli === false ? "Not connected. Open T3 Code once so Ensō can find it (~/.t3/bin/t3)." : "Not connected."]
      : !t3.reachable ? ["warn", "Connected. T3 Code isn't running right now."]
      : t3.tokenValid === false ? ["bad", t3.error ?? "The token was revoked or expired. Connect again."]
      : ["good", `Connected${t3.serverVersion ? ` to ${t3.serverVersion}` : ""}. ${t3.route === "attachment" ? "Screenshots go as images." : "Screenshots go as a saved PNG's path."}`];
    const buttons = h("div", { class: "set-controls" },
      !t3?.connected || t3.tokenValid === false ? h("button", { type: "button", class: "btn small primary", disabled: !!busy, onclick: () => actions.t3Connect() }, busy === "connect" ? [h("span", { class: "spinner" }), "Connecting…"] : [icon("link"), t3?.connected ? "Reconnect" : "Connect"]) : null,
      t3?.connected ? h("button", { type: "button", class: "btn small ghost", disabled: !!busy, onclick: () => actions.t3Disconnect() }, busy === "disconnect" ? "Disconnecting…" : "Disconnect") : null,
      iconButton("refresh", "Check T3 Code again", () => actions.t3Status(), { class: "small" }));
    return row({ label: "T3 Code", keys: "t3 code threads screenshots token keychain connect",
      desc: [h("span", { class: ["t3-state", state[0]] }, h("i"), state[1]), done && !done.ok ? h("span", { class: "form-error", role: "alert" }, ` ${done.error}`) : null,
        !t3?.connected ? h("span", { class: "set-sub" }, `Lets Ensō read and message your T3 threads for 30 days. The token stays in ${vaultOf(s.setup.status, s.platform)}.`) : null],
      control: buttons });
  }

  renderers.connections = () => {
    if (!s.ready) return [loading("state", "Loading…")];
    const list = sortTools(s.servers ?? []);
    const on = list.filter(x => x.enabled !== false);
    const needs = toolsNeedingSignIn(s);
    const st = s.setup.status;
    return [
      group("Tools",
        row({ label: `${on.length} of ${list.length} tools on`, desc: "claude.ai connectors and MCP servers, including monday.com and other sign-ins.", keys: "tools connectors mcp servers gmail calendar drive notion monday commonfold sign in",
          control: h("button", { type: "button", class: "btn small", onclick: () => actions.go("tools") }, "Manage", icon("chevronRight")),
          extra: list.length ? h("span", { class: "tools-summary-icons set-tool-icons" }, list.slice(0, 12).map(sv => h("button", { type: "button", class: ["tool-icon", sv.enabled === false && "off", statusOf(sv).key === "auth" && "dim"], title: labelOf(sv), aria: { label: `${labelOf(sv)}: ${statusOf(sv).text}`, haspopup: "dialog", expanded: "false" }, onclick: ev => openToolPopover(store, sv, ev.currentTarget, ctx) }, toolGlyph(sv)))) : null }),
        needs.map(sv => row({ label: labelOf(sv), desc: statusOf(sv).text, keys: "sign in tool needs attention",
          control: h("button", { type: "button", class: "btn small primary", onclick: ev => openToolPopover(store, sv, ev.currentTarget, ctx) }, "Sign in") }))),
      group("Accounts",
        st ? h("ul", { class: "setup-list bare" }, kit.githubItem(st)) : loading("setup", "Checking GitHub…"),
        t3Row()),
    ];
  };

  renderers.agents = () => {
    const st = s.settings;
    if (!st) return [loading("state", "Loading settings…")];
    const setup = s.setup.status;
    const agents = s.connectedAgents ?? [];
    const links = st.sendLinks ?? { tabs: [], hosts: {} };
    const tabLinks = links.tabs ?? [];
    const hostLinks = Object.entries(links.hosts ?? {});
    const t3 = s.t3.status;
    return [
      group("Agents that can use Zen",
        setup ? kit.agentRows(setup) : loading("setup", "Checking your agents…"),
        row({ label: "Connected now", keys: "connected running agents inbox", desc: agents.length ? agents.map(a => a.client).join(", ") : "None right now. An agent shows up here once it starts with zen-browser." }),
        kit.doneLine(["agents."]) ? h("div", { class: "set-row", dataset: { search: "agents" } }, kit.doneLine(["agents."])) : null),
      group("What agents may do",
        row({ label: "Access", desc: "Read: see tabs and pages. Full: also click, type, open and close. Private sites are always off-limits.", keys: "external control full read only off mcp permission",
          control: segmented("Agent access", [["full", "Full"], ["read", "Read"], ["off", "Off"]], st.externalControl ?? "full", v => save({ externalControl: v })) }),
        switchRow("Mark the tab an agent uses", "Puts ✦ in front of the tab's title while an agent works there.", st.agentTitlePrefix !== false, v => save({ agentTitlePrefix: v }), { keys: "title prefix star tab list" }),
        setup ? kit.readOnlyRow(setup) : null),
      group("Screenshots",
        row({ label: "Take a screenshot", desc: `${SCREENSHOT_SHORTCUT} or the camera button. Send it to a T3 Code thread or a connected agent, or copy it. Screenshots stay on ${here()}.`, keys: "screenshot capture camera shortcut send" }),
        row({ label: "T3 Code", desc: !t3 ? "Checking…" : t3.connected ? (t3.tokenValid === false ? "Needs a new connection." : "Connected.") : "Not connected.", keys: "t3 code threads",
          control: h("button", { type: "button", class: "btn small ghost", onclick: () => open("connections") }, "Connections", icon("chevronRight")) }),
        setup ? kit.hookRow(setup) : null,
        row({ label: "Linked threads", stacked: true, keys: "linked threads tab site project always send here",
          desc: "Where a tab's screenshots go without asking. Tab links end when the tab closes.",
          control: tabLinks.length || hostLinks.length ? h("ul", { class: "tool-list link-list" },
            tabLinks.map(l => h("li", null,
              h("span", { class: "tag" }, "Tab"),
              h("span", { class: "link-main" }, h("strong", null, l.pageTitle || l.host || `Tab ${l.tabId}`), h("span", { class: "muted" }, ` → ${l.kind === "agent" ? "agent " : ""}${l.title || l.id}`)),
              iconButton("x", `Remove the link for ${l.pageTitle || "this tab"}`, () => actions.unlink({ type: "tab", tabId: l.tabId }), { class: "small" }))),
            hostLinks.map(([host, v]) => h("li", null,
              h("span", { class: "tag accent" }, "Site"),
              h("span", { class: "link-main" }, h("strong", null, host), h("span", { class: "muted" }, ` → T3 project ${v.projectTitle || v.projectId}`)),
              iconButton("x", `Remove the link for ${host}`, () => actions.unlink({ type: "host", host }), { class: "small" })))) : h("p", { class: "hint" }, "None yet. Tick “Always send this tab here” when you send one.") })),
      group("Security", kit.tokenRow()),
    ];
  };

  function normalizeOrigin(raw) {
    const t = String(raw ?? "").trim();
    if (!t) return null;
    try {
      const u = new URL(/^[a-z]+:\/\//i.test(t) ? t : `https://${t}`);
      return /^https?:$/.test(u.protocol) ? u.origin : null;
    } catch { return null; }
  }
  const isSensitive = origin => (s.sensitiveHosts ?? []).some(p => {
    const g = q => q.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(p.startsWith("*.") ? `^(.*\\.)?${g(p.slice(2))}$` : `^${g(p)}$`, "i").test(new URL(origin).hostname);
  });

  renderers.privacy = () => {
    const st = s.settings;
    if (!st) return [loading("state", "Loading settings…")];
    const always = st.alwaysAllowedTools ?? [];
    const access = st.sessionAccess ?? {};
    const sites = Object.entries(access).sort(([a], [b]) => a.localeCompare(b));
    const setAccess = next => save({ sessionAccess: next });
    const input = h("input", { type: "text", class: "input", placeholder: "github.com", aria: { label: "Site to allow" } });
    const err = h("p", { class: "form-error", role: "alert", hidden: true });
    const add = () => {
      const origin = normalizeOrigin(input.value);
      if (!origin) { err.textContent = "Enter a site like github.com or https://app.example.com."; err.hidden = false; return; }
      if (isSensitive(origin)) { err.textContent = "Private sites (banking, health, tax and similar) can't be allowed."; err.hidden = false; return; }
      setAccess({ ...access, [origin]: "allow" });
    };
    return [
      group("Approvals",
        switchRow("Run reading tools without asking", "Searching and reading run straight away. Anything that changes something still asks.", st.autoApproveReadOnly, v => save({ autoApproveReadOnly: v }), { keys: "auto-approve read-only tools approval" }),
        row({ label: "Always allowed", stacked: true, keys: "always allow tools approvals", desc: always.length ? "These tools run without asking. Remove one to be asked again." : "Tools you “Always allow” show up here.",
          control: always.length ? h("ul", { class: "tool-list" }, always.map(name => h("li", null, h("code", null, name), iconButton("x", `Stop always allowing ${name}`, () => save({ alwaysAllowedTools: always.filter(t => t !== name) }), { class: "small" })))) : null })),
      group("Your signed-in sessions",
        row({ label: "Session access", stacked: true, keys: "session access allowlist cookies signed in sites headless allow site subdomains",
          desc: "Sites where Claude and your agents may make requests as you, or copy your sign-in to the headless browser. Other sites ask in Ensō; agents are refused. Covers subdomains.",
          control: [
            sites.length ? h("ul", { class: "tool-list" }, sites.map(([origin, value]) => h("li", null,
              h("code", null, origin),
              h("span", { class: ["tag", value === "allow" && "accent"] }, value === "allow" ? "Allowed" : "Ask"),
              iconButton("x", `Remove ${origin}`, () => { const next = { ...access }; delete next[origin]; setAccess(next); }, { class: "small" })))) : h("p", { class: "hint" }, "No sites yet. Choose “Always allow on this site” when Claude asks, or add one."),
            h("form", { class: "form-actions", onsubmit: ev => { ev.preventDefault(); add(); } }, input, h("button", { type: "submit", class: "btn small" }, icon("plus"), "Allow")),
            err] }),
        row({ label: "Private sites", keys: "blocked private sites banking health tax sensitive off-limits", desc: "Banking, health, tax and similar sites are always off-limits: no reading, acting, sharing or session access." })),
      group(`What leaves ${here()}`,
        row({ label: "Your messages", desc: "What you send, and the page or tabs you include, go to Anthropic to answer.", keys: "anthropic data messages page" }),
        row({ label: "The Home brief", desc: `Your profile, memory and what read-only tools return go to Anthropic on each refresh. ${(st.dashboard?.autoRefreshMinutes ?? 0) ? "It refreshes by itself" : "Off by default: only when you press refresh"} (General → New tab & Home).`, keys: "brief dashboard anthropic data" }),
        row({ label: "Search suggestions", desc: searchSuggestions ? "On: what you type in the new tab's box goes to your search engine for suggestions (General → New tab & Home)." : "Off: nothing you type in the new tab's box leaves until you press Enter (General → New tab & Home).", keys: "search suggestions google duckduckgo typing" }),
        row({ label: "Everything else", desc: `Conversations, memory, screenshots and settings stay in Ensō's folder on ${here()}.`, keys: "local data folder screenshots storage",
          control: h("span", { class: "set-links" }, learnMore("privacy", "Privacy policy"), learnMore("docs/privacy-data", "Where data lives")) })),
    ];
  };

  const editionRow = () => row({ label: EDITION.name, desc: EDITION.detail, keys: "edition build version channel firefox add-ons direct download development page_eval about",
    control: (v => (v ? h("span", { class: "tag" }, v) : null))(globalThis.browser?.runtime?.getManifest?.().version) });

  renderers.setup = () => {
    const st = s.setup.status;
    if (!st) return [loading("setup", `Checking ${here()}…`)];
    const sum = setupSummary(st, s.settings);
    const agentsOn = st.agents.clients.filter(c => c.registration);
    const t = st.t3;
    const tools = st.tools;
    const link = (sec, label) => h("button", { type: "button", class: "btn small ghost", onclick: () => (sec === "tools" ? actions.go("tools") : open(sec)) }, label, icon("chevronRight"));
    const glance = (title, level, status, sec, label, keys) => h("div", { class: ["set-row", "set-glance", level], dataset: { search: searchKey(title, status, keys) } },
      h("span", { class: "si-mark small", aria: { hidden: "true" } }, level === "good" ? icon("check") : level === "warn" ? icon("alert") : h("i")),
      h("div", { class: "setting-text" }, h("span", { class: "set-label" }, title), h("p", null, status)),
      link(sec, label));
    return [
      h("div", { class: ["setup-summary", sum.essentialsReady ? "good" : "warn"] },
        h("span", { class: "si-mark" }, icon(sum.essentialsReady ? "check" : "alert")),
        h("div", { class: "setup-summary-text" },
          h("strong", null, sum.essentialsReady ? "Ensō is ready" : sum.todo[0] ? `Next: ${sum.todo[0]}` : "Almost there"),
          h("span", { class: "muted" }, sum.essentialsReady ? ` · ${sum.optionalOn} optional connection${sum.optionalOn === 1 ? "" : "s"} on.` : " · Chat needs Claude: your subscription through Claude Code, or an API key.")),
        iconButton("refresh", "Check again", () => actions.setupStatus(true), { class: "small" })),
      group("Essentials", h("ul", { class: "setup-list bare" }, kit.helperItem(st), kit.engineItem(st))),
      group("Optional",
        glance("Agents", agentsOn.length ? "good" : "off", agentsOn.length ? `${agentsOn.map(c => c.name).join(", ")} can use Zen.` : "No agent uses Zen yet.", "agents", "Agents", "claude code codex cursor opencode mcp"),
        glance("T3 Code", !t.installed || !t.connected ? "off" : t.tokenValid === false ? "warn" : "good", !t.installed ? `Not on ${here()}.` : !t.connected ? "Not connected." : t.tokenValid === false ? "Needs a new connection." : "Connected.", "connections", "Connections", "t3 screenshots"),
        glance("GitHub", st.github.connected ? "good" : st.github.error ? "warn" : "off", st.github.connected ? `Signed in as ${st.github.login}.` : "Not connected.", "connections", "Connections", "github gh"),
        glance("Tools", tools.needsAuth ? "warn" : tools.on ? "good" : "off", tools.total ? `${tools.on} of ${tools.total} on${tools.needsAuth ? ` · ${tools.needsAuth} need${tools.needsAuth === 1 ? "s" : ""} a sign-in` : ""}.` : "None yet.", "tools", "Tools", "connectors mcp")),
      group("This copy of Ensō", editionRow()),
      kit.placesRows(st).length ? group("Where Ensō keeps things", ...kit.placesRows(st)) : null,
      h("p", { class: "hint set-foot" }, "Everything here also works from the ", h("code", null, "enso"), ` command in ${s.platform === "win" ? "PowerShell" : s.platform === "linux" ? "a terminal" : "Terminal"} (`, h("code", null, "enso setup"), ")."),
    ];
  };

  renderers.advanced = () => {
    const st = s.settings;
    if (!st) return [loading("state", "Loading settings…")];
    const eng = s.engines ?? {};
    const pathId = nextId("set-claude-path");
    const paths = s.paths;
    return [
      group("This copy of Ensō", editionRow()),
      group("Claude Code",
        row({ label: "Claude Code location", forId: pathId, keys: "claude path cli binary location",
          desc: eng.subscription?.path ? `Using ${eng.subscription.path}. Leave empty to find it automatically.` : `Found automatically on your PATH, in ${s.platform === "win" ? "%USERPROFILE%\\.local\\bin or npm" : s.platform === "linux" ? "~/.local/bin, npm or Linuxbrew" : "~/.local/bin or Homebrew"}. Set a path only if yours lives elsewhere.`,
          control: h("input", { type: "text", class: "input mono set-path", id: pathId, value: st.claudePath ?? "", placeholder: "/path/to/claude", spellcheck: "false", onchange: ev => save({ claudePath: ev.target.value.trim() }) }) })),
      group("Developer tools",
        switchRow("Developer tools", PAGE_EVAL ? "Console, network, JavaScript and storage of your tabs, for Claude and your agents. Running JavaScript asks first." : "Console, network and storage of your tabs, for Claude and your agents.", st.developerTools !== false, v => save({ developerTools: v }), { keys: "devtools console network eval storage debugging" }),
        PAGE_EVAL ? null : row({ label: "Running JavaScript", desc: PAGE_EVAL_NOTE, keys: "page_eval javascript eval firefox add-ons build unavailable", control: h("span", { class: "tag" }, "Not in this build") }),
        switchRow("Headless browser", "A separate, invisible Zen with a throwaway profile for testing pages. Stops after 10 minutes idle.", st.headless !== false, v => save({ headless: v }), { keys: "headless zen testing marionette" }),
        row({ label: "Session access", desc: "Which sites these tools may use as you.", keys: "session access", control: h("button", { type: "button", class: "btn small ghost", onclick: () => open("privacy") }, "Privacy & safety", icon("chevronRight")) })),
      group("Files",
        paths ? row({ label: "Profile", stacked: true, keys: "profile.md data folder file", control: h("code", { class: "set-code" }, `${paths.data}${/^[A-Za-z]:\\/.test(paths.data) ? "\\" : "/"}profile.md`) }) : null,
        paths ? row({ label: "Personal config", desc: "Extra tools, space notes and other overrides, edited by hand.", stacked: true, keys: "config.local.json extraServers overrides file", control: h("code", { class: "set-code" }, paths.localConfig) }) : null,
        kit.devRow(s.setup.status)),
    ];
  };

  function renderSection(...ids) {
    const attn = settingsAttention(s);
    for (const id of ids) {
      // Don't throw away what someone is typing in a field of this section.
      const active = document.activeElement;
      const typing = active && bodies[id].contains(active) && active.matches("input[type=text], input[type=password], input:not([type]), textarea") && active.value;
      if (typing && !["memory", "skills"].includes(id)) continue;
      waitingIn.delete(id);
      rendering = id;
      clear(bodies[id], renderers[id]());
      rendering = null;
      if (id === "setup") attnSlot(id, null);
      if (id === "connections") attnSlot(id, attn.connections ? `${attn.connections}.` : null);
      if (id === "agents") attnSlot(id, attn.agents ? "An agent still uses the older setup with the token in its config. Turn it off and on again below." : null);
    }
    renderNav();
    applyView();
  }
  const renderAll = () => renderSection(...SECTION_IDS);
  renderAll();

  let lastSection = undefined;
  return {
    el,
    update(topics) {
      const ids0 = new Set();
      kit.onTopics(topics);
      if (topics.has("waits") || topics.has("helper")) for (const id of waitingIn) ids0.add(id);
      const any = (...t) => t.some(x => topics.has(x));
      const ids = ids0;
      if (any("settings", "state", "dashboard")) ["general", "agents", "privacy", "advanced"].forEach(x => ids.add(x));
      if (any("profile", "state", "memory") || (topics.has("space") && !prof.dirty)) ids.add("memory");
      if (topics.has("space") && !mem.dirty) ids.add("memory");
      if (any("skills", "state")) ids.add("skills");
      if (any("servers", "state", "t3", "setup")) ids.add("connections");
      if (any("setup", "settings", "agents", "t3")) ["setup", "agents"].forEach(x => ids.add(x));
      if (topics.has("setup")) ids.add("advanced");
      if (ids.size) renderSection(...ids);
      if (topics.has("ui") && s.ui.view === "settings" && lastSection !== s.ui.settingsSection) {
        lastSection = s.ui.settingsSection;
        clearSearch();
        renderNav();
        applyView();
        ctx.scroller?.().scrollTo?.({ top: 0 });
      }
    },
    show() {
      if (!s.memory.loaded) actions.loadMemory();
      actions.t3Status();
      actions.setupStatus();
      lastSection = s.ui.settingsSection;
      renderAll();
    },
    hide() { kit.stopPoll(); },
    focusMemory() {
      const area = sectionEls.memory.querySelector(".memory-editor");
      area?.scrollIntoView({ block: "center" });
      area?.focus({ preventScroll: true });
    },
    focusSearch() { search.focus(); search.select(); },
  };
}
