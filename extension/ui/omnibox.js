// One box for search and chat (new-tab page): as the user types, suggest opening a
// URL, searching with the default engine, switching to an open tab, opening a
// bookmark or history entry, or asking Ensō. Uses the extension APIs directly
// (tabs, bookmarks, history, search, windows); the mock fakes them.

import { getBrowserApi } from "./transport.js";

const QUESTION = /^(who|what|when|where|why|which|how|can|could|should|would|will|is|are|am|do|does|did|was|were|explain|summar|tell|help|write|draft|compare|give|make|translate|quiz|plan|find me|show me)\b/i;
const TLD = /\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i;

export function looksLikeUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^https?:\/\//i.test(t) || /^about:|^file:\/\//i.test(t)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(t) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return true;
  return /^[\w-]+(\.[\w-]+)+/.test(t) && TLD.test(t);
}

export function normalizeUrl(text) {
  const t = text.trim();
  if (/^[a-z][\w+.-]*:/i.test(t) && !/^localhost:/i.test(t)) return t;
  return `${/^localhost|^\d{1,3}(\.\d{1,3}){3}/i.test(t) ? "http" : "https"}://${t}`;
}

export function looksLikeQuestion(text) {
  const t = text.trim();
  return t.endsWith("?") || QUESTION.test(t) || t.split(/\s+/).length > 6;
}

/** Glob patterns from state.sensitiveHosts ("*.bank*", "bankieren.*") → matcher. */
export function sensitiveMatcher(patterns = []) {
  const res = patterns.map(p => new RegExp(`^${String(p).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i"));
  return url => {
    let host = "";
    try { host = new URL(url).hostname; } catch { return false; }
    return res.some(re => re.test(host));
  };
}

const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const pathOf = url => { try { const u = new URL(url); return (u.hostname.replace(/^www\./, "") + u.pathname + u.search).replace(/\/$/, ""); } catch { return url; } };

/**
 * Local suggestions (tabs, bookmarks, history): instant, no network, never the host.
 * → { matches, completion } where completion is { text, row } when the typed text
 * is a prefix of a known URL (shown inline, with the completed part selected).
 */
export async function localSuggestions(text, { sensitive = () => false } = {}) {
  const q = text.trim();
  if (!q) return { matches: [], completion: null };
  const api = await getBrowserApi();
  const lower = q.toLowerCase();
  const [tabs, bookmarks, history] = await Promise.all([
    api.tabs().catch(() => []),
    q.length >= 2 ? api.bookmarks(q).catch(() => []) : [],
    api.history(q).catch(() => []),
  ]);
  const favs = new Map(); // host → favicon from open tabs
  for (const t of tabs) if (t.favIconUrl) favs.set(hostOf(t.url), t.favIconUrl);
  const seen = new Set();
  const matches = [];
  const add = (kind, item) => {
    if (!item.url || !/^https?:/i.test(item.url) || sensitive(item.url)) return;
    const key = item.url.replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    matches.push({ kind, label: item.title || hostOf(item.url), sub: pathOf(item.url), url: item.url, tabId: item.tabId, windowId: item.windowId, favIconUrl: item.favIconUrl ?? favs.get(hostOf(item.url)), score: score(item, lower, kind) });
  };
  for (const t of tabs) if (`${t.title} ${t.url}`.toLowerCase().includes(lower)) add("tab", t);
  for (const b of bookmarks) add("bookmark", b);
  for (const hItem of history) add("history", hItem);
  matches.sort((x, y) => y.score - x.score);

  let completion = null;
  if (!/\s/.test(q)) {
    for (const m of matches) {
      if (m.kind === "tab") continue;
      const p = pathOf(m.url);
      if (p.toLowerCase().startsWith(lower) && p.length > q.length) { completion = { text: p, row: { ...m, kind: "site" } }; break; }
    }
  }
  return { matches, completion };
}

/** The default search engine: { name, suggest: "google" | "duckduckgo" | null }. */
export async function engineInfo() {
  const api = await getBrowserApi();
  const name = (await api.engine().catch(() => null)) ?? "Search";
  const suggest = /google/i.test(name) ? "google" : /duckduckgo/i.test(name) ? "duckduckgo" : null;
  return { name, suggest };
}

/** Search-engine suggestions; abortable. Network goes straight to the engine, never the host. */
export async function engineSuggestions(text, engine, signal) {
  const api = await getBrowserApi();
  if (!engine?.suggest || !text.trim()) return [];
  return api.suggestions(text.trim(), engine.suggest, signal).catch(() => []);
}

/**
 * Build the rows. Order when not URL-like: search, chat, local matches, engine suggestions.
 * URL-like: the inline-completed site (or "Open …"), search, then matches, chat.
 */
export function buildRows(text, { matches = [], completion = null, suggestions = [], engineName = "Search", max = 7 }) {
  const q = text.trim();
  if (!q) return [];
  const search = { kind: "search", label: q, sub: engineName, query: q };
  const chat = { kind: "ask", label: q, sub: "Chat" };
  const others = matches.filter(m => m.url !== completion?.row.url);
  let rows;
  if (completion) rows = [completion.row, search, ...others.slice(0, 3), chat];
  else if (looksLikeUrl(q)) rows = [{ kind: "open", label: `Open ${q.replace(/^https?:\/\//i, "")}`, url: normalizeUrl(q) }, search, ...others.slice(0, 3), chat];
  else {
    const local = others.slice(0, suggestions.length ? 2 : 4);
    const sugg = suggestions.filter(x => x.toLowerCase() !== q.toLowerCase()).map(x => ({ kind: "suggest", label: x, query: x, typed: q }));
    rows = [search, chat, ...local, ...sugg];
  }
  return rows.slice(0, max);
}

/** Which row starts selected: the site/open row, Chat for clear asks, else search. */
export function initialIndex(rows, text) {
  if (!rows.length) return 0;
  if (rows[0].kind === "site" || rows[0].kind === "open") return 0;
  const t = text.trim();
  const ask = t.endsWith("?") || t.split(/\s+/).length > 6 || /^(explain|summar|tell me|help me|draft|write|translate|compare|quiz me|plan)\b/i.test(t);
  const i = rows.findIndex(r => r.kind === "ask");
  return ask && i >= 0 ? i : 0;
}

function score(item, q, kind) {
  const host = hostOf(item.url).toLowerCase();
  const title = (item.title ?? "").toLowerCase();
  let s = { tab: 30, bookmark: 20, history: 10 }[kind] ?? 0;
  if (host.startsWith(q)) s += 50;
  else if (host.includes(q)) s += 25;
  if (title.startsWith(q)) s += 20;
  else if (title.includes(q)) s += 10;
  s += Math.min(15, (item.visitCount ?? 0) / 4);
  return s;
}

/** Run a non-ask row directly in the browser (instant; never through the host). */
export async function runRow(row, text) {
  const api = await getBrowserApi();
  if (row.kind === "open" || row.kind === "site" || row.kind === "bookmark" || row.kind === "history") return api.open(row.url);
  if (row.kind === "search" || row.kind === "suggest") return api.search(row.query ?? text.trim());
  if (row.kind === "tab") return api.switchTo(row.tabId, row.windowId);
}
