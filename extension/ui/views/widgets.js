// New-tab widgets: small, glanceable tiles under the box (Next up, Due soon,
// Tasks, monday.com, Mail, Practice, GitHub, Clock, Recent chats, Quick links, Note, Ask).
// Tasks and monday.com keep themselves fresh: the helper pushes new data right
// after a chat changes tasks, and pages ask again when they open or become
// visible (data older than a minute) and every five minutes while visible.
// Hidden until the user adds them via Customize; layout persists in
// settings.homeWidgets (localStorage as fallback). Edit mode (top-bar button,
// "Edit widgets" under the grid, or right-click a widget): drag or arrow keys
// to reorder, S/M size, remove, and an "Add widget" picker.

import { h, icon, clear, iconButton, hostBadge, isHttpUrl } from "../dom.js";
import { relTime, hostOf, stripAsk } from "../format.js";
import { getBrowserApi, openFullPage, inExtension } from "../transport.js";
import { favicon } from "./composer.js";

const LAYOUT_KEY = "enso.homeWidgets";
const DONE_KEY = "enso.doneItems";
const LINKS_KEY = "enso.quickLinks";
const NOTE_KEY = "enso.note";
const TASKS_ADDED_KEY = "enso.tasksWidgetAdded"; // one-time: Tasks added next to Due soon
const ISO = /\d{4}-\d{2}-\d{2}/;

const load = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const hm = d => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// Widgets saved under an older type name.
const renamed = w => (w?.type === "armenian" ? { ...w, type: "language" } : w);

export const TYPES = {
  next: { name: "Next up", desc: "Your next event, and the one after.", icon: "calendar", sizes: ["M", "S"], data: true },
  due: { name: "Due soon", desc: "Deadlines and tasks by date; tick tasks off.", icon: "checkSquare", sizes: ["M", "S"], data: true },
  tasks: { name: "Tasks", desc: "Open tasks from your task apps (e.g. Commonfold); tick them off.", icon: "check", sizes: ["M", "S"] },
  mail: { name: "Mail", desc: "How many emails need you, and the top one.", icon: "mail", sizes: ["S", "M"], data: true },
  language: { name: "Practice", desc: "Today's practice (e.g. a language app) in one line.", icon: "languages", sizes: ["M", "S"], data: true },
  monday: { name: "monday.com", desc: "Items assigned to you across your boards, with status and due date; recent updates.", icon: "layout", sizes: ["M", "S"] },
  github: { name: "GitHub", desc: "Reviews waiting for you, your PRs that need you, assigned issues.", icon: "pullRequest", sizes: ["M", "S"] },
  clock: { name: "Clock", desc: "The time and date.", icon: "clock", sizes: ["S", "M"] },
  chats: { name: "Recent chats", desc: "Your last three conversations in this space.", icon: "chat", sizes: ["M", "S"] },
  links: { name: "Quick links", desc: "Up to eight sites, one click away.", icon: "link", sizes: ["M", "S"] },
  note: { name: "Note", desc: "A tiny scratchpad, saved as you type.", icon: "pencil", sizes: ["S", "M"] },
  ask: { name: "Ask", desc: "Three things Ensō suggests asking today.", icon: "sparkle", sizes: ["M", "S"], data: true },
};

export const DEFAULT_LAYOUT = [
  { id: "w-next", type: "next", size: "M" },
  { id: "w-due", type: "due", size: "M" },
  { id: "w-tasks", type: "tasks", size: "M" },
  { id: "w-clock", type: "clock", size: "S" },
];

function parseDue(due) {
  if (typeof due !== "string" || !ISO.test(due)) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due.trim()); // a bare date is a local day, not UTC midnight
  const d = day ? new Date(+day[1], day[2] - 1, +day[3]) : new Date(due);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dueLabel(due, now = new Date()) {
  const d = parseDue(due);
  if (!d) return due ?? "";
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const t = due.includes("T") ? ` ${hm(d)}` : "";
  if (days < 0) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (days === 0) return `Today${t}`;
  if (days === 1) return `Tomorrow${t}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })}${t}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const itemKey = x => `${x.course ?? x.source ?? ""}|${x.item ?? x.title ?? ""}`;
const normTitle = t => String(t ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Dashboard tasks that are follow-ups from these sources stay in Due soon, not in Tasks.
const NOT_A_TASK_APP = /mail|outlook|calendar|meet|study|course|canvas|github/i;
const fromTaskApp = t => (t.kind ? t.kind === "app" : !NOT_A_TASK_APP.test(t.source ?? ""));

const dayStart = d => new Date(d).setHours(0, 0, 0, 0);
/** Whole days from today to the due day (negative: overdue), or null without a date. */
export function dueDays(due, now = new Date()) {
  const d = parseDue(due);
  return d ? Math.round((dayStart(d) - dayStart(now)) / 86_400_000) : null;
}
/** A due value's sort time: a bare date counts as the end of that day, so timed tasks that day come first. */
const dueSortTime = due => {
  const d = parseDue(due);
  if (!d) return 0;
  return /T/.test(due) ? d.getTime() : new Date(d).setHours(23, 59, 59, 0);
};

/** Overdue first, then due today, then the rest by date, then undated (ties: reminder, then title). Same order as the helper's sortTasks. */
export function orderTasks(rows, now = new Date()) {
  const bucket = r => { const n = dueDays(r.due, now); return n == null ? 3 : n < 0 ? 0 : n === 0 ? 1 : 2; };
  return [...rows].sort((a, b) => bucket(a) - bucket(b) || dueSortTime(a.due) - dueSortTime(b.due) || (parseDue(a.remindAt)?.getTime() ?? 9e15) - (parseDue(b.remindAt)?.getTime() ?? 9e15) || String(a.title).localeCompare(String(b.title)));
}

/**
 * Rows for the Tasks widget: tasks fetched directly from task apps (tasks.widget),
 * monday.com items with a due date (monday.widget), then the dashboard's tasks that
 * came from a task app (kind "app", or a source that isn't mail/calendar/study/GitHub),
 * minus duplicates and apps the direct path already covered. `local` rows can only be
 * hidden locally. late: overdue; soon: due today or tomorrow.
 */
export function taskRows(direct, dashTasks, { done = new Set(), completing = new Set(), monday = null, now = new Date() } = {}) {
  const tasks = direct?.tasks ?? [];
  const mondayItems = monday?.state === "ok" ? monday.items.filter(i => i.due) : [];
  const covered = new Set((direct?.servers ?? []).filter(x => x.ok).map(x => String(x.label).toLowerCase()));
  if (monday?.state === "ok") covered.add("monday.com").add("monday");
  const titles = new Set(tasks.map(t => normTitle(t.title)));
  const rows = [
    ...tasks.map(t => ({ ...t, key: `${t.server}|${t.id}`, local: !t.completable })),
    ...mondayItems.filter(i => !titles.has(normTitle(i.title))).map(i => ({ id: i.id, title: i.title, due: i.due, url: i.url, source: "monday.com", key: `monday:${i.id}`, local: true })),
  ];
  for (const r of rows) titles.add(normTitle(r.title));
  rows.push(...(dashTasks ?? [])
    .filter(t => fromTaskApp(t) && !covered.has(String(t.source ?? "").toLowerCase()) && !titles.has(normTitle(t.title)))
    .map(t => ({ title: t.title, due: t.due, url: t.url, source: t.source, key: itemKey({ source: t.source, title: t.title }), local: true })));
  return orderTasks(rows.filter(r => !done.has(r.key) && !completing.has(r.key)), now)
    .map(r => { const n = dueDays(r.due, now); return { ...r, late: n != null && n < 0, soon: n === 0 || n === 1 }; });
}

/** Up to n rows in order, making room for `keep` rows (just created in a chat) so they are always visible. */
export function pickShown(rows, n, keep = new Set()) {
  const must = rows.filter(r => keep.has(r.key)).slice(0, n);
  const rest = rows.filter(r => !keep.has(r.key)).slice(0, n - must.length);
  const chosen = new Set([...must, ...rest]);
  return rows.filter(r => chosen.has(r));
}

/** The reminder as a short time ("17:00", or "Wed 17:00" on another day than the due date). */
function reminderLabel(r) {
  const d = parseDue(r.remindAt);
  if (!d || !/T/.test(r.remindAt)) return "";
  const due = parseDue(r.due);
  return due && dayStart(due) === dayStart(d) ? hm(d) : `${d.toLocaleDateString(undefined, { weekday: "short" })} ${hm(d)}`;
}

export function createWidgets(store, ctx, { onEdit } = {}) {
  const { state: s, actions } = store;
  let editing = false;
  let pickerOpen = false;
  let layout = readLayout();
  const seen = new Set(); // widget ids already shown, so only new tiles animate
  const grid = h("div", { class: "widgets", role: "list", aria: { label: "Widgets" } });
  const picker = h("div", { class: "widget-picker", role: "dialog", aria: { label: "Add a widget" }, hidden: true });
  // Quiet way into edit mode once there are widgets (the top-bar button is easy to miss).
  const editLink = h("button", { type: "button", class: "edit-widgets", onclick: () => onEdit?.() }, icon("pencil"), "Edit widgets");
  const el = h("section", { class: "widgets-wrap", aria: { label: "Widgets" } }, grid, editLink, picker);
  const live = h("div", { class: "visually-hidden", aria: { live: "polite" } });
  el.append(live);

  function readLayout() {
    const fromSettings = s.settings?.homeWidgets;
    if (Array.isArray(fromSettings)) return fromSettings.map(renamed).filter(w => TYPES[w?.type]);
    const local = load(LAYOUT_KEY, null);
    return Array.isArray(local) ? local.map(renamed).filter(w => TYPES[w?.type]) : [];
  }

  // One time: put Tasks next to Due soon in an existing layout (only via the UI; settings.json is the helper's).
  function addTasksOnce() {
    if (!s.ready || !Array.isArray(s.settings?.homeWidgets) || load(TASKS_ADDED_KEY, false)) return;
    save(TASKS_ADDED_KEY, true);
    const i = layout.findIndex(w => w.type === "due");
    if (i < 0 || layout.some(w => w.type === "tasks")) return;
    layout.splice(i + 1, 0, { id: "w-tasks", type: "tasks", size: "M" });
    persist();
  }

  function persist() {
    save(LAYOUT_KEY, layout);
    actions.updateSettings({ homeWidgets: layout });
  }

  // ---- widget bodies ----------------------------------------------------

  const dash = () => s.dashboard.data;
  const loadingSkel = () => h("div", { class: "w-skel" }, h("div", { class: "skel w40 tall" }), h("div", { class: "skel w75" }), h("div", { class: "skel w60" }));
  const empty = text => h("p", { class: "w-empty" }, text);

  function open(url, fallbackAsk) {
    if (isHttpUrl(url)) getBrowserApi().then(api => api.open(url));
    else if (fallbackAsk) ctx.ask(fallbackAsk);
  }

  function nextUp(w) {
    const cal = dash()?.calendar ?? [];
    const now = Date.now();
    const upcoming = cal.filter(ev => { const d = parseDue(ev.time); return !d || d.getTime() > now - 15 * 60_000; });
    if (!upcoming.length) return empty(cal.length ? "Nothing else today" : "Nothing on your calendar today");
    const [first, second] = upcoming;
    const time = ev => (parseDue(ev.time) ? hm(new Date(ev.time)) : ev.time ?? "");
    return h("button", { type: "button", class: "w-hit", onclick: () => open(first.url, `Tell me about “${first.title}” on my calendar`) },
      h("span", { class: "w-big" }, time(first)),
      h("span", { class: "w-title clamp2" }, first.title),
      first.location && w.size === "M" ? h("span", { class: "w-sub" }, first.location) : null,
      second ? h("span", { class: "w-sub w-then" }, `Then ${time(second)} · ${second.title}`) : null);
  }

  function dueSoon(w) {
    const d = dash();
    const done = new Set(load(DONE_KEY, []));
    // With a Tasks widget on the page, task-app tasks live there; Due soon keeps deadlines and follow-ups.
    const withTasks = layout.some(x => x.type === "tasks");
    const items = [
      ...(d?.study ?? []).map(x => ({ title: x.item, sub: x.course, due: x.due, url: x.url, task: false })),
      ...(d?.tasks ?? []).filter(x => !withTasks || !fromTaskApp(x)).map(x => ({ title: x.title, sub: x.source, due: x.due, url: x.url, task: true })),
    ].map(x => ({ ...x, key: itemKey({ course: x.sub, item: x.title }), late: /\boverdue\b/i.test(x.title) || (parseDue(x.due)?.getTime() ?? Infinity) < Date.now() }))
      .filter(x => !done.has(x.key))
      .sort((a, b) => (b.late - a.late) || ((parseDue(a.due)?.getTime() ?? 9e15) - (parseDue(b.due)?.getTime() ?? 9e15)));
    if (!items.length) return empty("Nothing due. Enjoy it.");
    const shown = items.slice(0, 3);
    return h("div", { class: "w-list tight" },
      shown.map((x, i) => h("div", { class: ["w-due-row", i === 0 && "first", x.late && "late"] },
        x.task
          ? h("button", { type: "button", class: "w-tick", title: "Mark done", aria: { label: `Mark “${x.title}” done` }, onclick: e => { e.stopPropagation(); const set = new Set(load(DONE_KEY, [])); set.add(x.key); save(DONE_KEY, [...set]); live.textContent = `Marked ${x.title} done`; render(); } })
          : h("span", { class: "w-dotcol" }, x.late ? h("span", { class: "b-dot", title: "Overdue" }) : null),
        h("button", { type: "button", class: "w-due-text", title: [x.title, x.sub, dueLabel(x.due)].filter(Boolean).join(" · "), onclick: () => open(x.url, `Help me with “${x.title}”${x.sub ? ` (${x.sub})` : ""}`) },
          h("span", { class: "w-title one" }, x.title)),
        w.size === "M" ? h("span", { class: "w-due-when" }, dueLabel(x.due)) : null)),
      items.length > shown.length ? h("span", { class: "w-more" }, `+${items.length - shown.length} more`) : null);
  }

  // Rows a chat just created stay marked "new" for a minute; the flash plays once (the
  // animation continues across redraws via a negative delay). Reduced motion: no flash, the tag stays.
  const NEW_MS = 60_000;
  const FLASH_MS = 2400;
  const newSince = new Map(); // row key -> first seen
  function noteAdded(keys) { const t = Date.now(); for (const k of keys ?? []) if (!newSince.has(k)) newSince.set(k, t); }
  const newKeys = () => { const t = Date.now(); for (const [k, at] of newSince) if (t - at > NEW_MS) newSince.delete(k); return new Set(newSince.keys()); };
  const flashing = key => newSince.has(key) && Date.now() - newSince.get(key) < FLASH_MS;
  const newAttrs = key => (flashing(key) ? { style: `--new-delay:-${Date.now() - newSince.get(key)}ms` } : {});
  const newTag = () => h("span", { class: "w-new-tag" }, "New");

  function tasksBody(w) {
    const t = s.tasks;
    if (!t.data && !dash() && !s.monday.data && (t.loading || !s.ready || !t.at)) return loadingSkel();
    const rows = taskRows(t.data, dash()?.tasks, { done: new Set(load(DONE_KEY, [])), completing: t.completing, monday: s.monday.data });
    const fresh = newKeys();
    const err = t.lastError ? h("span", { class: "w-task-err", role: "status" }, `Couldn't complete: ${t.lastError}`) : null;
    if (!rows.length) {
      const anyApp = (t.data?.servers ?? []).length > 0 || (dash()?.tasks ?? []).some(x => x.kind === "app") || s.monday.data?.state === "ok";
      return h("div", { class: "w-col" }, empty(anyApp ? "No open tasks. Nice." : "No task app connected"),
        anyApp ? err : h("button", { type: "button", class: "b-link w-action", onclick: () => actions.go("tools") }, "Connect one ›"));
    }
    const tick = r => h("button", { type: "button", class: "w-tick", title: r.local ? "Hide (done)" : `Mark done in ${r.source}`, aria: { label: `Mark “${r.title}” done` }, onclick: e => {
      e.stopPropagation();
      if (r.local) { const set = new Set(load(DONE_KEY, [])); set.add(r.key); save(DONE_KEY, [...set]); render(); }
      else actions.completeTask(r.server, r.id);
      live.textContent = `Marked ${r.title} done`;
    } });
    const when = r => [r.due ? dueLabel(r.due) : "", reminderLabel(r)].filter(Boolean);
    const meta = r => [r.source, ...when(r)].filter(Boolean).join(" · ");
    const whenEl = r => (r.due ? h("span", { class: "w-due-when" }, dueLabel(r.due), reminderLabel(r) ? h("span", { class: "w-remind", title: `Reminder ${reminderLabel(r)}` }, icon("bell"), reminderLabel(r)) : null) : null);
    const openRow = r => open(r.url, `Help me with my task “${r.title}”${r.source ? ` (${r.source})` : ""}`);
    const rowClass = r => ["w-due-row", r.late && "late", r.soon && "soon", fresh.has(r.key) && "is-new", flashing(r.key) && "flash"];
    if (w.size === "S") {
      const top = pickShown(rows, 1, fresh)[0];
      return h("div", { class: "w-col" },
        h("span", { class: "w-big" }, String(rows.length), h("small", null, " open")),
        h("div", { class: [...rowClass(top), "w-task-top"], ...newAttrs(top.key) }, tick(top),
          h("button", { type: "button", class: "w-due-text", title: [top.title, meta(top)].join(" · "), onclick: () => openRow(top) },
            h("span", { class: "w-title one" }, fresh.has(top.key) ? newTag() : null, top.title), h("span", { class: "w-sub" }, meta(top)))), err);
    }
    const shown = pickShown(rows, rows.length > 4 ? 3 : 4, fresh); // four rows fill the tile; with more, three and "+N more"
    return h("div", { class: "w-list tight w-tasks" },
      shown.map(r => h("div", { class: rowClass(r), ...newAttrs(r.key) }, tick(r),
        h("button", { type: "button", class: "w-due-text", title: [r.title, meta(r)].join(" · "), onclick: () => openRow(r) }, h("span", { class: "w-title one" }, fresh.has(r.key) ? newTag() : null, r.title)),
        h("span", { class: "w-task-meta" }, r.source ? h("span", { class: "w-task-src" }, r.source) : null, whenEl(r)))),
      err ?? (rows.length > shown.length ? h("span", { class: "w-more" }, `+${rows.length - shown.length} more`) : null));
  }

  // monday.com rows come from the helper (monday.widget, cached ~5 min).
  const STATUS_TONE = [[/done|complete/i, "done"], [/stuck|blocked/i, "stuck"], [/working|progress|doing|review/i, "working"], [/wait|hold|pending/i, "wait"]];
  const toneOf = status => STATUS_TONE.find(([re]) => re.test(status ?? ""))?.[1] ?? "other";
  function mondayBody(w) {
    const m = s.monday;
    const d = m.data;
    if (!d) return loadingSkel();
    if (d.state === "not-connected") {
      const text = { off: "monday.com is off in Tools", expired: "monday.com wants you to sign in again", "claude.ai": "monday.com is only connected on claude.ai" }[d.reason] ?? "monday.com isn't connected";
      return h("div", { class: "w-col" }, empty(text), h("button", { type: "button", class: "b-link w-action", onclick: () => actions.go("tools") }, d.reason === "off" ? "Open Tools ›" : "Connect monday.com ›"));
    }
    if (d.state === "error") {
      return h("div", { class: "w-col" }, h("p", { class: "w-empty", role: "status" }, d.error || "monday.com isn't responding."),
        h("span", { class: "w-mon-actions" },
          h("button", { type: "button", class: "b-link w-action", disabled: m.loading, onclick: () => actions.loadMonday(true) }, m.loading ? "Retrying…" : "Retry"),
          d.kind === "auth" || d.kind === "tools" ? h("button", { type: "button", class: "b-link w-action", onclick: () => actions.go("tools") }, "Tools ›") : null));
    }
    const fresh = newKeys();
    const items = d.items ?? [];
    const due = items.filter(i => { const n = dueDays(i.due); return n != null && n <= 7; }).length;
    const late = items.filter(i => (dueDays(i.due) ?? 0) < 0).length;
    const rowEl = i => {
      const n = dueDays(i.due);
      return h("button", { type: "button", class: ["w-mon-row", n != null && n < 0 && "late", (n === 0 || n === 1) && "soon", fresh.has(`monday:${i.id}`) && "is-new", flashing(`monday:${i.id}`) && "flash"], ...newAttrs(`monday:${i.id}`), title: [i.title, i.board, i.status, i.due ? `due ${dueLabel(i.due)}` : ""].filter(Boolean).join(" · "), onclick: () => open(i.url, `Tell me about “${i.title}” on monday.com`) },
        h("span", { class: "w-title one" }, fresh.has(`monday:${i.id}`) ? newTag() : null, i.title),
        i.status ? h("span", { class: ["w-mon-status", `t-${toneOf(i.status)}`] }, i.status) : h("span"),
        h("span", { class: "w-due-when" }, i.due ? dueLabel(i.due) : ""));
    };
    if (w.size === "S") {
      const top = pickShown(items.map(i => ({ ...i, key: `monday:${i.id}` })), 1, fresh)[0];
      return h("div", { class: "w-col" },
        h("span", { class: "w-big" }, String(items.length), h("small", null, " assigned")),
        top ? h("button", { type: "button", class: "w-gh-text", title: top.title, onclick: () => open(top.url) }, h("span", { class: "w-title one" }, top.title), h("span", { class: "w-sub" }, [top.status, top.due ? dueLabel(top.due) : top.board].filter(Boolean).join(" · "))) : empty("Nothing assigned to you"));
    }
    const counts = h("div", { class: "w-gh-counts" },
      h("span", { class: ["w-gh-count", !items.length && "zero"] }, h("strong", null, String(items.length)), " assigned"),
      h("span", { class: ["w-gh-count", "c-mine", !due && "zero"] }, h("strong", null, String(due)), " due this week"),
      late ? h("span", { class: "w-gh-count c-late" }, h("strong", null, String(late)), " overdue") : null);
    if (!items.length) return h("div", { class: "w-col" }, counts, empty("Nothing assigned to you"));
    const upd = (d.updates ?? [])[0];
    const maxRows = upd ? 2 : 3; // the counts line, then rows; the latest update takes the last line
    const shown = pickShown(items.map(i => ({ ...i, key: `monday:${i.id}` })), maxRows, fresh);
    return h("div", { class: "w-col w-mon" }, counts,
      h("div", { class: "w-list tight" }, shown.map(rowEl)),
      upd ? h("button", { type: "button", class: ["w-mon-update", upd.mention && "mention"], title: `${upd.author} on “${upd.item ?? "an item"}”: ${upd.text}`, onclick: () => open(upd.url) },
        h("span", { class: "w-mon-who" }, upd.mention ? icon("at") : icon("chat"), upd.author),
        h("span", { class: "one" }, upd.text)) : items.length > shown.length ? h("span", { class: "w-more" }, `+${items.length - shown.length} more`) : null);
  }

  function mail(w) {
    const m = dash()?.mail ?? [];
    if (!m.length) return empty("No mail needs you");
    const top = m[0];
    return h("button", { type: "button", class: "w-hit", onclick: () => open(top.url ?? "https://mail.google.com/", "Summarise the mail that needs me") },
      h("span", { class: "w-big" }, String(m.length), h("small", null, " need you")),
      h("span", { class: "w-title one" }, top.from),
      h("span", { class: w.size === "M" ? "w-sub clamp2" : "w-sub one" }, top.subject));
  }

  function language() {
    const l = dash()?.language;
    if (!l) return empty("No practice data yet");
    return h("div", { class: "w-col" },
      h("p", { class: "w-text clamp3" }, l.summary),
      h("button", { type: "button", class: "b-link w-action", onclick: () => ctx.ask("Start a short practice session with what's due") }, "Practise ›"));
  }

  // GitHub rows come from the helper (github.widget, cached ~5 min), not the dashboard.
  function github(w) {
    const g = s.github;
    if (!g.data) {
      if (g.error) return h("div", { class: "w-col" }, h("p", { class: "w-empty" }, /not connected/i.test(g.error) ? "GitHub isn't connected" : /switched GitHub off/i.test(g.error) ? "GitHub is off in Tools" : "Couldn't reach GitHub"),
        h("button", { type: "button", class: "b-link w-action", onclick: () => actions.go("tools") }, "Set up ›"));
      return loadingSkel();
    }
    const d = g.data;
    const why = r => (r.ci === "FAILURE" || r.ci === "ERROR" ? "CI failing" : r.review === "CHANGES_REQUESTED" ? "Changes requested" : r.conflict ? "Merge conflict" : "Needs you");
    const groups = [
      d.review.map(r => ({ ...r, tag: "Review", cls: "review" })),
      d.mine.map(r => ({ ...r, tag: why(r), cls: "mine" })),
      d.assigned.map(r => ({ ...r, tag: "Issue", cls: "issue" })),
    ];
    const total = groups.reduce((n, g2) => n + g2.length, 0);
    // Round-robin so each kind shows up even when one list is long.
    const rows = [];
    for (let i = 0; rows.length < total; i++) for (const g2 of groups) if (g2[i]) rows.push(g2[i]);
    const rowEl = r => h("button", { type: "button", class: ["w-gh-row", `k-${r.cls}`], title: `${r.repo}#${r.number} · ${r.title} · ${r.tag}`, onclick: () => open(r.url) },
      h("span", { class: "w-gh-dot", aria: { hidden: "true" } }),
      h("span", { class: "w-title one" }, r.title),
      h("span", { class: "w-gh-tag" }, r.tag));
    if (w.size === "S") {
      const need = (d.counts.review ?? 0) + (d.counts.mine ?? 0);
      return h("div", { class: "w-col w-gh" },
        h("span", { class: "w-big" }, String(need), h("small", null, " need you")),
        rows[0] ? h("button", { type: "button", class: "w-gh-text", title: `${rows[0].repo}#${rows[0].number} · ${rows[0].title}`, onclick: () => open(rows[0].url) }, h("span", { class: "w-title one" }, rows[0].title), h("span", { class: "w-sub" }, `${rows[0].tag} · ${rows[0].repo.split("/")[1]}`)) : empty("Nothing waiting on you"));
    }
    const counts = h("div", { class: "w-gh-counts" },
      [["review", "to review"], ["mine", "need you"], ["assigned", "assigned"]].map(([k, label]) => h("span", { class: ["w-gh-count", `c-${k}`, !d.counts[k] && "zero"] }, h("strong", null, String(d.counts[k] ?? 0)), ` ${label}`)));
    if (!rows.length) return h("div", { class: "w-col" }, counts, empty("Nothing waiting on you"));
    return h("div", { class: "w-col w-gh" }, counts, h("div", { class: "w-list tight" }, rows.slice(0, 3).map(rowEl)));
  }

  function clock(w) {
    const now = new Date();
    return h("div", { class: "w-col w-clock" },
      h("span", { class: "w-big huge" }, hm(now)),
      h("span", { class: "w-sub" }, now.toLocaleDateString(undefined, w.size === "M" ? { weekday: "long", day: "numeric", month: "long" } : { weekday: "short", day: "numeric", month: "short" })));
  }

  function chats(w) {
    const list = store.visibleConversations().slice(0, w.size === "M" ? 3 : 2);
    if (!list.length) return empty("No conversations here yet");
    return h("div", { class: "w-list" }, list.map(c => h("button", { type: "button", class: "w-chat", onclick: () => (inExtension ? openFullPage(`#conversation=${encodeURIComponent(c.id)}`) : actions.open(c.id)) },
      h("span", { class: "w-title one" }, c.title || "Untitled"),
      h("span", { class: "w-sub" }, relTime(c.updatedAt)))));
  }

  function links(w) {
    const list = load(LINKS_KEY, []);
    const favFor = url => s.tabs.find(t => hostOf(t.url) === hostOf(url))?.favIconUrl;
    const tiles = list.slice(0, 8).map((l, i) => h("span", { class: "w-link-wrap" },
      h("button", { type: "button", class: "w-link", title: l.title || l.url, onclick: () => !editing && open(l.url) },
        h("span", { class: "w-link-icon" }, favicon(l.url, l.favIconUrl ?? favFor(l.url))),
        h("span", { class: "w-link-name" }, (l.title || hostOf(l.url)).split(/[·|–—-]/)[0].trim().slice(0, 12))),
      editing ? h("button", { type: "button", class: "w-link-x", aria: { label: `Remove ${l.title || l.url}` }, onclick: () => { list.splice(i, 1); save(LINKS_KEY, list); render(); } }, icon("x")) : null));
    if (editing && list.length < 8) {
      const input = h("input", { type: "url", class: "w-link-input", placeholder: "Add a site…", aria: { label: "Add a site (URL)" } });
      const add = (url, title, fav) => {
        let u = url.trim();
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
        if (!isHttpUrl(u)) return;
        list.push({ url: u, title: title || hostOf(u), favIconUrl: fav });
        save(LINKS_KEY, list);
        render();
      };
      input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(input.value); } e.stopPropagation(); });
      const recent = s.tabs.filter(t => !list.some(l => hostOf(l.url) === hostOf(t.url))).slice(0, 2);
      return h("div", { class: "w-col" }, h("div", { class: "w-links" }, tiles),
        h("div", { class: "w-link-add" }, input, recent.map(t => h("button", { type: "button", class: "w-link-sugg", title: `Add ${t.title}`, onclick: () => add(t.url, t.title, t.favIconUrl) }, favicon(t.url, t.favIconUrl), "+"))));
    }
    if (!list.length) return empty("Edit widgets to add your sites");
    return h("div", { class: "w-links" }, tiles);
  }

  function note() {
    const area = h("textarea", { class: "w-note", placeholder: "Jot something down…", aria: { label: "Note" }, spellcheck: "true" });
    area.value = load(NOTE_KEY, "");
    let t = 0;
    area.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => save(NOTE_KEY, area.value), 300); });
    area.addEventListener("keydown", e => e.stopPropagation());
    return area;
  }

  function ask(w) {
    const list = (dash()?.suggestions ?? []).slice(0, w.size === "M" ? 3 : 2);
    if (!list.length) return empty("No suggestions yet");
    return h("div", { class: "w-list" }, list.map(t => h("button", { type: "button", class: "w-ask", onclick: () => ctx.ask(stripAsk(t)) }, icon("sparkle"), h("span", { class: "one" }, stripAsk(t)))));
  }

  const BODY = { next: nextUp, due: dueSoon, tasks: tasksBody, monday: mondayBody, mail, language, github, clock, chats, links, note, ask };

  // ---- rendering --------------------------------------------------------

  function tile(w, index) {
    const type = TYPES[w.type];
    const needsData = type.data && !dash();
    const body = needsData ? (s.dashboard.loading || !s.ready ? loadingSkel() : empty("Not available yet")) : BODY[w.type](w);
    const fetched = { github: s.github.data?.fetchedAt, tasks: s.tasks.data?.fetchedAt ?? dash()?.generatedAt, monday: s.monday.data?.fetchedAt }[w.type];
    const updated = type.data && dash()?.generatedAt ? `updated ${relTime(dash().generatedAt)}` : fetched ? `updated ${relTime(fetched)}` : "";
    const node = h("div", { class: ["widget", `wt-${w.type}`, `size-${w.size}`], role: "listitem", dataset: { id: w.id }, aria: { label: type.name } },
      h("div", { class: "w-head" }, h("span", { class: "w-label" }, type.name), updated ? h("span", { class: "w-updated" }, updated) : null),
      h("div", { class: "w-body" }, body));
    // Right-click a widget to edit the layout (text fields keep their own menu).
    node.addEventListener("contextmenu", e => {
      if (editing || e.target.closest?.("input, textarea") || !onEdit) return;
      e.preventDefault();
      onEdit();
    });
    if (editing) {
      const handle = h("button", { type: "button", class: "w-handle", title: "Drag to move (or use the arrow keys)", aria: { label: `Move ${type.name}, position ${index + 1} of ${layout.length}` } }, icon("grip"));
      handle.addEventListener("keydown", e => {
        const delta = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
        if (!delta) return;
        e.preventDefault();
        const j = index + delta;
        if (j < 0 || j >= layout.length) return;
        [layout[index], layout[j]] = [layout[j], layout[index]];
        persist();
        render();
        live.textContent = `${type.name} moved to position ${j + 1}`;
        grid.querySelector(`[data-id="${CSS.escape(w.id)}"] .w-handle`)?.focus();
      });
      handle.addEventListener("pointerdown", e => startDrag(e, node));
      node.append(h("div", { class: "w-tools" },
        handle,
        type.sizes.length > 1 ? h("button", { type: "button", class: "w-size", title: "Change size", aria: { label: `Size ${w.size === "M" ? "medium" : "small"}; switch to ${w.size === "M" ? "small" : "medium"}` }, onclick: () => { w.size = w.size === "M" ? "S" : "M"; persist(); render(); } }, w.size) : null,
        h("button", { type: "button", class: "w-remove", title: "Remove", aria: { label: `Remove ${type.name}` }, onclick: () => { layout = layout.filter(x => x.id !== w.id); persist(); render(); } }, icon("x"))));
    }
    return node;
  }

  // ---- keeping Tasks and monday fresh ----------------------------------
  // Open or visible page: ask for data at most a minute old; while visible, every
  // five minutes. The helper shares one cache between pages and refetches only
  // what's older than asked, so several open tabs don't multiply the load.
  const VISIBLE_MAX_AGE = 60_000;
  const PERIOD = 5 * 60_000;
  const ageOf = d => (d?.fetchedAt ? Date.now() - Date.parse(d.fetchedAt) : Infinity);
  function refreshFeeds(maxAge) {
    if (!s.ready || document.visibilityState === "hidden") return;
    const has = type => layout.some(w => w.type === type);
    // monday also feeds Tasks (items with a due date), so it loads for either widget; without a sign-in that costs no request.
    if (has("tasks") && !s.tasks.loading && ageOf(s.tasks.data) > maxAge && Date.now() - s.tasks.at > 10_000) actions.loadTasks(false, maxAge);
    if ((has("monday") || has("tasks")) && !s.monday.loading && ageOf(s.monday.data) > maxAge && Date.now() - s.monday.at > 10_000) actions.loadMonday(false, maxAge);
    if (has("github") && !s.github.loading && Date.now() - s.github.at > PERIOD) actions.loadGithub();
  }
  document.addEventListener("visibilitychange", () => refreshFeeds(VISIBLE_MAX_AGE));
  setInterval(() => refreshFeeds(PERIOD), 60_000);

  function render() {
    if (s.ready && (!s.tasks.at || !s.monday.at || !s.github.at)) refreshFeeds(VISIBLE_MAX_AGE); // first draw after the helper answered
    const nodes = layout.map((w, i) => tile(w, i));
    if (editing) nodes.push(h("button", { type: "button", class: "widget add-tile size-S", aria: { haspopup: "dialog", expanded: String(pickerOpen) }, onclick: () => togglePicker() }, icon("plus"), h("span", null, "Add widget")));
    clear(grid, nodes);
    // Tiles rise in once; redraws (clock ticks, new data) replace the nodes and
    // would replay it every time. A tile added in edit mode still rises in.
    if (grid.childElementCount) requestAnimationFrame(() => grid.classList.add("settled"));
    for (const n of grid.children) if (n.dataset.id && !seen.has(n.dataset.id)) { n.classList.add("fresh"); seen.add(n.dataset.id); n.addEventListener("animationend", () => n.classList.remove("fresh"), { once: true }); }
    el.classList.toggle("editing", editing);
    el.hidden = !editing && !layout.length;
    editLink.hidden = editing || !layout.length;
    renderPicker();
  }

  function renderPicker() {
    picker.hidden = !pickerOpen || !editing;
    if (picker.hidden) return;
    const used = new Set(layout.map(w => w.type));
    clear(picker,
      h("div", { class: "picker-head" }, "Add a widget", h("span", null, "Esc to close")),
      Object.entries(TYPES).map(([type, t]) => h("button", { type: "button", class: "wp-item", disabled: used.has(type), onclick: () => {
        layout.push({ id: `w-${type}-${Date.now().toString(36)}`, type, size: t.sizes[0] });
        persist();
        pickerOpen = false;
        render();
        grid.querySelector(".add-tile")?.focus();
      } }, h("span", { class: "wp-icon" }, icon(t.icon)), h("span", { class: "wp-text" }, h("strong", null, t.name), h("small", null, used.has(type) ? "Added" : t.desc)))));
    picker.querySelector(".wp-item:not(:disabled)")?.focus();
  }

  function togglePicker(v = !pickerOpen) { pickerOpen = v; render(); }
  picker.addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); togglePicker(false); grid.querySelector(".add-tile")?.focus(); }
    const items = [...picker.querySelectorAll(".wp-item:not(:disabled)")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  });

  // Drag to reorder: the tile moves in the DOM as the pointer passes others.
  let dragging = false;
  // Listeners live on window: moving the tile in the DOM drops pointer capture.
  function startDrag(e, node) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    node.classList.add("dragging");
    const move = ev => {
      const over = document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.classList?.contains("widget") && x !== node && !x.classList.contains("add-tile"));
      if (!over) return;
      const rect = over.getBoundingClientRect();
      const after = ev.clientX > rect.left + rect.width / 2;
      const ref = after ? over.nextSibling : over;
      if (ref !== node && ref !== node.nextSibling) grid.insertBefore(node, ref);
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      node.classList.remove("dragging");
      const order = [...grid.querySelectorAll(".widget[data-id]")].map(x => x.dataset.id);
      layout.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      persist();
      render();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function enterEdit() {
    if (!layout.length && !Array.isArray(s.settings?.homeWidgets) && load(LAYOUT_KEY, null) == null) {
      layout = DEFAULT_LAYOUT.map(w => ({ ...w }));
      persist();
    }
    editing = true;
    render();
    if (!s.dashboard.data && !s.dashboard.loading) actions.refreshDashboard();
  }

  function exitEdit() {
    editing = false;
    pickerOpen = false;
    render();
  }

  // Clock ticks; dashboard-bound widgets re-render on data.
  const typingInside = () => !!document.activeElement?.closest?.(".widgets-wrap input, .widgets-wrap textarea");
  setInterval(() => { if (layout.some(w => w.type === "clock") && !editing && el.isConnected && !typingInside()) render(); }, 15_000);

  render();
  return {
    el,
    get editing() { return editing; },
    get count() { return layout.length; },
    enterEdit,
    exitEdit,
    update(topics) {
      if (topics.has("settings") || topics.has("state")) {
        const next = readLayout();
        if (JSON.stringify(next) !== JSON.stringify(layout) && Array.isArray(s.settings?.homeWidgets)) layout = next;
        addTasksOnce();
      }
      if (topics.has("tasks")) noteAdded(s.tasks.added);
      if (topics.has("monday")) noteAdded(s.monday.added);
      if ((topics.has("tasks") && s.tasks.added?.length) || (topics.has("monday") && s.monday.added?.length)) setTimeout(() => { if (!typingInside() && !dragging) render(); }, FLASH_MS + 50); // drop the flash style once it has played
      if (["dashboard", "settings", "state", "conversations", "space", "tabs", "github", "tasks", "monday"].some(t => topics.has(t))) {
        if (!typingInside() && !dragging) render();
      }
    },
  };
}
