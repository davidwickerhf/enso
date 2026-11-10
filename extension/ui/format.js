// Formatting helpers: times, hosts, tool labels.

const DAY = 86_400_000;

function toDate(value) {
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** "just now", "5 min ago", "2 h ago", "Yesterday", "Mon", "3 Oct". */
export function relTime(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return "";
  const diff = now - d;
  if (diff < 45_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))} min ago`;
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return `${Math.round(diff / 3_600_000)} h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** Clock time for ISO strings; passes through strings like "14:00" or "Fri". */
export function clock(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && !/\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const d = toDate(value);
  return d ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : String(value);
}

/** Due dates: "Today", "Tomorrow", "in 3 days", "Fri 14 Nov"; passes through free text. */
export function due(value, now = new Date()) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && !/\d{4}-\d{2}-\d{2}/.test(value)) return value;
  const d = toDate(value);
  if (!d) return String(value);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / DAY);
  const hasTime = typeof value === "string" && value.includes("T");
  const time = hasTime ? ` ${clock(d)}` : "";
  if (days < 0) return `Overdue · ${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  if (days === 0) return `Today${time}`;
  if (days === 1) return `Tomorrow${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: "long" })}${time}`;
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function isSoon(value, now = new Date()) {
  const d = typeof value === "string" && /\d{4}-\d{2}-\d{2}/.test(value) ? toDate(value) : null;
  return !!d && d - now < 2 * DAY;
}

export function dayLabel(value, now = new Date()) {
  const d = toDate(value);
  if (!d) return "Earlier";
  const days = Math.round((startOfDay(now) - startOfDay(d)) / DAY);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This week";
  if (days < 31) return "This month";
  return "Earlier";
}

export function fullDate(value) {
  const d = toDate(value);
  return d ? d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function duration(ms) {
  if (ms == null || Number.isNaN(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function plural(n, word, pluralWord = `${word}s`) {
  return `${n} ${n === 1 ? word : pluralWord}`;
}

export function compactNumber(n) {
  if (n == null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

const PAST = {
  search: "Searched", read: "Read", get: "Got", list: "Listed", fetch: "Fetched", find: "Found",
  open: "Opened", click: "Clicked", type: "Typed", select: "Selected", press: "Pressed",
  scroll: "Scrolled", navigate: "Navigated", go: "Went", take: "Took", send: "Sent",
  create: "Created", draft: "Drafted", update: "Updated", delete: "Deleted", save: "Saved",
  check: "Checked", look: "Looked", recall: "Recalled", remember: "Remembered", write: "Wrote",
  reply: "Replied", forward: "Forwarded", label: "Labelled", add: "Added", remove: "Removed",
  move: "Moved", snapshot: "Read", screenshot: "Captured", summarise: "Summarised", query: "Queried",
  download: "Downloaded", plan: "Planned", mark: "Marked", sync: "Synced", run: "Ran", use: "Used",
};

/** "Search Gmail" → "Searched Gmail" once the step is done. */
export function pastTense(title) {
  if (!title) return "";
  const m = title.match(/^(\w+)(.*)$/s);
  if (!m) return title;
  const past = PAST[m[1].toLowerCase()];
  return past ? past + m[2] : title;
}

/** Best-effort result count from a tool preview string. */
export function resultCount(preview) {
  if (!preview || typeof preview !== "string") return null;
  const text = preview.trim();
  const m = text.match(/^(?:found\s+)?(\d+)\s+(results?|items?|threads?|messages?|emails?|events?|files?|matches?|entries|entry|words?|steps?|reviews?)\b/i);
  if (m) return `${m[1]} ${m[2].toLowerCase()}`;
  if (text.startsWith("[")) {
    try {
      const arr = JSON.parse(text);
      if (Array.isArray(arr)) return plural(arr.length, "result");
    } catch { /* truncated preview */ }
  }
  return null;
}

const ACTION_PAST = { click: "Clicked", type: "Typed into", select: "Selected", press: "Pressed", scroll: "Scrolled", navigate: "Opened", back: "Went back on", snapshot: "Read", screenshot: "Captured", eval: "Ran", note: "Sent", session_fetch: "Requested", storage: "Read storage of" };

/** 'Clicked "Submit" on example.com' */
export function describeAction(action, target, url) {
  const verb = ACTION_PAST[action] ?? (action ? action[0].toUpperCase() + action.slice(1) : "Acted on");
  const host = hostOf(url);
  if (action === "navigate") return `${verb} ${host || target || "a page"}`;
  const what = target ? ` ${quoteTarget(target)}` : "";
  return `${verb}${what}${host ? ` on ${host}` : ""}`;
}

function quoteTarget(target) {
  const t = String(target).trim();
  if (/^["“].*["”]$/.test(t)) return t;
  return t.length > 48 ? `“${t.slice(0, 46)}…”` : `“${t}”`;
}

export function actionIcon(action) {
  return { click: "cursor", type: "keyboard", select: "cursor", press: "keyboard", navigate: "compass", back: "arrowLeft", scroll: "chevronDown", snapshot: "page", screenshot: "page", eval: "command", note: "chat", session_fetch: "globe" }[action] ?? "cursor";
}

export function stripAsk(s) {
  return String(s).replace(/^\s*ask:\s*/i, "");
}
