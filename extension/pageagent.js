// Page agent: injected into a tab when the assistant reads or acts on it.
// Builds a numbered list of interactive elements, performs clicks/typing on
// them, and shows what it is doing (outline flash + pill, "✦ " title prefix
// while an external agent's session is active). Types into Google Docs through
// its hidden input frame. Answers messages from background.js: { enso: true, action, args }.
//
// Developer tools: console capture in the page's own JS world (through
// window.wrappedJSObject + exportFunction, so page CSP doesn't matter),
// page-world eval, storage keys, and session requests with content.fetch
// (a request made as the page, with its cookies). Credential-looking values
// (JWTs, bearer tokens, secret-named keys) are redacted before they leave.

(() => {
  if (window.__ensoAgent) return;
  window.__ensoAgent = true;

  const ACCENT = "#d9643a";
  let refs = new Map();

  const INTERACTIVE =
    'a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="option"], [role="switch"], [role="textbox"], [role="combobox"], [role="searchbox"], [tabindex]:not([tabindex="-1"])';

  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };

  const clean = s => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 100);

  function roleOf(el) {
    const r = el.getAttribute("role");
    if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") return ["checkbox", "radio", "submit", "button", "search", "email", "password", "file", "range", "date"].includes(el.type) ? el.type : "textbox";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "select";
    if (el.isContentEditable) return "textbox";
    return tag;
  }

  function nameOf(el) {
    const labelled = el.getAttribute("aria-labelledby");
    const byId = labelled && labelled.split(/\s+/).map(id => document.getElementById(id)?.innerText).join(" ");
    const label = el.labels?.[0]?.innerText;
    return clean(el.getAttribute("aria-label") || byId || label || el.innerText || el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("alt") || el.value || el.getAttribute("name") || "");
  }

  function describe(el) {
    return `${roleOf(el)} "${nameOf(el) || "(unnamed)"}"`;
  }

  function snapshot() {
    refs = new Map();
    const all = [...document.querySelectorAll(INTERACTIVE)].filter(visible);
    const inView = el => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight;
    };
    all.sort((a, b) => Number(inView(b)) - Number(inView(a)));
    const elements = [];
    for (const el of all.slice(0, 400)) {
      const ref = elements.length + 1;
      refs.set(ref, el);
      const role = roleOf(el);
      const item = { ref, role, name: nameOf(el) };
      if (["textbox", "search", "email", "select", "combobox", "searchbox", "date", "range"].includes(role)) item.value = role === "password" ? "••••" : clean(el.value ?? el.innerText);
      if (role === "checkbox" || role === "radio") item.value = el.checked ? "checked" : "unchecked";
      if (el.href) item.href = el.href.slice(0, 200);
      elements.push(item);
    }
    let text = document.body?.innerText ?? "";
    const transcript = youtubeTranscript();
    if (transcript) text = `${text}\n\n[Video transcript]\n${transcript}`;
    return { url: location.href, title: document.title, elements, text };
  }

  // YouTube: the captions the page already loaded, if any (so "chat with this video" works).
  function youtubeTranscript() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return "";
    const segs = [...document.querySelectorAll("ytd-transcript-segment-renderer .segment-text")].map(n => n.textContent.trim());
    return segs.join(" ").slice(0, 60_000);
  }

  // ---------- feedback on the page ----------
  // Ensō's own turns: a short-lived ribbon per action. External agents with a
  // live session (lib/agentsessions.mjs → background.js "presence"): a pill that
  // stays for the whole session, "<Client> · <task>", with a live dot while it
  // acts. Clicking the pill opens Ensō's sidebar (through pill.html, an
  // extension frame laid over it, because sidebarAction.open() needs a click in
  // an extension page). Every element acted on flashes a soft outline.

  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let agentName = "Claude"; // who is acting: Ensō's own Claude, or the MCP client (Codex, Cursor…) named in the request
  let presence = null; // { label, task, running, paused, stopped, titlePrefix } while an external session is active
  let pill = null; // { host, box, text, state, dot, frame, ready }
  let liveTimer = null;
  let fadeTimer = null;

  function buildPill() {
    if (pill) return pill;
    const host = document.createElement("div");
    host.setAttribute("data-enso-pill", "");
    Object.assign(host.style, { position: "fixed", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647, display: "block", margin: 0, padding: 0, border: 0, background: "none", maxWidth: "min(560px, calc(100vw - 24px))" });
    const root = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { position: "relative", display: "inline-block", maxWidth: "100%" });
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    Object.assign(box.style, {
      display: "flex", alignItems: "center", gap: "7px", maxWidth: "100%", boxSizing: "border-box",
      background: ACCENT, color: "white", font: "500 12px/1.3 -apple-system, system-ui, sans-serif",
      padding: "6px 12px 6px 10px", borderRadius: "999px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", cursor: "pointer",
      transition: reduceMotion() ? "none" : "opacity .2s, background-color .2s", whiteSpace: "nowrap", userSelect: "none",
    });
    const dot = document.createElement("span");
    Object.assign(dot.style, { width: "7px", height: "7px", borderRadius: "50%", background: "white", flex: "none", opacity: "0.55" });
    const text = document.createElement("span");
    Object.assign(text.style, { overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 });
    const state = document.createElement("span");
    Object.assign(state.style, { flex: "none", fontWeight: "600", opacity: "0.9" });
    box.append(dot, text, state);
    // Fallback when the extension frame can't load (a page that blocks it): ask background.js.
    box.addEventListener("click", () => browser.runtime.sendMessage({ ensoPillFallback: true }).catch(() => {}));
    const frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL("pill.html");
    frame.title = "Open Ensō";
    frame.setAttribute("tabindex", "0");
    Object.assign(frame.style, { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, margin: 0, padding: 0, background: "transparent", colorScheme: "normal", opacity: 0, pointerEvents: "none", borderRadius: "999px" });
    frame.setAttribute("allowtransparency", "true");
    wrap.append(box, frame);
    root.append(wrap);
    document.documentElement.appendChild(host);
    pill = { host, box, text, state, dot, frame, ready: false, pulse: null };
    return pill;
  }

  function renderPill() {
    const p = buildPill();
    if (!p.host.isConnected) document.documentElement.appendChild(p.host); // pages that rebuild <html> children
    const label = presence?.label || agentName;
    const task = presence?.task ? ` · ${presence.task}` : "";
    p.text.textContent = presence ? `✦ ${label}${task}` : `✦ ${agentName} is working on this page`;
    if (presence && !presence.task) p.text.textContent = `✦ ${label} is working on this page`;
    p.state.textContent = presence?.stopped ? "· Stopped" : presence?.paused ? "· Paused" : "";
    p.box.style.background = presence?.stopped ? "#6b625a" : presence?.paused ? "#8a5a3f" : ACCENT;
    p.box.setAttribute("aria-label", `${p.text.textContent.replace(/^✦ /, "")}${p.state.textContent}. Click to open Ensō.`);
    p.host.title = "Open Ensō to see what it is doing, pause or stop it";
    p.box.style.opacity = "1";
    const live = !!(presence?.running || liveTimer) && !presence?.paused && !presence?.stopped;
    p.dot.style.opacity = live ? "1" : "0.55";
    if (live && !p.pulse && !reduceMotion()) p.pulse = p.dot.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0.35, transform: "scale(0.8)" }, { opacity: 1, transform: "scale(1)" }], { duration: 1200, iterations: Infinity });
    if (!live && p.pulse) {
      p.pulse.cancel();
      p.pulse = null;
    }
  }

  /** Ensō's own turns, and any action: show the pill; without a session it fades after a few seconds. */
  function showRibbon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (presence) renderPill();
    }, 1500);
    renderPill();
    clearTimeout(fadeTimer);
    if (!presence) fadeTimer = setTimeout(() => pill && !presence && (pill.box.style.opacity = "0"), 4000);
  }

  function setPresence(next) {
    presence = next && typeof next === "object" && !next.off ? { label: String(next.label ?? "").slice(0, 40), task: String(next.task ?? "").slice(0, 200), running: !!next.running, paused: !!next.paused, stopped: !!next.stopped, titlePrefix: next.titlePrefix !== false } : null;
    clearTimeout(fadeTimer);
    if (presence) {
      renderPill();
      titlePrefix(presence.titlePrefix);
    } else {
      titlePrefix(false);
      if (pill) {
        pill.box.style.opacity = "0";
        const p = pill;
        pill = null;
        setTimeout(() => p.host.remove(), reduceMotion() ? 0 : 250);
      }
    }
    return { shown: !!presence, title: document.title };
  }

  // "✦ " in front of the page title while an agent is active, so Zen's tab list shows it.
  // Pages that rewrite their title (Google Docs, Gmail) are followed with a
  // MutationObserver; on end the page's latest own title is put back exactly.
  const TITLE_PREFIX = "✦ ";
  let titleOn = false;
  let pageTitle = null; // the page's own title, without our prefix
  let titleObserver = null;
  function applyTitle() {
    const current = document.title;
    if (current === TITLE_PREFIX + pageTitle) return;
    pageTitle = current;
    document.title = TITLE_PREFIX + current;
  }
  function titlePrefix(on) {
    if (on && !titleOn) {
      titleOn = true;
      pageTitle = document.title;
      document.title = TITLE_PREFIX + pageTitle;
      titleObserver = new MutationObserver(() => titleOn && applyTitle());
      titleObserver.observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
    } else if (!on && titleOn) {
      titleOn = false;
      titleObserver?.disconnect();
      titleObserver = null;
      if (document.title === TITLE_PREFIX + pageTitle) document.title = pageTitle;
      pageTitle = null;
    }
  }

  /** A soft outline flash on the element acted on, with who is acting. */
  function highlight(el, verb = "") {
    const r = el.getBoundingClientRect();
    const still = reduceMotion();
    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    Object.assign(box.style, {
      position: "fixed", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
      border: `2px solid ${ACCENT}`, borderRadius: "8px", boxShadow: `0 0 0 4px ${ACCENT}33`, zIndex: 2147483646,
      pointerEvents: "none", boxSizing: "border-box", margin: 0,
    });
    const tag = document.createElement("div");
    tag.textContent = verb ? `${presence?.label || agentName} · ${verb}` : presence?.label || agentName;
    Object.assign(tag.style, { position: "absolute", left: "-2px", top: r.top > 26 ? "-22px" : "calc(100% + 4px)", background: ACCENT, color: "white", font: "600 10.5px/1 -apple-system, system-ui, sans-serif", padding: "4px 7px", borderRadius: "6px", whiteSpace: "nowrap" });
    box.append(tag);
    document.documentElement.appendChild(box);
    if (!still) box.animate([{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(.22,1,.36,1)" });
    setTimeout(() => {
      if (still) return box.remove();
      box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }).onfinish = () => box.remove();
    }, 1200);
  }

  // ---------- actions ----------

  function target(ref, verb) {
    const el = refs.get(Number(ref));
    if (!el || !el.isConnected) throw new Error(`Element [${ref}] is gone; call page_read again.`);
    el.scrollIntoView({ block: "center", inline: "nearest" });
    showRibbon();
    highlight(el, verb);
    return el;
  }

  const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", ""]);
  const isEditable = el => !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && TEXT_INPUT_TYPES.has(String(el.type ?? "").toLowerCase())));

  // ---------- Google Docs ----------
  // Docs draws the document on a canvas and listens for typing in a hidden,
  // same-origin iframe (.docs-texteventtarget-iframe) holding a contenteditable.
  // Text goes in with execCommand("insertText") there, at Docs' own cursor; a
  // new line is an Enter keydown. Sheets and Slides keep the normal path.
  const docsApp = () => (location.hostname === "docs.google.com" ? /^\/(document|spreadsheets|presentation)\//.exec(location.pathname)?.[1] ?? null : null);
  function docsInput() {
    const frame = document.querySelector("iframe.docs-texteventtarget-iframe");
    let doc = null;
    try {
      doc = frame?.contentDocument ?? null;
    } catch {}
    const editable = doc?.querySelector('[contenteditable="true"], [contenteditable=""]') ?? (doc?.body?.isContentEditable ? doc.body : null);
    return frame && doc && editable ? { frame, doc, editable } : null;
  }
  function docsEnter(el, win) {
    const KE = win.KeyboardEvent;
    const init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KE("keydown", init));
    el.dispatchEvent(new KE("keypress", { ...init, charCode: 13 }));
    el.dispatchEvent(new KE("keyup", init));
  }
  function docsType(text, submit, near) {
    const d = docsInput();
    if (!d) throw new Error("Couldn't find Google Docs' text input. Click into the document first (page_click on the page), then type again.");
    const { frame, doc, editable } = d;
    const shown = near ?? document.querySelector(".kix-appview-editor, .docs-editor-container, #docs-editor") ?? frame;
    showRibbon();
    if (shown?.getBoundingClientRect) highlight(shown, "typing");
    editable.focus();
    const win = doc.defaultView;
    const lines = String(text ?? "").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (i > 0) docsEnter(editable, win);
      if (line) doc.execCommand("insertText", false, line);
    });
    if (submit) docsEnter(editable, win);
    return { description: "Google Docs document body (at the cursor)", url: location.href, title: document.title };
  }

  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function key(el, k) {
    const init = { key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keypress", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  // ---- screenshot region select ("Send screenshot", ⌘⇧2): the user drags a box ----
  // Resolves { mode: "region", rect } (page coordinates, CSS px), { mode: "visible" }
  // (Enter or a click without dragging), { mode: "full" } (F) or { cancelled: true } (Esc).
  // The overlay is removed and two frames painted before it resolves, so it never shows in the capture.
  let selecting = null;
  function regionSelect() {
    if (selecting) return selecting;
    selecting = new Promise(resolve => {
      const host = document.createElement("div");
      host.setAttribute("data-enso-region", "");
      host.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      const root = host.attachShadow({ mode: "closed" });
      const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text) n.textContent = text;
        return n;
      };
      const style = el("style");
      style.textContent = `
        .layer{position:fixed;inset:0;cursor:crosshair;background:rgba(20,16,12,.32);outline:none}
        .layer.dragging{background:transparent}
        .box{position:fixed;display:none;border:1.5px solid ${ACCENT};border-radius:2px;box-shadow:0 0 0 100vmax rgba(20,16,12,.32);pointer-events:none}
        .size{position:absolute;right:-1px;bottom:-24px;font:600 11px/1 -apple-system,system-ui,sans-serif;color:#fff;background:${ACCENT};padding:4px 6px;border-radius:4px;white-space:nowrap}
        .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;gap:14px;align-items:center;font:500 12.5px/1.2 -apple-system,system-ui,sans-serif;color:#fff;background:rgba(28,24,20,.92);padding:9px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none;white-space:nowrap}
        .hint b{font-weight:650;color:#ffd9c7}
        kbd{font:600 11px/1 ui-monospace,SFMono-Regular,monospace;background:rgba(255,255,255,.14);border-radius:4px;padding:3px 5px;margin-right:4px}
        .layer.dragging ~ .hint{opacity:0}
      `;
      const layerEl = el("div", "layer");
      layerEl.tabIndex = -1;
      const boxEl = el("div", "box");
      boxEl.append(el("span", "size"));
      const hint = el("div", "hint");
      hint.append(el("b", "", "✦ Screenshot"), el("span", "", "Drag to select"));
      for (const [k, t] of [["↵", "Visible area"], ["F", "Full page"], ["Esc", "Cancel"]]) {
        const item = el("span");
        item.append(el("kbd", "", k), document.createTextNode(t));
        hint.append(item);
      }
      root.append(style, layerEl, boxEl, hint);
      const layer = root.querySelector(".layer");
      const box = root.querySelector(".box");
      const size = root.querySelector(".size");
      let start = null;
      let rect = null;
      const finish = result => {
        window.removeEventListener("keydown", onKey, true);
        host.remove();
        selecting = null;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
      };
      const onKey = e => {
        if (e.key === "Escape") finish({ cancelled: true });
        else if (e.key === "Enter") finish({ mode: "visible" });
        else if (e.key === "f" || e.key === "F") finish({ mode: "full" });
        else return;
        e.preventDefault();
        e.stopPropagation();
      };
      layer.addEventListener("mousedown", e => {
        if (e.button !== 0) return;
        start = { x: e.clientX, y: e.clientY };
        layer.classList.add("dragging");
        e.preventDefault();
      });
      layer.addEventListener("mousemove", e => {
        if (!start) return;
        const x = Math.min(start.x, e.clientX), y = Math.min(start.y, e.clientY);
        const w = Math.abs(e.clientX - start.x), h = Math.abs(e.clientY - start.y);
        rect = { x, y, width: w, height: h };
        Object.assign(box.style, { display: "block", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
        size.textContent = `${Math.round(w)} × ${Math.round(h)}`;
      });
      layer.addEventListener("mouseup", () => {
        if (!start) return;
        start = null;
        if (!rect || rect.width < 8 || rect.height < 8) return finish({ mode: "visible" });
        finish({ mode: "region", rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height } });
      });
      window.addEventListener("keydown", onKey, true);
      (document.body ?? document.documentElement).append(host);
      layer.focus();
    });
    return selecting;
  }

  const actions = {
    snapshot,
    click({ ref }) {
      const el = target(ref, "clicking");
      const description = describe(el);
      el.focus?.();
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      el.click();
      return { description, url: location.href, title: document.title };
    },
    type({ ref, text, submit }) {
      let el = ref != null ? target(ref, "typing") : null;
      // Google Docs: the page/canvas (or no ref at all) means "the document body, at the cursor".
      if (docsApp() === "document" && !isEditable(el)) return docsType(text, submit, el);
      if (!el) {
        el = document.activeElement;
        while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
        if (!isEditable(el)) throw new Error("No ref given and no text field has the cursor. Call page_read and pass the ref of the field to type into.");
        showRibbon();
        highlight(el, "typing");
      }
      const description = describe(el);
      el.focus();
      // insertText goes through the browser's own editing path, so the page
      // gets real (trusted) beforeinput/input events; sites that ignore
      // synthetic events (GitHub's confirm boxes, many React forms) see it as
      // typing. Fall back to setting the value directly if it didn't take.
      if (el.isContentEditable) {
        // Select the editor's own contents: "selectAll" can select outside the
        // editor (Outlook's body), and insertText then does nothing.
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        if (!document.execCommand("insertText", false, text) || !el.innerText.includes(text.slice(0, 40))) {
          // Last resort: a paste, which rich editors (Outlook, Gmail, Docs) handle themselves.
          const data = new DataTransfer();
          data.setData("text/plain", text);
          el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
        }
      } else {
        try {
          el.select?.();
          if (!text) document.execCommand("delete", false);
          else document.execCommand("insertText", false, text);
        } catch {}
        if (el.value !== text) setValue(el, text);
        else el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (submit) {
        key(el, "Enter");
        const form = el.form;
        if (form) form.requestSubmit ? form.requestSubmit() : form.submit();
      }
      return { description, url: location.href, title: document.title };
    },
    select({ ref, value }) {
      const el = target(ref, "choosing");
      const description = describe(el);
      const want = String(value).toLowerCase();
      const opt = [...(el.options ?? [])].find(o => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ?? [...(el.options ?? [])].find(o => o.text.toLowerCase().includes(want));
      if (!opt) throw new Error(`No option "${value}" in ${description}.`);
      el.value = opt.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { description, url: location.href, title: document.title };
    },
    press({ key: k }) {
      showRibbon();
      const el = document.activeElement ?? document.body;
      key(el, k);
      if (k === "Enter" && el.form) el.form.requestSubmit?.();
      return { description: `key ${k}`, url: location.href, title: document.title };
    },
    scroll({ direction, ref }) {
      if (ref) target(ref);
      else window.scrollBy({ top: (direction === "up" ? -1 : 1) * innerHeight * 0.8, behavior: "smooth" });
      return { url: location.href, title: document.title };
    },
    presence: setPresence,
    region_select: regionSelect,
    page_size() {
      const d = document.documentElement;
      const b = document.body;
      return { width: Math.max(d.scrollWidth, b?.scrollWidth ?? 0, innerWidth), height: Math.max(d.scrollHeight, b?.scrollHeight ?? 0, innerHeight), viewport: { width: innerWidth, height: innerHeight }, dpr: devicePixelRatio };
    },
    pill_ready() {
      if (pill) {
        pill.ready = true;
        pill.frame.style.pointerEvents = "auto"; // clicks now land in pill.html, which can open the sidebar
      }
      return {};
    },
    pill_hint({ text }) {
      if (!pill) return {};
      const before = pill.state.textContent;
      pill.state.textContent = `· ${String(text ?? "").slice(0, 60)}`;
      setTimeout(() => pill && (pill.state.textContent = before), 3500);
      return {};
    },
    text() {
      return { url: location.href, title: document.title, text: document.body?.innerText ?? "" };
    },
    console_start: startConsole,
    console_flush() {
      clearTimeout(consoleTimer);
      consoleTimer = null;
      const entries = consoleBuf;
      consoleBuf = [];
      return { entries, capturing: consoleOn };
    },
    eval: evaluate,
    storage,
    fetch: sessionFetch,
  };

  // ---------- developer tools ----------

  const pw = window.wrappedJSObject;
  const SECRET_NAME = /(cookie|authorization|auth|token|secret|passw|pwd|session|sess|jwt|bearer|credential|api[-_]?key|apikey|private|signature|csrf|xsrf|otp)/i;
  const looksSecret = v => /^eyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*$/.test(v) || /^(Bearer|Basic|token)\s+\S{8,}/i.test(v) || /^(gh[pousr]_|github_pat_|sk-|xox[abpr]-|AKIA)[A-Za-z0-9_-]{8,}/.test(v);
  const REDACTED = "[redacted: looks like a credential]";

  /** Page value (possibly an Xray/waived wrapper) → plain JSON-safe content object. */
  function toSafe(v, depth = 0, seen = new Set(), key = "") {
    if (typeof v === "string") return (key && SECRET_NAME.test(key) && v.length > 6) || looksSecret(v.trim()) ? REDACTED : v.length > 5000 ? `${v.slice(0, 5000)}…[${v.length} chars]` : v;
    if (v === null || typeof v === "boolean") return v;
    if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
    if (v === undefined) return "[undefined]";
    if (typeof v === "bigint") return `${v}n`;
    if (typeof v === "symbol") return String(v);
    let w = v;
    try { w = v.wrappedJSObject ?? v; } catch {}
    if (typeof w === "function") { let n = ""; try { n = w.name; } catch {} return `[Function ${n || "anonymous"}]`; }
    try { if (typeof w.stack === "string" && "message" in w) return { error: String(w.name ?? "Error"), message: String(w.message), stack: w.stack.slice(0, 2000) }; } catch {}
    try { if (w.nodeType === 1) return String(w.outerHTML).slice(0, 500); if (w.nodeType) return `[${w.nodeName}]`; } catch {}
    if (seen.has(w)) return "[Circular]";
    let tag = "";
    try { tag = Object.prototype.toString.call(w); } catch {}
    if (depth > 5) return `[${tag.slice(8, -1) || "Object"}]`;
    seen.add(w);
    try {
      if (tag === "[object Date]") return new Date(w.getTime()).toISOString();
      if (Array.isArray(w) || tag === "[object NodeList]" || tag === "[object HTMLCollection]") {
        const out = [];
        for (let i = 0; i < Math.min(w.length, 200); i++) out.push(toSafe(w[i], depth + 1, seen));
        if (w.length > 200) out.push(`…${w.length - 200} more`);
        return out;
      }
      if (tag === "[object Map]") return { "[Map]": Array.from(w).slice(0, 100).map(([k, x]) => [toSafe(k, depth + 1, seen), toSafe(x, depth + 1, seen, String(k))]) };
      if (tag === "[object Set]") return { "[Set]": Array.from(w).slice(0, 100).map(x => toSafe(x, depth + 1, seen)) };
      if (tag === "[object Promise]") return "[Promise]";
      const out = {};
      const keys = Object.keys(w);
      for (const k of keys.slice(0, 200)) {
        try { out[k] = toSafe(w[k], depth + 1, seen, k); } catch { out[k] = "[unreadable]"; }
      }
      if (keys.length > 200) out["…"] = `${keys.length - 200} more keys`;
      return out;
    } catch (err) {
      return `[unserialisable: ${err.message}]`;
    }
  }
  const typeOf = v => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v !== "object") return typeof v;
    try { return Object.prototype.toString.call(v.wrappedJSObject ?? v).slice(8, -1); } catch { return "object"; }
  };

  // Console capture: buffered here, pushed to background.js in small batches.
  let consoleOn = false;
  let consoleBuf = [];
  let consoleTimer = null;
  function pushConsole(entry) {
    consoleBuf.push(entry);
    if (consoleBuf.length > 300) consoleBuf.shift();
    if (!consoleTimer) consoleTimer = setTimeout(flushConsole, 400);
  }
  function flushConsole() {
    consoleTimer = null;
    if (!consoleBuf.length) return;
    const entries = consoleBuf;
    consoleBuf = [];
    browser.runtime.sendMessage({ ensoConsole: true, entries }).catch(() => {});
  }
  const fmtArg = a => {
    if (typeof a === "string") return a;
    const safe = toSafe(a, 3);
    if (safe && typeof safe === "object" && safe.error && "message" in safe && "stack" in safe) return `${safe.error}: ${safe.message}`;
    return typeof safe === "string" ? safe : JSON.stringify(safe);
  };
  const sourceOf = stack => {
    const line = String(stack ?? "").split("\n").find(l => l && !l.includes("moz-extension://") && /:\d+:\d+$/.test(l));
    return line ? line.replace(/^[^@]*@/, "") : "";
  };

  function startConsole() {
    if (consoleOn) return { started: false };
    consoleOn = true;
    const pc = pw.console;
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = pc[level];
      if (typeof orig !== "function") continue;
      exportFunction(function (...args) {
        try {
          pushConsole({ t: Date.now(), level, text: args.map(fmtArg).join(" ").slice(0, 4000), source: sourceOf(new Error().stack) });
        } catch {}
        return Reflect.apply(orig, pc, args);
      }, pc, { defineAs: level });
    }
    window.addEventListener("error", e => {
      const t = e.target;
      if (t && t !== window && t.nodeType) {
        pushConsole({ t: Date.now(), level: "error", text: `Failed to load ${String(t.nodeName).toLowerCase()} ${t.src || t.href || ""}`, source: "" });
        return;
      }
      let stack = "";
      try { const err = e.error?.wrappedJSObject ?? e.error; stack = typeof err?.stack === "string" ? err.stack.slice(0, 2000) : ""; } catch {}
      pushConsole({ t: Date.now(), level: "error", text: `Uncaught ${e.message ?? ""}`, source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : "", stack });
    }, true);
    window.addEventListener("unhandledrejection", e => {
      let stack = "";
      try { const r = e.reason?.wrappedJSObject ?? e.reason; stack = typeof r?.stack === "string" ? r.stack.slice(0, 2000) : ""; } catch {}
      pushConsole({ t: Date.now(), level: "error", text: `Unhandled promise rejection: ${fmtArg(e.reason)}`.slice(0, 4000), source: "", stack });
    });
    return { started: true };
  }

  const MAX_JSON = 20_000;
  async function evaluate({ expression }) {
    showRibbon();
    const base = { url: location.href, title: document.title, description: `JavaScript: ${expression.replace(/\s+/g, " ").slice(0, 100)}` };
    let value;
    let world = "page";
    try {
      value = pw.eval(expression);
    } catch (err) {
      const e = err?.wrappedJSObject ?? err;
      const msg = String(e?.message ?? e);
      if (!/CSP|Content Security Policy|blocked/i.test(msg)) return { ...base, ok: false, error: `${e?.name ?? "Error"}: ${msg}`, stack: String(e?.stack ?? "").slice(0, 2000) };
      world = "isolated";
      try {
        const page = pw; // eslint-disable-line no-unused-vars -- visible to the evaluated code
        value = eval(expression); // eslint-disable-line no-eval
      } catch (err2) {
        return { ...base, ok: false, world, error: `${err2?.name ?? "Error"}: ${err2?.message ?? err2}`, stack: String(err2?.stack ?? "").slice(0, 2000) };
      }
    }
    try {
      const w = value?.wrappedJSObject ?? value;
      if (w && typeof w.then === "function") {
        value = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("The promise did not settle within 10 s.")), 10_000);
          const ok = exportFunction(x => (clearTimeout(timer), resolve(x)), pw);
          const fail = exportFunction(x => (clearTimeout(timer), reject(x)), pw);
          w.then(ok, fail);
        });
      }
    } catch (err) {
      const e = err?.wrappedJSObject ?? err;
      return { ...base, ok: false, world, error: `Rejected: ${e?.name ? `${e.name}: ${e.message}` : fmtArg(err)}`, stack: String(e?.stack ?? "").slice(0, 2000) };
    }
    let json = JSON.stringify(toSafe(value), null, 2) ?? "undefined";
    if (json.length > MAX_JSON) json = `${json.slice(0, MAX_JSON)}\n[result cut at ${MAX_JSON} characters]`;
    return { ...base, ok: true, world, type: typeOf(value), json };
  }

  function storage({ includeValues }) {
    const read = which => {
      try {
        const st = which === "local" ? window.localStorage : window.sessionStorage;
        const items = [];
        for (let i = 0; i < st.length && i < 500; i++) {
          const k = st.key(i);
          const v = st.getItem(k) ?? "";
          const item = { key: k, length: v.length };
          if (includeValues) item.value = SECRET_NAME.test(k) || looksSecret(v.trim()) ? REDACTED : v.length > 1000 ? `${v.slice(0, 1000)}…` : v;
          items.push(item);
        }
        return { items };
      } catch (err) {
        return { error: `(not accessible: ${err.message})` };
      }
    };
    const local = read("local");
    const session = read("session");
    return { url: location.href, title: document.title, description: includeValues ? "storage values" : "storage keys", local: local.items, localError: local.error, session: session.items, sessionError: session.error };
  }

  const TEXTUAL = /^(text\/|application\/(json|xml|javascript|ld\+json|x-www-form-urlencoded|graphql)|[^;]*\+(json|xml))/i;
  async function sessionFetch({ url, method, headers, body, maxChars }) {
    showRibbon();
    const init = { method, headers: headers ?? {}, credentials: "include", redirect: "follow", cache: "no-store" };
    if (body != null && !["GET", "HEAD"].includes(method)) init.body = body;
    const f = typeof content !== "undefined" && content.fetch ? (u, i) => content.fetch(u, cloneInto(i, window)) : (u, i) => fetch(u, i);
    const res = await f(url, init);
    const hdrs = [];
    try {
      res.headers.forEach((value, name) => hdrs.push({ name, value: SECRET_NAME.test(name) || looksSecret(String(value)) ? "[redacted]" : String(value).slice(0, 300) }));
    } catch {}
    const type = res.headers.get("content-type") ?? "";
    let text = "";
    let length = 0;
    if (method === "HEAD") {
      text = "";
    } else if (!type || TEXTUAL.test(type)) {
      text = await res.text();
      length = text.length;
    } else {
      const buf = await res.arrayBuffer();
      length = buf.byteLength;
      text = `[binary body: ${type}, ${length} bytes]`;
    }
    const cap = maxChars ?? 100_000;
    return { status: res.status, statusText: res.statusText, url: res.url, redirected: res.redirected, headers: hdrs, contentType: type, body: text.length > cap ? text.slice(0, cap) : text, bodyLength: length, truncated: text.length > cap, tabOrigin: location.origin, tabTitle: document.title };
  }

  const PASSIVE = new Set(["presence", "pill_ready", "pill_hint", "text", "console_flush", "region_select", "page_size"]); // not an action by anyone
  browser.runtime.onMessage.addListener(msg => {
    if (!msg?.enso) return undefined;
    return (async () => {
      try {
        const fn = actions[msg.action];
        if (!fn) throw new Error(`Unknown page action ${msg.action}`);
        if (!PASSIVE.has(msg.action)) agentName = typeof msg.agent === "string" && msg.agent.trim() ? msg.agent.trim().slice(0, 40) : "Claude";
        return { ok: true, result: await fn(msg.args ?? {}) };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    })();
  });
})();
