// Browser-level tools: open tabs, tab groups (Zen folders), history, reports.
// Executed by background.js through `browser.request`.

import { z } from "zod";
import { createReport } from "./store.mjs";
import { findSpace, listRoutes, listSpaces, routeFor, spaceHint, zenPrefs } from "./zenspaces.mjs";

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
    name: "spaces_list",
    title: "List Zen spaces",
    description: "List the user's Zen spaces (workspaces): name, id, icon, container (each space's own logins), which one is on screen, and what the user said each is for. Use it to pick the space for tabs_open and session_start when the task doesn't make it obvious.",
    shape: {},
    kind: "read",
    async run(_a, ctx) {
      const spaces = listSpaces();
      if (!spaces.length) return text("Ensō can't see any Zen spaces (Zen's session file wasn't found). tabs_open opens in the current space.");
      let info = { current: null, containers: {} };
      try {
        info = (await ctx.browser("spaces_info", { spaces })) ?? info;
      } catch {}
      const mine = ctx.sessionSpace?.() ?? null;
      const lines = spaces.map(sp => {
        const container = sp.containerId ? `container "${info.containers?.[sp.containerId] ?? `#${sp.containerId}`}"` : "no container (the default logins)";
        const hint = spaceHint(sp);
        const tags = [sp.id === info.current && "on screen now", mine?.id === sp.id && "your session's space"].filter(Boolean);
        return `- ${sp.name}${tags.length ? ` (${tags.join(", ")})` : ""}: id ${sp.id}${sp.icon ? `, icon ${sp.icon}` : ""}, ${container}${hint ? `. About: ${hint}` : ""}`;
      });
      return text(`The user's Zen spaces:\n${lines.join("\n")}\nOpen tabs in the space that matches the task: tabs_open { urls, space: "<name>" }; session_start { task, space } makes it your default.`);
    },
  },
  {
    name: "tabs_open",
    title: "Open tabs",
    description:
      "Open one or more URLs in new tabs in a Zen space, with that space's container (so its logins). space: a name or id from spaces_list; pick the one that matches the task (work for an organisation → that organisation's space) and never open work tabs in Personal by default. Without space it uses your session's space (session_start), else the space on screen. " +
      "Replies with each new tab's tabId (pass it to page tools; they work on tabs in any space) and where the tabs actually landed: Zen only lets Ensō put a tab in a space that is on screen in some window, so otherwise the tab opens with that space's container in the current space and the reply says so. " +
      "For external agents the tabs open in the background (the user's tab keeps focus) unless background is false, and they are yours: other agents can read them but not act on them.",
    shape: {
      urls: z.array(z.string().url()).min(1).max(20),
      space: z.string().min(1).max(200).optional().describe("Zen space name or id (spaces_list). Default: your session's space, else the space on screen"),
      background: z.boolean().optional().describe("Open without switching to the tab (default: true for external agents, false in Ensō's own chat)"),
    },
    kind: "read",
    async run(args, ctx) {
      // An external agent shouldn't pull the user away from what they are doing.
      const background = args.background ?? (ctx.external ? true : false);
      const spaces = listSpaces();
      let target = null;
      let from = "";
      if (args.space) {
        const r = findSpace(args.space, spaces);
        if (r.error) throw new Error(r.error);
        target = r.space;
        from = "asked";
      } else {
        const fallback = ctx.external ? ctx.sessionSpace?.() : ctx.space;
        if (fallback?.id) {
          target = spaces.find(sp => sp.id === fallback.id) ?? null;
          from = ctx.external ? "session" : "conversation";
        }
      }
      const reply = await ctx.browser("tabs_open", { urls: args.urls, background, ...(target ? { space: target, spaces } : spaces.length ? { spaces } : {}) });
      // Older extensions answer with the bare list.
      const r = Array.isArray(reply) ? { opened: reply, placement: "current", currentSpace: null, container: null } : (reply ?? { opened: [] });
      const opened = r.opened ?? [];
      const ids = opened.map(o => o.tabId).filter(Number.isInteger);
      if (ctx.external && ids.length) ctx.claimTabs?.(ids, opened.filter(o => Number.isInteger(o.tabId)));
      if (!opened.length) return text("Opened no tabs (only http(s) URLs can be opened).");
      return text(describeOpened({ opened, r, target, from, background, external: ctx.external, spaces }) + (ctx.external ? "\nWhen you're done, close the tabs you opened (tabs_close) and call session_end; otherwise Ensō cleans them up after your session ends." : ""));
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
      if (ctx.external && args.groupId == null) ctx.agentGroup?.(r.groupId);
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
      ctx.tabsClosed?.(args.tabIds);
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

/** The tabs_open reply: the tabs, and where they landed compared with the space asked for. */
export function describeOpened({ opened, r, target, from, background, external, spaces = listSpaces(), prefs = zenPrefs(), routes = listRoutes() }) {
  const nameOf = id => spaces.find(sp => sp.id === id)?.name ?? "another space";
  const where = target ? ` in ${target.name}` : r.currentSpace ? ` in ${r.currentSpace}` : "";
  const logins = target ? (target.containerId ? `, with its container${r.container && r.container !== target.name ? ` "${r.container}"` : ""} (${target.name}'s logins)` : " (no container: the default logins)") : "";
  const lines = opened.map(o => {
    let note = "";
    if (o.inView === false) {
      const routed = routeFor(o.url, routes);
      if (routed) note = ` (Zen's Space routing rule moved it to ${nameOf(routed)})`;
      else if (prefs.forceContainerWorkspace && target) note = ` (Zen moved it to ${target.name} and switched the window there, because zen.workspaces.force-container-workspace is on)`;
      else note = " (Zen moved it out of the current space)";
    } else if (o.inView === true && target && r.placement === "current") {
      const routed = routeFor(o.url, routes);
      if (routed && routed !== target.id) note = ` (matches Zen's routing rule for ${nameOf(routed)})`;
    }
    return `- tab ${o.tabId}: ${o.url}${note}`;
  });
  const why = from === "session" ? " (your session's space)" : from === "conversation" ? " (this conversation's space)" : "";
  let head;
  if (!target || r.placement === "exact") head = `Opened ${opened.length} tab(s)${where}${why}${logins}${background ? " in the background" : ""}:`;
  else if (r.placement === "window") head = `Opened ${opened.length} tab(s)${where}${why}${logins}, in the Zen window that shows ${target.name}${background ? ", in the background" : ""}:`;
  else {
    const stayed = opened.every(o => o.inView !== false);
    head = stayed
      ? `Opened ${opened.length} tab(s) with ${target.name}'s ${target.containerId ? "container (its logins)" : "logins (no container)"}${why}, but in the space on screen${r.currentSpace ? `, ${r.currentSpace}` : ""}, not in ${target.name}${background ? ", in the background" : ""}. Zen only lets Ensō put a tab in a space that some window shows; it moves a tab to its space on its own only when a Space routing rule matches the URL, or when zen.workspaces.force-container-workspace is on (off by default; it also switches the window to that space). Tell the user if it matters which space the tab is in:`
      : `Opened ${opened.length} tab(s) with ${target.name}'s ${target.containerId ? "container (its logins)" : "logins"}${why}:`;
  }
  return `${head}\n${lines.join("\n")}${external ? "\nPass tabId to page tools to work in these tabs (without it they act on the user's active tab)." : ""}`;
}

export const browserToolByName = new Map(BROWSER_TOOLS.map(t => [t.name, t]));
