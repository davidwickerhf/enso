// Tools that read and act on the user's current tab. The work happens in the
// extension (background.js + pageagent.js); these definitions are shared by
// both engines.
//
// Approval follows Claude desktop: an action the user asked for runs; an
// action Claude decides on by itself, or anything irreversible (sending,
// paying, deleting, publishing), waits for the user's OK.

import { z } from "zod";

const intent = {
  requested_by_user: z
    .boolean()
    .describe("true only if the user explicitly asked for this action in their latest messages; false if you are acting on your own initiative"),
  irreversible: z
    .boolean()
    .describe("true if the action sends, submits, pays, deletes, publishes or otherwise cannot be undone"),
};

const MAX_TEXT = 20_000;

export function formatSnapshot(s) {
  const lines = s.elements.map(e => {
    const extra = [e.value !== undefined && e.value !== "" ? `value="${e.value}"` : "", e.href ? `→ ${e.href}` : ""].filter(Boolean).join(" ");
    return `[${e.ref}] ${e.role} "${e.name}"${extra ? " " + extra : ""}`;
  });
  const text = s.text.length > MAX_TEXT ? `${s.text.slice(0, MAX_TEXT)}\n[page text cut at ${MAX_TEXT} characters]` : s.text;
  return `URL: ${s.url}\nTitle: ${s.title}\n\nInteractive elements (use the [ref] numbers with the other page tools):\n${lines.join("\n") || "(none found)"}\n\nPage text:\n${text}`;
}

const textResult = text => ({ content: [{ type: "text", text }] });

export const PAGE_TOOLS = [
  {
    name: "page_read",
    title: "Read the page",
    description:
      "Read the current tab: its URL, title, visible text and a numbered list of interactive elements (links, buttons, inputs). Call this before acting on a page and again after the page changes.",
    shape: {},
    kind: "read",
    async run(_args, ctx) {
      return textResult(formatSnapshot(await ctx.page("snapshot", {})));
    },
  },
  {
    name: "page_screenshot",
    title: "Look at the page",
    description: "Take a screenshot of the visible part of the current tab, for layout or visual questions.",
    shape: {},
    kind: "read",
    async run(_args, ctx) {
      const { dataUrl } = await ctx.page("screenshot", {});
      return { content: [{ type: "image", data: dataUrl.split(",")[1], mimeType: "image/png" }] };
    },
  },
  {
    name: "page_scroll",
    title: "Scroll",
    description: "Scroll the current tab up or down, or to an element by ref.",
    shape: { direction: z.enum(["up", "down"]).optional(), ref: z.number().int().optional() },
    kind: "read",
    async run(args, ctx) {
      await ctx.page("scroll", args);
      return textResult("Scrolled. Call page_read to see what is visible now.");
    },
  },
  {
    name: "page_click",
    title: "Click",
    description: "Click an element on the current tab by its ref from page_read.",
    shape: { ref: z.number().int(), ...intent },
    kind: "act",
    async run(args, ctx) {
      const r = await ctx.act("click", { ref: args.ref }, args);
      return textResult(`Clicked ${r.description}. The page may have changed; call page_read before the next step.`);
    },
  },
  {
    name: "page_type",
    title: "Type",
    description:
      "Type text into an input, textarea or editable element by ref, replacing its content. Set submit to press Enter / submit the form afterwards. " +
      "Without ref, types at the cursor (the focused element). On Google Docs, typing without a ref (or with the ref of the page/canvas) inserts the text into the document body at the cursor instead of replacing anything; a newline in text starts a new paragraph.",
    shape: { ref: z.number().int().optional(), text: z.string(), submit: z.boolean().optional(), ...intent },
    kind: "act",
    async run(args, ctx) {
      const r = await ctx.act("type", { ...(args.ref != null ? { ref: args.ref } : {}), text: args.text, submit: !!args.submit }, args);
      return textResult(`Typed into ${r.description}${args.submit ? " and submitted" : ""}.`);
    },
  },
  {
    name: "page_select",
    title: "Choose an option",
    description: "Choose an option in a <select> element by ref, matching the option's visible text or value.",
    shape: { ref: z.number().int(), value: z.string(), ...intent },
    kind: "act",
    async run(args, ctx) {
      const r = await ctx.act("select", { ref: args.ref, value: args.value }, args);
      return textResult(`Selected "${args.value}" in ${r.description}.`);
    },
  },
  {
    name: "page_press",
    title: "Press a key",
    description: "Press a key on the focused element, e.g. Enter, Escape, Tab, ArrowDown.",
    shape: { key: z.string(), ...intent },
    kind: "act",
    async run(args, ctx) {
      await ctx.act("press", { key: args.key }, args);
      return textResult(`Pressed ${args.key}.`);
    },
  },
  {
    name: "page_navigate",
    title: "Open a page",
    description: "Open a URL in the current tab (http or https only).",
    shape: { url: z.string().url(), ...intent },
    kind: "act",
    async run(args, ctx) {
      if (!/^https?:\/\//i.test(args.url)) throw new Error("Only http(s) URLs can be opened.");
      const r = await ctx.act("navigate", { url: args.url }, args);
      return textResult(`Opened ${r.url} ("${r.title}"). Call page_read to see it.`);
    },
  },
  {
    name: "page_back",
    title: "Go back",
    description: "Go back to the previous page in the current tab.",
    shape: { ...intent },
    kind: "act",
    async run(args, ctx) {
      const r = await ctx.act("back", {}, args);
      return textResult(`Went back to ${r.url}.`);
    },
  },
];

export const pageToolByName = new Map(PAGE_TOOLS.map(t => [t.name, t]));

/** Does this call need the user's OK before it runs? */
export function pageActionNeedsApproval(args) {
  return !args.requested_by_user || !!args.irreversible;
}
