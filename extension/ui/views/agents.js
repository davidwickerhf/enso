// External agents in Ensō's sidebar and full page (docs/PROTOCOL.md "agents").
//
//   - the agent card: when the active tab has a session of an external agent
//     (Claude Code, Codex…), its client and task, elapsed time, a live list of
//     recent steps (irreversible ones highlighted), Pause/Resume, Stop and
//     "Tell the agent…" with the delivery state of each note;
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
const STEP_ICON = { page_click: "cursor", page_type: "keyboard", page_press: "keyboard", page_navigate: "compass", page_back: "arrowLeft", page_read: "page", page_screenshot: "camera", page_scroll: "chevronDown", page_eval: "command", tabs_close: "x", tabs_open: "plus", session_fetch: "globe", history_search: "search" };
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
  return "Idle";
}

export function createAgentsPanel(store) {
  const { state: s, actions } = store;
  const el = h("div", { class: "agents-slot" });
  let card = null; // { id, root, parts… }
  let listOpen = false;
  let lastAnnounced = null;
  let ticker = null;

  const current = () => (s.tab ? s.agents.find(a => a.tabId === s.tab.tabId) ?? null : null);

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
    const root = h("section", { class: "agent-card", tabindex: "-1", aria: { label: `${a.client} is working on this tab` } },
      h("header", { class: "agent-head" },
        h("span", { class: "agent-mark", aria: { hidden: "true" } }, "✦"),
        h("div", { class: "agent-who" }, who, task),
        h("div", { class: "agent-meta" }, stateEl, time)),
      t3Line, steps, status, notes,
      h("div", { class: "agent-actions" }, form, h("div", { class: "agent-controls" }, pauseBtn, stopBtn, dismissBtn)),
      live);
    return { id: a.id, root, steps, notes, input, form, pauseBtn, stopBtn, dismissBtn, who, task, stateEl, time, status, live, t3Line, t3Title, t3Open, stepIds: "" };
  }

  function fillCard(a) {
    const c = card;
    c.root.classList.toggle("paused", !!a.paused);
    c.root.classList.toggle("stopped", !!a.stopped);
    c.root.classList.toggle("running", !!a.running && !a.paused && !a.stopped);
    c.root.setAttribute("aria-label", `${a.client}${a.task ? `: ${a.task}` : ""}. ${stateLabel(a)}.`);
    c.who.textContent = a.client;
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

  function renderList(skipId) {
    const others = s.agents.filter(a => a.id !== skipId);
    if (!others.length) return null;
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
            h("span", { class: "agents-sub" }, [stateLabel(a), tab?.space || null, a.title || host || null, last ? stepText(last) : null].filter(Boolean).join(" · ")))),
        a.stopped ? iconButton("x", `Dismiss ${a.client}`, () => actions.dismissAgent(a.id), { class: "small", dataset: { fk: `x-${a.id}` } }) : iconButton("stop", `Stop ${a.client}`, () => actions.stopAgent(a.id), { class: "small danger-icon", dataset: { fk: `stop-${a.id}` } }));
    })) : null;
    return h("div", { class: "agents-row-wrap" }, toggle, list);
  }

  const cardHost = h("div", { class: "agent-card-host" });
  const listHost = h("div", { class: "agents-list-host" });
  let listSig = "";
  el.append(cardHost, listHost);

  function render() {
    const a = current();
    if (a && (!card || card.id !== a.id)) {
      card = buildCard(a);
      lastAnnounced = a.actions.at(-1)?.id ?? null;
      clear(cardHost, card.root);
    }
    if (!a && card) { card = null; clear(cardHost); }
    if (card) fillCard(a);
    // The card node (and the note being typed) stays in place; only the list is rebuilt.
    const others = s.agents.filter(x => x.id !== a?.id);
    const sig = JSON.stringify([listOpen, a?.id, others.map(x => [x.id, x.task, x.paused, x.stopped, x.running, x.title, x.actions.at(-1)?.id]), listOpen ? s.tabs.map(t => [t.tabId, t.space]) : 0]);
    let list = listHost.firstChild;
    if (sig !== listSig) {
      listSig = sig;
      const focused = listHost.contains(document.activeElement) ? document.activeElement.dataset.fk : null;
      list = renderList(a?.id);
      clear(listHost, list);
      if (focused) listHost.querySelector(`[data-fk="${CSS.escape(focused)}"]`)?.focus();
    }
    cardHost.hidden = !card;
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
