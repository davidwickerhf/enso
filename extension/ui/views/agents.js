// External agents in Ensō's sidebar and full page (docs/PROTOCOL.md "agents").
//
//   - the agent card: when the active tab has a session of an external agent
//     (Claude Code, Codex…), its client and task, elapsed time, a live list of
//     recent steps (irreversible ones highlighted), Pause/Resume, Stop and
//     "Tell the agent…" with the delivery state of each note;
//     With several sessions on the tab, one card with a tab per agent (its
//     shade, as on the page pill and flashes, and its state); the page pill
//     picks the tab of the agent clicked;
//   - tab leases (lib/agentsessions.mjs): with several agents on the tab, the
//     one allowed to act wears "In control"; a refused one shows "Waiting for
//     the tab". The card offers "Hand over to <agent>" (the lease moves to that
//     session) and "Let both act" (shared: everyone may act, with the risk in
//     one line), and "One at a time" to end sharing;
//   - the Agents row: every live session across tabs and spaces; a row
//     switches to that tab, Stop stops it.
//
// The card is built once per session and updated in place, so typing a note
// isn't interrupted by the live updates. New steps are announced politely;
// nothing here takes focus unless the page pill asked for the card.

import { h, clear, icon, iconButton, hostBadge } from "../dom.js";
import { hostOf, fullDate } from "../format.js";

const STEP_VERB = {
  page_read: "Read the page",
  page_screenshot: "Looked at the page",
  page_scroll: "Scrolled",
  page_click: "Clicked",
  page_type: "Typed",
  page_select: "Chose an option in",
  page_press: "Pressed",
  page_navigate: "Opened",
  page_back: "Went back",
  page_eval: "Ran JavaScript",
  page_query: "Found elements:",
  page_inspect: "Inspected",
  page_storage: "Read storage",
  tabs_list: "Listed tabs",
  tab_read: "Read a tab",
  tabs_open: "Opened tabs",
  tabs_close: "Closed tabs",
  tabs_group: "Grouped tabs",
  history_search: "Searched history for",
  devtools_console: "Read the console",
  devtools_network: "Read network requests",
  session_fetch: "Made a request to",
  session_start: "Started",
};
const STEP_ICON = { page_click: "cursor", page_type: "keyboard", page_press: "keyboard", page_navigate: "compass", page_back: "arrowLeft", page_read: "page", page_screenshot: "camera", page_scroll: "chevronDown", page_eval: "command", page_query: "search", page_inspect: "search", tabs_close: "x", tabs_open: "plus", session_fetch: "globe", history_search: "search" };
const RISKY = /\b(send|delete|remove|submit|pay|purchase|buy|publish|post|confirm|transfer|merge)\b/i;

export const isRisky = a => !!a.irreversible || a.tool === "tabs_close" || ((a.tool === "page_click" || a.tool === "page_press") && RISKY.test(a.target ?? ""));

/** "Typed “Dear Sam…” into textbox "Body"" */
export function stepText(a) {
  const verb = STEP_VERB[a.tool] ?? a.title ?? a.tool;
  const target = String(a.target ?? "").replace(/^JavaScript:\s*/, "");
  if (a.tool === "page_type") return `${verb}${a.typed ? ` “${a.typed}”` : ""}${target ? ` into ${target}` : ""}`;
  if (a.tool === "page_eval" || a.tool === "page_read" || a.tool === "tabs_list" || a.tool === "page_screenshot") return verb;
  if (a.tool === "page_navigate") return `${verb} ${hostOf(target) || target || "a page"}`;
  return target ? `${verb} ${target}` : verb;
}

export function elapsed(fromIso, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(fromIso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const clock = iso => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

function stateLabel(a) {
  if (a.stopped) return "Stopped";
  if (a.paused) return "Paused";
  if (a.running) return "Working";
  if (a.control === "waiting") return "Waiting";
  return "Idle";
}

/** "Claude Code", or "Claude Code · Export the brief…" when another agent on the tab has the same name. */
export function agentName(a, here = []) {
  const twin = here.some(x => x.id !== a.id && x.client === a.client);
  if (!twin || !a.task) return a.client;
  return `${a.client} · ${a.task.length > 22 ? `${a.task.slice(0, 21).trimEnd()}…` : a.task}`;
}

/**
 * The tab-lease line and actions for the card of `a` (several agents on its tab, or `a` waiting).
 * → { text, risk, handOver: [session], share: "on" | "off" | null, badge }
 */
export function leaseView(a, here) {
  const live = here.filter(x => !x.stopped);
  const holder = here.find(x => x.control === "holder");
  const shared = here.some(x => x.control === "shared");
  const badge = a.stopped ? null : shared && here.length > 1 ? "Shared" : a.control === "holder" && here.length > 1 ? "In control" : a.control === "waiting" ? "Waiting for the tab" : null;
  if (here.length < 2 && a.control !== "waiting") return { text: "", risk: "", handOver: [], share: null, badge };
  const both = live.length > 2 ? "every agent" : "both agents";
  if (shared) return { text: `You let ${both} act on this tab.`, risk: "They may overwrite or undo each other's changes.", handOver: live, share: "off", badge };
  const handOver = live.filter(x => x.id !== holder?.id);
  const others = live.length > 2 ? "The other agents" : "The other agent";
  const text = !holder
    ? "No agent is in control of this tab; the next one to act takes it."
    : holder.id === a.id
      ? `This agent is in control of the tab. ${others} can read it but not act.`
      : a.control === "waiting"
        ? `${agentName(holder, here)} is in control, so this agent's actions here are refused.`
        : `${agentName(holder, here)} is in control of this tab.`;
  return { text, risk: "", handOver, share: live.length > 1 ? "on" : null, badge };
}

// The same shades as the page (pageagent.js SHADES): each session keeps the
// first one free on its tab, oldest first, for as long as it lives.
export const SHADES = ["#d9643a", "#2f7f86", "#8a4f9e", "#b0802a", "#4a6db0", "#a8455a"];
const RANK = a => (a.stopped ? 3 : a.paused ? 1 : a.running ? 0 : 2);

export function createAgentsPanel(store) {
  const { state: s, actions } = store;
  const el = h("div", { class: "agents-slot" });
  let card = null; // { id, root, parts… }
  let listOpen = false;
  let lastAnnounced = null;
  let ticker = null;

  let picked = null; // the session shown when several work on the active tab
  const shades = new Map(); // session id -> shade
  const onTab = () => (s.tab ? s.agents.filter(a => a.tabId === s.tab.tabId).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt))) : []);
  function current() {
    const list = onTab();
    if (!list.length) return null;
    let a = list.find(x => x.id === picked);
    if (!a) {
      a = [...list].sort((x, y) => RANK(x) - RANK(y))[0]; // the one the pill leads with
      picked = a.id;
    }
    return a;
  }
  function shadeOf(a) {
    const live = new Set(s.agents.map(x => x.id));
    for (const id of [...shades.keys()]) if (!live.has(id)) shades.delete(id);
    if (!shades.has(a.id)) {
      const used = new Set(s.agents.filter(x => x.tabId === a.tabId && shades.has(x.id)).map(x => shades.get(x.id)));
      shades.set(a.id, SHADES.find(c => !used.has(c)) ?? SHADES[0]);
    }
    return shades.get(a.id);
  }

  function buildCard(a) {
    const steps = h("ol", { class: "agent-steps", aria: { label: "Recent steps" } });
    const notes = h("ul", { class: "agent-notes", aria: { label: "Your notes" } });
    const input = h("input", { type: "text", class: "input agent-input", maxlength: "1000", placeholder: "Tell the agent…", autocomplete: "off", aria: { label: `Tell ${a.client} something` } });
    const sendBtn = h("button", { type: "submit", class: "btn primary small" }, "Send");
    const form = h("form", { class: "agent-tell", onsubmit: e => { e.preventDefault(); const t = input.value.trim(); if (!t || !card) return; actions.noteAgent(card.id, t); input.value = ""; } }, input, sendBtn);
    const pauseBtn = h("button", { type: "button", class: "btn small", onclick: () => { const x = current(); if (x) (x.paused ? actions.resumeAgent : actions.pauseAgent)(x.id); } });
    const stopBtn = h("button", { type: "button", class: "btn small ghost danger", onclick: () => { const x = current(); if (x) actions.stopAgent(x.id); } }, icon("stop"), "Stop");
    const dismissBtn = h("button", { type: "button", class: "btn small ghost", onclick: () => { const x = current(); if (x) actions.dismissAgent(x.id); } }, "Dismiss");
    const who = h("strong", { class: "agent-client" });
    const task = h("span", { class: "agent-task" });
    const stateEl = h("span", { class: "agent-state" });
    const time = h("span", { class: "agent-time" });
    const status = h("p", { class: "agent-status", role: "status" });
    const t3Title = h("span", { class: "agent-t3-title" });
    const t3Open = h("button", { type: "button", class: "linklike agent-t3-open", onclick: () => { const x = current(); if (x?.t3?.threadId) actions.openT3(x.t3.threadId); } }, "Open in T3", icon("arrowUpRight"));
    const t3Line = h("p", { class: "agent-t3", hidden: true }, h("span", { class: "tag" }, "T3"), t3Title, t3Open);
    const live = h("div", { class: "sr-only", aria: { live: "polite" } });
    const controlBadge = h("span", { class: "badge agent-control", hidden: true });
    const leaseText = h("p", { class: "agent-lease-text" });
    const leaseRisk = h("p", { class: "agent-lease-risk", hidden: true });
    const leaseActions = h("div", { class: "agent-lease-actions" });
    const lease = h("div", { class: "agent-lease", role: "group", aria: { label: "Who may act on this tab" }, hidden: true }, leaseText, leaseRisk, leaseActions);
    const root = h("section", { class: "agent-card", tabindex: "-1", aria: { label: `${a.client} is working on this tab` } },
      h("header", { class: "agent-head" },
        h("span", { class: "agent-mark", aria: { hidden: "true" } }, "✦"),
        h("div", { class: "agent-who" }, h("span", { class: "agent-who-line" }, who, controlBadge), task),
        h("div", { class: "agent-meta" }, stateEl, time)),
      t3Line, lease, steps, status, notes,
      h("div", { class: "agent-actions" }, form, h("div", { class: "agent-controls" }, pauseBtn, stopBtn, dismissBtn)),
      live);
    return { id: a.id, root, steps, notes, input, form, pauseBtn, stopBtn, dismissBtn, who, task, stateEl, time, status, live, t3Line, t3Title, t3Open, controlBadge, lease, leaseText, leaseRisk, leaseActions, leaseSig: "", stepIds: "" };
  }

  function fillCard(a) {
    const c = card;
    c.root.classList.toggle("paused", !!a.paused);
    c.root.classList.toggle("stopped", !!a.stopped);
    c.root.classList.toggle("running", !!a.running && !a.paused && !a.stopped);
    c.root.setAttribute("aria-label", `${a.client}${a.task ? `: ${a.task}` : ""}. ${stateLabel(a)}.`);
    c.who.textContent = a.client;
    // Tab leases: who may act here, and the user's hand-over / shared controls.
    const here = onTab();
    const lv = leaseView(a, here);
    c.controlBadge.hidden = !lv.badge;
    c.controlBadge.textContent = lv.badge ?? "";
    c.controlBadge.className = ["badge", "agent-control", lv.badge === "In control" && "in-control", lv.badge === "Waiting for the tab" && "waiting", lv.badge === "Shared" && "shared"].filter(Boolean).join(" ");
    c.root.classList.toggle("waiting", a.control === "waiting" && !a.stopped);
    c.lease.hidden = !lv.text;
    const lsig = JSON.stringify([lv.text, lv.risk, lv.share, lv.handOver.map(x => [x.id, agentName(x, here)])]);
    if (lsig !== c.leaseSig) {
      c.leaseSig = lsig;
      c.leaseText.textContent = lv.text;
      c.leaseRisk.textContent = lv.risk;
      c.leaseRisk.hidden = !lv.risk;
      const tabId = a.tabId;
      clear(c.leaseActions,
        lv.share === "off" ? [] : lv.handOver.map(x => h("button", { type: "button", class: "btn small", dataset: { fk: `handover-${x.id}` }, title: `Let ${x.client}${x.task ? ` (${x.task})` : ""} act on this tab; the others' actions are refused`, onclick: () => actions.handOverAgent(x.id) }, icon("arrowRight"), h("span", { class: "btn-label" }, x.id === a.id ? "Hand the tab to this agent" : `Hand over to ${agentName(x, here)}`))),
        lv.share === "on" ? h("button", { type: "button", class: "btn small ghost", dataset: { fk: "share-on" }, title: "Every agent on this tab may act on it at once", onclick: () => actions.shareTab(tabId, true) }, here.filter(x => !x.stopped).length > 2 ? "Let all act" : "Let both act") : null,
        lv.share === "off" ? h("button", { type: "button", class: "btn small", dataset: { fk: "share-off" }, title: "Back to one agent at a time: the last one to act keeps the tab", onclick: () => actions.shareTab(tabId, false) }, "One at a time") : null);
    }
    c.task.textContent = a.task || (a.explicit ? "" : "Working in Zen (no task given)");
    c.task.classList.toggle("muted", !a.task);
    // A T3 Code agent: the thread it runs in (screenshots of this tab go there).
    c.t3Line.hidden = !a.t3;
    if (a.t3) {
      c.t3Title.textContent = a.t3.title ? `${a.t3.title}${a.t3.projectTitle ? ` · ${a.t3.projectTitle}` : ""}` : "Running in a T3 Code thread";
      c.t3Open.hidden = !a.t3.openable;
    }
    clear(c.stateEl, a.running && !a.paused && !a.stopped ? h("span", { class: "live-dot", aria: { hidden: "true" } }) : null, stateLabel(a));
    tick();
    // Steps: newest last, like a log; re-rendered only when they change.
    const ids = a.actions.map(x => x.id).join(",");
    if (ids !== c.stepIds) {
      c.stepIds = ids;
      const shown = a.actions.slice(-6);
      clear(c.steps, shown.length ? shown.map(x => h("li", { class: ["agent-step", isRisky(x) && "risky", x.ok === false && "failed", x.refused && "refused"], title: `${fullDate(x.at)}${x.error ? ` · ${x.error}` : ""}` },
        h("span", { class: "agent-step-icon", aria: { hidden: "true" } }, icon(STEP_ICON[x.tool] ?? "dot")),
        h("span", { class: "agent-step-text" }, stepText(x)),
        isRisky(x) ? h("span", { class: "tag warn-tag" }, "irreversible") : null,
        x.refused ? h("span", { class: "badge" }, "refused") : x.ok === false ? h("span", { class: "badge bad" }, "failed") : null,
        h("time", { class: "agent-step-time", datetime: x.at }, clock(x.at)))) : h("li", { class: "agent-step empty" }, "No steps on this tab yet."));
      requestAnimationFrame(() => (c.steps.scrollTop = c.steps.scrollHeight)); // newest in view
      const latest = a.actions.at(-1);
      if (latest && latest.id !== lastAnnounced) {
        if (lastAnnounced !== null) c.live.textContent = `${a.client}: ${stepText(latest)}${latest.ok === false ? ", failed" : ""}.`;
        lastAnnounced = latest.id;
      }
    }
    // Notes: the helper's (with delivery state) plus local ones still on their way.
    const local = [...s.agentNotes.values()].filter(n => n.sessionId === a.id).map(n => ({ text: n.text, at: n.at, sending: true }));
    const all = [...a.notes, ...local].slice(-4);
    clear(c.notes, all.map(n => h("li", { class: ["agent-note", n.deliveredAt && "delivered"] },
      h("span", { class: "agent-note-text" }, n.text),
      h("span", { class: "agent-note-state" }, n.deliveredAt ? [icon("check"), "Delivered"] : n.sending ? "Sending…" : "Waiting for the agent's next step"))));
    c.notes.hidden = !all.length;
    c.pauseBtn.hidden = !!a.stopped;
    clear(c.pauseBtn, icon(a.paused ? "play" : "pause"), a.paused ? "Resume" : "Pause");
    c.pauseBtn.setAttribute("aria-pressed", String(!!a.paused));
    c.pauseBtn.title = a.paused ? "Let the agent continue; its next result tells it to read the page again" : "Hold the agent's actions on this tab until you resume";
    c.stopBtn.hidden = !!a.stopped;
    c.dismissBtn.hidden = !a.stopped;
    c.form.hidden = !!a.stopped;
    c.status.textContent = a.stopped
      ? `${a.client} is stopped: its further calls are refused until it starts a new session.`
      : a.paused
        ? `Paused. ${a.client}'s actions on this tab are refused until you resume; it was told to wait.`
        : "";
    c.status.hidden = !c.status.textContent;
  }

  function tick() {
    if (!card) return;
    const a = s.agents.find(x => x.id === card.id);
    if (a) card.time.textContent = elapsed(a.startedAt);
  }

  /** One tab per agent when several work on the active tab. */
  function renderTabs(list, selId) {
    if (list.length < 2) return null;
    const pick = id => { picked = id; render(); tabsHost.querySelector(`[data-fk="tab-${CSS.escape(id)}"]`)?.focus(); };
    const onkeydown = e => {
      const i = list.findIndex(x => x.id === selId);
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      pick(list[(i + step + list.length) % list.length].id);
    };
    return h("div", { class: "agent-tabs", role: "tablist", aria: { label: `${list.length} agents on this tab` }, onkeydown }, list.map(a => {
      const sel = a.id === selId;
      return h("button", { type: "button", role: "tab", class: ["agent-tab", sel && "selected", a.paused && "paused", a.stopped && "stopped", a.running && !a.paused && !a.stopped && "running", a.control === "waiting" && !a.stopped && "waiting"], tabindex: sel ? "0" : "-1", dataset: { fk: `tab-${a.id}` }, aria: { selected: String(sel), controls: "agent-card-panel" }, title: `${a.client}${a.task ? `: ${a.task}` : ""} · ${stateLabel(a)}`, onclick: () => pick(a.id) },
        h("span", { class: "agent-tab-dot", style: `background:${shadeOf(a)}`, aria: { hidden: "true" } }),
        h("span", { class: "agent-tab-text" }, h("strong", null, a.client), a.task ? h("span", { class: "agent-tab-task" }, a.task) : null),
        a.control === "holder" && !a.stopped ? h("span", { class: "agent-tab-control" }, "In control") : h("span", { class: "agent-tab-state" }, stateLabel(a)));
    }));
  }

  function renderList(skipIds) {
    const others = s.agents.filter(a => !skipIds.includes(a.id));
    if (!others.length) return null;
    const skipId = skipIds.length > 0;
    const toggle = h("button", { type: "button", class: "agents-toggle", dataset: { fk: "toggle" }, aria: { expanded: String(listOpen), controls: "agents-list" }, onclick: () => { listOpen = !listOpen; if (listOpen) actions.listTabs(); render(); } },
      h("span", { class: "agents-dot", aria: { hidden: "true" } }),
      h("span", { class: "agents-label" }, skipId ? `${others.length} more ${others.length === 1 ? "agent" : "agents"} working` : `${others.length === 1 ? "An agent is" : `${others.length} agents are`} working in other tabs`),
      icon(listOpen ? "chevronDown" : "chevronRight"));
    const list = listOpen ? h("ul", { class: "agents-list", id: "agents-list", aria: { label: "Agents" } }, others.map(a => {
      const tab = s.tabs.find(t => t.tabId === a.tabId);
      const host = hostOf(a.url);
      const last = a.actions.at(-1);
      return h("li", { class: ["agents-row", a.paused && "paused", a.stopped && "stopped"] },
        h("button", { type: "button", class: "agents-go", dataset: { fk: `go-${a.id}` }, disabled: a.tabId == null, title: a.tabId == null ? "Not on a tab yet" : "Switch to this tab", aria: { label: `Switch to the tab where ${a.client} is working${a.title ? `: ${a.title}` : ""}` }, onclick: () => a.tabId != null && actions.switchToTab(a.tabId) },
          host ? hostBadge(host) : h("span", { class: "agent-mark small", aria: { hidden: "true" } }, "✦"),
          h("span", { class: "agents-main" },
            h("span", { class: "agents-who" }, h("strong", null, a.client), a.task ? ` · ${a.task}` : ""),
            h("span", { class: "agents-sub" }, [a.control === "waiting" && !a.stopped ? "Waiting for the tab" : stateLabel(a), tab?.space || null, a.title || host || null, last ? stepText(last) : null].filter(Boolean).join(" · ")))),
        a.stopped ? iconButton("x", `Dismiss ${a.client}`, () => actions.dismissAgent(a.id), { class: "small", dataset: { fk: `x-${a.id}` } }) : iconButton("stop", `Stop ${a.client}`, () => actions.stopAgent(a.id), { class: "small danger-icon", dataset: { fk: `stop-${a.id}` } }));
    })) : null;
    return h("div", { class: "agents-row-wrap" }, toggle, list);
  }

  const tabsHost = h("div", { class: "agent-tabs-host" });
  const cardHost = h("div", { class: "agent-card-host" });
  const stack = h("div", { class: "agent-stack" }, tabsHost, cardHost);
  const listHost = h("div", { class: "agents-list-host" });
  let listSig = "";
  let tabsSig = "";
  el.append(stack, listHost);

  function render() {
    const a = current();
    if (a && (!card || card.id !== a.id)) {
      card = buildCard(a);
      lastAnnounced = a.actions.at(-1)?.id ?? null;
      clear(cardHost, card.root);
    }
    if (!a && card) { card = null; clear(cardHost); }
    if (card) fillCard(a);
    // Several agents on this tab: a tab for each above the card.
    const here = onTab();
    const tsig = JSON.stringify([a?.id, here.map(x => [x.id, x.client, x.task, x.paused, x.stopped, x.running, x.control])]);
    if (tsig !== tabsSig) {
      tabsSig = tsig;
      const focused = tabsHost.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
      clear(tabsHost, renderTabs(here, a?.id));
      if (focused) tabsHost.querySelector(`[data-fk="${CSS.escape(focused)}"]`)?.focus();
    }
    tabsHost.hidden = here.length < 2;
    stack.classList.toggle("tabbed", here.length > 1);
    if (card) {
      card.root.id = "agent-card-panel";
      if (here.length > 1) card.root.setAttribute("role", "tabpanel");
      else card.root.removeAttribute("role");
    }
    // The card node (and the note being typed) stays in place; only the list is rebuilt.
    const hereIds = here.map(x => x.id);
    const others = s.agents.filter(x => !hereIds.includes(x.id));
    const sig = JSON.stringify([listOpen, hereIds, others.map(x => [x.id, x.task, x.paused, x.stopped, x.running, x.control, x.title, x.actions.at(-1)?.id]), listOpen ? s.tabs.map(t => [t.tabId, t.space]) : 0]);
    let list = listHost.firstChild;
    if (sig !== listSig) {
      listSig = sig;
      const focused = listHost.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
      list = renderList(hereIds);
      clear(listHost, list);
      if (focused) listHost.querySelector(`[data-fk="${CSS.escape(focused)}"]`)?.focus();
    }
    cardHost.hidden = !card;
    stack.hidden = !card;
    listHost.hidden = !list;
    el.hidden = !card && !list;
    if (s.agents.length && !ticker) ticker = setInterval(tick, 1000);
    if (!s.agents.length && ticker) { clearInterval(ticker); ticker = null; }
  }

  render();
  return {
    el,
    update(topics) {
      if (topics.has("agents") || topics.has("tab") || topics.has("tabs")) render();
      if (topics.has("agents-focus") && s.agentFocus?.tabId === s.tab?.tabId && s.agentFocus.sessionId && s.agentFocus.sessionId !== picked && onTab().some(x => x.id === s.agentFocus.sessionId)) {
        picked = s.agentFocus.sessionId; // the agent clicked in the page pill
        render();
      }
      if (topics.has("agents-focus") && card && s.agentFocus?.tabId === s.tab?.tabId) {
        card.root.scrollIntoView({ block: "nearest" });
        card.root.classList.remove("flash");
        void card.root.offsetWidth;
        card.root.classList.add("flash");
        card.input.focus({ preventScroll: true }); // the user clicked the pill to get here
      }
    },
  };
}
