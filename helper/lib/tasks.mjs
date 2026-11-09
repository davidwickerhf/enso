// Tasks from task apps (Commonfold, or any MCP server with a `list_tasks`
// tool) for the new-tab Tasks widget, fetched directly instead of through the
// dashboard's agent run: connect, list, normalise, cache ~5 minutes.
//
// Only servers the helper can call itself are used (remote http servers with
// their headers, e.g. the OAuth servers in lib/connections.mjs). claude.ai
// connectors (Notion, Todoist…) only reach the dashboard run; their tasks come
// in through dashboard.tasks instead.
//
// Normalised task: { id, title, due?, url?, source, server, done?, space?, completable }

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TTL = 5 * 60_000;
const MAX = 60;
// Views worth showing as "open": Commonfold's today (incl. overdue), upcoming, inbox, anytime.
const OPEN_VIEWS = ["today", "upcoming", "inbox", "anytime"];
const COMPLETE_TOOLS = ["complete_task", "close_task", "update_task"];

const str = v => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const httpUrl = v => (typeof v === "string" && /^https?:\/\//i.test(v) ? v : undefined);

/** A tool result's payload: structuredContent, else the JSON in its text, else the text. */
export function toolPayload(result) {
  if (result?.structuredContent != null) return result.structuredContent;
  const text = (result?.content ?? []).filter(c => c?.type === "text").map(c => c.text).join("\n").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function findArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return null;
  for (const k of ["tasks", "items", "todos", "results", "data", "issues"]) {
    if (Array.isArray(data[k])) return data[k];
    if (data[k] && typeof data[k] === "object") {
      const inner = findArray(data[k]);
      if (inner) return inner;
    }
  }
  return null;
}

function dueOf(x) {
  const d = x.dueDate ?? x.due_date ?? x.due_on ?? x.dueOn ?? x.deadline ?? x.due;
  if (d && typeof d === "object") return str(d.datetime ?? d.date ?? d.string);
  return str(d);
}

function isDone(x) {
  const state = String(x.state ?? x.status ?? "").toLowerCase();
  return /^(done|completed?|closed|cancel+ed|resolved)$/.test(state) || x.completed === true || x.checked === true || x.is_completed === true || x.done === true || !!x.completedAt || !!x.completed_at;
}

/** Text output: one task per bullet or checkbox line ("- [ ] Pay rent (due 2026-11-12)"). */
function fromText(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[( |x|X)\]\s*)?(.+?)\s*$/.exec(line);
    if (!m) continue;
    const due = /\b(\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?)\b/.exec(m[2])?.[1];
    const url = /(https?:\/\/\S+)/.exec(m[2])?.[1];
    const title = m[2].replace(/\(?\s*(?:due:?\s*)?\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\s*\)?/i, "").replace(/\s*<?https?:\/\/\S+>?/, "").replace(/\s+[-–—·|]\s*$/, "").trim();
    if (title) out.push({ title, due, url, done: /x/i.test(m[1] ?? "") });
  }
  return out;
}

/**
 * Normalise one list_tasks result. JSON (Commonfold: { space, view, truncated,
 * tasks: [{ id, title, state, dueDate, url, completedAt, … }] }) or other
 * common shapes (Todoist, Linear, Things-like); free text falls back to bullets,
 * which can be shown but not completed (no id).
 */
export function normaliseTasks(result, { server, source }) {
  if (result?.isError) return [];
  const data = toolPayload(result);
  const space = data && typeof data === "object" && !Array.isArray(data) ? str(data.space?.id ?? data.space?.slug ?? data.space) : undefined;
  const list = findArray(data);
  const rows = list
    ? list
        .filter(x => x && typeof x === "object")
        .map(x => ({ id: str(x.id ?? x.uuid ?? x.gid ?? x.key), title: str(x.title ?? x.name ?? x.content ?? x.summary ?? x.text), due: dueOf(x), url: httpUrl(x.url ?? x.webUrl ?? x.web_url ?? x.html_url ?? x.permalink ?? x.link), done: isDone(x) }))
    : typeof data === "string"
      ? fromText(data)
      : [];
  return rows
    .filter(r => r.title)
    .map(r => {
      const t = { id: r.id ?? `text:${r.title.toLowerCase()}`, title: r.title.slice(0, 240), source, server, completable: !!r.id };
      if (r.due) t.due = r.due;
      if (r.url) t.url = r.url;
      if (r.done) t.done = true;
      if (space) t.space = space;
      return t;
    });
}

/** Spaces from list_spaces ({ spaces: [{ id, slug }] } or an array): their ids. */
export function parseSpaces(result) {
  const d = toolPayload(result);
  const list = Array.isArray(d?.spaces) ? d.spaces : (findArray(d) ?? []);
  return list.map(s => str(s?.id ?? s?.slug)).filter(Boolean);
}

/** The list_tasks calls to make, from its input schema: each open view, per space when there are several. */
export function listCalls(schema, { today, spaces = [] } = {}) {
  const props = schema?.properties ?? {};
  const base = {};
  if (props.today && today) base.today = today;
  const viewEnum = props.view?.enum ?? [];
  const views = OPEN_VIEWS.filter(v => viewEnum.includes(v));
  const perView = views.length ? views.map(view => ({ ...base, view })) : [base];
  if (!props.space || spaces.length < 2) return perView;
  return spaces.flatMap(space => perView.map(args => ({ ...args, space })));
}

/** Which tool completes a task and with what arguments, from the server's tool list; null if none fits. */
export function completeCall(tools, task) {
  for (const name of COMPLETE_TOOLS) {
    const tool = tools.find(t => t.name === name);
    if (!tool) continue;
    const props = tool.inputSchema?.properties ?? {};
    const idKey = ["id", "task_id", "taskId"].find(k => props[k]) ?? "id";
    const args = { [idKey]: task.id };
    if (props.space && task.space) args.space = task.space;
    if (name !== "update_task") return { name, arguments: args };
    const stateEnum = props.state?.enum ?? props.status?.enum;
    const doneWord = stateEnum?.find(v => /^(done|completed?)$/i.test(v));
    if (doneWord) args[props.state ? "state" : "status"] = doneWord;
    else if (props.completed) args.completed = true;
    else if (props.done) args.done = true;
    else if (props.checked) args.checked = true;
    else continue;
    return { name, arguments: args };
  }
  return null;
}

const dueTime = t => (t.due && /^\d{4}-\d{2}-\d{2}/.test(t.due) ? Date.parse(t.due) || 9e15 : 9e15);

/** Open tasks, deduplicated per server, dated first. */
export function mergeTasks(lists) {
  const seen = new Set();
  const out = [];
  for (const t of lists.flat()) {
    const key = `${t.server}|${t.id}`;
    if (t.done || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => dueTime(a) - dueTime(b) || a.title.localeCompare(b.title)).slice(0, MAX);
}

async function httpConnect(def) {
  const client = new Client({ name: "enso", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers: def.headers ?? {} } }));
  return client;
}

const localDate = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in the Mac's time zone

/**
 * candidates() → [{ name, label, def: { url, headers } }]: enabled, connected
 * servers whose tools include list_tasks. connect(def) → MCP client (tests pass a fake).
 */
export function createTaskSources({ candidates, connect = httpConnect, log = () => {}, ttl = TTL, today = localDate }) {
  let cache = null; // { tasks, servers, fetchedAt }
  let inflight = null;

  async function withClient(def, fn) {
    const client = await connect(def);
    try {
      return await fn(client);
    } finally {
      client.close?.().catch?.(() => {});
    }
  }

  async function fromServer({ name, label, def }) {
    return withClient(def, async client => {
      const { tools } = await client.listTools();
      const list = tools.find(t => t.name === "list_tasks");
      if (!list) return [];
      let spaces = [];
      if (list.inputSchema?.properties?.space && tools.some(t => t.name === "list_spaces")) spaces = parseSpaces(await client.callTool({ name: "list_spaces", arguments: {} }).catch(() => null));
      const calls = listCalls(list.inputSchema, { today: today(), spaces });
      const results = await Promise.all(calls.map(args => client.callTool({ name: "list_tasks", arguments: args }).catch(err => (log(`${name}: list_tasks failed (${err.message})`), null))));
      if (results.every(r => !r || r.isError)) throw new Error(String(toolPayload(results.find(Boolean)) ?? "list_tasks failed").slice(0, 200));
      return results.map(r => normaliseTasks(r, { server: name, source: label ?? name }));
    });
  }

  async function load() {
    const list = await candidates();
    const settled = await Promise.allSettled(list.map(fromServer));
    const servers = list.map((c, i) => ({ name: c.name, label: c.label ?? c.name, ok: settled[i].status === "fulfilled", ...(settled[i].status === "rejected" ? { error: String(settled[i].reason?.message ?? settled[i].reason).slice(0, 200) } : {}) }));
    for (const s of servers) if (!s.ok) log(`${s.name}: tasks unavailable (${s.error})`);
    return { tasks: mergeTasks(settled.filter(r => r.status === "fulfilled").flatMap(r => r.value)), servers, fetchedAt: new Date().toISOString() };
  }

  /** { tasks, servers: [{ name, label, ok, error? }], fetchedAt }, cached for ttl. */
  function widget({ fresh = false } = {}) {
    if (!fresh && cache && Date.now() - Date.parse(cache.fetchedAt) < ttl) return Promise.resolve(cache);
    inflight ??= load()
      .then(data => (cache = data))
      .finally(() => (inflight = null));
    return inflight;
  }

  /** Mark a task the widget showed as done at its app. Returns the task. */
  async function complete({ server, id }) {
    const task = cache?.tasks.find(t => t.server === server && t.id === id);
    if (!task) throw new Error("That task isn't in the current list; refresh and try again.");
    if (!task.completable) throw new Error(`${task.source} didn't give this task an id, so it can't be completed from here.`);
    const c = (await candidates()).find(x => x.name === server);
    if (!c) throw new Error(`${task.source} isn't connected.`);
    await withClient(c.def, async client => {
      const { tools } = await client.listTools();
      const call = completeCall(tools, task);
      if (!call) throw new Error(`${task.source} has no tool to complete tasks.`);
      const r = await client.callTool(call);
      if (r?.isError) throw new Error(String(toolPayload(r) ?? "The app refused.").slice(0, 200));
    });
    cache = { ...cache, tasks: cache.tasks.filter(t => t !== task) };
    return task;
  }

  return { widget, complete, get cached() { return cache; } };
}
