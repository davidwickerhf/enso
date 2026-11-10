// monday.com for the new-tab widget: what's on the user's plate, fetched
// directly from monday's hosted MCP server (https://mcp.monday.com/mcp, the
// "monday" OAuth server from the Tools page), cached like lib/tasks.mjs.
//
// monday's MCP has no "my work" tool, so this asks per board (tool names and
// output shapes from github.com/mondaycom/mcp, packages/agent-toolkit,
// commit 4299b7a; see docs/PROTOCOL.md → monday.widget):
//   get_user_context        who I am, my favourite and most relevant boards
//   get_board_schema        each board's columns (cached an hour): which are people, status, date
//   get_board_items_page    items on that board whose people column is "assigned_to_me"
//   get_updates             recent updates on those items (who wrote what; mentions are plain text)
// Results arrive as JSON (structuredContent, and the same JSON as text).
//
// Widget data: { state: "ok", user, items, updates, boards, fetchedAt }
//            | { state: "not-connected", reason, fetchedAt }
//            | { state: "error", kind: "server"|"auth"|"network"|"tools", error, fetchedAt }
// Item:   { id, title, url?, board, boardId, status?, due?, group?, updatedAt? }
// Update: { id, itemId, item?, url?, author, text, at, mention }

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { friendly } from "./connections.mjs";
import { sortTasks, toolPayload } from "./tasks.mjs";

const TTL = 5 * 60_000;
const SCHEMA_TTL = 60 * 60_000;
const MAX_BOARDS = 6;
const MAX_ITEMS = 40;
const MAX_UPDATES = 8;
const UPDATE_DAYS = 14;
const DONE = /^(done|completed?|closed|finished|shipped|resolved|cancel+ed|won't do|wont do|erledigt|klaar|fait)$/i;

const str = v => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const httpUrl = v => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : undefined);
const obj = v => (v && typeof v === "object" && !Array.isArray(v) ? v : null);

/** get_user_context → { user: { id, name }, boards: [{ id, name }] } (favourite boards first, then relevant ones). */
export function parseUserContext(result) {
  if (result?.isError) throw new Error(String(toolPayload(result) ?? "get_user_context failed"));
  const d = toolPayload(result);
  if (typeof d === "string") throw new Error(d.slice(0, 200)); // "AUTHENTICATION_ERROR: Unable to fetch current user…"
  const user = obj(d?.user);
  if (!user?.id) throw new Error("monday.com didn't say who you are.");
  const boards = [];
  const seen = new Set();
  const add = (id, name) => {
    const key = str(id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    boards.push({ id: key, name: str(name) ?? `Board ${key}` });
  };
  for (const f of Array.isArray(d.favorites) ? d.favorites : []) if (/^board$/i.test(String(f?.type ?? ""))) add(f.id, f.name);
  for (const b of Array.isArray(d.relevantBoards) ? d.relevantBoards : []) add(b?.id, b?.name);
  return { user: { id: str(user.id), name: str(user.name) ?? "" }, boards };
}

/**
 * get_board_schema (or get_board_info) → the columns the widget reads:
 * { people: [ids], status?: id, date?: id }. Status and date prefer columns
 * titled like "Status" / "Due date" when a board has several.
 */
export function pickColumns(result) {
  const d = toolPayload(result);
  const cols = (Array.isArray(d?.columns) ? d.columns : []).filter(c => c?.id && c?.type);
  const ofType = re => cols.filter(c => re.test(String(c.type)));
  const prefer = (list, re) => (list.find(c => re.test(String(c.title ?? ""))) ?? list[0])?.id;
  const people = ofType(/^(people|multiple-person|person)$/i).map(c => c.id);
  const status = prefer(ofType(/^(status|color)$/i), /^status$/i);
  const date = prefer(ofType(/^date$/i), /due|deadline/i) ?? prefer(ofType(/^timeline$/i), /due|deadline|timeline/i);
  return { people, ...(status ? { status } : {}), ...(date ? { date } : {}) };
}

/** The get_board_items_page arguments for "items assigned to me" on one board. */
export function itemsCall(boardId, cols, limit = 25) {
  return {
    boardId: Number(boardId),
    includeColumns: true,
    columnIds: [...cols.people, cols.status, cols.date].filter(Boolean),
    filters: cols.people.map(columnId => ({ columnId, compareValue: ["assigned_to_me"], operator: "any_of" })),
    filtersOperator: "or",
    limit,
  };
}

/**
 * A date column value as the widget wants it: "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM".
 * column_values hold the column's text ("2026-11-12", "2026-11-12 17:00"), or the
 * parsed JSON value ({ date, time }) when the text was empty; a timeline
 * ("2026-11-10 - 2026-11-14", { from, to }) counts by its end.
 */
export function mondayDate(v) {
  if (v == null) return undefined;
  if (typeof v === "object") return mondayDate(v.to ?? (v.date ? `${v.date}${v.time ? ` ${v.time}` : ""}` : undefined));
  const s = String(v).trim();
  const range = /(\d{4}-\d{2}-\d{2})\s+-\s+(\d{4}-\d{2}-\d{2})/.exec(s);
  if (range) return range[2];
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(s);
  if (!m) return undefined;
  return m[2] && m[2] !== "00:00" ? `${m[1]}T${m[2]}` : m[1];
}

/** get_board_items_page → open items: { id, title, url, board, boardId, status?, due?, group?, updatedAt? }. */
export function normaliseItems(result, { board, cols }) {
  if (result?.isError) throw new Error(String(toolPayload(result) ?? "get_board_items_page failed").slice(0, 200));
  const d = toolPayload(result);
  if (!d || typeof d !== "object") return []; // "No items found…"
  const boardName = str(d.board?.name) ?? board?.name ?? "";
  const boardId = str(d.board?.id) ?? board?.id ?? "";
  const out = [];
  for (const it of Array.isArray(d.items) ? d.items : []) {
    const id = str(it?.id);
    const title = str(it?.name);
    if (!id || !title) continue;
    const cv = obj(it.column_values) ?? {};
    const status = cols.status ? str(typeof cv[cols.status] === "object" ? cv[cols.status]?.label ?? cv[cols.status]?.text : cv[cols.status]) : undefined;
    if (status && DONE.test(status)) continue;
    const item = { id, title: title.slice(0, 240), board: boardName, boardId };
    const url = httpUrl(it.url);
    if (url) item.url = url;
    if (status) item.status = status;
    const due = cols.date ? mondayDate(cv[cols.date]) : undefined;
    if (due) item.due = due;
    if (str(it.group?.title)) item.group = str(it.group.title);
    if (str(it.updated_at)) item.updatedAt = str(it.updated_at);
    out.push(item);
  }
  return out;
}

/**
 * get_updates (objectType "Item") → the latest updates written by someone else,
 * newest first. mention: the text names me ("@Dana …"); monday's MCP has no
 * notifications or structured mentions.
 */
export function normaliseUpdates(result, { me, items = [], now = Date.now(), days = UPDATE_DAYS } = {}) {
  if (!result || result.isError) return [];
  const d = toolPayload(result);
  if (!d || typeof d !== "object") return [];
  const byId = new Map(items.map(i => [i.id, i]));
  const since = now - days * 86_400_000;
  const out = [];
  for (const group of Array.isArray(d.items) ? d.items : []) {
    for (const u of Array.isArray(group?.updates) ? group.updates : []) {
      const author = obj(u?.creator);
      const at = str(u?.created_at);
      if (!str(u?.id) || !at || (me?.id && str(author?.id) === me.id)) continue;
      if (!(Date.parse(at) >= since)) continue;
      const itemId = str(u.item_id) ?? str(group.item_id);
      const text = String(u.text_body ?? "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const item = byId.get(itemId);
      const first = me?.name?.split(/\s+/)[0];
      out.push({
        id: str(u.id),
        itemId,
        ...(item ? { item: item.title } : {}),
        ...(httpUrl(group.url) ?? item?.url ? { url: httpUrl(group.url) ?? item?.url } : {}),
        author: str(author?.name) ?? "Someone",
        text: text.slice(0, 200),
        at,
        mention: !!me?.name && (text.includes(`@${me.name}`) || (!!first && new RegExp(`@${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text))),
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, MAX_UPDATES);
}

/** monday items with a due date, as Tasks-widget rows (source "monday.com"; ticking only hides them). */
export function mondayTasks(items, server = "monday") {
  return items.filter(i => i.due).map(i => ({ id: `monday:${i.id}`, title: i.title, due: i.due, ...(i.url ? { url: i.url } : {}), source: "monday.com", server, completable: false }));
}

/** An error as the widget says it: { kind, error } with a short, readable text (never an HTML page). */
export function classifyError(err) {
  const raw = `${Number.isInteger(err?.code) ? `HTTP ${err.code} ` : ""}${String(err?.message ?? err ?? "")}`;
  const text = friendly(err);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ECONNRESET|timed out/i.test(raw)) return { kind: "network", error: "Couldn't reach monday.com." };
  if (/\b401\b|unauthori[sz]ed|invalid_token|AUTHENTICATION_ERROR/i.test(raw)) return { kind: "auth", error: "monday.com wants you to sign in again." };
  if (/\b5\d\d\b|<html|<!doctype|internal server error|bad gateway|service unavailable/i.test(raw)) return { kind: "server", error: "monday.com isn't responding (server error)." };
  return { kind: "server", error: text };
}

async function httpConnect(def) {
  const client = new Client({ name: "enso", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers: def.headers ?? {} } }));
  return client;
}

/**
 * target() → { state: "connected", name, def: { url, headers } } or
 *            { state: "not-connected", reason } (missing | off | disconnected | expired | connecting | error | claude.ai).
 * connect(def) → MCP client (tests pass a fake).
 */
export function createMondaySource({ target, connect = httpConnect, log = () => {}, ttl = TTL, now = () => Date.now() }) {
  let cache = null;
  let inflight = null;
  const schemas = new Map(); // boardId -> { cols, at }

  const call = async (client, name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r?.isError) throw new Error(String(toolPayload(r) ?? `${name} failed`).slice(0, 300));
    return r;
  };

  async function columnsFor(client, tools, board) {
    const hit = schemas.get(board.id);
    if (hit && now() - hit.at < SCHEMA_TTL) return hit.cols;
    const r = tools.has("get_board_schema")
      ? await call(client, "get_board_schema", { boardId: Number(board.id) })
      : await call(client, "get_board_info", { boardId: Number(board.id), filters: { columns: { only: true } } });
    const cols = pickColumns(r);
    schemas.set(board.id, { cols, at: now() });
    return cols;
  }

  async function fetchAll(def) {
    const client = await connect(def);
    try {
      const tools = new Set((await client.listTools()).tools.map(t => t.name));
      if (!tools.has("get_user_context") || !tools.has("get_board_items_page") || !(tools.has("get_board_schema") || tools.has("get_board_info"))) {
        return { state: "error", kind: "tools", error: "monday.com's server doesn't offer the tools this widget reads." };
      }
      const { user, boards } = parseUserContext(await client.callTool({ name: "get_user_context", arguments: {} }));
      const picked = boards.slice(0, MAX_BOARDS);
      const perBoard = await Promise.all(
        picked.map(async board => {
          try {
            const cols = await columnsFor(client, tools, board);
            if (!cols.people.length) return [];
            return normaliseItems(await call(client, "get_board_items_page", itemsCall(board.id, cols)), { board, cols });
          } catch (err) {
            log(`monday: board ${board.id} skipped (${friendly(err)})`);
            if (classifyError(err).kind !== "server" || /\b5\d\d\b|<html/i.test(`${err.code ?? ""} ${err.message}`)) throw err; // the whole server is down, not one board
            return [];
          }
        }),
      );
      const items = sortTasks(perBoard.flat(), new Date(now())).slice(0, MAX_ITEMS);
      let updates = [];
      if (tools.has("get_updates") && items.length) {
        const recent = [...items].sort((a, b) => Date.parse(b.updatedAt ?? 0) - Date.parse(a.updatedAt ?? 0)).slice(0, 25);
        const r = await client.callTool({ name: "get_updates", arguments: { objectIds: recent.map(i => i.id), objectType: "Item", limit: 3 } }).catch(err => (log(`monday: updates unavailable (${friendly(err)})`), null));
        updates = normaliseUpdates(r, { me: user, items, now: now() });
      }
      return { state: "ok", user, items, updates, boards: picked.map(b => ({ id: b.id, name: b.name })) };
    } finally {
      client.close?.().catch?.(() => {});
    }
  }

  async function load() {
    const t = await target();
    const fetchedAt = new Date(now()).toISOString();
    if (t.state !== "connected") return { state: "not-connected", reason: t.reason ?? "missing", fetchedAt };
    try {
      return { ...(await fetchAll(t.def)), fetchedAt };
    } catch (err) {
      const e = classifyError(err);
      log(`monday: widget failed (${friendly(err)})`);
      return { state: "error", ...e, fetchedAt };
    }
  }

  /** Widget data (see the top of this file), cached for ttl; maxAge and fresh as in tasks.widget. */
  function widget({ fresh = false, maxAge = ttl } = {}) {
    const age = cache ? now() - Date.parse(cache.fetchedAt) : Infinity;
    // Errors are kept for a minute only, so Retry and the next page visit try again.
    const limit = cache?.state === "ok" ? Math.min(ttl, Math.max(15_000, maxAge)) : 60_000;
    if (!fresh && age < limit) return Promise.resolve(cache);
    inflight ??= load()
      .then(data => (cache = data))
      .finally(() => (inflight = null));
    return inflight;
  }

  function invalidate() {
    cache = null;
  }

  /** After a write to monday: refetch and say which items are new. { data, added: ["monday:<id>"] } */
  async function refreshAfterWrite() {
    const before = cache?.state === "ok" ? new Set(cache.items.map(i => i.id)) : null;
    await inflight?.catch(() => {});
    invalidate();
    const data = await widget({ fresh: true });
    const added = before && data.state === "ok" ? data.items.filter(i => !before.has(i.id)).map(i => `monday:${i.id}`) : [];
    return { data, added };
  }

  return { widget, invalidate, refreshAfterWrite, get cached() { return cache; } };
}
