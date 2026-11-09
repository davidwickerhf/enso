// The brief: a calm, single-column morning page (sidebar Home, full-page Home
// and the new tab's "Your day" sheet). Greeting and headline, then small
// labelled sections with compact rows: Today, Mail, Study, Tasks, Practice, Ask.

import { h, icon, clear, isHttpUrl } from "../dom.js";
import { relTime, stripAsk } from "../format.js";
import { createTips } from "./tips.js";

const LIMIT = 4;
const ISO = /\d{4}-\d{2}-\d{2}/;
const DAY = 86_400_000;

function startOfDay(d) { const s = new Date(d); s.setHours(0, 0, 0, 0); return s; }
const hm = d => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Narrow-column time: "09:30" for ISO, free text passes through. */
function timeCell(value) {
  if (!value) return "";
  if (typeof value === "string" && !ISO.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : hm(d);
}

/** Narrow-column due date: "Today", "Tue 22:00", "12 Nov"; free text passes through. */
function dueCell(value, now = new Date()) {
  if (!value) return "";
  if (typeof value === "string" && !ISO.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  const time = typeof value === "string" && value.includes("T") ? ` ${hm(d)}` : "";
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tmrw${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })}${time}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function isOverdue(due, text = "") {
  if (/\boverdue\b/i.test(text) || /\boverdue\b/i.test(String(due ?? ""))) return true;
  if (typeof due !== "string" || !ISO.test(due)) return false;
  const d = new Date(due);
  return !Number.isNaN(d.getTime()) && d < new Date();
}

function isPast(time) {
  if (typeof time !== "string" || !ISO.test(time)) return false;
  return new Date(time) < Date.now() - 30 * 60_000;
}

export function createDashboard(store, ctx, { variant }) {
  const { state: s, actions } = store;
  const compact = variant === "compact";
  const expanded = new Set();
  const head = h("header", { class: "brief-head" });
  const body = h("div", { class: "brief-body", aria: { live: "polite", busy: "false" } });
  const tips = variant === "sheet" ? null : createTips({ onTry: id => ctx.tryTip(id) });
  const el = h("section", { class: `brief brief-${variant}`, aria: { label: "Your brief" } },
    tips && compact ? tips.el : null,
    head,
    body,
    tips && !compact ? tips.el : null);

  function renderHead() {
    const d = s.dashboard.data;
    const greeting = d?.greeting ?? fallbackGreeting(s.profile?.name);
    const updated = s.dashboard.loading ? "Updating…" : d?.generatedAt ? `Updated ${relTime(d.generatedAt)}` : "Not updated yet";
    clear(head,
      h("h1", { class: "brief-greeting" }, greeting),
      d?.headline ? h("p", { class: "brief-headline" }, d.headline) : s.dashboard.loading && !d ? h("div", { class: "skel w75" }) : null,
      h("p", { class: "brief-meta" },
        h("span", { title: d?.generatedAt ? new Date(d.generatedAt).toLocaleString() : "" }, updated),
        h("button", { type: "button", class: ["brief-refresh", s.dashboard.loading && "spinning"], disabled: s.dashboard.loading, title: "Refresh the brief", aria: { label: "Refresh the brief" }, onclick: () => actions.refreshDashboard() }, icon("refresh"))));
  }

  /** A row: [lead column][marker][title + one muted detail]. */
  function row({ lead = "", marker = null, title, detail, url, onclick, cls }) {
    const content = [
      h("span", { class: "b-lead" }, lead),
      h("span", { class: "b-mark", aria: { hidden: "true" } }, marker),
      h("span", { class: "b-text" }, h("span", { class: "b-title" }, title), detail ? h("span", { class: "b-detail" }, detail) : null),
    ];
    const inner = url && isHttpUrl(url)
      ? h("a", { class: "b-row-inner", href: url, target: "_blank", rel: "noreferrer noopener" }, content)
      : onclick ? h("button", { type: "button", class: "b-row-inner", onclick }, content) : h("div", { class: "b-row-inner" }, content);
    return h("li", { class: ["b-row", cls] }, inner);
  }

  function section(key, label, items, render, { noLead = false } = {}) {
    if (!items?.length) return null;
    const open = expanded.has(key);
    const shown = open ? items : items.slice(0, LIMIT);
    const more = items.length - shown.length;
    return h("section", { class: "b-section", aria: { label } },
      h("h2", { class: "b-label" }, label),
      h("ul", { class: ["b-rows", noLead && "no-lead"] }, shown.map(render)),
      more > 0 ? h("button", { type: "button", class: "b-more", aria: { expanded: "false" }, onclick: () => { expanded.add(key); renderBody(); } }, `+${more} more`) : null,
      open && items.length > LIMIT ? h("button", { type: "button", class: "b-more", aria: { expanded: "true" }, onclick: () => { expanded.delete(key); renderBody(); } }, "Show less") : null);
  }

  function skeleton() {
    const sec = n => h("div", { class: "b-section" }, h("div", { class: "skel w40 b-skel-label" }), Array.from({ length: n }, (_, i) => h("div", { class: "b-skel-row" }, h("div", { class: "skel" }), h("div", { class: `skel ${["w75", "w90", "w60"][i % 3]}` }))));
    return [sec(3), sec(2), sec(3)];
  }

  function renderBody() {
    const { data: d, loading, error } = s.dashboard;
    body.setAttribute("aria-busy", String(loading));
    const out = [];
    if (error) {
      out.push(h("p", { class: "b-error", role: "alert" }, h("span", { class: "b-dot" }), `Couldn't update the brief: ${error} `, h("button", { type: "button", class: "b-link", onclick: () => actions.refreshDashboard() }, "Try again")));
    }
    if (!d) {
      if (loading) out.push(...skeleton());
      else if (!error) out.push(h("p", { class: "b-empty" }, "No brief yet. It gathers today's calendar, mail that matters, deadlines and practice. ", h("button", { type: "button", class: "b-link", onclick: () => actions.refreshDashboard() }, "Build my brief")));
      clear(body, out);
      return;
    }
    const dot = h("span", { class: "b-dot", title: "Overdue" });
    out.push(
      section("calendar", "Today", d.calendar, ev => row({ lead: timeCell(ev.time), title: ev.title, detail: ev.location, url: ev.url, cls: isPast(ev.time) && "past" })),
      section("mail", "Mail", d.mail, m => row({ title: [h("span", { class: "b-from" }, m.from), h("span", { class: "b-sep" }, " — "), m.subject], detail: m.why, url: m.url }), { noLead: true }),
      section("study", "Study", d.study, x => {
        const late = isOverdue(x.due, x.item);
        return row({ lead: dueCell(x.due), marker: late ? dot.cloneNode() : null, title: x.item, detail: x.course, url: x.url, cls: late && "late" });
      }),
      section("tasks", "Tasks", d.tasks, x => {
        const late = isOverdue(x.due, x.title);
        return row({ lead: dueCell(x.due), marker: late ? dot.cloneNode() : h("span", { class: "b-ring" }), title: x.title, detail: x.source, url: x.url, cls: ["task", late && "late"] });
      }),
    );
    if (d.language) {
      out.push(h("section", { class: "b-section", aria: { label: "Practice" } }, h("h2", { class: "b-label" }, "Practice"),
        h("p", { class: "b-line" }, d.language.summary, " ", h("button", { type: "button", class: "b-link", onclick: () => ctx.ask("Start a short practice session with what's due") }, "Practise ›"))));
    }
    const sugg = (d.suggestions ?? []).slice(0, compact ? 2 : 3);
    if (sugg.length) {
      out.push(h("section", { class: "b-section", aria: { label: "Ask" } }, h("h2", { class: "b-label" }, "Ask"),
        h("p", { class: "b-line b-asks" }, sugg.flatMap((t, i) => [i ? h("span", { class: "b-sep" }, " · ") : null, h("button", { type: "button", class: "b-link", onclick: () => ctx.ask(stripAsk(t)) }, stripAsk(t))]))));
    }
    clear(body, out);
  }

  function renderAll() { renderHead(); renderBody(); }
  renderAll();
  setInterval(() => { if (el.isConnected) renderHead(); }, 60_000);

  return {
    el,
    heroSlot: null,
    update(topics) {
      if (topics.has("dashboard") || topics.has("state")) renderAll();
    },
    show() { renderAll(); },
  };
}

function fallbackGreeting(name) {
  const hr = new Date().getHours();
  const word = hr < 5 ? "Good night" : hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
  return name ? `${word}, ${name}` : word;
}
