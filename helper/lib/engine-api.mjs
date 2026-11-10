// API engine: the Messages API with an Anthropic API key from the Keychain,
// and MCP servers connected by this process. Used when the user switches the
// engine to "API key" in settings.

import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { log } from "./native.mjs";
import { ALL_BROWSER_TOOLS, browserSideToolByName } from "./toolset.mjs";
import { systemPrompt } from "./prompt.mjs";
import { appendMemory, getEngineState, listActions, searchHistory, setEngineState } from "./store.mjs";
import { describeTool } from "./tools-meta.mjs";

const MAX_TOOL_TEXT = 200_000;

export function keychain(service) {
  try {
    return execFileSync("security", ["find-generic-password", "-s", service, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
// The key's Keychain item is "enso-anthropic"; installs from before the rename
// stored it as "zen-chat-anthropic", which is still read when the new one is missing.
let keyCache = { at: 0, value: null };
export function apiKey(config) {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  if (keyCache.value && Date.now() - keyCache.at < 60_000) return keyCache.value;
  for (const service of [config.keychainService, ...(config.legacyKeychainServices ?? [])].filter(Boolean)) {
    const value = keychain(service);
    if (value) return (keyCache = { at: Date.now(), value }).value;
  }
  return null;
}

// ---------- MCP clients (API engine only) ----------

const mcp = new Map(); // name -> { client, tools, status }
const toolIndex = new Map(); // claude tool name -> { server, tool }
let mcpReady = null;

const claudeName = (server, t) => `mcp__${server}__${t}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

async function connect(name, def) {
  const client = new Client({ name: "enso", version: "0.5.0" });
  const transport = def.url
    ? new StreamableHTTPClientTransport(new URL(def.url), { requestInit: { headers: def.headers ?? {} } })
    : new StdioClientTransport({ command: def.command, args: def.args ?? [], env: { ...process.env, ...(def.env ?? {}) }, stderr: "ignore" });
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 20_000));
  await Promise.race([client.connect(transport), timeout]);
  const { tools } = await Promise.race([client.listTools(), timeout]);
  return { client, tools };
}

export function connectMcp(servers, onStatus) {
  mcpReady ??= (async () => {
    await Promise.all(
      Object.entries(servers).map(async ([name, def]) => {
        try {
          const { client, tools } = await connect(name, def);
          mcp.set(name, { client, tools, status: "connected" });
          for (const t of tools) toolIndex.set(claudeName(name, t.name), { server: name, tool: t });
        } catch (err) {
          mcp.set(name, { tools: [], status: /auth/i.test(err.message) ? "needs-auth" : "failed" });
          log(`${name}:`, err.message);
        }
      }),
    );
    onStatus([...mcp].map(([name, s]) => ({ name, status: s.status, tools: s.tools.length })));
  })();
  return mcpReady;
}

// ---------- tools ----------

const ZEN_TOOLS = [
  {
    name: "remember",
    description: 'Save a lasting fact or preference about the user. scope "space" keeps it to the current Zen space; "global" (default) applies everywhere.',
    shape: { fact: z.string(), scope: z.enum(["global", "space"]).optional() },
    run: ({ fact, scope }, ctx) => (appendMemory(fact, scope === "space" ? ctx.space?.id : null), "Saved to memory."),
  },
  {
    name: "search_history",
    description: "Search the user's earlier conversations with you.",
    shape: { query: z.string() },
    run: ({ query }) => searchHistory(query, 10).map(h => `- ${h.at.slice(0, 10)} "${h.title}": …${h.snippet}…`).join("\n") || "No matches.",
  },
  {
    name: "page_activity",
    description: "List what you did on web pages recently, optionally for one site.",
    shape: { host: z.string().optional() },
    run: ({ host }) => listActions({ host, limit: 30 }).map(a => `- ${a.at.slice(0, 16)} ${a.action} ${a.target} on ${a.url}`).join("\n") || "No page actions recorded.",
  },
];

const schema = shape => {
  const { $schema, ...rest } = z.toJSONSchema(z.object(shape));
  return rest;
};

function claudeTools(config) {
  const tools = [
    ...ALL_BROWSER_TOOLS.map(t => ({ name: `mcp__browser__${t.name}`, description: t.description, input_schema: schema(t.shape) })),
    ...ZEN_TOOLS.map(t => ({ name: `mcp__zen__${t.name}`, description: t.description, input_schema: schema(t.shape) })),
    ...[...toolIndex].map(([name, { server, tool }]) => ({
      name,
      description: `[${server}] ${tool.description ?? ""}`.slice(0, 1024),
      input_schema: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object", properties: {} },
    })),
  ];
  if (config.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  return tools;
}

function mcpResultToContent(result) {
  const blocks = [];
  let budget = MAX_TOOL_TEXT;
  for (const item of result.content ?? []) {
    if (item.type === "image" && item.data) {
      blocks.push({ type: "image", source: { type: "base64", media_type: item.mimeType, data: item.data } });
      continue;
    }
    let text = item.type === "text" ? item.text : JSON.stringify(item);
    if (text.length > budget) text = `${text.slice(0, budget)}\n[output truncated: ${text.length - budget} more characters]`;
    budget = Math.max(0, budget - text.length);
    blocks.push({ type: "text", text });
  }
  return blocks.length ? blocks : [{ type: "text", text: "(no output)" }];
}

async function runTool(ctx, block) {
  const [, server, name] = block.name.split("__");
  if (server === "browser") return mcpResultToContent(await browserSideToolByName.get(name).run(block.input ?? {}, ctx));
  if (server === "zen") return [{ type: "text", text: await ZEN_TOOLS.find(t => t.name === name).run(block.input ?? {}, ctx) }];
  const entry = toolIndex.get(block.name);
  if (!entry) throw new Error(`Unknown tool ${block.name}`);
  const readOnly = entry.tool.annotations?.readOnlyHint === true;
  if (!(ctx.settings.alwaysAllowedTools?.includes(block.name) || (ctx.settings.autoApproveReadOnly && readOnly))) {
    const d = describeTool(block.name);
    const decision = await ctx.approve({ toolUseId: block.id, server: d.server, tool: d.tool, title: d.title, input: block.input, reason: "This tool can change things." });
    if (decision === "always") ctx.allowAlways(block.name);
    if (decision === "deny") throw new Error("The user declined this action.");
  }
  const result = await mcp.get(entry.server).client.callTool({ name: entry.tool.name, arguments: block.input ?? {} });
  if (result.isError) throw Object.assign(new Error("tool error"), { content: mcpResultToContent(result) });
  return mcpResultToContent(result);
}

// ---------- turn ----------

let client = null;

export async function runApiTurn(ctx, { prompt, events }) {
  const key = apiKey(ctx.config);
  if (!key) {
    ctx.emit({ kind: "error", code: "no_api_key", text: `No Anthropic API key in the Keychain (service "${ctx.config.keychainService}"). Add one with: security add-generic-password -s ${ctx.config.keychainService} -a "$USER" -w — or switch the engine to your Claude subscription in settings.` });
    return null;
  }
  client ??= new Anthropic({ apiKey: key });
  await mcpReady;

  const state = getEngineState(ctx.conversationId);
  const history = state.apiMessages ?? [];
  if (!history.length) {
    const prior = events.filter(e => e.kind === "user" || e.kind === "assistant").slice(-12);
    if (prior.length) prompt = `Earlier in this conversation:\n${prior.map(e => `${e.kind === "user" ? "User" : "You"}: ${e.text}`).join("\n\n")}\n\n---\n\n${prompt}`;
  }
  history.push({ role: "user", content: prompt });
  const tools = claudeTools(ctx.config);
  const usage = { inputTokens: 0, outputTokens: 0 };

  try {
    for (;;) {
      const stream = client.beta.messages.stream(
        {
          model: ctx.settings.model,
          max_tokens: 64000,
          system: systemPrompt({ engine: "api" }),
          messages: history,
          tools,
          thinking: { type: "adaptive", display: "summarized" },
          output_config: { effort: ctx.settings.effort },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: ctx.abortController.signal },
      );
      let messageId = null;
      stream.on("streamEvent", ev => {
        if (ev.type === "message_start") messageId = ev.message.id;
      });
      stream.on("text", d => ctx.delta("assistant.delta", messageId, d));
      stream.on("thinking", d => ctx.delta("thinking.delta", messageId, d));
      const message = await stream.finalMessage();
      history.push({ role: "assistant", content: message.content });
      usage.inputTokens += message.usage?.input_tokens ?? 0;
      usage.outputTokens += message.usage?.output_tokens ?? 0;

      for (const b of message.content) {
        if (b.type === "thinking" && b.thinking?.trim()) ctx.emit({ kind: "thinking", messageId, text: b.thinking });
        if (b.type === "text" && b.text.trim()) ctx.emit({ kind: "assistant", messageId, text: b.text });
        if (b.type === "server_tool_use") ctx.emit({ kind: "tool.call", toolUseId: b.id, category: "web", server: "web", tool: b.name, title: "Search the web", input: b.input });
        if (b.type === "web_search_tool_result") ctx.emit({ kind: "tool.result", toolUseId: b.tool_use_id, ok: Array.isArray(b.content), preview: Array.isArray(b.content) ? b.content.map(r => r.title).join("\n").slice(0, 600) : "Search failed", durationMs: 0 });
      }
      if (message.stop_reason === "refusal") {
        ctx.emit({ kind: "notice", text: `Claude declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.` });
        break;
      }
      if (message.stop_reason === "pause_turn") continue;
      const uses = message.content.filter(b => b.type === "tool_use");
      if (message.stop_reason !== "tool_use" || !uses.length) {
        if (message.stop_reason === "max_tokens") ctx.emit({ kind: "notice", text: "The answer hit the length limit." });
        break;
      }
      const results = await Promise.all(
        uses.map(async b => {
          const d = describeTool(b.name);
          const t0 = Date.now();
          ctx.emit({ kind: "tool.call", toolUseId: b.id, category: d.category, server: d.server, tool: d.tool, title: d.title, input: b.input });
          try {
            const content = await runTool(ctx, b);
            ctx.emit({ kind: "tool.result", toolUseId: b.id, ok: true, preview: content.map(c => c.text ?? `[${c.type}]`).join("\n").slice(0, 600), durationMs: Date.now() - t0 });
            ctx.onToolResult?.({ tool: b.name, ok: true });
            return { type: "tool_result", tool_use_id: b.id, content };
          } catch (err) {
            ctx.emit({ kind: "tool.result", toolUseId: b.id, ok: false, preview: String(err.message ?? err).slice(0, 600), durationMs: Date.now() - t0 });
            return { type: "tool_result", tool_use_id: b.id, is_error: true, content: err.content ?? [{ type: "text", text: String(err.message ?? err) }] };
          }
        }),
      );
      history.push({ role: "user", content: results });
      if (ctx.abortController.signal.aborted) break;
    }
  } catch (err) {
    history.pop(); // keep the stored history valid
    if (ctx.abortController.signal.aborted) return usage;
    if (err instanceof Anthropic.AuthenticationError) ctx.emit({ kind: "error", code: "bad_api_key", text: "The Anthropic API key was rejected." });
    else if (err instanceof Anthropic.RateLimitError) ctx.emit({ kind: "error", text: "Rate limited by the Anthropic API; try again in a moment." });
    else if (err instanceof Anthropic.APIError) ctx.emit({ kind: "error", text: `Claude API error ${err.status ?? ""}: ${err.message}` });
    else throw err;
  } finally {
    setEngineState(ctx.conversationId, { ...state, apiMessages: history });
  }
  return usage;
}
