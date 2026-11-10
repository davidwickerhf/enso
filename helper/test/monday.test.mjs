// Offline checks of the monday.com widget (lib/monday.mjs) against fixtures
// built from monday's MCP source (github.com/mondaycom/mcp @ 4299b7a; each
// fixture's _source names the files): get_user_context, get_board_schema,
// get_board_items_page (assigned_to_me) and get_updates. Also the widget's
// states (not connected, server error with an HTML page, missing tools),
// caching, and a refresh after a write. No account, network or Keychain.
//
//   node test/monday.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = name => JSON.parse(readFileSync(path.join(here, "fixtures/monday", `${name}.json`), "utf8"));
const { parseUserContext, pickColumns, itemsCall, mondayDate, normaliseItems, normaliseUpdates, mondayTasks, classifyError, createMondaySource } = await import("../lib/monday.mjs");

const ctxFx = fixture("get_user_context");
const schemaFx = fixture("get_board_schema");
const itemsFx = fixture("get_board_items_page.assigned_to_me");
const updatesFx = fixture("get_updates.items");
const textOnly = r => ({ content: r.content }); // the same result without structuredContent
const asResult = obj => ({ structuredContent: obj, content: [{ type: "text", text: JSON.stringify(obj) }] });
const NOW = Date.parse("2026-11-10T10:00:00Z");

// The fixtures' text is exactly their structuredContent, as monday's formatToolResult sends it.
for (const fx of [ctxFx, schemaFx, itemsFx, updatesFx]) assert.deepEqual(JSON.parse(fx.result.content[0].text), fx.result.structuredContent, fx._call.name);

// ---- get_user_context ----
for (const r of [ctxFx.result, textOnly(ctxFx.result)]) {
  const { user, boards } = parseUserContext(r);
  assert.deepEqual(user, { id: "71234567", name: "Dana Example" });
  assert.deepEqual(boards, [{ id: "1840000001", name: "Team Tasks" }, { id: "1840000002", name: "Q4 Roadmap" }, { id: "1840000003", name: "Bug Tracker" }], "favourite boards first, then relevant ones, once each; workspaces left out");
}
assert.throws(() => parseUserContext({ content: [{ type: "text", text: "AUTHENTICATION_ERROR: Unable to fetch current user. Verify API token and user permissions." }] }), /AUTHENTICATION_ERROR/);
console.log("ok - get_user_context gives me and my boards (favourites first)");

// ---- get_board_schema → columns ----
assert.deepEqual(pickColumns(schemaFx.result), { people: ["person"], status: "status", date: "date4" }, "the date column titled like a due date wins");
assert.deepEqual(pickColumns(asResult({ columns: [{ id: "p1", type: "people", title: "Owner" }, { id: "p2", type: "people", title: "Reviewer" }, { id: "tl", type: "timeline", title: "Timeline" }] })), { people: ["p1", "p2"], date: "tl" });
assert.deepEqual(pickColumns(asResult({ columns: [{ id: "name", type: "name" }] })), { people: [] });
const call = itemsCall("1840000001", { people: ["person"], status: "status", date: "date4" });
const fxArgs = itemsFx._call.arguments;
assert.equal(call.boardId, fxArgs.boardId);
assert.equal(call.includeColumns, true);
assert.deepEqual(call.columnIds, fxArgs.columnIds);
assert.deepEqual(call.filters, fxArgs.filters, "people column filtered on assigned_to_me, as monday documents it");
assert.equal(itemsCall("1", { people: ["a", "b"] }).filtersOperator, "or", "several people columns: any of them");
console.log("ok - board schema → people, status and due-date columns; items call filters on assigned_to_me");

// ---- get_board_items_page → items ----
const cols = { people: ["person"], status: "status", date: "date4" };
const items = normaliseItems(itemsFx.result, { board: { id: "1840000001", name: "Team Tasks" }, cols });
assert.deepEqual(items, [
  { id: "1840100011", title: "Write onboarding guide", board: "Team Tasks", boardId: "1840000001", url: "https://example-account.monday.com/boards/1840000001/pulses/1840100011", status: "Working on it", due: "2026-11-12", group: "This week", updatedAt: "2026-11-09T16:03:10Z" },
  { id: "1840100027", title: "Review PR for export bug", board: "Team Tasks", boardId: "1840000001", url: "https://example-account.monday.com/boards/1840000001/pulses/1840100027", status: "Stuck", due: "2026-11-07", group: "This week", updatedAt: "2026-11-10T08:21:55Z" },
  { id: "1840100031", title: "Plan Q1 offsite", board: "Team Tasks", boardId: "1840000001", url: "https://example-account.monday.com/boards/1840000001/pulses/1840100031", group: "Backlog", updatedAt: "2026-11-05T14:00:00Z" },
]);
assert.deepEqual(normaliseItems(textOnly(itemsFx.result), { cols }), items.map(i => ({ ...i })), "same from the text block alone");
const withDone = structuredClone(itemsFx.result.structuredContent);
withDone.items[0].column_values.status = "Done";
assert.deepEqual(normaliseItems(asResult(withDone), { cols }).map(i => i.id), ["1840100027", "1840100031"], "done items are left out");
assert.deepEqual(normaliseItems({ content: [{ type: "text", text: "No items found matching the specified searchTerm" }] }, { cols }), []);
assert.equal(mondayDate("2026-11-12"), "2026-11-12");
assert.equal(mondayDate("2026-11-12 17:00"), "2026-11-12T17:00");
assert.equal(mondayDate({ date: "2026-11-12", time: "09:30:00" }), "2026-11-12T09:30");
assert.equal(mondayDate("2026-11-10 - 2026-11-14"), "2026-11-14", "a timeline counts by its end");
assert.equal(mondayDate(null), undefined);
console.log("ok - items normalise to { title, status, due, board, url }; done items and empty pages drop out");

// ---- get_updates → recent updates by others ----
const updates = normaliseUpdates(updatesFx.result, { me: { id: "71234567", name: "Dana Example" }, items, now: NOW });
assert.deepEqual(updates, [{ id: "4021000123", itemId: "1840100027", item: "Review PR for export bug", url: "https://example-account.monday.com/boards/1840000001/pulses/1840100027", author: "Alex Colleague", text: "@Dana Example can you take another look? The CSV export still drops the last row.", at: "2026-11-10T08:21:55Z", mention: true }], "my own update is left out; the mention is flagged");
assert.deepEqual(normaliseUpdates(updatesFx.result, { me: { id: "71234567", name: "Dana Example" }, items, now: NOW + 30 * 86_400_000 }), [], "older than two weeks: left out");
assert.deepEqual(normaliseUpdates({ isError: true, content: [] }, {}), []);
console.log("ok - updates: newest first, by others, mentions of me flagged");

assert.deepEqual(mondayTasks(items).map(t => [t.title, t.source, t.due, t.completable]), [["Write onboarding guide", "monday.com", "2026-11-12", false], ["Review PR for export bug", "monday.com", "2026-11-07", false]]);
console.log("ok - monday items with a due date become Tasks rows (source monday.com)");

// ---- errors read plainly, never as an HTML page ----
const html500 = Object.assign(new Error(`Streamable HTTP error: Error POSTing to endpoint: <!DOCTYPE html><html><head><title>Internal Server Error</title></head><body>${"<p>x</p>".repeat(500)}</body></html>`), { code: 500 });
assert.deepEqual(classifyError(html500), { kind: "server", error: "monday.com isn't responding (server error)." });
assert.equal(classifyError(Object.assign(new Error("Streamable HTTP error: Error POSTing to endpoint: Unauthorized"), { code: 401 })).kind, "auth");
assert.equal(classifyError(new Error("fetch failed")).kind, "network");
console.log("ok - errors: server error (HTML page), sign-in needed, unreachable");

// ---- the source: fake MCP client serving the fixtures ----
function fakeMonday({ tools = ["get_user_context", "get_board_schema", "get_board_items_page", "get_updates", "create_item"], fail } = {}) {
  const calls = [];
  const state = { items: structuredClone(itemsFx.result.structuredContent) };
  const connect = async () => {
    if (fail) throw fail;
    return {
      listTools: async () => ({ tools: tools.map(name => ({ name, inputSchema: { type: "object" } })) }),
      callTool: async ({ name, arguments: args }) => {
        calls.push({ name, args });
        if (name === "get_user_context") return ctxFx.result;
        if (name === "get_board_schema") {
          if (args.boardId === 1840000002) return asResult({ message: "Board schema retrieved", board_id: args.boardId, columns: [{ id: "name", title: "Name", type: "name" }], groups: [] });
          return asResult({ ...schemaFx.result.structuredContent, board_id: args.boardId });
        }
        if (name === "get_board_items_page") {
          if (args.boardId === 1840000003) return asResult({ board: { id: "1840000003", name: "Bug Tracker", hierarchy_type: "classic" }, items: [], pagination: { has_more: false, nextCursor: null, count: 0 } });
          return asResult(state.items);
        }
        if (name === "get_updates") return updatesFx.result;
        throw new Error(`unexpected ${name}`);
      },
      close: async () => {},
    };
  };
  return { calls, state, connect };
}
const connected = async () => ({ state: "connected", name: "monday", def: { url: "https://mcp.monday.com/mcp", headers: {} } });

{
  const fake = fakeMonday();
  const src = createMondaySource({ target: connected, connect: fake.connect, now: () => NOW });
  const d = await src.widget();
  assert.equal(d.state, "ok");
  assert.deepEqual(d.user, { id: "71234567", name: "Dana Example" });
  assert.deepEqual(d.items.map(i => i.title), ["Review PR for export bug", "Write onboarding guide", "Plan Q1 offsite"], "overdue first, then by date, undated last");
  assert.equal(d.updates.length, 1);
  assert.deepEqual(d.boards.map(b => b.name), ["Team Tasks", "Q4 Roadmap", "Bug Tracker"]);
  assert.ok(!fake.calls.some(c => c.name === "get_board_items_page" && c.args.boardId === 1840000002), "a board without a people column isn't queried for items");
  assert.deepEqual(fake.calls.find(c => c.name === "get_updates").args.objectType, "Item");
  const n = fake.calls.length;
  await src.widget();
  assert.equal(fake.calls.length, n, "cached within 5 minutes");
  await src.widget({ fresh: true });
  assert.equal(fake.calls.filter(c => c.name === "get_board_schema").length, 3, "board schemas are cached for an hour, not refetched");
  console.log("ok - widget: my items across boards, recent updates, cached; schemas fetched once");

  // A chat creates an item on monday: refetch, mark it new.
  fake.state.items.items.push({ id: "1840100099", name: "Buy souvenirs", url: "https://example-account.monday.com/boards/1840000001/pulses/1840100099", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z", column_values: { person: "Dana Example", status: "Working on it", date4: "2026-11-12" }, group: { id: "topics", title: "This week" } });
  const { data, added } = await src.refreshAfterWrite();
  assert.ok(data.items.some(i => i.title === "Buy souvenirs"));
  assert.deepEqual(added, ["monday:1840100099"]);
  console.log("ok - after a write to monday the widget refetches and marks the new item");
}

{
  const src = createMondaySource({ target: async () => ({ state: "not-connected", reason: "missing" }), connect: async () => assert.fail("no connection without a sign-in") });
  assert.deepEqual(await src.widget().then(d => [d.state, d.reason]), ["not-connected", "missing"]);
  const down = createMondaySource({ target: connected, connect: fakeMonday({ fail: html500 }).connect });
  const e = await down.widget();
  assert.equal(e.state, "error");
  assert.equal(e.kind, "server");
  assert.equal(e.error, "monday.com isn't responding (server error).");
  assert.ok(!/<|html/i.test(JSON.stringify(e)), "no HTML reaches the UI");
  const old = createMondaySource({ target: connected, connect: fakeMonday({ tools: ["get_user_context"] }).connect });
  assert.equal((await old.widget()).kind, "tools");
  console.log("ok - states: not connected, server error (plain words), tools missing");
}

console.log("monday checks passed");
