// Page agent: injected into a tab when the assistant reads or acts on it.
// Builds a numbered list of interactive elements, performs clicks/typing on
// them, and shows what it is doing (outline flash + one pill per tab, "✦ "
// title prefix once while any external agent's session is active). Types into Google Docs through
// its hidden input frame. Answers messages from background.js: { enso: true, action, args }.
//
// Developer tools: console capture in the page's own JS world (through
// window.wrappedJSObject + exportFunction, so page CSP doesn't matter),
// storage keys, session requests with content.fetch (a request made as the
// page, with its cookies), and in self-distributed and dev builds only,
// page_eval in the page's world. Credential-looking values (JWTs, bearer
// tokens, secret-named keys) are redacted before they leave.
//
// Code between the "unlisted-only" marker comments exists only for page_eval.
// scripts/build-extension.mjs removes it from the build listed on
// addons.mozilla.org, which doesn't evaluate JavaScript at all.

(() => {
  if (window.__ensoAgent) return; // already running in this sandbox (copies from before an update: "one copy per page" below)
  window.__ensoAgent = true;
  const INSTANCE = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

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
  // live session (lib/agentsessions.mjs → background.js "presence"): one pill
  // per tab for the whole time any session is active, however many agents work
  // on the page. One agent: "<Client> · <task>". Several: "2 agents · <Client>:
  // <task> (+1)", the most important state first (working > paused > idle >
  // stopped); hovering, focusing or clicking it expands a list of each agent
  // with its task and state. Clicking opens Ensō's sidebar on that agent's card
  // (through pill.html, an extension frame laid over the pill, because
  // sidebarAction.open() needs a click in an extension page). Every element
  // acted on flashes a soft outline in the acting agent's shade, with its name.

  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  let agentName = "Claude"; // who is acting: Ensō's own Claude, or the MCP client (Codex, Cursor…) named in the request
  let actorId = null; // the session acting, when background.js could tell (several agents on one tab)
  let sessions = []; // [{ id, label, task, running, paused, stopped }] while external sessions are active on this tab
  let titlePrefixWanted = false;
  let pill = null; // { host, wrap, box, text, state, dot, list, frame, ready }
  let liveTimer = null;
  let fadeTimer = null;
  let expanded = false;
  let pinTimer = null;
  let collapseTimer = null;

  // A shade per agent, kept for as long as it has a session here, so its
  // flashes, its row in the list and its tab in the sidebar (views/agents.js
  // SHADES, same rule: the first free one, oldest first) match. The first is Ensō's copper.
  const SHADES = [ACCENT, "#2f7f86", "#8a4f9e", "#b0802a", "#4a6db0", "#a8455a"];
  const shadeOf = new Map(); // session id -> shade
  function assignShades() {
    const live = new Set(sessions.map(s => s.id));
    for (const id of [...shadeOf.keys()]) if (!live.has(id)) shadeOf.delete(id);
    const oldestFirst = sessions.map((s, i) => [s, i]).sort((a, b) => a[0].startedAt.localeCompare(b[0].startedAt) || b[1] - a[1]).map(x => x[0]);
    for (const s of oldestFirst) {
      if (shadeOf.has(s.id)) continue;
      const used = new Set(shadeOf.values());
      shadeOf.set(s.id, SHADES.find(c => !used.has(c)) ?? SHADES[shadeOf.size % SHADES.length]);
    }
  }

  const stateOf = s => (s.stopped ? "stopped" : s.paused ? "paused" : s.running ? "working" : "idle");
  const RANK = { working: 0, paused: 1, idle: 2, stopped: 3 };
  const STATE_LABEL = { working: "Working", paused: "Paused", idle: "Idle", stopped: "Stopped" };
  /** Sessions, most important state first; among equals, the order background.js sent (newest first). */
  const ranked = () => sessions.map((s, i) => [s, i]).sort((a, b) => RANK[stateOf(a[0])] - RANK[stateOf(b[0])] || a[1] - b[1]).map(x => x[0]);

  /** The pill's text, state and colour for the current sessions (exported to the tests through the DOM). */
  function pillSummary() {
    if (!sessions.length) return { text: `✦ ${agentName} is working on this page`, state: "", tone: "working" };
    const order = ranked();
    const top = order[0];
    const tone = stateOf(top);
    if (sessions.length === 1) {
      return { text: top.task ? `✦ ${top.label} · ${top.task}` : `✦ ${top.label} is working on this page`, state: tone === "stopped" ? "· Stopped" : tone === "paused" ? "· Paused" : "", tone };
    }
    const more = sessions.length - 1;
    const text = `✦ ${sessions.length} agents · ${top.label}${top.task ? `: ${top.task}` : ""} (+${more})`;
    const paused = sessions.filter(s => stateOf(s) === "paused").length;
    const waiting = sessions.filter(s => s.control === "waiting" && stateOf(s) !== "stopped").length;
    const state = tone === "stopped" ? "· Stopped" : tone === "paused" ? "· Paused" : paused ? `· ${paused} paused` : waiting ? `· ${waiting} waiting` : "";
    return { text, state, tone };
  }

  let fading = null; // the pill on its way out, removed at once if a new one is needed
  function buildPill() {
    if (pill) return pill;
    fading?.remove();
    fading = null;
    const host = document.createElement("div");
    host.setAttribute("data-enso-pill", INSTANCE);
    host.id = `enso-pill-${INSTANCE}`;
    Object.assign(host.style, { position: "fixed", top: "10px", left: "50%", transform: "translateX(-50%)", zIndex: 2147483647, display: "block", margin: 0, padding: 0, border: 0, background: "none", maxWidth: "min(560px, calc(100vw - 24px))" });
    const root = host.attachShadow({ mode: "closed" });
    const wrap = document.createElement("div");
    Object.assign(wrap.style, { position: "relative", display: "flex", flexDirection: "column", alignItems: "center", maxWidth: "100%" });
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
    // Each agent with its task and state, under the pill while it is expanded.
    const list = document.createElement("div");
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", "Agents on this page");
    Object.assign(list.style, {
      display: "none", marginTop: "6px", padding: "4px", boxSizing: "border-box", width: "min(420px, calc(100vw - 24px))", maxWidth: "100%",
      background: "#2b231e", color: "#f6efe9", font: "500 12px/1.35 -apple-system, system-ui, sans-serif",
      borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,.24)", cursor: "pointer", userSelect: "none",
    });
    // Fallback when the extension frame can't load (a page that blocks it): ask background.js.
    const fallback = e => {
      setExpanded(true, 5000);
      browser.runtime.sendMessage({ ensoPillFallback: true, sessionId: pickAt(e.clientY - wrap.getBoundingClientRect().top) }).catch(() => {});
    };
    box.addEventListener("click", fallback);
    list.addEventListener("click", fallback);
    const frame = document.createElement("iframe");
    frame.src = browser.runtime.getURL("pill.html");
    frame.title = "Open Ensō";
    frame.setAttribute("tabindex", "0");
    Object.assign(frame.style, { position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, margin: 0, padding: 0, background: "transparent", colorScheme: "normal", opacity: 0, pointerEvents: "none", borderRadius: "999px" });
    frame.setAttribute("allowtransparency", "true");
    // Hover and keyboard focus expand the list (the frame takes the pointer, so its own element's events count).
    wrap.addEventListener("mouseenter", () => setExpanded(true));
    wrap.addEventListener("mouseleave", () => setExpanded(false));
    frame.addEventListener("focus", () => setExpanded(true));
    frame.addEventListener("blur", () => setExpanded(false));
    wrap.append(box, list, frame);
    root.append(wrap);
    document.documentElement.appendChild(host);
    pill = { host, wrap, box, text, state, dot, list, frame, ready: false, pulse: null, rows: [] };
    return pill;
  }

  /** Expand (or collapse) the list; `pinMs` keeps it open for a while after a click. */
  function setExpanded(on, pinMs = 0) {
    clearTimeout(collapseTimer);
    if (pinMs) {
      clearTimeout(pinTimer);
      pinTimer = setTimeout(() => {
        pinTimer = null;
        setExpanded(false);
      }, pinMs);
    }
    if (!on && pinTimer) return;
    if (!on) {
      collapseTimer = setTimeout(() => {
        expanded = false;
        if (pill) renderPill();
      }, 180); // moving from the pill to the list doesn't flicker it shut
      return;
    }
    expanded = true;
    if (pill) renderPill();
  }

  /** The session whose row is at `y` (pixels from the top of the pill), else the pill's top agent. */
  function pickAt(y) {
    const p = pill;
    if (p && expanded && sessions.length > 1) {
      const top = p.wrap.getBoundingClientRect().top;
      for (const row of p.rows) {
        const r = row.el.getBoundingClientRect();
        if (y >= r.top - top && y <= r.bottom - top) return row.id;
      }
    }
    return ranked()[0]?.id ?? null;
  }

  function renderList(p) {
    const show = expanded && sessions.length > 1;
    p.list.style.display = show ? "block" : "none";
    p.frame.style.borderRadius = show ? "14px" : "999px";
    p.host.toggleAttribute("data-expanded", show);
    if (!show) {
      p.list.replaceChildren();
      p.rows = [];
      return;
    }
    const order = ranked();
    p.list.replaceChildren();
    p.rows = order.map(s => {
      const st = stateOf(s);
      const row = document.createElement("div");
      row.setAttribute("role", "listitem");
      row.setAttribute("data-session", s.id);
      row.setAttribute("data-state", st);
      Object.assign(row.style, { display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px", borderRadius: "8px", minWidth: 0 });
      const dot = document.createElement("span");
      Object.assign(dot.style, { width: "8px", height: "8px", borderRadius: "50%", flex: "none", background: shadeOf.get(s.id) ?? ACCENT, boxShadow: st === "working" ? `0 0 0 3px ${shadeOf.get(s.id) ?? ACCENT}55` : "none", opacity: st === "stopped" ? "0.5" : "1" });
      const who = document.createElement("span");
      Object.assign(who.style, { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
      const name = document.createElement("strong");
      name.textContent = s.label;
      Object.assign(name.style, { fontWeight: "650" });
      const task = document.createElement("span");
      task.textContent = s.task ? ` · ${s.task}` : " · no task given";
      Object.assign(task.style, { opacity: s.task ? "0.85" : "0.55" });
      who.append(name, task);
      const chip = document.createElement("span");
      // Who may act here (lib/agentsessions.mjs tab leases): in control, shared, or waiting for the tab.
      chip.textContent = s.control === "waiting" && st !== "stopped" ? "Waiting for the tab" : `${STATE_LABEL[st]}${s.control === "holder" ? " · in control" : s.control === "shared" ? " · shared" : ""}`;
      if (s.control) row.setAttribute("data-control", s.control);
      Object.assign(chip.style, { flex: "none", fontSize: "11px", fontWeight: "600", padding: "2px 7px", borderRadius: "999px", background: st === "working" ? "rgba(217,100,58,.28)" : st === "paused" ? "rgba(138,90,63,.45)" : "rgba(255,255,255,.12)", color: st === "working" ? "#ffd9c7" : "#f0e6de" });
      row.append(dot, who, chip);
      p.list.append(row);
      return { id: s.id, el: row };
    });
    const hint = document.createElement("div");
    hint.textContent = "Click an agent to open it in Ensō";
    Object.assign(hint.style, { padding: "4px 8px 3px", fontSize: "10.5px", opacity: "0.55" });
    p.list.append(hint);
  }

  function renderPill() {
    const p = buildPill();
    if (!p.host.isConnected) document.documentElement.appendChild(p.host); // pages that rebuild <html> children
    const sum = pillSummary();
    p.text.textContent = sum.text;
    p.state.textContent = sum.state;
    p.box.style.background = sum.tone === "stopped" ? "#6b625a" : sum.tone === "paused" ? "#8a5a3f" : ACCENT;
    p.host.setAttribute("data-count", String(sessions.length));
    const n = sessions.length;
    p.box.setAttribute("aria-label", `${sum.text.replace(/^✦ /, "")}${sum.state}. ${n > 1 ? "Hover to see each agent; click" : "Click"} to open Ensō.`);
    p.host.title = n > 1 ? "Agents working on this page: click to open Ensō, see each one, pause or stop it" : "Open Ensō to see what it is doing, pause or stop it";
    p.box.style.opacity = "1";
    p.list.style.opacity = "1";
    const live = sessions.length ? sum.tone === "working" || (!!liveTimer && sum.tone === "idle") : !!liveTimer;
    p.dot.style.opacity = live ? "1" : "0.55";
    if (live && !p.pulse && !reduceMotion()) p.pulse = p.dot.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0.35, transform: "scale(0.8)" }, { opacity: 1, transform: "scale(1)" }], { duration: 1200, iterations: Infinity });
    if (!live && p.pulse) {
      p.pulse.cancel();
      p.pulse = null;
    }
    renderList(p);
  }

  /** Ensō's own turns, and any action: show the pill; without a session it fades after a few seconds. */
  function showRibbon() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = null;
      if (sessions.length) renderPill();
    }, 1500);
    renderPill();
    clearTimeout(fadeTimer);
    if (!sessions.length) fadeTimer = setTimeout(() => pill && !sessions.length && (pill.box.style.opacity = "0"), 4000);
  }

  const normSession = (x, i) => ({
    id: String(x?.id ?? `s${i}`).slice(0, 64),
    label: String(x?.label ?? "").trim().slice(0, 40) || "An agent",
    task: String(x?.task ?? "").slice(0, 200),
    startedAt: String(x?.startedAt ?? ""),
    running: !!x?.running,
    paused: !!x?.paused,
    stopped: !!x?.stopped,
    control: x?.control === "holder" || x?.control === "shared" || x?.control === "waiting" ? x.control : null, // its part in the tab lease
  });

  function removePill() {
    if (!pill) return;
    pill.box.style.opacity = "0";
    pill.list.style.opacity = "0";
    const p = pill;
    pill = null;
    expanded = false;
    fading = p.host;
    setTimeout(() => {
      p.host.remove();
      if (fading === p.host) fading = null;
    }, reduceMotion() ? 0 : 250);
  }

  /**
   * background.js sends every session on this tab at once: { agents: [...], titlePrefix }.
   * (A single { label, task, running, paused, stopped } still works: one session.) { off: true } ends them all.
   */
  function setPresence(next) {
    if (!next || typeof next !== "object" || next.off) sessions = [];
    else if (Array.isArray(next.agents)) sessions = next.agents.slice(0, 12).map(normSession);
    else sessions = [normSession({ id: "single", ...next }, 0)];
    titlePrefixWanted = sessions.length > 0 && next?.titlePrefix !== false;
    assignShades();
    clearTimeout(fadeTimer);
    if (sessions.length) renderPill();
    else removePill();
    titlePrefix(titlePrefixWanted);
    return { shown: sessions.length > 0, count: sessions.length, title: document.title };
  }

  // "✦ " in front of the page title while any agent is active, exactly once
  // whatever the number of sessions, so Zen's tab list shows it. Pages that
  // rewrite their title (Google Docs, Gmail) are followed with a
  // MutationObserver. Idempotent: the title is always "✦ " + the page's own
  // title with every leading "✦ " removed, so a doubled prefix left by an older
  // build is cleaned up too; on end the page's latest own title is put back exactly.
  const TITLE_PREFIX = "✦ ";
  const PREFIXES = /^(?:✦ )+/;
  let titleObserver = null;
  function applyTitle() {
    const current = document.title;
    const want = TITLE_PREFIX + current.replace(PREFIXES, "");
    if (current !== want) document.title = want;
  }
  function titlePrefix(on) {
    if (on) {
      applyTitle();
      if (!titleObserver) {
        titleObserver = new MutationObserver(() => titleObserver && applyTitle());
        titleObserver.observe(document.head ?? document.documentElement, { subtree: true, childList: true, characterData: true });
      }
    } else {
      if (titleObserver) {
        titleObserver.disconnect();
        titleObserver = null;
      }
      if (PREFIXES.test(document.title)) document.title = document.title.replace(PREFIXES, "");
    }
  }

  /** A soft outline flash on the element acted on, in the acting agent's shade, with its name. */
  function highlight(el, verb = "") {
    const r = el.getBoundingClientRect();
    const still = reduceMotion();
    // The helper names the acting session exactly (background.js passes it as `session`); only
    // requests without one (plain-http clients outside a session) fall back to the client's name.
    const actor = actorId ? sessions.find(s => s.id === actorId) : sessions.length === 1 ? sessions[0] : sessions.find(s => s.label === agentName);
    const shade = (actor && shadeOf.get(actor.id)) || ACCENT;
    const who = actor?.label || agentName;
    if (actor && pill) {
      // Its row in the expanded pill shows it is the one acting.
      for (const row of pill.rows ?? []) row.el.toggleAttribute("data-acting", row.id === actor.id);
    }
    const box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.setAttribute("data-enso-flash", INSTANCE);
    if (actor) box.setAttribute("data-session", actor.id);
    Object.assign(box.style, {
      position: "fixed", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px`,
      border: `2px solid ${shade}`, borderRadius: "8px", boxShadow: `0 0 0 4px ${shade}33`, zIndex: 2147483646,
      pointerEvents: "none", boxSizing: "border-box", margin: 0,
    });
    const tag = document.createElement("div");
    tag.textContent = verb ? `${who} · ${verb}` : who;
    Object.assign(tag.style, { position: "absolute", left: "-2px", top: r.top > 26 ? "-22px" : "calc(100% + 4px)", background: shade, color: "white", font: "600 10.5px/1 -apple-system, system-ui, sans-serif", padding: "4px 7px", borderRadius: "6px", whiteSpace: "nowrap" });
    box.append(tag);
    document.documentElement.appendChild(box);
    if (!still) box.animate([{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "scale(1)" }], { duration: 160, easing: "cubic-bezier(.22,1,.36,1)" });
    setTimeout(() => {
      if (still) return box.remove();
      box.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }).onfinish = () => box.remove();
    }, 1200);
  }

  // ---------- one copy per page ----------
  // A copy of this script from before an extension update or reload runs in
  // another sandbox (window.__ensoAgent above can't see it) or is dead, and its
  // pill, flashes and title prefix stay on the page. A new copy tells live
  // copies to stand down (a DOM event, which crosses sandboxes) and removes
  // what any older copy left, including builds that predate this event.
  const REPLACE_EVENT = "enso-agent-replaced";
  let retired = false; // replaced by a newer copy: ignore messages
  function standDown() {
    document.removeEventListener(REPLACE_EVENT, onReplaced);
    clearTimeout(liveTimer);
    clearTimeout(fadeTimer);
    clearTimeout(pinTimer);
    clearTimeout(collapseTimer);
    sessions = [];
    titleObserver?.disconnect();
    titleObserver = null;
    pill?.host.remove();
    fading?.remove();
    pill = fading = null;
    for (const n of document.querySelectorAll(`[data-enso-flash="${INSTANCE}"]`)) n.remove();
    retired = true;
  }
  function onReplaced(e) {
    if (e.detail !== INSTANCE) standDown();
  }
  document.dispatchEvent(new CustomEvent(REPLACE_EVENT, { detail: INSTANCE }));
  document.addEventListener(REPLACE_EVENT, onReplaced);
  for (const n of document.querySelectorAll("[data-enso-pill], [data-enso-flash]")) n.remove();
  // Flashes of builds before data-enso-flash: an outline box on <html> at our z-index.
  for (const n of document.documentElement.children) if (n.tagName === "DIV" && n.getAttribute("aria-hidden") === "true" && n.style.zIndex === "2147483646" && n.style.pointerEvents === "none") n.remove();
  if (PREFIXES.test(document.title)) document.title = document.title.replace(PREFIXES, ""); // background.js puts it back, once, while a session is active

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
  let regionKey = null; // the open overlay's key handler, also fed by Ensō's sidebar (region_key)
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
        .hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;font:500 12.5px/1.2 -apple-system,system-ui,sans-serif;color:#fff;background:rgba(28,24,20,.92);padding:6px 6px 6px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.25);white-space:nowrap;cursor:default}
        .hint > span{margin-right:8px}
        .hint button{all:unset;display:inline-flex;align-items:center;gap:2px;padding:5px 8px;border-radius:7px;cursor:pointer;color:#fff}
        .hint button:hover,.hint button:focus-visible{background:rgba(255,255,255,.14)}
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
      // Buttons as well as keys: keyboard focus is often still in Ensō's sidebar or
      // the address bar (the shortcut opens the sidebar), so the page may not see keys.
      for (const [k, t, key] of [["↵", "Visible area", "Enter"], ["F", "Full page", "f"], ["Esc", "Cancel", "Escape"]]) {
        const item = el("button");
        item.type = "button";
        item.append(el("kbd", "", k), document.createTextNode(t));
        item.addEventListener("mousedown", e => e.stopPropagation());
        item.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); regionKey?.({ key, preventDefault() {}, stopPropagation() {} }); });
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
        regionKey = null;
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
      regionKey = onKey;
      (document.body ?? document.documentElement).append(host);
      layer.focus();
    });
    return selecting;
  }

  // ---------- page_upload and page_wait ----------
  // Files arrive from background.js in upload_part messages (raw bytes, up to
  // 8 MB each, never altered) and become File objects with the name, type and
  // lastModified of the file on disk. In Firefox they are built in the page's
  // own compartment (window.wrappedJSObject, cloneInto): DataTransfer hides
  // items added under the content script's principal from the page, and the
  // page can't use objects owned by the content script. Then either
  //   input  input.files = DataTransfer.files, then input + change events, or
  //   drop   dragenter / dragover / drop with that DataTransfer on a drop zone.
  // No code is evaluated; this works in the listed build.

  const incoming = new Map(); // uploadId -> { files: [{ meta, parts: Uint8Array[] }], at }
  function uploadPart({ uploadId, index, count, meta, bytes }) {
    for (const [id, u] of incoming) if (Date.now() - u.at > 5 * 60_000) incoming.delete(id);
    let u = incoming.get(uploadId);
    if (!u) incoming.set(uploadId, (u = { files: new Array(count).fill(null).map(() => ({ meta: null, parts: [] })), at: Date.now() }));
    const f = u.files[index];
    if (!f) throw new Error(`No file ${index} in this upload.`);
    f.meta = meta;
    if (bytes && bytes.byteLength) f.parts.push(bytes);
    u.at = Date.now();
    return { received: f.parts.reduce((n, p) => n + p.byteLength, 0) };
  }

  const pageWin = window.wrappedJSObject ?? null; // Firefox: the page's own window, waived
  const inPage = typeof cloneInto === "function" && pageWin;
  function makeFile({ meta, parts }) {
    const got = parts.reduce((n, p) => n + p.byteLength, 0);
    if (got !== meta.size) throw new Error(`${meta.name} arrived incomplete in the page (${got} of ${meta.size} bytes); nothing was attached.`);
    const opts = { type: meta.type ?? "", lastModified: meta.lastModified || Date.now() };
    if (inPage) return new pageWin.File(cloneInto(parts, pageWin), meta.name, cloneInto(opts, pageWin));
    return new File(parts, meta.name, opts);
  }
  const newDataTransfer = () => (inPage ? new pageWin.DataTransfer() : new DataTransfer());
  function pageEvent(ctor, type, init) {
    if (!inPage) return new window[ctor](type, init);
    const i = new pageWin.Object();
    for (const [k, v] of Object.entries(init)) i[k] = v;
    return new pageWin[ctor](type, i);
  }
  const unwrap = el => (inPage ? el.wrappedJSObject ?? el : el);

  /** querySelector, then into open shadow roots (many upload widgets live in one). */
  function deepQuery(selector, all = false) {
    const found = [];
    const visit = root => {
      if (all) found.push(...root.querySelectorAll(selector));
      else if (!found.length) {
        const el = root.querySelector(selector);
        if (el) found.push(el);
      }
      if (!all && found.length) return;
      for (const host of root.querySelectorAll("*")) if (host.shadowRoot) visit(host.shadowRoot);
    };
    try {
      visit(document);
    } catch (err) {
      throw new Error(`Invalid CSS selector ${JSON.stringify(selector)}: ${err.message}`);
    }
    return all ? found : found[0] ?? null;
  }

  const isFileInput = el => el?.tagName === "INPUT" && String(el.type).toLowerCase() === "file";
  function fileInputFor(el) {
    if (isFileInput(el)) return el;
    if (el?.tagName === "LABEL" && isFileInput(el.control)) return el.control;
    const inside = el?.querySelectorAll?.('input[type="file" i]') ?? [];
    return inside.length === 1 ? inside[0] : null;
  }

  function accepts(input, file) {
    const accept = String(input.getAttribute("accept") ?? "").trim();
    if (!accept) return true;
    const name = file.name.toLowerCase();
    const type = String(file.type ?? "").toLowerCase();
    return accept.split(",").map(a => a.trim().toLowerCase()).filter(Boolean).some(a => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a));
  }

  const listFiles = list => Array.from(list ?? [], f => ({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified }));

  function upload({ uploadId, ref, selector, mode }) {
    const u = incoming.get(uploadId);
    incoming.delete(uploadId);
    if (!u || u.files.some(f => !f.meta)) throw new Error("The files didn't reach the page; call page_upload again.");
    let el = null;
    if (ref != null) {
      el = refs.get(Number(ref));
      if (!el || !el.isConnected) throw new Error(`Element [${ref}] is gone; call page_read again.`);
    } else if (selector) {
      el = deepQuery(selector);
      if (!el) throw new Error(`No element matches ${JSON.stringify(selector)}.`);
    } else throw new Error("Give the ref (from page_read) or a CSS selector of the file input or drop zone.");
    const input = fileInputFor(el);
    const how = mode ?? (input ? "input" : "drop");
    const files = u.files.map(makeFile);
    const metas = u.files.map(f => f.meta);
    const shown = input && visible(input) ? input : visible(el) ? el : null;
    showRibbon();
    if (shown) {
      shown.scrollIntoView({ block: "center", inline: "nearest" });
      highlight(shown, how === "drop" ? "dropping files" : "attaching files");
    }
    const dt = newDataTransfer();
    for (const f of files) dt.items.add(f);
    const base = { url: location.href, title: document.title };
    if (how === "input") {
      if (!input) {
        const n = deepQuery('input[type="file" i]', true).length;
        throw new Error(`${describe(el)} is not a file input${n ? `; this page has ${n} file input${n === 1 ? "" : "s"}: pass selector "input[type=file]" (or a more specific one)` : ""}. For a drop zone use mode "drop".`);
      }
      if (input.disabled) throw new Error(`${describe(input)} is disabled.`);
      if (files.length > 1 && !input.multiple) throw new Error(`${describe(input)} takes one file (no multiple attribute); you gave ${files.length}.`);
      unwrap(input).files = dt.files;
      for (const type of ["input", "change"]) unwrap(input).dispatchEvent(pageEvent("Event", type, { bubbles: true, composed: true }));
      const received = listFiles(input.files);
      const notAccepted = metas.filter(m => !accepts(input, m)).map(m => m.name);
      return { ...base, mode: "input", description: describe(input), received, accept: input.getAttribute("accept") || null, notAccepted, multiple: !!input.multiple };
    }
    if (how !== "drop") throw new Error(`Unknown mode ${how}; use "input" or "drop".`);
    const r = el.getBoundingClientRect();
    const point = { clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
    try {
      dt.dropEffect = "copy";
      dt.effectAllowed = "all";
    } catch {}
    const fire = type => {
      const ev = pageEvent("DragEvent", type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, ...point });
      unwrap(el).dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    fire("dragenter");
    const overAccepted = fire("dragover");
    const handled = fire("drop");
    return { ...base, mode: "drop", description: describe(el), received: listFiles(dt.files), handled, overAccepted };
  }

  /** One check for page_wait (background.js polls it). */
  function probe({ for: kind, value, visible: needVisible = true }) {
    if (kind === "text") {
      const text = document.body?.innerText ?? "";
      const re = /^\/(.+)\/([a-z]*)$/.exec(String(value ?? ""));
      const met = re ? new RegExp(re[1], re[2]).test(text) : text.includes(String(value ?? ""));
      return { met, detail: met ? `text ${JSON.stringify(String(value).slice(0, 80))} is on the page` : `text not on the page yet` };
    }
    const els = deepQuery(String(value ?? ""), true);
    const shown = els.filter(visible);
    const present = needVisible ? shown.length : els.length;
    if (kind === "selector") return { met: present > 0, detail: present ? `${present} matching element${present === 1 ? "" : "s"}${needVisible ? " visible" : ""}` : els.length ? `${els.length} match${els.length === 1 ? "es" : ""} but hidden` : "no element matches yet" };
    if (kind === "gone") return { met: present === 0, detail: present ? `${present} matching element${present === 1 ? "" : "s"} still ${needVisible ? "visible" : "present"}` : "no matching element" + (needVisible ? " is visible" : "") };
    throw new Error(`Unknown probe ${kind}.`);
  }

  const actions = {
    snapshot,
    ping: () => ({ url: location.href }),
    probe,
    upload_part: uploadPart,
    upload,
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
    region_key: ({ key }) => { if (!regionKey) return false; regionKey({ key: String(key), preventDefault() {}, stopPropagation() {} }); return true; },
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
    /** A click in pill.html at `y` px from its top: which agent it was on (and keep the list open a moment). */
    pill_pick({ y }) {
      if (!pill) return { sessionId: null };
      const sessionId = pickAt(Number(y) || 0);
      if (sessions.length > 1) setExpanded(true, 5000);
      return { sessionId };
    },
    /** What the pill shows (its shadow root is closed to the page): for diagnostics and the tests. */
    pill_state() {
      if (!pill || !pill.host.isConnected) return { shown: false, count: sessions.length };
      return { shown: true, count: sessions.length, text: pill.text.textContent, state: pill.state.textContent, expanded: pill.list.style.display !== "none", rows: pill.rows.filter(r => r.el.isConnected).map(r => ({ id: r.id, text: r.el.textContent, state: r.el.getAttribute("data-state") })), shades: Object.fromEntries(shadeOf) };
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
    // <unlisted-only>
    eval: evaluate,
    // </unlisted-only>
    storage,
    fetch: sessionFetch,
    query,
    inspect,
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
  // <unlisted-only>
  const typeOf = v => {
    if (v === null) return "null";
    if (Array.isArray(v)) return "array";
    if (typeof v !== "object") return typeof v;
    try { return Object.prototype.toString.call(v.wrappedJSObject ?? v).slice(8, -1); } catch { return "object"; }
  };
  // </unlisted-only>

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

  // <unlisted-only>
  const MAX_JSON = 20_000;
  async function evaluate({ expression, awaitPromise = true, timeoutMs = 30_000 }) {
    showRibbon();
    const base = { url: location.href, title: document.title, description: `JavaScript: ${expression.replace(/\s+/g, " ").slice(0, 100)}` };
    let value;
    const world = "page";
    // Runs in the page's own world, like a script of the page (and only there:
    // there is no fallback that runs it with the extension's privileges). A page
    // whose Content Security Policy forbids eval can't be evaluated.
    try {
      value = pw.eval(expression);
    } catch (err) {
      const e = err?.wrappedJSObject ?? err;
      const msg = String(e?.message ?? e);
      if (/CSP|Content Security Policy|blocked/i.test(msg)) return { ...base, ok: false, world, error: "This page's Content Security Policy blocks evaluating JavaScript. Use page_read, devtools_console or devtools_network instead." };
      return { ...base, ok: false, error: `${e?.name ?? "Error"}: ${msg}`, stack: String(e?.stack ?? "").slice(0, 2000) };
    }
    try {
      const w = value?.wrappedJSObject ?? value;
      if (w && typeof w.then === "function" && awaitPromise !== false) {
        const wait = Math.min(120_000, Math.max(1_000, Number(timeoutMs) || 30_000));
        value = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(Object.assign(new Error(`The promise did not settle within ${Math.round(wait / 1000)} s.`), { timedOut: wait })), wait);
          const ok = exportFunction(x => (clearTimeout(timer), resolve(x)), pw);
          const fail = exportFunction(x => (clearTimeout(timer), reject(x)), pw);
          w.then(ok, fail);
        });
      }
    } catch (err) {
      if (err?.timedOut) return { ...base, ok: false, world, timedOut: true, waitedMs: err.timedOut, error: err.message };
      const e = err?.wrappedJSObject ?? err;
      return { ...base, ok: false, world, error: `Rejected: ${e?.name ? `${e.name}: ${e.message}` : fmtArg(err)}`, stack: String(e?.stack ?? "").slice(0, 2000) };
    }
    let json = JSON.stringify(toSafe(value), null, 2) ?? "undefined";
    if (json.length > MAX_JSON) json = `${json.slice(0, MAX_JSON)}\n[result cut at ${MAX_JSON} characters]`;
    return { ...base, ok: true, world, type: typeOf(value), json };
  }
  // </unlisted-only>

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

  // ---------- fixed queries (page_query, page_inspect) ----------
  // Read-only answers to fixed questions about elements: no code is evaluated,
  // the selector only goes to querySelectorAll. Every build has them.

  const URL_ATTRS = new Set(["href", "src", "action", "poster", "formaction", "cite", "data"]);
  const QUERY_ATTR = /^(href|src|srcset|value|alt|title|name|id|class|type|role|placeholder|lang|dir|for|rel|target|action|method|poster|download|disabled|checked|selected|required|readonly|hidden|tabindex|contenteditable|aria-[\w-]+|data-[\w-]+)$/i;
  const MAX_QUERY_JSON = 60_000;
  const rectOf = el => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const isPassword = el => el instanceof HTMLInputElement && el.type === "password";
  const capText = (t, n) => {
    const s = String(t ?? "").replace(/\s+/g, " ").trim();
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  function attrValue(el, name) {
    const lower = name.toLowerCase();
    if (lower === "value") {
      if (isPassword(el)) return el.value ? "[redacted: password field]" : "";
      if ("value" in el && typeof el.value === "string") return capText(el.value, 500);
    }
    if (lower === "checked" && "checked" in el) return String(!!el.checked);
    if (lower === "selected" && "selected" in el) return String(!!el.selected);
    const raw = el.getAttribute(name);
    if (raw == null) return null;
    let v = raw;
    if (URL_ATTRS.has(lower)) {
      try { v = new URL(raw, document.baseURI).href; } catch {}
    }
    v = capText(v, 500);
    return (SECRET_NAME.test(lower) && v.length > 6) || looksSecret(v) ? REDACTED : v;
  }
  function accessibleName(el) {
    if (isPassword(el)) {
      return clean(el.getAttribute("aria-label") || el.labels?.[0]?.innerText || el.getAttribute("placeholder") || el.getAttribute("name") || "");
    }
    return nameOf(el);
  }
  function selectAll(selector) {
    const sel = String(selector ?? "").trim();
    if (!sel) throw new Error("Give a CSS selector.");
    try {
      return [...document.querySelectorAll(sel)];
    } catch {
      throw new Error(`Not a valid CSS selector: ${sel.slice(0, 200)}`);
    }
  }

  function query({ selector, attributes, limit, includeText }) {
    const all = selectAll(selector);
    const max = Math.min(200, Math.max(1, Number(limit) || 50));
    const wanted = (Array.isArray(attributes) ? attributes : []).map(String).filter(a => QUERY_ATTR.test(a)).slice(0, 30);
    const refused = (Array.isArray(attributes) ? attributes : []).map(String).filter(a => !QUERY_ATTR.test(a)).slice(0, 10);
    const elements = [];
    let size = 0;
    let truncated = false;
    for (const el of all.slice(0, max)) {
      const item = { tag: el.tagName.toLowerCase() };
      if (includeText !== false) item.text = capText(isPassword(el) ? "" : el.innerText ?? el.textContent, 300);
      if (wanted.length) {
        item.attributes = {};
        for (const a of wanted) {
          const v = attrValue(el, a);
          if (v != null) item.attributes[a] = v;
        }
      }
      item.visible = visible(el);
      item.rect = rectOf(el);
      size += JSON.stringify(item).length;
      if (size > MAX_QUERY_JSON) { truncated = true; break; }
      elements.push(item);
    }
    return { url: location.href, title: document.title, description: String(selector).slice(0, 100), selector: String(selector).slice(0, 300), total: all.length, count: elements.length, truncated: truncated || all.length > elements.length, refusedAttributes: refused, elements };
  }

  const STYLE_PROPS = ["display", "visibility", "position", "top", "right", "bottom", "left", "width", "height", "min-width", "max-width", "min-height", "max-height", "box-sizing",
    "margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "font-family", "font-size", "font-weight", "line-height", "color", "background-color", "background-image", "z-index", "overflow-x", "overflow-y", "opacity",
    "flex-direction", "justify-content", "align-items", "gap", "grid-template-columns", "transform", "pointer-events", "cursor", "text-overflow", "white-space"];

  function inspect({ ref, selector }) {
    let el = null;
    if (ref != null && ref !== "") {
      el = refs.get(Number(ref));
      if (!el || !el.isConnected) throw new Error(`No element [${ref}]: call page_read again for fresh refs.`);
    } else {
      const all = selectAll(selector);
      if (!all.length) throw new Error(`Nothing matches ${String(selector).slice(0, 200)}.`);
      el = all[0];
    }
    const cs = getComputedStyle(el);
    const styles = {};
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v !== "") styles[p] = capText(v, 200);
    }
    const r = el.getBoundingClientRect();
    const inView = r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    let coveredBy = null;
    if (inView) {
      const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) coveredBy = `${top.tagName.toLowerCase()}${top.id ? `#${top.id}` : ""}${typeof top.className === "string" && top.className.trim() ? `.${top.className.trim().split(/\s+/).slice(0, 3).join(".")}` : ""} (${describe(top)})`;
    }
    return {
      url: location.href,
      title: document.title,
      description: describe(el),
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: accessibleName(el) || "",
      matched: selector && (ref == null || ref === "") ? selectAll(selector).length : undefined,
      rect: rectOf(el),
      scroll: { scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight, clientWidth: el.clientWidth, clientHeight: el.clientHeight, scrollTop: Math.round(el.scrollTop), scrollLeft: Math.round(el.scrollLeft) },
      viewport: { width: innerWidth, height: innerHeight, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) },
      visible: visible(el),
      inView,
      covered: !!coveredBy,
      coveredBy,
      styles,
    };
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

  const PASSIVE = new Set(["presence", "pill_ready", "pill_pick", "pill_state", "pill_hint", "text", "ping", "probe", "upload_part", "console_flush", "region_select", "region_key", "page_size"]); // not an action by anyone
  browser.runtime.onMessage.addListener(msg => {
    if (!msg?.enso || retired) return undefined;
    return (async () => {
      try {
        const fn = actions[msg.action];
        if (!fn) throw new Error(`Unknown page action ${msg.action}`);
        if (!PASSIVE.has(msg.action)) {
          agentName = typeof msg.agent === "string" && msg.agent.trim() ? msg.agent.trim().slice(0, 40) : "Claude";
          actorId = typeof msg.session === "string" ? msg.session : null;
        }
        return { ok: true, result: await fn(msg.args ?? {}) };
      } catch (err) {
        return { ok: false, error: String(err?.message ?? err) };
      }
    })();
  });
})();
