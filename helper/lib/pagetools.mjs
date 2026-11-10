// Tools that read and act on the user's current tab. The work happens in the
// extension (background.js + pageagent.js); these definitions are shared by
// both engines.
//
// Approval follows Claude desktop: an action the user asked for runs; an
// action Claude decides on by itself, or anything irreversible (sending,
// paying, deleting, publishing), waits for the user's OK.

import { z } from "zod";
import { DEFAULT_TIMEOUTS, MAX_TIMEOUT_MS, clampTimeout } from "./timeouts.mjs";
import { describeFiles, formatBytes, maxUploadBytes, stageFiles } from "./upload.mjs";

const intent = {
  requested_by_user: z
    .boolean()
    .describe("true only if the user explicitly asked for this action in their latest messages; false if you are acting on your own initiative"),
  irreversible: z
    .boolean()
    .describe("true if the action sends, submits, pays, deletes, publishes or otherwise cannot be undone"),
};

const MAX_TEXT = 20_000;
const timeoutArg = (def, what) => z.number().int().min(1_000).max(MAX_TIMEOUT_MS).optional().describe(`How long to wait${what ? ` for ${what}` : ""}, in ms (default ${def}, max ${MAX_TIMEOUT_MS})`);
const stillLoading = r => (r.timedOut ? ` It was still loading after ${Math.round(r.waitedMs / 1000)} s; that doesn't mean it failed. Use page_wait (for: "load" or a selector) before acting on it.` : "");

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
    shape: { url: z.string().url(), timeoutMs: timeoutArg(40_000, "the page to load"), ...intent },
    kind: "act",
    async run(args, ctx) {
      if (!/^https?:\/\//i.test(args.url)) throw new Error("Only http(s) URLs can be opened.");
      const r = await ctx.act("navigate", { url: args.url, ...(args.timeoutMs ? { timeoutMs: clampTimeout(args.timeoutMs) } : {}) }, args);
      return textResult(`Opened ${r.url} ("${r.title}").${stillLoading(r)} Call page_read to see it.`);
    },
  },
  {
    name: "page_back",
    title: "Go back",
    description: "Go back to the previous page in the current tab.",
    shape: { timeoutMs: timeoutArg(25_000, "the page to load"), ...intent },
    kind: "act",
    async run(args, ctx) {
      const r = await ctx.act("back", args.timeoutMs ? { timeoutMs: clampTimeout(args.timeoutMs) } : {}, args);
      return textResult(`Went back to ${r.url}.${stillLoading(r)}`);
    },
  },
  {
    name: "page_wait",
    title: "Wait for the page",
    description:
      "Wait until something happens on the current tab, instead of polling: for \"selector\" (an element matching the CSS selector `value` is visible; visible:false accepts hidden ones), \"gone\" (no visible element matches `value` any more, e.g. a spinner or \"Uploading…\" banner), \"text\" (`value` appears in the page text; /regex/ allowed), \"url\" (the URL contains `value`, or matches /regex/), \"network_idle\" (no requests open for idleMs, default 500 ms; long-lived streams and requests open over 15 s don't count) or \"load\" (the tab finished loading). " +
      `Returns as soon as the condition holds, or after timeoutMs (default ${DEFAULT_TIMEOUTS.wait / 1000} s, max ${MAX_TIMEOUT_MS / 1000} s) with what it saw. Survives navigations. Use it after page_upload, a submit or a click that starts slow work.`,
    shape: {
      for: z.enum(["selector", "gone", "text", "url", "network_idle", "load"]).describe("What to wait for"),
      value: z.string().max(2000).optional().describe("CSS selector (selector, gone), text or /regex/ (text), URL part or /regex/ (url)"),
      visible: z.boolean().optional().describe("selector / gone: only count visible elements (default true)"),
      idleMs: z.number().int().min(100).max(10_000).optional().describe("network_idle: how long the network must be quiet (default 500)"),
      timeoutMs: timeoutArg(DEFAULT_TIMEOUTS.wait),
    },
    kind: "read",
    async run(args, ctx) {
      if (["selector", "gone", "text", "url"].includes(args.for) && !args.value) throw new Error(`page_wait for "${args.for}" needs a value.`);
      const timeoutMs = clampTimeout(args.timeoutMs) ?? DEFAULT_TIMEOUTS.wait;
      const r = await ctx.page("wait", { for: args.for, value: args.value, visible: args.visible, idleMs: args.idleMs, timeoutMs });
      const what = `${args.for}${args.value ? ` ${JSON.stringify(args.value)}` : ""}`;
      if (r.met) return textResult(`Done: ${what} after ${(r.ms / 1000).toFixed(1)} s (${r.detail}).\nURL: ${r.url}`);
      return textResult(`Timed out after ${Math.round(r.ms / 1000)} s waiting for ${what}; last seen: ${r.detail}.\nURL: ${r.url}\nThis doesn't mean anything failed. Call page_wait again to keep waiting, or page_read to look at the page.`);
    },
  },
  {
    name: "page_upload",
    title: "Attach files",
    description:
      "Attach files from this computer to the page, exactly as they are on disk: sets them on an <input type=file> (mode \"input\", the default when the target is or contains a file input) or drops them on a drop zone (mode \"drop\": dragenter, dragover, drop). " +
      "Target it by ref from page_read, or by CSS selector: file inputs are often hidden and have no ref, so try selector \"input[type=file]\" (searches open shadow roots too). paths: absolute paths or ~/…, files only (no folders, no URLs). " +
      `Up to ${formatBytes(maxUploadBytes())} in all and 20 files per call; files are streamed in chunks and checked (size and SHA-256) before they are attached. ` +
      "It returns what the page received and does not wait for the site's own upload: follow it with page_wait (e.g. for \"gone\" on the progress bar, \"text\" \"Uploaded\", or \"network_idle\") and page_read. Attaching is an action (requested_by_user as for page_type); set irreversible when the page uploads or submits on attach. " +
      "Never modify, shrink or re-encode a user's file to get around a limit: if a limit blocks you, stop and tell the user.",
    shape: {
      paths: z.array(z.string().min(1).max(4096)).min(1).max(20).describe("Absolute paths (or ~/…) of the files to attach"),
      ref: z.number().int().optional().describe("Ref from page_read of the file input, its label, or the drop zone"),
      selector: z.string().min(1).max(1000).optional().describe('CSS selector of the file input or drop zone, e.g. "input[type=file]" (used when no ref is given)'),
      mode: z.enum(["input", "drop"]).optional().describe("input: set the files on a file input; drop: drag-and-drop them onto the element (default: input if the target is or holds a file input, else drop)"),
      timeoutMs: timeoutArg(DEFAULT_TIMEOUTS.upload, "the files to reach the page"),
      ...intent,
    },
    kind: "act",
    async run(args, ctx) {
      if (args.ref == null && !args.selector) throw new Error('Give the ref (from page_read) or a CSS selector (e.g. "input[type=file]") of the file input or drop zone.');
      if (ctx.external && ctx.mode?.() !== "full") throw new Error("Ensō only lets external agents read Zen right now; attaching files needs Access = Full (Ensō → Settings → Agents & screenshots).");
      const files = await describeFiles(args.paths);
      const { uploadId, sha256s } = await stageFiles(ctx.browser, files);
      const total = files.reduce((n, f) => n + f.size, 0);
      const timeoutMs = clampTimeout(args.timeoutMs) ?? Math.min(MAX_TIMEOUT_MS, DEFAULT_TIMEOUTS.upload + Math.round(total / (1024 * 1024)) * 300);
      let r;
      try {
        r = await ctx.act(
          "upload",
          { uploadId, sha256: sha256s, files: files.map(f => `${f.name} (${formatBytes(f.size)})`), ...(args.ref != null ? { ref: args.ref } : { selector: args.selector }), ...(args.mode ? { mode: args.mode } : {}), timeoutMs },
          args,
        );
      } catch (err) {
        await ctx.browser("upload_discard", { uploadId }).catch(() => {});
        throw err;
      }
      return textResult(formatUpload(r, files, sha256s));
    },
  },
];

/** page_upload's result as text. */
export function formatUpload(r, files, sha256s = []) {
  const sent = files.map((f, i) => `- ${f.name}: ${formatBytes(f.size)}${f.type ? `, ${f.type}` : ""}${sha256s[i] ? `, sha256 ${sha256s[i].slice(0, 16)}…` : ""}`).join("\n");
  const got = (r.received ?? []).map(f => `- ${f.name}: ${formatBytes(f.size)}${f.type ? `, ${f.type}` : ""}`).join("\n") || "(nothing)";
  const lines = [r.mode === "drop" ? `Dropped ${files.length} file${files.length === 1 ? "" : "s"} on ${r.description}.` : `Attached ${files.length} file${files.length === 1 ? "" : "s"} to ${r.description}.`, `Sent, unchanged (size and SHA-256 checked):\n${sent}`, `The page received:\n${got}`];
  if (r.mode === "drop") lines.push(r.handled ? "The page handled the drop (it called preventDefault)." : "No handler accepted the drop (preventDefault wasn't called), so the page may have ignored it. Check with page_read; if there is a file input, use mode \"input\" with its selector.");
  if (r.notAccepted?.length) lines.push(`Note: the input's accept="${r.accept}" doesn't list ${r.notAccepted.join(", ")}; the site may reject ${r.notAccepted.length === 1 ? "it" : "them"}.`);
  lines.push("The site's own upload (if it starts one) isn't awaited: use page_wait (gone / text / network_idle) and page_read to confirm it finished. Attaching isn't submitting.");
  return lines.join("\n\n");
}

export const pageToolByName = new Map(PAGE_TOOLS.map(t => [t.name, t]));

/** Does this call need the user's OK before it runs? */
export function pageActionNeedsApproval(args) {
  return !args.requested_by_user || !!args.irreversible;
}
