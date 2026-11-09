// The composer: page chip, @-mentioned tabs, /skills, attachments, screenshot
// toggle, site-adaptive prompts, auto-growing textarea and the send/stop button.
// One instance per app; app.js moves it between slots (hero / docked).

import { h, icon, clear, hostBadge, isHttpUrl, spaceIcon } from "../dom.js";
import { hostOf } from "../format.js";
import { promptsFor } from "../prompts.js";
import { localSuggestions, engineInfo, engineSuggestions, buildRows, initialIndex, runRow, sensitiveMatcher } from "../omnibox.js";

const MAX_BYTES = 25 * 1024 * 1024;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl+";

export function favicon(url, favIconUrl, cls = "") {
  const host = hostOf(url);
  if (typeof favIconUrl === "string" && (isHttpUrl(favIconUrl) || favIconUrl.startsWith("data:image/"))) {
    const img = h("img", { class: `favicon ${cls}`.trim(), src: favIconUrl, alt: "", width: 16, height: 16, referrerpolicy: "no-referrer", loading: "lazy" });
    img.addEventListener("error", () => img.replaceWith(hostBadge(host, `favicon ${cls}`)), { once: true });
    return img;
  }
  return hostBadge(host, `favicon ${cls}`.trim());
}

export function createComposer(store) {
  const { state: s, actions } = store;
  const local = {
    pageRemoved: false,     // × on the page chip: this message goes without the page
    mentions: [],           // tab ids, or "all"
    skill: null,
    attachments: [],        // { name, mimeType, dataBase64, size }
    screenshot: false,
    picker: null,           // { kind: "mention" | "skill", query, index, start }
    error: null,
    suggestions: true,      // app decides whether site prompts may show
    variant: "docked",
    omni: null,             // { text, rows, index, completion } in the new-tab search box
    menu: false,            // "Add tabs or files" menu
  };
  let omniTimer = 0;
  let omniSeq = 0;

  const textarea = h("textarea", {
    rows: 1,
    class: "composer-input",
    placeholder: "Ask anything…",
    aria: { label: "Message", autocomplete: "list", controls: "composer-picker", expanded: "false" },
    spellcheck: "true",
  });
  // Any file: the helper turns Office documents, spreadsheets, slides, archives and code into something Claude can read.
  const fileInput = h("input", { type: "file", multiple: true, hidden: true, tabindex: "-1" });
  const chips = h("div", { class: "composer-chips" });
  const suggest = h("div", { class: "site-prompts", role: "group", aria: { label: "Suggestions for this page" } });
  const picker = h("div", { class: "picker", id: "composer-picker", role: "listbox", hidden: true });
  const errorEl = h("div", { class: "composer-error", role: "alert", hidden: true });

  const attachBtn = h("button", { type: "button", class: "icon-btn", title: "Attach files (any type, up to 25 MB in total) — or drop or paste them here", aria: { label: "Attach files" }, onclick: () => fileInput.click() }, icon("plus"));
  const shotBtn = h("button", { type: "button", class: "icon-btn", title: "Attach a screenshot of this page", aria: { label: "Attach a screenshot of this page", pressed: "false" }, onclick: () => { local.screenshot = !local.screenshot; render(); textarea.focus(); } }, icon("camera"));
  // Zen has no speech recognition of its own; macOS Dictation works in this box, so the mic starts there.
  const micBtn = h("button", { type: "button", class: "icon-btn", title: "Dictate: press Fn twice (macOS Dictation)", aria: { label: "Dictate with macOS Dictation" }, onclick: () => {
    textarea.focus();
    local.error = "Press Fn (🌐) twice to dictate with macOS Dictation. Turn it on in System Settings → Keyboard → Dictation if nothing happens.";
    render();
    setTimeout(() => { if (local.error?.startsWith("Press Fn")) { local.error = null; render(); } }, 6000);
  } }, icon("mic"));
  const sendBtn = h("button", { type: "button", class: "send-btn", onclick: () => (running() ? actions.stop() : omniSelected() ? runSelected() : submit()) }, icon("arrowUp"));

  const lead = h("span", { class: "composer-lead", aria: { hidden: "true" } }, icon("search"));
  const omniList = h("div", { class: "omni", id: "composer-omni", role: "listbox", aria: { label: "Suggestions" }, hidden: true });
  const actionsEl = h("div", { class: "composer-actions" }, attachBtn, shotBtn, micBtn, sendBtn);
  const addMenu = h("div", { class: "add-menu", role: "menu", hidden: true },
    h("button", { type: "button", role: "menuitem", onclick: () => { closeMenu(); insertAt("@"); } }, icon("at"), "Mention a tab"),
    h("button", { type: "button", role: "menuitem", onclick: () => { closeMenu(); if (!local.mentions.includes("all")) { actions.listTabs(); local.mentions.push("all"); scheduleOmni(); render(); } textarea.focus(); } }, icon("layers"), "All open tabs"),
    h("button", { type: "button", role: "menuitem", onclick: () => { closeMenu(); fileInput.click(); } }, icon("page"), "Upload a file"));
  const addChip = h("button", { type: "button", class: "add-chip", aria: { haspopup: "menu", expanded: "false" }, onclick: () => (local.menu ? closeMenu() : openMenu()) }, icon("plus"), h("span", null, "Add tabs or files"));
  const foot = h("div", { class: "composer-foot" }, h("span", { class: "add-wrap" }, addChip, addMenu), h("span", { class: "spacer" }));

  const box = h("div", { class: "composer-box" },
    chips,
    h("div", { class: "composer-row" }, lead, textarea, actionsEl),
    omniList,
    foot,
    picker,
    fileInput);

  const hints = h("div", { class: "composer-hints", aria: { hidden: "true" } },
    h("span", null, h("kbd", null, "↵"), " send"),
    h("span", { class: "hint-wide" }, h("kbd", null, "⇧↵"), " new line"),
    h("span", null, h("kbd", null, "@"), " tabs"),
    h("span", null, h("kbd", null, "/"), " skills"),
    h("span", { class: "hint-wide" }, h("kbd", null, `${MOD}K`), " focus"),
    h("span", { class: "hint-wide" }, h("kbd", null, `${MOD}N`), " new chat"));

  const el = h("div", { class: "composer" }, suggest, errorEl, box, hints);

  // ---- helpers ----------------------------------------------------------

  function running() {
    const id = s.ui.view === "chat" ? s.ui.currentId : null;
    return !!id && s.running.has(id);
  }

  function sensitive() {
    return !!s.tab?.sensitive;
  }

  function pageAttached() {
    return !!s.tab && !sensitive() && s.ui.includePage && !local.pageRemoved;
  }

  function autosize() {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`;
  }

  function reset() {
    textarea.value = "";
    typed = "";
    local.pageRemoved = false;
    local.mentions = [];
    local.skill = null;
    local.attachments = [];
    local.screenshot = false;
    local.error = null;
    local.omni = null;
    renderOmni();
    closePicker();
    autosize();
    render();
  }

  function submit(textOverride) {
    if (running()) return;
    const text = textOverride ?? textarea.value;
    if (!text.trim() && !local.skill) return;
    const ids = local.mentions.includes("all") ? s.tabs.map(t => t.tabId) : local.mentions;
    actions.send(text, {
      includePage: textOverride != null ? !sensitive() : pageAttached(),
      skill: local.skill?.name,
      mentionedTabIds: [...new Set(ids)],
      attachScreenshot: local.screenshot && !sensitive(),
      attachments: local.attachments,
    });
    reset();
  }

  function openMenu() { local.menu = true; addMenu.hidden = false; addChip.setAttribute("aria-expanded", "true"); addMenu.querySelector("button")?.focus(); }
  function closeMenu() { local.menu = false; addMenu.hidden = true; addChip.setAttribute("aria-expanded", "false"); }
  document.addEventListener("click", e => { if (local.menu && !e.target.closest?.(".add-wrap")) closeMenu(); });
  addMenu.addEventListener("keydown", e => {
    const items = [...addMenu.querySelectorAll("button")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); textarea.focus(); }
  });

  function insertAt(str) {
    const pos = textarea.selectionStart ?? textarea.value.length;
    const v = textarea.value;
    const pre = v.slice(0, pos);
    const add = (pre && !/\s$/.test(pre) ? " " : "") + str;
    textarea.value = pre + add + v.slice(pos);
    textarea.setSelectionRange(pos + add.length, pos + add.length);
    textarea.focus();
    textarea.dispatchEvent(new Event("input"));
  }

  // ---- new-tab search box -------------------------------------------------

  // local.typed: what the user actually typed (the input may also hold a selected inline completion).
  let typed = "";
  let deleting = false;
  let abort = null;
  let enginePromise = null;
  const engine = () => (enginePromise ??= engineInfo());

  function omniEligible() {
    return local.variant === "hero" && typed.trim() && !local.skill && !local.picker && !local.mentions.length && !local.attachments.length && !typed.trimStart().startsWith("/") && !/(^|\s)@\S*$/.test(typed);
  }

  function hasInlineCompletion() {
    return textarea.selectionStart === typed.length && textarea.selectionEnd === textarea.value.length && textarea.value.length > typed.length;
  }

  function scheduleOmni() {
    clearTimeout(omniTimer);
    abort?.abort();
    if (!omniEligible()) { if (local.omni) { local.omni = null; renderOmni(); render(); } return; }
    const text = typed;
    const seq = ++omniSeq;
    omniTimer = setTimeout(async () => {
      const [{ matches, completion }, eng] = await Promise.all([localSuggestions(text, { sensitive: sensitiveMatcher(s.sensitiveHosts) }), engine()]);
      if (seq !== omniSeq || typed !== text || !omniEligible()) return;
      // Inline autocomplete while typing forward with the caret at the end.
      let comp = null;
      if (completion && !deleting && textarea.value === text && textarea.selectionStart === text.length) {
        textarea.value = text + completion.text.slice(text.length);
        textarea.setSelectionRange(text.length, textarea.value.length);
        comp = completion;
      } else if (completion && hasInlineCompletion() && textarea.value.toLowerCase() === completion.text.toLowerCase()) comp = completion;
      const rows = buildRows(text, { matches, completion: comp, engineName: eng.name });
      local.omni = { text, rows, index: initialIndex(rows, text), completion: comp, matches, engine: eng };
      renderOmni();
      render();
      // Engine suggestions arrive later and are appended below, so nothing jumps.
      if (!comp && eng.suggest) {
        abort = new AbortController();
        const sugg = await engineSuggestions(text, eng, abort.signal);
        if (seq !== omniSeq || typed !== text || !local.omni || !sugg.length) return;
        const o = local.omni;
        const selected = o.rows[o.index];
        o.rows = buildRows(text, { matches, completion: null, suggestions: sugg, engineName: eng.name });
        o.index = Math.max(0, o.rows.findIndex(r => r.kind === selected?.kind && r.label === selected?.label && r.url === selected?.url));
        renderOmni();
        render();
      }
    }, 60);
  }

  const OMNI_ICON = { open: "globe", site: "globe", search: "search", suggest: "search", tab: "layers", bookmark: "globe", history: "globe", ask: "chat" };
  const isMacHint = isMac ? { search: "⇧⌘↵", ask: "⌃⌘↵" } : { search: "Shift+Ctrl+↵", ask: "Ctrl+Alt+↵" };

  function boldRest(label, q) {
    const l = label.toLowerCase();
    let i = 0;
    const ql = q.toLowerCase();
    while (i < l.length && i < ql.length && l[i] === ql[i]) i++;
    // don't split a word: back up to the last space within the shared prefix
    if (i < l.length && i > 0 && l[i - 1] !== " ") { const sp = label.lastIndexOf(" ", i); i = sp >= 0 ? sp + 1 : 0; }
    return [label.slice(0, i), h("strong", null, label.slice(i))];
  }

  function renderOmni() {
    const o = local.omni;
    if (!o || !o.rows.length) {
      omniList.hidden = true;
      clear(omniList);
      textarea.removeAttribute("aria-activedescendant");
      clear(lead, icon("search"));
      el.classList.remove("omni-open");
      return;
    }
    clear(omniList, o.rows.map((row, i) => h("div", {
      class: ["omni-row", `kind-${row.kind}`, i === o.index && "active"], id: `omni-${i}`, role: "option", aria: { selected: String(i === o.index) },
      onmousedown: e => { e.preventDefault(); o.index = i; runSelected(); },
      onmousemove: () => { if (o.index !== i) { o.index = i; renderOmni(); render(); } },
    },
      h("span", { class: "omni-icon" }, row.favIconUrl && row.url ? favicon(row.url, row.favIconUrl) : icon(OMNI_ICON[row.kind] ?? "globe")),
      h("span", { class: "omni-text" },
        row.kind === "suggest" ? h("span", { class: "omni-label" }, boldRest(row.label, row.typed)) : h("span", { class: "omni-label" }, row.label),
        row.sub ? h("span", { class: "omni-sub" }, " — ", shortSub(row.sub)) : null),
      row.kind === "search" || row.kind === "ask" ? h("span", { class: "omni-hint" }, isMacHint[row.kind === "ask" ? "ask" : "search"])
        : row.kind === "tab" ? h("span", { class: "omni-trail" }, "Switch to tab") : null)));
    omniList.hidden = false;
    el.classList.add("omni-open");
    textarea.setAttribute("aria-activedescendant", `omni-${o.index}`);
    clear(lead, icon(OMNI_ICON[o.rows[o.index]?.kind] ?? "search"));
  }

  function omniSelected() {
    const o = local.omni;
    return o && omniEligible() ? o.rows[o.index] ?? null : null;
  }

  function clearOmni() {
    textarea.value = "";
    typed = "";
    local.omni = null;
    renderOmni();
    autosize();
    render();
  }

  function runSelected(force) {
    const o = local.omni;
    let row = omniSelected();
    if (force === "search") row = o?.rows.find(r => r.kind === "search") ?? { kind: "search", query: typed.trim() };
    if (force === "ask") row = { kind: "ask" };
    if (!row || row.kind === "ask") {
      const text = typed || textarea.value;
      local.omni = null;
      renderOmni();
      submit(text);
      typed = "";
      return;
    }
    runRow(row, typed);
    clearOmni();
  }

  function acceptCompletion() {
    if (!hasInlineCompletion()) return false;
    typed = textarea.value;
    textarea.setSelectionRange(typed.length, typed.length);
    scheduleOmni();
    return true;
  }

  // ---- pickers ----------------------------------------------------------

  function detectPicker() {
    const pos = textarea.selectionStart;
    const before = textarea.value.slice(0, pos);
    const skill = !local.skill && before.match(/^\/([\w-]*)$/);
    const mention = before.match(/(^|\s)@([^\s@]*)$/);
    if (skill) openPicker("skill", skill[1], 0);
    else if (mention) openPicker("mention", mention[2], pos - mention[2].length - 1);
    else closePicker();
  }

  function openPicker(kind, query, start) {
    const was = local.picker;
    if (!was || was.kind !== kind) {
      if (kind === "mention") actions.listTabs();
      local.picker = { kind, query, index: 0, start };
    } else {
      if (was.query !== query) was.index = 0;
      Object.assign(was, { query, start });
    }
    renderPicker();
  }

  function closePicker() {
    if (!local.picker) return;
    local.picker = null;
    renderPicker();
  }

  function pickerItems() {
    const p = local.picker;
    if (!p) return [];
    const q = p.query.toLowerCase();
    if (p.kind === "skill") {
      return s.skills
        .filter(k => !q || k.name.toLowerCase().includes(q) || (k.description ?? "").toLowerCase().includes(q))
        .sort((a, b) => (b.name.toLowerCase().startsWith(q) ? 1 : 0) - (a.name.toLowerCase().startsWith(q) ? 1 : 0))
        .map(k => ({ id: `skill-${k.name}`, skill: k }));
    }
    const tabs = s.tabs.filter(t => !local.mentions.includes(t.tabId) && (!q || (t.title ?? "").toLowerCase().includes(q) || (t.url ?? "").toLowerCase().includes(q)));
    const here = tabs.filter(t => !t.hidden);
    const other = tabs.filter(t => t.hidden);
    const items = [...here, ...other].map(t => ({ id: `tab-${t.tabId}`, tab: t }));
    if (!local.mentions.includes("all") && s.tabs.length > 1 && (!q || "all open tabs".includes(q))) items.unshift({ id: "tab-all", all: true });
    return items;
  }

  function choose(item) {
    const p = local.picker;
    if (!item || !p) return;
    if (item.skill) {
      local.skill = item.skill;
      textarea.value = textarea.value.replace(/^\/[\w-]*\s?/, "");
      textarea.setSelectionRange(0, 0);
    } else {
      local.mentions.push(item.all ? "all" : item.tab.tabId);
      const v = textarea.value;
      const end = textarea.selectionStart;
      textarea.value = v.slice(0, p.start) + v.slice(end).replace(/^\s?/, v.slice(0, p.start) && !/\s$/.test(v.slice(0, p.start)) ? " " : "");
      textarea.setSelectionRange(p.start, p.start);
    }
    local.picker = null;
    renderPicker();
    render();
    autosize();
    textarea.focus();
  }

  function renderPicker() {
    const p = local.picker;
    textarea.setAttribute("aria-expanded", p ? "true" : "false");
    if (!p) {
      picker.hidden = true;
      textarea.removeAttribute("aria-activedescendant");
      return;
    }
    const items = pickerItems();
    p.index = Math.max(0, Math.min(p.index, items.length - 1));
    clear(picker,
      h("div", { class: "picker-head" }, p.kind === "skill" ? "Skills" : "Mention a tab", h("span", null, "↑↓ to move · ↵ to choose · Esc to close")),
      items.length
        ? items.flatMap((item, i) => [item.tab?.hidden && !items[i - 1]?.tab?.hidden ? h("div", { class: "picker-divider", role: "presentation" }, "Other spaces") : null, h("div", {
            class: ["picker-item", i === p.index && "active"],
            id: `pick-${item.id}`,
            role: "option",
            aria: { selected: i === p.index ? "true" : "false" },
            onmousedown: e => { e.preventDefault(); choose(item); },
            onmousemove: () => { if (p.index !== i) { p.index = i; renderPicker(); } },
          },
          item.skill
            ? [h("span", { class: "picker-icon skill-slash" }, "/"), h("span", { class: "picker-text" }, h("strong", null, item.skill.name), h("small", null, item.skill.description ?? "")), item.skill.builtIn ? null : h("span", { class: "tag" }, "custom")]
            : item.all
              ? [h("span", { class: "picker-icon" }, icon("layers")), h("span", { class: "picker-text" }, h("strong", null, "All open tabs"), h("small", null, `${s.tabs.length} tabs in this window`))]
              : [favicon(item.tab.url, item.tab.favIconUrl, "picker-icon"), h("span", { class: "picker-text" }, h("strong", null, item.tab.title || item.tab.url), h("small", null, item.tab.hidden && item.tab.space ? `${item.tab.space} · ${hostOf(item.tab.url)}` : hostOf(item.tab.url))), item.tab.active ? h("span", { class: "tag" }, "current") : item.tab.hidden && item.tab.space ? h("span", { class: "tag" }, item.tab.space) : null])])
        : h("div", { class: "picker-empty" }, p.kind === "skill" ? "No skill matches. Create one in Settings." : s.tabs.length ? "No tab matches." : "Loading tabs…"));
    picker.hidden = false;
    const active = items[p.index];
    if (active) {
      textarea.setAttribute("aria-activedescendant", `pick-${active.id}`);
      picker.querySelector(".picker-item.active")?.scrollIntoView({ block: "nearest" });
    }
  }

  // ---- files ------------------------------------------------------------

  async function addFiles(files) {
    local.error = null;
    for (const file of files) {
      const ok = /^(image\/|text\/|application\/pdf$|application\/json$)/.test(file.type) || /\.(md|csv|txt|json|log)$/i.test(file.name);
      if (!ok) { local.error = `${file.name}: only images, PDF and text files can be attached.`; continue; }
      const used = local.attachments.reduce((n, a) => n + a.size, 0);
      if (used + file.size > MAX_BYTES) { local.error = `${file.name} is too large: attachments are limited to 25 MB in total.`; continue; }
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      }).catch(() => null);
      if (dataBase64 == null) { local.error = `Couldn't read ${file.name}.`; continue; }
      local.attachments.push({ name: file.name, mimeType: file.type || "text/plain", dataBase64, size: file.size });
    }
    render();
    textarea.focus();
  }

  // ---- render -----------------------------------------------------------

  function chip(cls, content, onRemove, label) {
    return h("span", { class: `chip ${cls}` }, content,
      onRemove ? h("button", { type: "button", class: "chip-x", title: `Remove ${label}`, aria: { label: `Remove ${label}` }, onclick: e => { e.stopPropagation(); onRemove(); textarea.focus(); } }, icon("x")) : null);
  }

  let chipsSig = "";
  let promptsSig = "";

  function render() {
    const tab = s.tab;
    const items = [];
    const sig = JSON.stringify([tab, s.space?.id, sensitive(), pageAttached(), local.mentions, local.skill?.name, local.attachments.map(a => a.name), local.screenshot, s.tabs.length]);
    if (tab && sensitive()) {
      items.push(chip("page-chip private", [h("span", { class: "page-chip-icon" }, icon("lock")), h("span", { class: "page-chip-text" }, h("strong", null, "Private page — not shared"), h("small", null, hostOf(tab.url)))], null));
    } else if (tab && pageAttached()) {
      items.push(chip("page-chip", [h("span", { class: "page-chip-icon" }, favicon(tab.url, tab.favIconUrl)), h("span", { class: "page-chip-text", title: tab.url }, h("strong", null, tab.title || hostOf(tab.url)), h("small", { class: "page-chip-sub" }, s.space ? [spaceIcon(s.space, "tiny"), h("span", { class: "chip-space" }, s.space.name), h("span", { class: "sep" }, " · ")] : null, h("span", { class: "chip-host" }, hostOf(tab.url))))], () => { local.pageRemoved = true; render(); }, "this page"));
    } else if (tab) {
      items.push(h("button", { type: "button", class: "chip add-page", title: tab.url, onclick: () => { local.pageRemoved = false; actions.setIncludePage(true); render(); } }, icon("plus"), "Add this page"));
    }
    for (const m of local.mentions) {
      if (m === "all") { items.push(chip("tab-chip", [icon("layers"), h("span", null, `All open tabs (${s.tabs.length})`)], () => { local.mentions = local.mentions.filter(x => x !== "all"); render(); }, "all tabs")); continue; }
      const t = s.tabs.find(x => x.tabId === m);
      if (!t) continue;
      const short = (t.title || hostOf(t.url)).slice(0, 28) + ((t.title || "").length > 28 ? "…" : "");
      items.push(chip("tab-chip", [favicon(t.url, t.favIconUrl), h("span", { title: t.title }, short)], () => { local.mentions = local.mentions.filter(x => x !== m); render(); }, t.title));
    }
    if (local.skill) items.push(chip("skill-chip", [h("span", { class: "skill-slash" }, "/"), h("span", null, local.skill.name)], () => { local.skill = null; render(); }, `skill ${local.skill.name}`));
    for (const a of local.attachments) {
      items.push(chip("file-chip", [icon(a.mimeType.startsWith("image/") ? "image" : "page"), h("span", { title: a.name }, a.name), h("small", null, sizeLabel(a.size))], () => { local.attachments = local.attachments.filter(x => x !== a); render(); }, a.name));
    }
    if (local.screenshot && !sensitive()) items.push(chip("shot-chip", [icon("camera"), h("span", null, "Screenshot of this page")], () => { local.screenshot = false; render(); }, "screenshot"));
    if (sig !== chipsSig) {
      chipsSig = sig;
      clear(chips, items);
      chips.hidden = !items.length;
    }

    // placeholder + site prompts
    const p = tab && !sensitive() ? promptsFor(tab.url) : null;
    textarea.placeholder = local.variant === "hero" && !pageAttached() && !local.skill ? "Ask anything…" : local.skill ? `${local.skill.description || `Run /${local.skill.name}`}…` : pageAttached() ? p?.placeholder ?? "Ask a question about this page…" : "Ask anything…";
    const showPrompts = local.suggestions && p && pageAttached() && !textarea.value && !local.skill && !running();
    const pSig = showPrompts ? p.chips.join("|") : "";
    if (pSig !== promptsSig) {
      promptsSig = pSig;
      clear(suggest, showPrompts ? p.chips.slice(0, 3).map(text => h("button", { type: "button", class: "site-prompt", onclick: () => submit(text) }, icon("sparkle"), text)) : null);
      suggest.hidden = !showPrompts;
    }

    errorEl.hidden = !local.error;
    errorEl.textContent = local.error ?? "";

    const isRunning = running();
    const sel = omniSelected();
    const go = !isRunning && sel && sel.kind !== "ask";
    sendBtn.classList.toggle("stop", isRunning);
    sendBtn.classList.toggle("go", !!go);
    sendBtn.title = isRunning ? "Stop (Esc)" : go ? (sel.kind === "search" || sel.kind === "suggest" ? "Search (Enter)" : sel.kind === "tab" ? "Switch to tab (Enter)" : "Open (Enter)") : "Send (Enter)";
    sendBtn.setAttribute("aria-label", isRunning ? "Stop the answer" : go ? sendBtn.title.replace(" (Enter)", "") : "Send message");
    const askSel = !isRunning && sel && sel.kind === "ask";
    sendBtn.classList.toggle("ask", !!askSel);
    if (go) clear(sendBtn, h("span", null, sel.kind === "search" || sel.kind === "suggest" ? local.omni?.engine?.name ?? "Search" : "Go"), h("span", { class: "go-key" }, "↵"));
    else if (askSel) clear(sendBtn, h("span", null, "Ask"), h("span", { class: "go-key" }, "↵"));
    else clear(sendBtn, icon(isRunning ? "stop" : "arrowUp"));
    sendBtn.disabled = !isRunning && !textarea.value.trim() && !local.skill;
    shotBtn.hidden = !tab; // nothing to capture on the new tab
    shotBtn.disabled = sensitive();
    shotBtn.classList.toggle("on", local.screenshot && !sensitive());
    shotBtn.setAttribute("aria-pressed", String(local.screenshot && !sensitive()));
    shotBtn.title = sensitive() ? "Screenshots are off on private pages" : "Attach a screenshot of this page";
    el.classList.toggle("is-running", isRunning);
  }

  // ---- events -----------------------------------------------------------

  textarea.addEventListener("input", e => {
    deleting = /^delete/.test(e.inputType ?? "");
    typed = textarea.value;
    autosize();
    detectPicker();
    scheduleOmni();
    render();
  });
  textarea.addEventListener("click", detectPicker);
  textarea.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== textarea) closePicker(); }, 120));
  textarea.addEventListener("keydown", e => {
    const p = local.picker;
    if (p) {
      const items = pickerItems();
      if (e.key === "ArrowDown") { e.preventDefault(); p.index = (p.index + 1) % Math.max(1, items.length); renderPicker(); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); p.index = (p.index - 1 + items.length) % Math.max(1, items.length); renderPicker(); return; }
      if ((e.key === "Enter" || e.key === "Tab") && items.length) { e.preventDefault(); choose(items[p.index]); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePicker(); return; }
    }
    if (local.variant === "hero" && omniEligible() && !e.isComposing) {
      const o = local.omni;
      if (e.key === "Enter" && e.shiftKey && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runSelected("search"); return; }
      if (e.key === "Enter" && ((e.ctrlKey && e.metaKey) || (!isMac && e.ctrlKey && e.altKey))) { e.preventDefault(); runSelected("ask"); return; }
      if ((e.key === "Tab" && !e.shiftKey) || (e.key === "ArrowRight" && !e.shiftKey)) { if (acceptCompletion()) { e.preventDefault(); return; } }
      if (o && e.key === "ArrowDown") { e.preventDefault(); o.index = (o.index + 1) % o.rows.length; renderOmni(); render(); return; }
      if (o && e.key === "ArrowUp") { e.preventDefault(); o.index = (o.index - 1 + o.rows.length) % o.rows.length; renderOmni(); render(); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); runSelected(); return; }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); clearOmni(); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === "Escape" && running()) { e.preventDefault(); actions.stop(); return; }
    if (e.key === "Backspace" && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      // Backspace at the start removes the last chip, like a token field.
      if (local.skill) { local.skill = null; render(); e.preventDefault(); }
      else if (local.mentions.length) { local.mentions.pop(); render(); e.preventDefault(); }
    }
  });
  textarea.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  box.addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); box.classList.add("drop"); } });
  box.addEventListener("dragleave", () => box.classList.remove("drop"));
  box.addEventListener("drop", e => { box.classList.remove("drop"); if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } });
  box.addEventListener("click", e => { if (e.target === box || e.target.classList.contains("composer-row")) textarea.focus(); });
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files]); fileInput.value = ""; });

  store.subscribe(topics => {
    if (topics.has("tabs") && local.picker) renderPicker();
    if (topics.has("skills") && local.picker) renderPicker();
    if (topics.has("tab")) local.pageRemoved = false;
    if (["tab", "tabs", "ui", "skills", "conversations", "settings", "space"].some(t => topics.has(t)) || [...topics].some(t => t.startsWith("conv:"))) render();
  });

  render();

  return {
    el,
    textarea,
    focus() { textarea.focus(); },
    setText(text) { textarea.value = text; typed = text; autosize(); render(); textarea.focus(); },
    setSuggestions(v) { local.suggestions = v; render(); },
    setVariant(name) {
      el.dataset.variant = name;
      local.variant = name;
      if (name === "hero") foot.append(micBtn, sendBtn);
      else actionsEl.append(micBtn, sendBtn);
      if (name !== "hero") { local.omni = null; renderOmni(); }
      requestAnimationFrame(autosize);
      render();
    },
    submit,
  };
}

function sizeLabel(bytes) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Long URLs in suggestion rows: drop the query string and shorten the middle.
function shortSub(sub) {
  const text = String(sub).replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "");
  return text.length > 56 ? `${text.slice(0, 34)}…${text.slice(-18)}` : text;
}
