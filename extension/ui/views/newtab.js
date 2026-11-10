// Minimal new-tab home: the ensō mark, one box for search and chat, a quiet
// "Your tools" strip, and optional widgets the user adds and edits in place.

import { h, icon, clear, iconButton, hostBadge } from "../dom.js";
import { createWidgets } from "./widgets.js";
import { sortTools, labelOf, statusOf, toolGlyph, openToolPopover } from "./tools.js";
import { createDefaultEngineCard } from "./defaultengine.js";

const TOOLS_KEY = "enso.tools.hidden";

export function createNewtabHome(store, ctx) {
  const { state: s } = store;
  const heroSlot = h("div", { class: "hero-slot" });
  const tools = h("div", { class: "tools-strip", role: "group", aria: { label: "Your tools" } });
  const mark = h("div", { class: "enso-mark", aria: { hidden: "true" } }, icon("enso"));
  // "Make the address bar Ensō's box" under the box, while Ensō isn't Zen's default engine (dismissible).
  const engineCard = createDefaultEngineCard({ place: "newtab" });
  // "Edit widgets" under the grid and right-click on a widget open edit mode too.
  const widgets = createWidgets(store, ctx, { onEdit: () => { if (!widgets.editing) customize(); } });
  const addHint = h("button", { type: "button", class: "add-widgets-hint", onclick: () => customize() }, icon("plus"), "Add widgets");
  const editBar = h("div", { class: "edit-bar", hidden: true },
    h("span", null, "Editing widgets: drag to reorder, S/M to resize"),
    h("button", { type: "button", class: "btn small primary", onclick: () => done() }, "Done"));
  const el = h("section", { class: "nt-home", aria: { label: "New tab" } },
    h("div", { class: "nt-center" }, mark, h("h1", { class: "visually-hidden" }, "Ensō"), heroSlot, tools, engineCard.el, addHint, editBar, widgets.el));

  function sync() {
    const editing = widgets.editing;
    editBar.hidden = !editing;
    addHint.hidden = editing || widgets.count > 0;
    el.classList.toggle("has-widgets", widgets.count > 0 || editing);
    el.classList.toggle("is-editing", editing);
  }

  function customize() {
    if (widgets.editing) return done();
    widgets.enterEdit();
    sync();
    ctx.onHomeChange?.();
    requestAnimationFrame(() => editBar.querySelector("button")?.focus());
  }

  function done() {
    widgets.exitEdit();
    sync();
    ctx.onHomeChange?.();
  }

  el.addEventListener("keydown", e => {
    if (e.key === "Escape" && widgets.editing && !e.target.closest?.(".widget-picker, .composer")) { e.preventDefault(); done(); }
  });

  let iconsObserver = null;
  function fadeEdges(box) {
    const max = box.scrollWidth - box.clientWidth;
    box.classList.toggle("fade-start", max > 1 && box.scrollLeft > 1);
    box.classList.toggle("fade-end", max > 1 && box.scrollLeft < max - 1);
  }

  function renderTools() {
    let hidden = false;
    try { hidden = localStorage.getItem(TOOLS_KEY) === "1"; } catch { /* ignore */ }
    const list = sortTools((s.servers ?? []).filter(x => x.enabled !== false && x.status !== "failed"));
    tools.hidden = hidden || !list.length;
    if (tools.hidden) return;
    // In a narrow sidebar the icons scroll sideways (faded at the cut edge);
    // the label and the more/× buttons stay put.
    const icons = h("span", { class: "tools-icons", onscroll: () => fadeEdges(icons) }, list.map(sv => {
      const st = statusOf(sv);
      const title = st.key === "ok" ? labelOf(sv) : `${labelOf(sv)} · ${st.text}`;
      return h("button", { type: "button", class: ["tool-icon", st.key !== "ok" && "dim"], title, aria: { label: title, haspopup: "dialog", expanded: "false" }, onclick: e => openToolPopover(store, sv, e.currentTarget, ctx) }, toolGlyph(sv));
    }));
    iconsObserver?.disconnect();
    iconsObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => fadeEdges(icons)) : null;
    iconsObserver?.observe(icons);
    clear(tools,
      h("button", { type: "button", class: "tools-label", onclick: () => store.actions.go("tools") }, "Your tools"),
      icons,
      iconButton("more", "Manage tools", () => store.actions.go("tools"), { class: "small" }),
      iconButton("x", "Hide your tools", () => { try { localStorage.setItem(TOOLS_KEY, "1"); } catch { /* ignore */ } renderTools(); }, { class: "small tools-x" }));
  }

  renderTools();
  sync();

  return {
    el,
    heroSlot,
    customize,
    get editing() { return widgets.editing; },
    update(topics) {
      if (topics.has("servers") || topics.has("state")) renderTools();
      widgets.update(topics);
      sync();
    },
    show() { renderTools(); sync(); engineCard.check(); },
  };
}
