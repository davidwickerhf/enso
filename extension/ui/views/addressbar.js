// The address bar as Ensō's box, on Ensō's side:
//   createUrlbarArrival: the new-tab page opened for a query typed in Zen's address
//     bar (background.js → newtab.html#urlbar). Asks Ensō with a one-click "Search
//     <engine> instead", or shows the two-option chooser, plus the active rule.
//   createAddressBarSetting: the one Settings row (mode, web search engine, whether
//     Ensō is Zen's default engine, and the card that shows how to make it so:
//     ./defaultengine.js).
// Rules: ../route.js. Setting and browser calls: ../addressbar.js. Docs: site/content/docs/new-tab.md.

import { h, icon, clear } from "../dom.js";
import { R, addressBarState, setPrefs, takeUrlbarQuery, webSearch } from "../addressbar.js";
import { createDefaultEngineCard } from "./defaultengine.js";

// Its own stylesheet, so app.css stays untouched (loaded with this module, on every page that shows Settings).
if (!document.querySelector("link[data-addressbar]")) {
  document.head.append(h("link", { rel: "stylesheet", href: new URL("../addressbar.css", import.meta.url).href, "data-addressbar": "" }));
}

const DOCS = "https://enso.wicker.life/docs/new-tab#the-address-bar";

function openSetting(store) {
  store.actions.go("settings", { section: "general" }); // the address-bar row lives in Settings → General
  requestAnimationFrame(() => document.getElementById("settings-addressbar")?.scrollIntoView({ block: "center" }));
}

function ruleRow(store, entry) {
  return h("p", { class: "ub-rule" },
    h("span", null, R.ruleLine(entry.mode, entry.engine, { ensoIsDefault: entry.ensoIsDefault })),
    h("span", { "aria-hidden": "true" }, " · "),
    h("button", { type: "button", class: "link-btn", onclick: () => openSetting(store) }, "Change"));
}

export function createUrlbarArrival(store, ctx) {
  const { state: s } = store;
  const el = h("div", { class: "ub-strip", hidden: true, role: "status" });
  let entry = null;
  let chooser = null;
  let shownFor = null; // conversation the strip belongs to

  function hideStrip() { el.hidden = true; clear(el); entry = null; shownFor = null; }

  function showAsked(why) {
    const engine = entry.engine;
    clear(el,
      h("div", { class: "ub-line" },
        icon("sparkle"),
        h("span", { class: "ub-what" }, why),
        engine ? h("button", { type: "button", class: "btn small ub-switch", onclick: () => webSearch(entry.query, engine) }, icon("search"), `Search ${engine} instead`) : null),
      ruleRow(store, entry));
    el.hidden = false;
  }

  function ask() {
    removeChooser();
    // A fresh chat without the page chip: the "page" here is only this new tab.
    store.actions.newChat();
    store.actions.send(entry.query, { includePage: false });
    shownFor = "pending";
    showAsked(entry.forced ? "Asked Ensō (you started with e)" : "Asked Ensō from the address bar");
  }

  function search() {
    removeChooser();
    webSearch(entry.query, entry.engine);
  }

  function removeChooser() {
    chooser?.remove();
    chooser = null;
  }

  function showChooser() {
    const pick = choice => { setPrefs({ lastChoice: choice }).catch(() => {}); choice === "web" ? search() : ask(); };
    const opts = [
      { key: "enso", label: "Ask Ensō", sub: "Start a chat", glyph: "sparkle" },
      { key: "web", label: `Search ${entry.engine ?? "the web"}`, sub: "Open the results", glyph: "search", disabled: !entry.engine },
    ];
    let sel = entry.lastChoice === "web" && entry.engine ? 1 : 0;
    const buttons = opts.map((o, i) => h("button", {
      type: "button", class: "ub-opt", role: "option", disabled: o.disabled,
      onclick: () => pick(o.key), onfocus: () => { sel = i; mark(); },
    }, h("span", { class: "ub-glyph" }, icon(o.glyph)), h("span", { class: "ub-opt-text" }, h("strong", null, o.label), h("small", null, o.sub)), h("kbd", { class: "ub-enter" }, "↵")));
    const mark = () => buttons.forEach((b, i) => { b.classList.toggle("on", i === sel); b.setAttribute("aria-selected", String(i === sel)); });
    const list = h("div", { class: "ub-opts", role: "listbox", aria: { label: "Where should this go?" } }, buttons);
    chooser = h("div", { class: "ub-chooser" },
      h("p", { class: "ub-q" }, h("span", { class: "muted" }, "From the address bar: "), h("strong", null, entry.query)),
      list,
      h("p", { class: "ub-keys" }, h("kbd", null, "Tab"), " switches · ", h("kbd", null, "↵"), " picks · ", h("kbd", null, "Esc"), " edits the text"),
      ruleRow(store, entry));
    chooser.addEventListener("keydown", e => {
      if (["Tab", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const enabled = buttons.map((b, i) => (b.disabled ? -1 : i)).filter(i => i >= 0);
        sel = enabled[(enabled.indexOf(sel) + 1) % enabled.length];
        buttons[sel].focus();
        mark();
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        pick(opts[sel].key);
      } else if (e.key === "Escape") {
        e.preventDefault();
        removeChooser();
        ctx.composerText?.(entry.query);
      }
    });
    mark();
    const slot = ctx.heroSlot?.();
    if (slot) slot.append(chooser);
    else el.parentNode?.insertBefore(chooser, el.nextSibling);
    requestAnimationFrame(() => buttons[sel].focus({ preventScroll: true }));
    // Typing in the box instead means "neither": the chooser steps aside.
    ctx.composerEl?.()?.addEventListener("input", removeChooser, { once: true });
  }

  return {
    el,
    /** Run once the page is connected (so a question can be sent). */
    async start(hash) {
      const got = await takeUrlbarQuery(hash).catch(() => null);
      if (!got) return;
      entry = got;
      if (!entry.query) { ctx.focusComposer(); return; }
      if (entry.to === "choose") showChooser();
      else if (entry.to === "web") search(); // the mock, or background.js couldn't search
      else ask();
    },
    update(topics) {
      if (!entry || chooser) return;
      if (!topics.has("ui")) return;
      // The strip belongs to the conversation it started; it goes once you move on.
      if (shownFor === "pending" && s.ui.view === "chat" && s.ui.currentId && s.ui.currentId !== "draft") shownFor = s.ui.currentId;
      else if (shownFor && shownFor !== "pending" && (s.ui.view !== "chat" || s.ui.currentId !== shownFor)) hideStrip();
    },
  };
}

// ---- Settings ------------------------------------------------------------

export function createAddressBarSetting(store) {
  const el = h("section", { class: "settings-block", id: "settings-addressbar" });
  let st = null;
  // Prominent while Ensō isn't the default; says "Done" if that changes while Settings is open.
  const card = createDefaultEngineCard({ place: "settings", onChange: () => load() });

  async function load() {
    st = await addressBarState().catch(() => null);
    render();
  }

  async function save(patch) {
    await setPrefs(patch).catch(() => {});
    await load();
  }

  function render() {
    if (!st) { clear(el); return; }
    const modes = [["enso", "Ensō"], ["web", "Web search"], ["choose", "Choose each time"]];
    const engineSelect = h("select", { class: "select", id: "set-ab-engine", aria: { label: "Web search engine" }, onchange: e => save({ engine: e.target.value }) },
      st.engines.map(name => h("option", { value: name, selected: name === st.engine }, name)));
    clear(el,
      h("h3", null, "Address bar"),
      card.el,
      h("div", { class: "setting stacked" },
        h("div", { class: "setting-text" },
          h("label", null, "Address-bar queries go to"),
          h("p", null, st.ensoIsDefault
            ? [icon("check"), " Ensō is Zen's default search engine, so what you type in the address bar comes here. Start with ", h("kbd", null, "e"), " to ask Ensō or ", h("kbd", null, "g"), " to search the web, whatever you pick below."]
            : ["Ensō isn't Zen's default search engine yet, so only searches with the ", h("code", null, "@enso"), " keyword come here. The card above shows how to change that."])),
        h("div", { class: "ab-controls" },
          h("div", { class: "segmented", role: "radiogroup", aria: { label: "Address-bar queries go to" } },
            modes.map(([v, label]) => h("button", { type: "button", role: "radio", class: ["seg", v === st.mode && "on"], aria: { checked: String(v === st.mode) }, onclick: () => v !== st.mode && save({ mode: v }) }, label))),
          h("label", { class: "ab-engine", for: "set-ab-engine" }, h("span", { class: "muted small" }, "Web search engine"), engineSelect)),
        h("p", { class: "hint" }, "For one box like Dia, set ", h("code", null, "zen.urlbar.replace-newtab"), " to true in about:config: ⌘T then opens Zen's floating bar. ",
          h("a", { href: DOCS, target: "_blank", rel: "noopener" }, "How it works"))));
  }

  load();
  // Zen's default engine can change while Settings is open.
  document.addEventListener("visibilitychange", () => { if (!document.hidden && el.isConnected) load(); });
  window.addEventListener("enso:engines", () => { if (el.isConnected) load(); }); // the mock's __ensoMock.setEnsoDefault()
  return { el, update() {} };
}
