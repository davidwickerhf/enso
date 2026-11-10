// Conversation transcript: user messages with context chips, reasoning summary,
// tool steps grouped in the flow of the answer, inline approvals, streamed
// Markdown, notices and errors.

import { h, icon, clear, extLink } from "../dom.js";
import { renderMarkdown, codeBlock } from "../markdown.js";
import { hostOf, duration, pastTense, resultCount, describeAction, actionIcon, compactNumber, fullDate, relTime } from "../format.js";
import { favicon } from "./composer.js";
import { loadingOr } from "./helperstate.js";

// ---- model -----------------------------------------------------------------

/** Group a flat event list into turns with ordered items and merged tool steps. */
export function buildTurns(events) {
  const turns = [];
  let turn = null;
  const steps = new Map();
  const ensureTurn = () => {
    if (!turn) { turn = { key: `t${turns.length}`, user: null, items: [], end: null, start: null }; turns.push(turn); }
    return turn;
  };
  const step = (ev) => {
    let st = steps.get(ev.toolUseId);
    if (!st) {
      st = { id: ev.toolUseId, call: null, result: null, approval: null, resolved: null, actions: [] };
      steps.set(ev.toolUseId, st);
      const t = ensureTurn();
      const last = t.items[t.items.length - 1];
      if (last?.type === "steps") last.steps.push(st);
      else t.items.push({ type: "steps", id: `g-${ev.toolUseId}`, steps: [st] });
    }
    return st;
  };
  for (const ev of events) {
    switch (ev.kind) {
      case "user":
        turn = { key: ev.id, user: ev, items: [], end: null, start: null };
        turns.push(turn);
        break;
      case "turn.start": {
        // A turn.start right before its user event belongs to that next turn.
        if (turn && (turn.items.length || turn.end)) turn = null;
        ensureTurn().start = ev;
        break;
      }
      case "turn.end": ensureTurn().end = ev; break;
      case "thinking": ensureTurn().items.push({ type: "thinking", id: ev.id, ev }); break;
      case "assistant": ensureTurn().items.push({ type: "text", id: ev.id, ev }); break;
      case "notice": ensureTurn().items.push({ type: "notice", id: ev.id, ev }); break;
      case "error": ensureTurn().items.push({ type: "error", id: ev.id, ev }); break;
      case "tool.call": step(ev).call = ev; break;
      case "tool.result": step(ev).result = ev; break;
      case "approval.request": step(ev).approval = ev; break;
      case "approval.resolved": step(ev).resolved = ev; break;
      case "page.action": step(ev).actions.push(ev); break;
      default: break;
    }
  }
  // A user event that arrives after turn.start: merge the empty turn into it.
  return turns.filter((t, i) => !(t.user == null && !t.items.length && !t.end && turns[i + 1]?.user));
}

function stepStatus(st, pending, running) {
  if (st.resolved?.decision === "deny") return "denied";
  if (st.approval && !st.resolved) return pending ? "waiting" : running ? "waiting" : "unanswered";
  if (st.result) return st.result.ok ? "ok" : "failed";
  return running ? "running" : "unknown";
}

const SERVER_ICONS = [[/gmail|mail|outlook/i, "mail"], [/calendar/i, "calendar"], [/drive|docs|sheets|slides/i, "page"], [/language|tutor|anki/i, "languages"], [/study|canvas|course/i, "book"], [/browser|tabs/i, "layers"]];

function stepIcon(st) {
  const call = st.call ?? st.approval ?? {};
  if (st.actions.length) return actionIcon(st.actions[st.actions.length - 1].action);
  if (call.category === "page" || call.server === "page") return actionIcon(call.tool);
  if (call.category === "web") return "globe";
  if (call.category === "memory") return "bookmark";
  for (const [re, name] of SERVER_ICONS) if (re.test(call.server ?? "") || re.test(call.title ?? "")) return name;
  return "tool";
}

function stepLabel(st, status) {
  const call = st.call ?? st.approval ?? {};
  const action = st.actions[st.actions.length - 1];
  if (action) return describeAction(action.action, action.target, action.url);
  const title = call.title || `${call.server ?? ""} · ${call.tool ?? "tool"}`;
  if (status === "running") return `${title}…`;
  if (status === "waiting" || status === "unanswered" || status === "denied") return title;
  if (status === "failed") return `${title} failed`;
  return pastTense(title);
}

const STATUS_ICON = { ok: "check", failed: "alert", denied: "ban", waiting: "shield", unanswered: "shield", unknown: "dot" };
const STATUS_TEXT = { ok: "Done", failed: "Failed", denied: "Denied", waiting: "Waiting for your approval", unanswered: "Not answered", running: "Running", unknown: "" };

function pretty(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

// ---- view ------------------------------------------------------------------

export function createChatView(store, ctx) {
  const { state: s, actions } = store;
  const ui = {
    expandedSteps: new Set(),
    expandedGroups: new Set(),
    openThinking: new Set(),
  };
  const list = h("div", { class: "transcript", role: "log", aria: { live: "polite", relevant: "additions text", label: "Conversation" } });
  const el = h("section", { class: "chat-view", aria: { label: "Chat" } }, list);
  let shownId = null;
  const cache = new Map(); // turn key → { node, sig, streamNodes }
  let raf = 0;

  function nearBottom() {
    const sc = ctx.scroller();
    return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120;
  }
  function toBottom(smooth = false) {
    const sc = ctx.scroller();
    sc.scrollTo({ top: sc.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" });
  }

  // -- pieces --

  function userBlock(ev) {
    const ctxChips = [];
    if (ev.page?.url) ctxChips.push(h("a", { class: "ctx-chip", href: ev.page.url, target: "_blank", rel: "noreferrer noopener", title: ev.page.url }, favicon(ev.page.url, null), h("span", null, ev.page.title || hostOf(ev.page.url))));
    for (const t of ev.tabs ?? []) ctxChips.push(h("a", { class: "ctx-chip", href: t.url, target: "_blank", rel: "noreferrer noopener", title: t.url }, icon("at"), h("span", null, t.title || hostOf(t.url))));
    for (const a of ev.attachments ?? []) ctxChips.push(h("span", { class: "ctx-chip" }, icon(String(a.mimeType).startsWith("image/") ? "image" : "page"), h("span", null, a.name)));
    if (ev.screenshot) ctxChips.push(h("span", { class: "ctx-chip" }, icon("camera"), h("span", null, "Screenshot")));
    const skill = String(ev.text ?? "").match(/^\/([\w-]+)(\s[\s\S]*)?$/);
    return h("div", { class: ["msg-user", ev.local && "pending"] },
      ctxChips.length ? h("div", { class: "ctx-chips" }, ctxChips) : null,
      h("div", { class: "bubble", title: fullDate(ev.at) },
        skill ? [h("span", { class: "skill-tag" }, `/${skill[1]}`), (skill[2] ?? "").trim()] : ev.text));
  }

  function thinkingBlock(item, live) {
    const open = ui.openThinking.has(item.id) || (live && item.ev.streaming);
    const body = h("div", { class: "thinking-body" }, item.ev.text);
    const btn = h("button", { type: "button", class: "thinking-toggle", aria: { expanded: String(open) } },
      icon("brain"), h("span", { class: item.ev.streaming ? "shimmer" : "" }, item.ev.streaming ? "Thinking…" : "Thought process"), icon("chevronRight", "chev"));
    const node = h("div", { class: ["thinking", open && "open"] }, btn, body);
    btn.addEventListener("click", () => {
      const now = !node.classList.contains("open");
      node.classList.toggle("open", now);
      btn.setAttribute("aria-expanded", String(now));
      if (now) ui.openThinking.add(item.id); else ui.openThinking.delete(item.id);
    });
    return { node, stream: item.ev.streaming ? body : null };
  }

  function approvalCard(st) {
    const a = st.approval;
    const pend = s.approvals.get(st.id);
    const sent = pend?.sent;
    const card = h("div", { class: "approval", role: "group", aria: { label: `Approval needed: ${a.title}` }, id: `approval-${st.id}` },
      h("div", { class: "approval-head" }, icon("shield"), h("div", null,
        h("strong", null, a.title || `${a.server} · ${a.tool}`),
        a.reason ? h("p", null, a.reason) : null)),
      a.input && Object.keys(a.input).length ? h("details", { class: "approval-input" }, h("summary", null, "Details"), h("pre", null, pretty(a.input))) : null,
      h("div", { class: "approval-actions" },
        h("button", { type: "button", class: "btn primary", disabled: !!sent, onclick: () => actions.reply(st.id, "allow") }, sent === "allow" ? "Allowing…" : "Allow"),
        h("button", { type: "button", class: "btn", disabled: !!sent, title: a.alwaysLabel ?? `Don't ask again for ${a.server} · ${a.tool}`, onclick: () => actions.reply(st.id, "always") }, sent === "always" ? "Saving…" : a.alwaysLabel ?? "Always allow"),
        h("button", { type: "button", class: "btn ghost danger", disabled: !!sent, onclick: () => actions.reply(st.id, "deny") }, sent === "deny" ? "Denying…" : "Deny")));
    return card;
  }

  function stepRow(st, running) {
    const pending = s.approvals.has(st.id);
    const status = stepStatus(st, pending, running);
    const call = st.call ?? st.approval ?? {};
    const open = ui.expandedSteps.has(st.id);
    const meta = [];
    if (st.result && status === "ok") { const c = resultCount(st.result.preview); if (c) meta.push(c); }
    if (st.resolved) meta.push({ allow: "allowed", always: "always allowed", deny: "denied by you" }[st.resolved.decision] ?? st.resolved.decision);
    if (st.result?.durationMs != null) meta.push(duration(st.result.durationMs));
    const statusEl = status === "running" ? h("span", { class: "status running", title: "Running" }, h("span", { class: "spinner" })) : h("span", { class: `status ${status}`, title: STATUS_TEXT[status] }, icon(STATUS_ICON[status]));
    const head = h("button", { type: "button", class: "step-head", aria: { expanded: String(open), controls: `step-${st.id}` } },
      statusEl,
      h("span", { class: "step-icon" }, icon(stepIcon(st))),
      h("span", { class: "step-label" }, stepLabel(st, status)),
      meta.length ? h("span", { class: "step-meta" }, meta.join(" · ")) : null,
      icon("chevronRight", "chev"));
    const body = h("div", { class: "step-body", id: `step-${st.id}`, hidden: !open },
      h("div", { class: "step-kv" }, h("span", null, "Tool"), h("code", null, `${call.server ?? "?"} · ${call.tool ?? "?"}`)),
      st.actions.map(a => h("div", { class: "step-kv" }, h("span", null, "Page"), extLink(a.url, a.title || a.url), a.ok === false ? h("span", { class: "bad" }, " failed") : null)),
      call.input != null && Object.keys(call.input ?? {}).length ? [h("div", { class: "step-sub" }, "Input"), h("pre", null, pretty(call.input))] : null,
      st.result ? [h("div", { class: "step-sub" }, st.result.ok ? "Result" : "Error"), h("pre", { class: st.result.ok ? "" : "bad" }, st.result.preview || (st.result.ok ? "(no output)" : "(no details)"))] : null);
    head.addEventListener("click", () => {
      const now = body.hidden;
      body.hidden = !now;
      head.setAttribute("aria-expanded", String(now));
      row.classList.toggle("open", now);
      if (now) ui.expandedSteps.add(st.id); else ui.expandedSteps.delete(st.id);
    });
    const row = h("div", { class: ["step", `is-${status}`, open && "open"] }, head, body, status === "waiting" && pending ? approvalCard(st) : null);
    return row;
  }

  function stepsBlock(item, running) {
    const all = item.steps;
    const done = all.every(st => st.result || st.resolved?.decision === "deny");
    const collapsible = all.length >= 3 && done;
    const expanded = !collapsible || ui.expandedGroups.has(item.id);
    const node = h("div", { class: "steps" });
    if (collapsible) {
      const servers = [...new Set(all.map(st => (st.call ?? st.approval)?.server).filter(x => x && x !== "page"))];
      const pageActs = all.filter(st => st.actions.length).length;
      const summary = [`${all.length} steps`, servers.length ? servers.slice(0, 3).join(", ") : null, pageActs ? `${pageActs} page action${pageActs > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
      const btn = h("button", { type: "button", class: "steps-summary", aria: { expanded: String(expanded) } }, icon("tool"), h("span", null, summary), icon("chevronRight", "chev"));
      btn.addEventListener("click", () => {
        if (ui.expandedGroups.has(item.id)) ui.expandedGroups.delete(item.id); else ui.expandedGroups.add(item.id);
        rerenderTurns(true);
      });
      node.append(btn);
      node.classList.toggle("open", expanded);
    }
    if (expanded) node.append(h("div", { class: "steps-list" }, all.map(st => stepRow(st, running))));
    return node;
  }

  function errorBlock(ev) {
    const code = ev.code;
    const body = [];
    let title = "Something went wrong";
    if (code === "no_api_key") {
      title = "No Anthropic API key";
      body.push(h("p", null, ev.text || "The API engine needs a key, and none was found."),
        h("p", null, "Add one to the macOS Keychain, then send again:"),
        codeBlock('security add-generic-password -s enso-anthropic -a "$USER" -w', "shell"),
        h("p", null, "Or switch to your Claude subscription, which needs no key."));
      const sub = s.engines?.subscription;
      body.push(h("div", { class: "error-actions" },
        sub?.available !== false ? h("button", { type: "button", class: "btn primary", onclick: () => actions.updateSettings({ engine: "subscription" }) }, "Use Claude subscription") : null,
        h("button", { type: "button", class: "btn", onclick: () => actions.go("settings") }, "Open settings")));
    } else if (code === "host_disconnected" || code === "host_missing") {
      title = "Ensō's helper isn't running";
      body.push(h("p", null, ev.text), h("p", null, "Install or update it, then reopen Zen:"), codeBlock("curl -fsSL https://enso.wicker.life/install.sh | bash", "shell"));
    } else if (code === "no_claude_code") {
      title = "Install Claude Code";
      const api = s.engines?.api;
      body.push(h("p", null, ev.text || "The subscription engine runs on Claude Code, which wasn't found on this Mac."),
        h("p", null, "Install it, sign in once, then reopen Zen:"),
        codeBlock("curl -fsSL https://claude.ai/install.sh | bash\nclaude", "shell"),
        h("div", { class: "error-actions" },
          api?.available ? h("button", { type: "button", class: "btn primary", onclick: () => actions.updateSettings({ engine: "api" }) }, "Use my API key") : null,
          h("button", { type: "button", class: "btn", onclick: () => actions.go("settings") }, "Open settings")));
    } else if (code === "engine_unavailable" || code === "not_logged_in") {
      title = "The Claude subscription isn't available";
      body.push(h("p", null, ev.text), h("div", { class: "error-actions" }, h("button", { type: "button", class: "btn", onclick: () => actions.go("settings") }, "Open settings")));
    } else {
      body.push(h("p", null, ev.text || "Unknown error"));
      if (code) body.push(h("p", { class: "muted small" }, `Code: ${code}`));
    }
    return h("div", { class: "error-card", role: "alert" }, h("div", { class: "error-title" }, icon("alert"), title), body);
  }

  function textBlock(item) {
    const node = h("div", { class: ["answer", "md", item.ev.streaming && "streaming"] });
    fillMarkdown(node, item.ev.text, item.ev.streaming);
    return { node, stream: item.ev.streaming ? node : null };
  }

  function fillMarkdown(node, text, streaming) {
    clear(node, renderMarkdown(text));
    if (streaming) {
      let target = node.lastElementChild;
      while (target && /^(UL|OL|BLOCKQUOTE)$/.test(target.tagName) && target.lastElementChild) target = target.lastElementChild;
      if (!target || /^(DIV|HR|FIGURE)$/.test(target.tagName)) target = node;
      target.append(h("span", { class: "caret", aria: { hidden: "true" } }));
    }
  }

  function turnFooter(turn, running) {
    if (!turn.end) return null;
    const u = turn.end.usage;
    const texts = turn.items.filter(i => i.type === "text").map(i => i.ev.text).join("\n\n");
    const meta = [];
    if (turn.end.stopped) meta.push(h("span", { class: "badge" }, "Stopped"));
    if (u) meta.push(h("span", { class: "usage", title: "Tokens used by this turn" }, `${compactNumber(u.inputTokens)} in · ${compactNumber(u.outputTokens)} out${u.costUsd != null ? ` · $${u.costUsd.toFixed(2)}` : ""}`));
    meta.push(h("span", { class: "usage", title: fullDate(turn.end.at) }, relTime(turn.end.at)));
    const copy = texts ? h("button", { type: "button", class: "icon-btn small", title: "Copy answer", aria: { label: "Copy answer" } }, icon("copy")) : null;
    copy?.addEventListener("click", () => navigator.clipboard?.writeText(texts).then(() => { copy.classList.add("done"); clear(copy, icon("check")); setTimeout(() => { copy.classList.remove("done"); clear(copy, icon("copy")); }, 1200); }));
    return h("div", { class: "turn-foot" }, copy, meta);
  }

  function signature(turn, running, isLast) {
    return JSON.stringify([
      turn.user?.id, turn.end?.id, running && isLast,
      turn.items.map(i => i.type === "steps"
        ? [i.id, ui.expandedGroups.has(i.id), i.steps.map(st => [st.id, stepStatus(st, s.approvals.has(st.id), running), s.approvals.get(st.id)?.sent, st.actions.length, !!st.result])]
        : [i.id, i.ev.streaming ? "s" : ""]),
    ]);
  }

  function renderTurn(turn, running, isLast) {
    const streamNodes = new Map();
    const node = h("div", { class: "turn" });
    if (turn.user) node.append(userBlock(turn.user));
    const flow = h("div", { class: "turn-flow" });
    for (const item of turn.items) {
      if (item.type === "thinking") { const r = thinkingBlock(item, isLast); flow.append(r.node); if (r.stream) streamNodes.set(item.id, { node: r.stream, kind: "thinking", item }); }
      else if (item.type === "text") { const r = textBlock(item); flow.append(r.node); if (r.stream) streamNodes.set(item.id, { node: r.stream, kind: "text", item }); }
      else if (item.type === "steps") flow.append(stepsBlock(item, running && isLast));
      else if (item.type === "notice") flow.append(h("div", { class: "notice" }, icon("info"), h("span", null, item.ev.text)));
      else if (item.type === "error") flow.append(errorBlock(item.ev));
    }
    const last = turn.items[turn.items.length - 1];
    const waitingOnApproval = turn.items.some(i => i.type === "steps" && i.steps.some(st => s.approvals.has(st.id)));
    if (running && isLast && !turn.end && !(last && last.ev?.streaming) && !waitingOnApproval) {
      flow.append(h("div", { class: "pending-dots", aria: { label: "Working" } }, h("i"), h("i"), h("i")));
    }
    if (flow.childNodes.length) node.append(flow);
    const foot = turnFooter(turn, running);
    if (foot) node.append(foot);
    return { node, streamNodes };
  }

  function rerenderTurns(force = false) {
    const id = s.ui.currentId;
    const c = id ? store.conv(id) : null;
    if (id !== shownId) { cache.clear(); clear(list); shownId = id; force = true; }
    if (!c || (!c.loaded && c.loading)) {
      clear(list, loadingOr(store, `conv:${id}`, null, { placeholder: h("div", { class: "transcript-loading", aria: { label: "Loading conversation" } }, h("div", { class: "skel w60" }), h("div", { class: "skel w90" }), h("div", { class: "skel w75" }), h("div", { class: "skel w40" })) }));
      cache.clear();
      return;
    }
    const running = s.running.has(id);
    const turns = buildTurns(c.events);
    if (!turns.length) {
      clear(list, h("div", { class: "empty-chat" }, h("p", null, "This conversation is empty.")));
      cache.clear();
      return;
    }
    const stick = force || nearBottom();
    const keys = new Set();
    let prev = null;
    turns.forEach((turn, i) => {
      const isLast = i === turns.length - 1;
      keys.add(turn.key);
      const sig = signature(turn, running, isLast);
      const cached = cache.get(turn.key);
      if (cached && cached.sig === sig && !force) {
        // Same structure: patch streamed text in place.
        for (const [, sn] of cached.streamNodes) {
          if (sn.kind === "text") fillMarkdown(sn.node, sn.item.ev.text, true);
          else sn.node.textContent = sn.item.ev.text;
        }
        cached.streamNodes = new Map([...cached.streamNodes].map(([k, sn]) => [k, { ...sn, item: turn.items.find(it => it.id === k) ?? sn.item }]));
        prev = cached.node;
        return;
      }
      const r = renderTurn(turn, running, isLast);
      if (cached) cached.node.replaceWith(r.node);
      else if (prev) prev.after(r.node);
      else list.prepend(r.node);
      if (!cached && !force && isLast) r.node.classList.add("enter");
      cache.set(turn.key, { node: r.node, sig, streamNodes: r.streamNodes });
      prev = r.node;
    });
    for (const [k, v] of cache) if (!keys.has(k)) { v.node.remove(); cache.delete(k); }
    for (const child of [...list.children]) if (![...cache.values()].some(v => v.node === child)) child.remove();
    list.setAttribute("aria-busy", String(running));
    if (stick) requestAnimationFrame(() => toBottom(false));
  }

  function schedule(force) {
    if (force) { cancelAnimationFrame(raf); raf = 0; rerenderTurns(true); return; }
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; rerenderTurns(false); });
  }

  return {
    el,
    update(topics) {
      const id = s.ui.currentId;
      if (topics.has("ui") && id !== shownId) return schedule(true);
      if (topics.has(`conv:${id}`) || topics.has("approvals") || topics.has("engines")) schedule(false);
      else if ((topics.has("waits") || topics.has("helper")) && id && !store.conv(id)?.loaded) schedule(true);
    },
    show() { schedule(true); },
    scrollToApproval(toolUseId) {
      const node = el.querySelector(`#approval-${CSS.escape(toolUseId)}`);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      node?.querySelector(".btn.primary")?.focus({ preventScroll: true });
    },
  };
}
