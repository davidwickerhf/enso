// "Send screenshot": the send sheet, the target picker and the toast.
// docs/PROTOCOL.md "Send screenshots"; the helper side is lib/screenshots.mjs.
//
// Targets: a T3 Code thread, an agent connected through `enso mcp` (Claude Code,
// Codex, OpenCode, Cursor…), or the clipboard ("Copy image", "Save + copy path")
// for any terminal agent. The sheet opens with the target Ensō resolved (an agent
// on this tab → its T3 thread or the agent; a tab link; a site → project link),
// or straight on the picker when there is none.
//
// Keys: Enter sends (Shift+Enter for a new line), Esc closes the picker, then
// the sheet; ↑/↓ move in the picker list.

import { h, clear, icon, iconButton } from "../dom.js";
import { hostOf } from "../format.js";

const SHORTCUT = /Mac/.test(globalThis.navigator?.platform ?? "") ? "⌘⇧2" : "Ctrl+Shift+2";
export const SCREENSHOT_SHORTCUT = SHORTCUT;

const statusDot = t => (t.waiting ? h("span", { class: "dot-status waiting", title: "Waiting for you" }) : t.running ? h("span", { class: "live-dot", title: "Running" }) : h("span", { class: "dot-status idle", aria: { hidden: "true" } }));

export function createSendSheet(store) {
  const { state: s, actions } = store;
  const el = h("div", { class: "shot-layer", hidden: true });
  const toastEl = h("div", { class: "toast-slot", aria: { live: "polite" } });
  let query = "";
  let cursor = 0;
  let wasOpen = false;
  let built = null; // { root, message } kept while the sheet is open, so typing isn't interrupted

  function close() { actions.closeShot(); }

  function targetRow(sh) {
    const info = store.targetInfo(sh.target);
    const kindIcon = sh.target?.kind === "agent" ? "sparkle" : "chat";
    const source = sh.targets?.source;
    const why = !sh.target ? null : source === "agent" ? `${sh.targets.client ?? "The agent"} is working on this tab` : source === "tab-link" ? "Linked to this tab" : source === "host-link" ? `Linked to ${sh.targets.host}` : null;
    return h("div", { class: "shot-target" },
      h("span", { class: "shot-target-icon", aria: { hidden: "true" } }, icon(kindIcon)),
      h("span", { class: "shot-target-main" },
        h("span", { class: "shot-target-kind" }, sh.target?.kind === "agent" ? "Agent" : sh.target ? "T3 thread" : "No target yet"),
        h("strong", { class: "shot-target-title" }, info?.title ?? "Choose where to send it"),
        h("span", { class: "shot-target-sub" }, [info?.sub, why].filter(Boolean).join(" · "))),
      h("button", { type: "button", class: "btn small", onclick: () => { actions.patchShot({ picker: true }); }, aria: { label: "Change where to send the screenshot" } }, sh.target ? "Change" : "Choose"));
  }

  function routeNote(sh) {
    const t = sh.target;
    const t3 = sh.targets?.t3;
    if (t?.kind === "t3" && t3?.connected && t3.route === "path") return h("p", { class: "shot-note" }, icon("info"), "This T3 Code can't take image attachments from Ensō, so the PNG is saved in Ensō's folder and its path is sent as text. Claude Code and Codex open it from there.");
    if (t?.kind === "t3" && t3 && t3.connected && t3.tokenValid === false) return h("p", { class: "shot-note bad" }, icon("alert"), t3.error ?? "Reconnect T3 Code in Settings → Connections.");
    if (t?.kind === "agent") {
      const a = store.targetInfo(t)?.agent;
      return h("p", { class: "shot-note" }, icon("info"), a?.active ? `${a.client} gets the image with its next step in Zen.` : `${a?.client ?? "The agent"} is idle: it gets the image with its next step, when it calls inbox_read, or with your next message if the Claude Code hook is on.`);
    }
    return null;
  }

  function buildSheet(sh) {
    const message = h("textarea", { class: "input shot-message", rows: 2, placeholder: "Add a message (optional)", aria: { label: "Message" } });
    message.value = sh.message ?? "";
    message.addEventListener("input", () => { sh.message = message.value; });
    message.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); actions.sendShot(); }
    });
    const body = h("div", { class: "shot-body" });
    const root = h("section", { class: "shot-sheet", role: "dialog", aria: { modal: "true", label: "Send screenshot" }, tabindex: "-1" },
      h("header", { class: "shot-head" },
        h("h3", null, icon("camera"), "Send screenshot"),
        iconButton("x", "Cancel (Esc)", close, { class: "small" })),
      body);
    return { root, body, message };
  }

  function fillSheet(sh) {
    const errs = sh.consoleErrors;
    const host = hostOf(sh.tab?.url ?? "");
    const toggle = (label, checked, onChange, disabled = false, hint = null) => h("label", { class: ["shot-check", disabled && "disabled"] },
      h("input", { type: "checkbox", checked, disabled, onchange: e => onChange(e.target.checked) }), h("span", null, label, hint ? h("small", { class: "muted" }, ` ${hint}`) : null));
    const t3Target = sh.target?.kind === "t3";
    const projectId = t3Target ? store.targetInfo(sh.target)?.thread?.projectId : null;
    const linkedHost = sh.targets?.links?.hosts?.[sh.targets?.host];
    clear(built.body,
      h("figure", { class: "shot-thumb" },
        h("img", { src: sh.image, alt: `Screenshot of ${sh.tab?.title || "the page"}` }),
        h("figcaption", null, { region: "Region", visible: "Visible area", full: "Full page" }[sh.mode] ?? "Screenshot", host ? ` · ${host}` : "")),
      targetRow(sh),
      routeNote(sh),
      h("div", { class: "shot-options" },
        toggle("Page URL and title", sh.includePage, v => actions.patchShot({ includePage: v })),
        errs?.length ? toggle(`Console errors (${errs.length})`, sh.includeErrors, v => actions.patchShot({ includeErrors: v }))
          : errs ? toggle("Console errors", false, () => {}, true, "none captured yet")
          : h("div", { class: "shot-console-off" },
            h("span", { class: "muted" }, "Console errors aren't being captured on this tab."),
            h("span", { class: "shot-console-acts" },
              h("button", { type: "button", class: "linklike", onclick: () => actions.startConsole(sh.tab?.tabId) }, "Start capturing"),
              host ? h("button", { type: "button", class: "linklike", onclick: () => actions.startConsole(sh.tab?.tabId, true) }, `Always on ${host}`) : null)),
        sh.target ? toggle("Always send this tab here", sh.remember, v => actions.patchShot({ remember: v })) : null,
        t3Target && projectId && sh.targets?.host && linkedHost?.projectId !== projectId && store.targetInfo(sh.target)?.thread?.projectTitle && !/^no project$/i.test(store.targetInfo(sh.target).thread.projectTitle) ? h("button", { type: "button", class: "linklike", onclick: () => { const t = store.targetInfo(sh.target).thread; actions.linkHost(sh.targets.host, t.projectId, t.projectTitle); actions.patchShot({}); } }, `Use ${store.targetInfo(sh.target).thread.projectTitle} for ${sh.targets.host}`) : null),
      built.message,
      sh.error ? h("p", { class: "form-error", role: "alert" }, sh.error) : null,
      h("div", { class: "shot-actions" },
        h("button", { type: "button", class: "btn primary", disabled: !sh.target || sh.sending, onclick: () => actions.sendShot() }, sh.sending ? [h("span", { class: "spinner" }), "Sending…"] : [icon("arrowUp"), "Send"]),
        h("button", { type: "button", class: "btn", onclick: () => actions.copyShot(), title: `For any terminal agent: paste with ${/Mac/.test(globalThis.navigator?.platform ?? "") ? "⌘V" : "Ctrl+V (Ctrl+Shift+V in some terminals)"}` }, icon("copy"), "Copy image"),
        h("button", { type: "button", class: "btn ghost", onclick: () => actions.saveShot(), title: "Save the PNG in Ensō's folder and copy its path" }, "Save + copy path")),
      h("p", { class: "shot-keys muted" }, h("kbd", null, "↵"), " send · ", h("kbd", null, "⇧↵"), " new line · ", h("kbd", null, "Esc"), " cancel"));
  }

  // ---- picker ----
  function pickerItems(sh) {
    const tg = sh.targets;
    if (!tg) return [];
    const q = query.trim().toLowerCase();
    const match = (...xs) => !q || xs.some(x => String(x ?? "").toLowerCase().includes(q));
    const agents = (tg.agents ?? []).filter(a => match(a.client, a.task)).map(a => ({ kind: "agent", id: a.id, title: a.client, sub: a.task || (a.active ? "Working now" : "Connected, idle"), group: "Agents", agent: a }));
    const threads = (tg.threads ?? []).filter(t => match(t.title, t.projectTitle));
    const active = threads.filter(t => t.running || t.waiting);
    const rest = threads.filter(t => !t.running && !t.waiting);
    const proj = tg.projectId ?? null;
    const near = rest.filter(t => proj ? t.projectId === proj : false);
    const other = rest.filter(t => !near.includes(t)).slice(0, q ? 60 : 25);
    const row = group => t => ({ kind: "t3", id: t.id, title: t.title, sub: t.projectTitle, group, thread: t });
    return [...agents, ...active.map(row("T3 · running and waiting")), ...near.map(row(`T3 · ${near[0]?.projectTitle ?? "this site"}`)), ...other.map(row(q ? "T3 threads" : "T3 · recent"))];
  }

  function renderPicker(sh) {
    const tg = sh.targets;
    const items = pickerItems(sh);
    cursor = Math.min(cursor, Math.max(0, items.length - 1));
    const search = h("input", { type: "search", class: "input", placeholder: "Search threads and agents", value: query, aria: { label: "Search threads and agents", controls: "shot-picker-list" }, autocomplete: "off" });
    const choose = it => { actions.patchShot({ target: { kind: it.kind, id: it.id }, picker: false }); };
    search.addEventListener("input", () => { query = search.value; cursor = 0; render(true); });
    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(cursor + 1, items.length - 1); render(true); }
      else if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(cursor - 1, 0); render(true); }
      else if (e.key === "Enter" && items[cursor]) { e.preventDefault(); choose(items[cursor]); }
    });
    let lastGroup = null;
    const list = h("ul", { class: "shot-picker-list", id: "shot-picker-list", role: "listbox", aria: { label: "Targets" } });
    items.forEach((it, i) => {
      if (it.group !== lastGroup) { lastGroup = it.group; list.append(h("li", { class: "shot-group", role: "presentation" }, it.group)); }
      const selected = sh.target?.kind === it.kind && sh.target?.id === it.id;
      list.append(h("li", { role: "option", aria: { selected: String(i === cursor) } },
        h("button", { type: "button", class: ["shot-option", i === cursor && "cursor", selected && "current"], onclick: () => choose(it), onmouseenter: () => { cursor = i; } },
          it.kind === "agent" ? h("span", { class: "agent-mark small", aria: { hidden: "true" } }, "✦") : statusDot(it.thread),
          h("span", { class: "shot-option-main" }, h("span", { class: "shot-option-title" }, it.title), h("span", { class: "shot-option-sub" }, it.sub || "")),
          selected ? icon("check") : null)));
    });
    const t3 = tg?.t3;
    const t3Line = !tg ? null : !t3?.connected ? h("p", { class: "shot-note" }, icon("info"), "T3 Code isn't connected: connect it in Settings → Connections to see its threads here.") : !t3.reachable ? h("p", { class: "shot-note" }, icon("info"), "T3 Code isn't running, so its threads aren't listed.") : t3.tokenValid === false ? h("p", { class: "shot-note bad" }, icon("alert"), t3.error) : null;
    const empty = tg && !items.length ? h("p", { class: "muted shot-empty" }, query ? "Nothing matches." : "No agents are connected and no T3 threads are listed. Copy the image instead, or connect one in Settings.") : null;
    const view = h("section", { class: "shot-sheet shot-picker", role: "dialog", aria: { modal: "true", label: "Choose where to send the screenshot" } },
      h("header", { class: "shot-head" },
        sh.target ? iconButton("arrowLeft", "Back", () => actions.patchShot({ picker: false }), { class: "small" }) : null,
        h("h3", null, "Send to…"),
        iconButton("x", "Cancel (Esc)", close, { class: "small" })),
      search,
      !tg ? h("div", { class: "list-loading" }, h("span", { class: "spinner" }), "Finding threads and agents…") : list,
      t3Line, empty,
      h("div", { class: "shot-actions" }, h("button", { type: "button", class: "btn", onclick: () => actions.copyShot() }, icon("copy"), "Copy image instead")));
    return { view, search };
  }

  function render(keepFocus = false) {
    const sh = s.shot;
    const open = !!sh && !sh.capturing;
    el.hidden = !sh;
    document.documentElement.classList.toggle("shot-open", !!sh);
    if (!sh) { built = null; query = ""; clear(el); wasOpen = false; return; }
    if (sh.capturing) { clear(el, h("div", { class: "shot-capturing", role: "status" }, h("span", { class: "spinner" }), sh.mode === "region" ? "Drag a region on the page (Enter: visible area, F: full page, Esc: cancel)…" : "Taking the screenshot…")); return; }
    if (sh.picker) {
      const { view, search } = renderPicker(sh);
      clear(el, h("div", { class: "shot-scrim", onclick: close }), view);
      search.focus();
      if (keepFocus) search.setSelectionRange(search.value.length, search.value.length);
      built = null;
      return;
    }
    if (!built) built = buildSheet(sh);
    fillSheet(sh);
    if (built.root.parentNode !== el) clear(el, h("div", { class: "shot-scrim", onclick: close }), built.root);
    if (open && (!wasOpen || !el.contains(document.activeElement))) built.message.focus();
    wasOpen = open;
  }

  function renderToast() {
    const t = s.toast;
    clear(toastEl, t ? h("div", { class: ["toast", t.kind], role: "status" },
      icon(t.kind === "bad" ? "alert" : t.kind === "good" ? "check" : "info"),
      h("span", { class: "toast-text" }, t.text),
      t.action ? h("button", { type: "button", class: "btn small", onclick: () => { t.action.run(); actions.dismissToast(); } }, t.action.label, icon("arrowUpRight")) : null,
      iconButton("x", "Dismiss", () => actions.dismissToast(), { class: "small" })) : null);
  }

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !s.shot) return;
    e.preventDefault();
    e.stopPropagation();
    if (s.shot.picker && s.shot.target) actions.patchShot({ picker: false });
    else close();
  }, true);

  render();
  renderToast();
  return {
    el,
    toastEl,
    update(topics) {
      if (topics.has("shot")) render();
      if (topics.has("toast")) renderToast();
    },
  };
}
