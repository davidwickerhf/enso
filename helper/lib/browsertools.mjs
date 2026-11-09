// Browser-level tools: open tabs, tab groups (Zen folders), history, reports.
// Executed by background.js through `browser.request`.

import { z } from "zod";
import { createReport } from "./store.mjs";

const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];
const text = t => ({ content: [{ type: "text", text: t }] });

export const BROWSER_TOOLS = [
  {
    name: "tabs_list",
    title: "List open tabs",
    description: "List the open tabs in the user's current Zen space (id, title, URL, group). Set allSpaces to include their other spaces' tabs.",
    shape: { allSpaces: z.boolean().optional() },
    kind: "read",
    async run(_a, ctx) {
      const tabs = await ctx.browser("tabs_list", { allSpaces: !!_a.allSpaces });
      return text(tabs.map(t => `[${t.tabId}] ${t.title} — ${t.url}${t.groupId > -1 ? ` (group ${t.groupId})` : ""}${t.active ? " (active)" : ""}${_a.allSpaces && t.space ? ` [${t.space}]` : ""}`).join("\n") || "No tabs.");
    },
  },
  {
    name: "tab_read",
    title: "Read a tab",
    description: "Read the text of another open tab by its id (from tabs_list), without switching to it.",
    shape: { tabId: z.number().int() },
    kind: "read",
    async run({ tabId }, ctx) {
      const r = await ctx.browser("tab_text", { tabId });
      return text(`URL: ${r.url}\nTitle: ${r.title}\n\n${r.text.slice(0, 20_000)}`);
    },
  },
  {
    name: "history_search",
    title: "Search browsing history",
    description: "Search the user's browsing history by words in the title or URL, within the last N days (default 30).",
    shape: { text: z.string(), days: z.number().int().optional(), max: z.number().int().optional() },
    kind: "read",
    async run(args, ctx) {
      const items = await ctx.browser("history_search", args);
      return text(items.map(i => `- ${i.title || i.url} — ${i.url} (last ${i.lastVisit?.slice(0, 10)}, ${i.visits}×)`).join("\n") || "Nothing found.");
    },
  },
  {
    name: "tabs_open",
    title: "Open tabs",
    description: "Open one or more URLs in new tabs, in the user's current Zen space.",
    shape: { urls: z.array(z.string().url()).min(1).max(20), background: z.boolean().optional() },
    kind: "read",
    async run(args, ctx) {
      const opened = await ctx.browser("tabs_open", args);
      return text(`Opened ${opened.length} tab(s).`);
    },
  },
  {
    name: "tabs_group",
    title: "Group tabs",
    description: "Put tabs into a tab group (a folder in Zen's sidebar), optionally naming and colouring it, or add them to an existing group.",
    shape: { tabIds: z.array(z.number().int()).min(1), title: z.string().optional(), color: z.enum(COLORS).optional(), groupId: z.number().int().optional() },
    kind: "read",
    async run(args, ctx) {
      const r = await ctx.browser("tabs_group", args);
      return text(`Grouped into group ${r.groupId}.`);
    },
  },
  {
    name: "tabs_ungroup",
    title: "Ungroup tabs",
    description: "Remove tabs from their group (dissolves a group when all its tabs are removed).",
    shape: { tabIds: z.array(z.number().int()).min(1) },
    kind: "read",
    async run(args, ctx) {
      await ctx.browser("tabs_ungroup", args);
      return text("Ungrouped.");
    },
  },
  {
    name: "group_update",
    title: "Update a tab group",
    description: "Rename, recolour, collapse or expand a tab group.",
    shape: { groupId: z.number().int(), title: z.string().optional(), color: z.enum(COLORS).optional(), collapsed: z.boolean().optional() },
    kind: "read",
    async run(args, ctx) {
      await ctx.browser("group_update", args);
      return text("Group updated.");
    },
  },
  {
    name: "tabs_close",
    title: "Close tabs",
    description: "Close tabs by id.",
    shape: { tabIds: z.array(z.number().int()).min(1), requested_by_user: z.boolean().describe("true only if the user asked to close these tabs") },
    kind: "act",
    async run(args, ctx) {
      if (!args.requested_by_user) {
        const ok = await ctx.confirm("tabs_close", `Close ${args.tabIds.length} tab(s)`, args);
        if (!ok) throw new Error("The user declined closing these tabs.");
      }
      await ctx.browser("tabs_close", { tabIds: args.tabIds });
      return text(`Closed ${args.tabIds.length} tab(s).`);
    },
  },
  {
    name: "create_report",
    title: "Create a report",
    description:
      'Create a structured, shareable report (Markdown) and open it in a new tab. Use for summaries that pull together several sources. You may include charts as fenced ```chart blocks with JSON {"type":"bar"|"line","title","labels":[...],"series":[{"name","values":[...]}]}.',
    shape: { title: z.string(), markdown: z.string() },
    kind: "read",
    async run({ title, markdown }, ctx) {
      const report = createReport({ title, markdown, conversationId: ctx.conversationId });
      await ctx.browser("open_report", { id: report.id });
      ctx.reportsChanged();
      return text(`Report "${title}" created and opened.`);
    },
  },
];

export const browserToolByName = new Map(BROWSER_TOOLS.map(t => [t.name, t]));
