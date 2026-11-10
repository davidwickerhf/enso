// Subscription engine: runs turns through the user's logged-in Claude Code
// with the Claude Agent SDK, so answers count against the Claude plan, not an
// API key. Claude Code also brings the claude.ai connectors (Gmail, Calendar,
// Drive…) and handles OAuth for MCP servers registered with `claude mcp add`;
// servers Ensō signs in to itself (lib/connections.mjs) arrive with a Bearer header.
//
// Speed: starting Claude Code and connecting the MCP servers takes ~3 s, so
// sessions are kept warm. Each recent conversation keeps a live session
// (streaming input: the process stays up between turns), and a spare session
// is started ahead of time for the next new conversation. The system prompt is
// the same for every conversation (time and space go into each message), so
// the spare fits any conversation and the prompt cache keeps hitting.
//
// It runs on the user's own `claude` CLI (lib/claude-cli.mjs), not on a binary
// shipped with the helper.
//
// No settings files are loaded (settingSources: []) so the user's global Claude
// Code hooks and permissions don't fire for browser questions; MCP servers are
// passed in explicitly.

import { createHash } from "node:crypto";
import { findClaude } from "./claude-cli.mjs";
import { config } from "./config.mjs";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { friendly } from "./connections.mjs";
import { log } from "./native.mjs";
import { ALL_BROWSER_TOOLS } from "./toolset.mjs";
import { systemPrompt } from "./prompt.mjs";
import { WORKSPACE, appendMemory, getEngineState, getSettings, listActions, searchHistory, setEngineState } from "./store.mjs";
import { describeTool, isReadOnlyTool } from "./tools-meta.mjs";

const IDLE_MS = 15 * 60_000;
const MAX_LIVE = 3;

/** The Claude Code CLI to run on: { found, path, version } or { found: false, reason }. */
export const claudeCli = () => findClaude([process.env.ENSO_CLAUDE_PATH, getSettings().claudePath, config.claudePath]);

/** { available, path?, version?, reason? } for the engine picker and error messages. */
export async function subscriptionStatus() {
  const c = claudeCli();
  return c.found ? { available: true, path: c.path, version: c.version } : { available: false, reason: c.reason };
}
export async function subscriptionAvailable() {
  return claudeCli().found;
}

// ---------- tools bound to whichever turn is running ----------

function inProcessServers(session) {
  const ctx = () => session.ctx;
  const browser = createSdkMcpServer({
    name: "browser",
    version: "1.0.0",
    tools: ALL_BROWSER_TOOLS.map(t =>
      tool(t.name, t.description, t.shape, async args => t.run(args, ctx()), { annotations: { readOnlyHint: t.kind === "read", title: t.title } }),
    ),
  });
  const zen = createSdkMcpServer({
    name: "zen",
    version: "1.0.0",
    tools: [
      tool(
        "remember",
        'Save a lasting fact or preference about the user to their memory (shown in future conversations). scope "space" keeps it to the current Zen space (e.g. a work detail in a work space); "global" (default) applies everywhere.',
        { fact: z.string(), scope: z.enum(["global", "space"]).optional() },
        async ({ fact, scope }) => {
          appendMemory(fact, scope === "space" ? ctx().space?.id : null);
          return { content: [{ type: "text", text: "Saved to memory." }] };
        },
      ),
      tool("search_history", "Search the user's earlier conversations with you (text, tool calls and page actions).", { query: z.string() }, async ({ query: q }) => {
        const hits = searchHistory(q, 10);
        return { content: [{ type: "text", text: hits.length ? hits.map(h => `- ${h.at.slice(0, 10)} "${h.title}": …${h.snippet}…`).join("\n") : "No matches." }] };
      }, { annotations: { readOnlyHint: true } }),
      tool("page_activity", "List what you did on web pages recently (clicks, typing, navigation), optionally for one site.", { host: z.string().optional() }, async ({ host }) => {
        const acts = listActions({ host, limit: 30 });
        return { content: [{ type: "text", text: acts.length ? acts.map(a => `- ${a.at.slice(0, 16)} ${a.action} ${a.target} on ${a.url}`).join("\n") : "No page actions recorded." }] };
      }, { annotations: { readOnlyHint: true } }),
    ],
  });
  return { browser, zen };
}

// ---------- sessions ----------

class Session {
  constructor({ signature, baseOptions, resume }) {
    this.signature = signature;
    this.ctx = null;
    this.turnDone = null;
    this.usedAt = Date.now();
    this.dead = false;
    this.queue = [];
    this.wake = null;
    this.sessionId = resume ?? null;
    this.startedAt = new Map();
    this.toolNames = new Map(); // toolUseId -> full tool name, for ctx.onToolResult
    this.messageId = null;

    const self = this;
    async function* input() {
      for (;;) {
        while (self.queue.length) yield self.queue.shift();
        if (self.dead) return;
        await new Promise(r => (self.wake = r));
      }
    }
    this.q = query({
      prompt: input(),
      options: {
        ...baseOptions,
        mcpServers: { ...baseOptions.mcpServers, ...inProcessServers(this) },
        ...(resume ? { resume } : {}),
        canUseTool: (name, toolInput, opts) => this.canUseTool(name, toolInput, opts),
      },
    });
    this.loop = this.consume().catch(err => {
      log("session ended:", err.message);
      this.finish(null, err);
    });
  }

  async consume() {
    for await (const m of this.q) this.onMessage(m);
    this.dead = true;
    this.finish(null, new Error("The Claude Code session ended."));
  }

  async canUseTool(toolName, input, opts) {
    const ctx = this.ctx;
    if (!ctx) return { behavior: "deny", message: "No active turn." };
    if (toolName.startsWith("mcp__browser__") || toolName.startsWith("mcp__zen__")) return { behavior: "allow", updatedInput: input };
    if (toolName === "WebSearch" || toolName === "WebFetch") return { behavior: "allow", updatedInput: input };
    if (ctx.settings.alwaysAllowedTools?.includes(toolName)) return { behavior: "allow", updatedInput: input };
    if (ctx.settings.autoApproveReadOnly && isReadOnlyTool(toolName)) return { behavior: "allow", updatedInput: input };
    const { server, tool: name, title } = describeTool(toolName);
    const decision = await ctx.approve({ toolUseId: opts.toolUseID, server, tool: name, title, input, reason: opts.decisionReason ?? "This tool can change things." });
    if (decision === "always") ctx.allowAlways(toolName);
    return decision === "deny" ? { behavior: "deny", message: "The user declined this action." } : { behavior: "allow", updatedInput: input };
  }

  /** Run one turn; resolves with usage when Claude Code reports the result. */
  turn(ctx, content) {
    this.ctx = ctx;
    this.usedAt = Date.now();
    const onAbort = () => this.q.interrupt?.().catch(() => {});
    ctx.abortController.signal.addEventListener("abort", onAbort, { once: true });
    return new Promise((resolve, reject) => {
      this.turnDone = { resolve, reject };
      this.queue.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: this.sessionId ?? "" });
      this.wake?.();
    }).finally(() => {
      ctx.abortController.signal.removeEventListener("abort", onAbort);
      this.ctx = null;
    });
  }

  finish(usage, err) {
    const done = this.turnDone;
    this.turnDone = null;
    if (!done) return;
    err ? done.reject(err) : done.resolve(usage);
  }

  onMessage(m) {
    const ctx = this.ctx;
    if (m.type === "system" && m.subtype === "init") {
      this.sessionId = m.session_id;
      if (ctx) {
        setEngineState(ctx.conversationId, { ...getEngineState(ctx.conversationId), sessionId: m.session_id });
        const toolNames = new Map();
        for (const t of m.tools ?? []) {
          const [, srv, ...rest] = t.split("__");
          if (t.startsWith("mcp__")) toolNames.set(srv, [...(toolNames.get(srv) ?? []), rest.join("__")]);
        }
        const key = n => n.replace(/[^a-zA-Z0-9_-]/g, "_");
        ctx.servers((m.mcp_servers ?? []).filter(s => !["browser", "zen"].includes(s.name)).map(s => ({ ...s, toolNames: toolNames.get(key(s.name)) ?? [], ...(s.error ? { error: friendly(s.error) } : {}) })));
      }
      return;
    }
    if (!ctx || m.parent_tool_use_id) return; // nothing running, or subagent traffic
    if (m.type === "stream_event") {
      const ev = m.event;
      if (ev.type === "message_start") this.messageId = ev.message.id;
      if (ev.type === "content_block_delta") {
        const id = this.messageId ?? m.uuid;
        if (ev.delta.type === "text_delta") ctx.delta("assistant.delta", id, ev.delta.text);
        if (ev.delta.type === "thinking_delta") ctx.delta("thinking.delta", id, ev.delta.thinking);
      }
      return;
    }
    if (m.type === "assistant") {
      const messageId = this.messageId ?? m.message.id;
      for (const block of m.message.content) {
        if (block.type === "text" && block.text.trim()) ctx.emit({ kind: "assistant", messageId, text: block.text });
        if (block.type === "thinking" && block.thinking?.trim()) ctx.emit({ kind: "thinking", messageId, text: block.thinking });
        if (block.type === "tool_use") {
          this.startedAt.set(block.id, Date.now());
          this.toolNames.set(block.id, block.name);
          const d = describeTool(block.name);
          ctx.emit({ kind: "tool.call", toolUseId: block.id, category: d.category, server: d.server, tool: d.tool, title: d.title, input: block.input });
        }
        if (block.type === "server_tool_use") {
          this.startedAt.set(block.id, Date.now());
          ctx.emit({ kind: "tool.call", toolUseId: block.id, category: "web", server: "web", tool: block.name, title: block.name === "web_search" ? "Search the web" : "Fetch a page", input: block.input });
        }
      }
      return;
    }
    if (m.type === "user" && Array.isArray(m.message?.content)) {
      for (const block of m.message.content) {
        if (block.type !== "tool_result") continue;
        const parts = Array.isArray(block.content) ? block.content : [{ type: "text", text: String(block.content ?? "") }];
        const preview = parts.map(p => (p.type === "text" ? p.text : `[${p.type}]`)).join("\n").slice(0, 600);
        ctx.emit({ kind: "tool.result", toolUseId: block.tool_use_id, ok: !block.is_error, preview, durationMs: Date.now() - (this.startedAt.get(block.tool_use_id) ?? Date.now()) });
        const name = this.toolNames.get(block.tool_use_id);
        this.toolNames.delete(block.tool_use_id);
        if (name) ctx.onToolResult?.({ tool: name, ok: !block.is_error });
      }
      return;
    }
    if (m.type === "result") {
      this.sessionId = m.session_id;
      setEngineState(ctx.conversationId, { ...getEngineState(ctx.conversationId), sessionId: m.session_id });
      if (!ctx.abortController.signal.aborted) {
        if (m.subtype !== "success" && m.subtype !== "error_during_execution") ctx.emit({ kind: "notice", text: `The turn ended early (${m.subtype.replace(/_/g, " ")}).` });
        if (m.is_error && m.result) ctx.emit({ kind: "error", text: String(m.result).slice(0, 500) });
      }
      this.finish({ inputTokens: m.usage?.input_tokens, outputTokens: m.usage?.output_tokens, costUsd: m.total_cost_usd });
    }
  }

  close() {
    this.dead = true;
    this.wake?.();
    try {
      this.q.interrupt?.().catch(() => {});
      this.q.return?.();
    } catch {}
  }
}

const live = new Map(); // conversationId -> Session
let spare = null;

function baseOptions({ settings, config, servers, disallowed }) {
  const cli = claudeCli();
  return {
    cwd: WORKSPACE,
    ...(cli.found ? { pathToClaudeCodeExecutable: cli.path } : {}),
    settingSources: [],
    mcpServers: servers,
    tools: config.webSearch ? ["WebSearch", "WebFetch"] : [],
    disallowedTools: disallowed,
    systemPrompt: systemPrompt({ engine: "subscription" }),
    model: settings.model,
    effort: settings.effort,
    thinking: { type: "adaptive", display: "summarized" },
    includePartialMessages: true,
    permissionMode: "default",
  };
}

// Server definitions are hashed whole (not just their names), so a refreshed
// OAuth token or a newly connected server starts a fresh session.
const digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const signatureOf = opts => digest({ ...opts, mcpServers: Object.keys(opts.mcpServers).sort().map(k => [k, digest(opts.mcpServers[k])]) });

function evict() {
  const now = Date.now();
  for (const [id, s] of live) if (s.dead || (!s.ctx && now - s.usedAt > IDLE_MS)) (s.close(), live.delete(id));
  while (live.size > MAX_LIVE) {
    const [id, s] = [...live].filter(([, x]) => !x.ctx).sort((a, b) => a[1].usedAt - b[1].usedAt)[0] ?? [];
    if (!s) break;
    s.close();
    live.delete(id);
  }
}
setInterval(evict, 60_000).unref();

/** Start a spare session in the background so the next new conversation starts warm. */
export function prewarm(args) {
  if (!claudeCli().found) return;
  const opts = baseOptions(args);
  const signature = signatureOf(opts);
  if (spare && !spare.dead && spare.signature === signature) return;
  spare?.close();
  spare = new Session({ signature, baseOptions: opts });
}

/** Earlier turns, for a conversation that started on the other engine. */
function carryOver(events) {
  const turns = events.filter(e => e.kind === "user" || e.kind === "assistant").slice(-12);
  if (!turns.length) return "";
  return `Earlier in this conversation (continued from another session):\n${turns.map(e => `${e.kind === "user" ? "User" : "You"}: ${e.text}`).join("\n\n")}\n\n---\n\n`;
}

export async function runSubscriptionTurn(ctx, { prompt, events, servers, disallowed }) {
  const cli = claudeCli();
  if (!cli.found) {
    const err = new Error(cli.reason);
    err.code = "no_claude_code";
    throw err;
  }
  const args = { settings: ctx.settings, config: ctx.config, servers, disallowed };
  const opts = baseOptions(args);
  const signature = signatureOf(opts);
  const state = getEngineState(ctx.conversationId);

  let session = live.get(ctx.conversationId);
  if (session && (session.dead || session.signature !== signature)) {
    session.close();
    session = null;
  }
  let prefix = "";
  if (!session) {
    if (!state.sessionId && spare && !spare.dead && spare.signature === signature) {
      session = spare; // warm start for a new conversation
      spare = null;
    } else {
      session = new Session({ signature, baseOptions: opts, resume: state.sessionId });
    }
    if (!state.sessionId) prefix = carryOver(events);
    live.set(ctx.conversationId, session);
  }

  const content = typeof prompt === "string" ? prefix + prompt : prefix ? [{ type: "text", text: prefix }, ...prompt] : prompt;
  try {
    return await session.turn(ctx, content);
  } finally {
    evict();
    setTimeout(() => prewarm(args), 500); // keep a spare ready for the next new chat
  }
}
