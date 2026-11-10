// Offline checks of the Tasks widget's direct path (lib/tasks.mjs) and the
// dashboard's task schema and prompt: normalising list_tasks output (Commonfold's
// JSON, other apps' shapes, free text), which calls to make, how to complete a
// task, caching, and a round trip over real MCP (Streamable HTTP) against a
// local mock task app. No account, network or Keychain.
//
//   node test/tasks.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const root = mkdtempSync(path.join(tmpdir(), "enso-tasks-"));
process.env.ENSO_DATA = path.join(root, "data");

const { normaliseTasks, listCalls, completeCall, mergeTasks, sortTasks, dueBucket, parseSpaces, toolPayload, createTaskSources, isTaskWrite, splitToolName, refreshTargets } = await import("../lib/tasks.mjs");

// Commonfold's list_tasks and update_task, as its server describes them (sample data).
const LIST_SCHEMA = {
  type: "object",
  properties: {
    view: { default: "today", type: "string", enum: ["inbox", "today", "upcoming", "reminders", "anytime", "blocked", "completed"] },
    space: { type: "string", minLength: 1, maxLength: 120 },
    today: { type: "string" },
  },
};
const UPDATE_SCHEMA = {
  type: "object",
  properties: { id: { type: "string", format: "uuid" }, title: { type: "string" }, state: { type: "string", enum: ["backlog", "in_progress", "blocked", "done"] }, dueDate: { anyOf: [{ type: "string" }, { type: "null" }] }, space: { type: "string" } },
  required: ["id"],
};
const cfTask = (id, title, extra = {}) => ({ id, title, state: "backlog", priority: null, dueDate: null, remindAt: null, project: null, assignee: null, source: null, url: `https://app.commonfold.space/notes/${id}`, completedAt: null, ...extra });
const cfResult = (tasks, view = "today") => ({ content: [{ type: "text", text: JSON.stringify({ space: "personal", view, truncated: false, tasks }, null, 2) }] });

try {
  // ---- normalising ----
  const cf = normaliseTasks(
    cfResult([
      cfTask("11111111-1111-4111-8111-111111111111", "Submit the assignment", { dueDate: "2026-09-22", remindAt: "2026-09-22T10:00:00.000Z" }),
      cfTask("22222222-2222-4222-8222-222222222222", "Already finished", { state: "done", completedAt: "2026-11-01T09:00:00.000Z" }),
      cfTask("33333333-3333-4333-8333-333333333333", "No date"),
    ]),
    { server: "commonfold", source: "Commonfold" },
  );
  assert.equal(cf.length, 3);
  assert.deepEqual(cf[0], { id: "11111111-1111-4111-8111-111111111111", title: "Submit the assignment", source: "Commonfold", server: "commonfold", completable: true, due: "2026-09-22", remindAt: "2026-09-22T10:00:00.000Z", url: "https://app.commonfold.space/notes/11111111-1111-4111-8111-111111111111", space: "personal" });
  assert.equal(cf[1].done, true);
  assert.equal(cf[2].due, undefined);
  console.log("ok - Commonfold's list_tasks JSON normalises to { id, title, due, url, source, server, space }");

  const todoist = normaliseTasks({ structuredContent: { items: [{ id: 42, content: "Buy milk", due: { date: "2026-11-12" }, url: "https://todoist.com/showTask?id=42" }, { id: 43, content: "Done one", checked: true }] } }, { server: "todo", source: "Todoist" });
  assert.deepEqual(todoist.map(t => [t.id, t.title, t.due, t.done ?? false]), [["42", "Buy milk", "2026-11-12", false], ["43", "Done one", undefined, true]]);
  const linear = normaliseTasks({ content: [{ type: "text", text: JSON.stringify([{ identifier: "X-1", id: "abc", title: "Fix login", status: "Completed" }, { id: "def", name: "Ship it", due_date: "2026-12-01", webUrl: "https://linear.app/x/issue/X-2" }]) }] }, { server: "linear", source: "Linear" });
  assert.deepEqual(linear.map(t => [t.title, t.done ?? false, t.url ?? null]), [["Fix login", true, null], ["Ship it", false, "https://linear.app/x/issue/X-2"]]);
  console.log("ok - other apps' shapes (Todoist-like, Linear-like, structuredContent, bare arrays) normalise");

  const text = normaliseTasks({ content: [{ type: "text", text: "Your tasks:\n- [ ] Pay rent (due 2026-11-12)\n- [x] Old thing\n* Call the bank https://bank.example.com/x\nNot a task line" }] }, { server: "t", source: "Things" });
  assert.deepEqual(text.map(t => [t.title, t.due ?? null, t.url ?? null, t.done ?? false, t.completable]), [["Pay rent", "2026-11-12", null, false, false], ["Old thing", null, null, true, false], ["Call the bank", null, "https://bank.example.com/x", false, false]]);
  assert.deepEqual(normaliseTasks({ isError: true, content: [{ type: "text", text: "- nope" }] }, { server: "t", source: "T" }), []);
  assert.deepEqual(normaliseTasks({ content: [] }, { server: "t", source: "T" }), []);
  console.log("ok - free-text output falls back to bullet lines (shown, not completable); errors give nothing");

  const merged = mergeTasks([cf, [{ ...cf[2] }], [{ id: "x", title: "Later", due: "2026-12-01", server: "other", source: "Other", completable: true }]], new Date(2026, 8, 1));
  assert.deepEqual(merged.map(t => t.title), ["Submit the assignment", "Later", "No date"], "open only, deduplicated per server, dated first");
  console.log("ok - merge drops done tasks and duplicates and sorts dated tasks first");

  // ---- ordering: overdue, due today, later by date, undated ----
  const now = new Date(2026, 10, 10, 9, 0); // Tue 10 Nov 2026, 09:00 local
  const T = (title, due, extra = {}) => ({ id: title, title, ...(due ? { due } : {}), server: "s", source: "S", completable: true, ...extra });
  const order = sortTasks([
    T("Undated B"),
    T("Next week", "2026-11-17"),
    T("Thursday evening", "2026-11-12", { remindAt: "2026-11-12T17:00:00" }),
    T("Thursday morning", "2026-11-12", { remindAt: "2026-11-12T09:00:00" }),
    T("Today, any time", "2026-11-10"),
    T("Today at 14:00", "2026-11-10T14:00:00"),
    T("Undated A"),
    T("Cancel subscription", "2026-10-04"),
    T("Yesterday", "2026-11-09"),
  ], now);
  assert.deepEqual(order.map(t => t.title), ["Cancel subscription", "Yesterday", "Today at 14:00", "Today, any time", "Thursday morning", "Thursday evening", "Next week", "Undated A", "Undated B"]);
  assert.deepEqual([T("a", "2026-11-09"), T("b", "2026-11-10"), T("c", "2026-11-10T23:30:00"), T("d", "2026-11-11"), T("e")].map(t => dueBucket(t, now)), [0, 1, 1, 2, 3]);
  console.log("ok - order: overdue, due today (timed first), later by date then reminder, undated by title");

  // ---- which tool calls are task writes, and what they refresh ----
  for (const t of ["create_task", "update_task", "complete_task", "complete_tasks", "close_task", "delete_task", "add_todo", "create_item", "change_item_column_values", "update_items", "move_item_to_group", "delete_item"]) assert.ok(isTaskWrite(t), t);
  for (const t of ["list_tasks", "get_task", "search_tasks", "tasks", "create_note", "update_note", "get_board_items_page", "taskmaster"]) assert.ok(!isTaskWrite(t), t);
  const names = ["commonfold", "monday", "claude.ai Notion", "my notes"];
  assert.deepEqual(splitToolName("mcp__commonfold__create_task", names), { server: "commonfold", tool: "create_task" });
  assert.deepEqual(splitToolName("mcp__claude_ai_Notion__notion-create-pages", names), { server: "claude.ai Notion", tool: "notion-create-pages" });
  assert.deepEqual(splitToolName("mcp__my_notes__add_todo", names), { server: "my notes", tool: "add_todo" });
  assert.equal(splitToolName("mcp__browser__page_read", names), null);
  assert.equal(splitToolName("WebSearch", names), null);
  const targets = tool => refreshTargets(tool, { serverNames: names, taskServers: ["commonfold"], mondayServer: "monday" });
  assert.deepEqual(targets("mcp__commonfold__create_task"), { tasks: "commonfold" });
  assert.deepEqual(targets("mcp__commonfold__list_tasks"), {});
  assert.deepEqual(targets("mcp__commonfold__create_note"), {});
  assert.deepEqual(targets("mcp__monday__create_item"), { monday: true });
  assert.deepEqual(targets("mcp__monday__create_update"), { monday: true });
  assert.deepEqual(targets("mcp__monday__get_board_items_page"), {});
  assert.deepEqual(targets("mcp__my_notes__add_todo"), {}, "no list_tasks there: nothing to refresh");
  console.log("ok - task writes (create/update/complete/delete…) are recognised in both engines' tool names");

  // ---- calls ----
  assert.deepEqual(listCalls(LIST_SCHEMA, { today: "2026-11-10" }), ["today", "upcoming", "inbox", "anytime"].map(view => ({ today: "2026-11-10", view })));
  assert.equal(listCalls(LIST_SCHEMA, { today: "2026-11-10", spaces: ["a", "b"] }).length, 8, "one call per view per space when there are several spaces");
  assert.deepEqual(listCalls(LIST_SCHEMA, { spaces: ["only"] })[0], { view: "today" }, "one space: no space argument");
  assert.deepEqual(listCalls({ type: "object", properties: {} }, { today: "2026-11-10" }), [{}]);
  assert.deepEqual(listCalls(undefined), [{}]);
  assert.deepEqual(parseSpaces({ content: [{ type: "text", text: JSON.stringify({ spaces: [{ id: "s1", slug: "personal" }, { slug: "work" }] }) }] }), ["s1", "work"]);
  assert.deepEqual(toolPayload({ content: [{ type: "text", text: "plain" }] }), "plain");
  console.log("ok - list_tasks calls follow its schema (open views, today, spaces)");

  const task = cf[0];
  assert.deepEqual(completeCall([{ name: "list_tasks", inputSchema: LIST_SCHEMA }, { name: "update_task", inputSchema: UPDATE_SCHEMA }], task), { name: "update_task", arguments: { id: task.id, space: "personal", state: "done" } });
  assert.deepEqual(completeCall([{ name: "complete_task", inputSchema: { properties: { task_id: {} } } }, { name: "update_task", inputSchema: UPDATE_SCHEMA }], { id: "9" }), { name: "complete_task", arguments: { task_id: "9" } });
  assert.deepEqual(completeCall([{ name: "update_task", inputSchema: { properties: { id: {}, completed: { type: "boolean" } } } }], { id: "9" }), { name: "update_task", arguments: { id: "9", completed: true } });
  assert.equal(completeCall([{ name: "update_task", inputSchema: { properties: { id: {}, title: {} } } }], { id: "9" }), null, "no way to mark it done");
  assert.equal(completeCall([{ name: "list_tasks" }], { id: "9" }), null);
  console.log("ok - completing picks complete_task, else update_task with state done / completed: true");

  // ---- sources with a fake client: caching, errors, completion ----
  const calls = [];
  const fake = { tasks: [cfTask("44444444-4444-4444-8444-444444444444", "Fake task", { dueDate: "2026-11-11" })] };
  const fakeClient = () => ({
    listTools: async () => ({ tools: [{ name: "list_spaces", inputSchema: {} }, { name: "list_tasks", inputSchema: LIST_SCHEMA }, { name: "update_task", inputSchema: UPDATE_SCHEMA }] }),
    callTool: async ({ name, arguments: args }) => {
      calls.push({ name, args });
      if (name === "list_spaces") return { content: [{ type: "text", text: JSON.stringify({ spaces: [{ id: "s1", slug: "personal" }] }) }] };
      if (name === "list_tasks") return cfResult(args.view === "today" ? fake.tasks : [], args.view);
      if (name === "update_task") {
        fake.tasks = fake.tasks.filter(t => t.id !== args.id);
        return { content: [{ type: "text", text: "{}" }] };
      }
      throw new Error(`unexpected ${name}`);
    },
    close: async () => {},
  });
  const broken = () => ({ listTools: async () => { throw new Error("401 Unauthorized"); }, close: async () => {} });
  const sources = createTaskSources({
    candidates: async () => [{ name: "commonfold", label: "Commonfold", def: { url: "https://cf.example" } }, { name: "down", label: "Down", def: { url: "https://down.example" } }],
    connect: async def => (def.url.includes("down") ? broken() : fakeClient()),
    today: () => "2026-11-10",
  });
  const w1 = await sources.widget();
  assert.deepEqual(w1.tasks.map(t => [t.title, t.source, t.due]), [["Fake task", "Commonfold", "2026-11-11"]]);
  assert.deepEqual(w1.servers.map(s => [s.name, s.ok]), [["commonfold", true], ["down", false]]);
  assert.match(w1.servers[1].error, /401/);
  assert.ok(calls.every(c => c.name !== "list_tasks" || c.args.today === "2026-11-10"));
  const n = calls.length;
  await sources.widget();
  assert.equal(calls.length, n, "second call within 5 minutes comes from the cache");
  await assert.rejects(sources.complete({ server: "commonfold", id: "not-listed" }), /isn't in the current list/);
  assert.ok(!calls.some(c => c.name === "update_task"), "unknown ids never reach the app");
  await sources.complete({ server: "commonfold", id: "44444444-4444-4444-8444-444444444444" });
  assert.deepEqual(calls.find(c => c.name === "update_task").args, { id: "44444444-4444-4444-8444-444444444444", space: "personal", state: "done" });
  assert.equal(sources.cached.tasks.length, 0, "the completed task leaves the cache at once");
  assert.equal((await sources.widget({ fresh: true })).tasks.length, 0);
  console.log("ok - sources cache ~5 min, report a failing server without hiding the others, and complete only listed tasks");

  // ---- a chat writes a task: the cache is dropped, refetched, and the new task is marked ----
  {
    let listCount = 0;
    const app = { tasks: [cfTask("77777777-7777-4777-8777-777777777777", "Cancel subscription", { dueDate: "2026-10-04" })] };
    const client = () => ({
      listTools: async () => ({ tools: [{ name: "list_tasks", inputSchema: { type: "object", properties: {} } }, { name: "create_task", inputSchema: {} }] }),
      callTool: async ({ name }) => (name === "list_tasks" ? (listCount++, cfResult(app.tasks)) : { content: [] }),
      close: async () => {},
    });
    const src = createTaskSources({ candidates: async () => [{ name: "commonfold", label: "Commonfold", def: { url: "https://cf.example" } }], connect: async () => client() });
    assert.deepEqual((await src.widget()).tasks.map(t => t.title), ["Cancel subscription"]);
    // Claude calls create_task in the chat (the app now has the task; Ensō's cache doesn't).
    app.tasks.push(cfTask("88888888-8888-4888-8888-888888888888", "Buy souvenirs", { dueDate: "2026-11-12", remindAt: "2026-11-12T17:00:00.000Z" }));
    assert.deepEqual((await src.widget()).tasks.map(t => t.title), ["Cancel subscription"], "without a refresh the 5-minute cache would hide it");
    const before = listCount;
    const { data, added } = await src.refreshAfterWrite("commonfold");
    assert.equal(listCount, before + 1, "one refetch");
    assert.deepEqual(data.tasks.map(t => t.title), ["Cancel subscription", "Buy souvenirs"]);
    assert.equal(data.tasks[1].remindAt, "2026-11-12T17:00:00.000Z");
    assert.deepEqual(added, ["commonfold|88888888-8888-4888-8888-888888888888"]);
    assert.equal(src.cached, data, "the fresh list is the new cache");
    src.invalidate();
    assert.equal(src.cached, null);
    console.log("ok - after a task write the cache is invalidated, refetched once, and the new task is reported as added");

    // maxAge: a page that becomes visible asks for data at most a minute old.
    const c0 = listCount;
    await src.widget({ maxAge: 60_000 });
    await src.widget({ maxAge: 60_000 });
    assert.equal(listCount, c0 + 1, "within maxAge: cached");
    const t0 = Date.parse(src.cached.fetchedAt);
    src.cached.fetchedAt = new Date(t0 - 90_000).toISOString();
    await src.widget({ maxAge: 60_000 });
    assert.equal(listCount, c0 + 2, "older than maxAge: refetched");
    await src.widget({ maxAge: 1 });
    assert.equal(listCount, c0 + 2, "maxAge is clamped to 15 s, so pages can't hammer the app");
    console.log("ok - maxAge refetches only data older than asked (at least 15 s)");
  }

  // ---- round trip over real MCP against a local mock task app ----
  const store = { tasks: [cfTask("55555555-5555-4555-8555-555555555555", "Water the plants", { dueDate: "2026-11-10" }), cfTask("66666666-6666-4666-8666-666666666666", "Someday task")] };
  const seen = [];
  const server = http.createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer test-token") return res.writeHead(401).end();
    let body = "";
    for await (const c of req) body += c;
    const mcp = new McpServer({ name: "mock-tasks", version: "1.0.0" });
    mcp.registerTool("list_tasks", { description: "List tasks", inputSchema: { view: z.enum(["inbox", "today", "upcoming", "anytime", "completed"]).default("today"), today: z.string().optional() } }, async ({ view }) => {
      seen.push(`list:${view}`);
      const tasks = store.tasks.filter(t => (view === "today" ? t.dueDate : view === "anytime" ? !t.dueDate : false));
      return { content: [{ type: "text", text: JSON.stringify({ space: "personal", view, truncated: false, tasks }) }] };
    });
    mcp.registerTool("update_task", { description: "Update a task", inputSchema: { id: z.string(), state: z.enum(["backlog", "in_progress", "blocked", "done"]).optional() } }, async ({ id, state }) => {
      seen.push(`update:${id}:${state}`);
      store.tasks = store.tasks.map(t => (t.id === id ? { ...t, state, completedAt: new Date().toISOString() } : t));
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => (transport.close(), mcp.close()));
    await mcp.connect(transport);
    transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const live = createTaskSources({ candidates: async () => [{ name: "mock", label: "Mock Tasks", def: { url, headers: { Authorization: "Bearer test-token" } } }] });
    const got = await live.widget();
    assert.deepEqual(got.tasks.map(t => t.title), ["Water the plants", "Someday task"]);
    assert.deepEqual(seen.filter(x => x.startsWith("list")).sort(), ["list:anytime", "list:inbox", "list:today", "list:upcoming"]);
    await live.complete({ server: "mock", id: "55555555-5555-4555-8555-555555555555" });
    assert.ok(seen.includes("update:55555555-5555-4555-8555-555555555555:done"));
    assert.deepEqual((await live.widget({ fresh: true })).tasks.map(t => t.title), ["Someday task"], "done tasks drop out on refresh");
    const noAuth = createTaskSources({ candidates: async () => [{ name: "mock", label: "Mock Tasks", def: { url } }] });
    const failed = await noAuth.widget();
    assert.equal(failed.servers[0].ok, false);
    assert.deepEqual(failed.tasks, []);
    console.log("ok - over MCP: lists the open views, completes with update_task state done, and reports a 401");
  } finally {
    server.close();
  }

  // ---- dashboard schema and prompt ----
  const { SCHEMA, PROMPT } = await import("../lib/dashboard.mjs");
  const taskItem = SCHEMA.properties.tasks.items;
  assert.deepEqual(taskItem.required, ["title", "source"]);
  assert.deepEqual(taskItem.properties.kind.enum, ["app", "follow-up"]);
  assert.equal(taskItem.additionalProperties, false);
  const prompt = PROMPT();
  assert.match(prompt, /list_tasks/);
  assert.match(prompt, /Commonfold/);
  assert.match(prompt, /kind "app"/);
  assert.match(prompt, /kind "follow-up"/);
  assert.match(prompt, /once/i);
  console.log("ok - the dashboard asks for open task-app tasks (kind app, source = app) and follow-ups, once each");

  const { isReadOnlyTool } = await import("../lib/tools-meta.mjs");
  assert.ok(isReadOnlyTool("mcp__commonfold__list_tasks"));
  assert.ok(isReadOnlyTool("mcp__things__todos"));
  assert.ok(isReadOnlyTool("mcp__commonfold__list_spaces"));
  assert.ok(!isReadOnlyTool("mcp__commonfold__update_task"));
  assert.ok(!isReadOnlyTool("mcp__commonfold__create_task"));
  assert.ok(!isReadOnlyTool("mcp__todo__complete_tasks"));
  console.log("ok - the dashboard's read-only run may list tasks but not change them");
} finally {
  rmSync(root, { recursive: true, force: true });
}
