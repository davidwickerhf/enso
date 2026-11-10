// Ensō helper (native messaging host). Zen starts it when the extension
// connects; it owns conversations, history, memory, settings and the
// dashboard, and runs each chat turn on the subscription or API engine.
// Message contract: ../docs/PROTOCOL.md.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { refreshDashboard, dashboardStale } from "./lib/dashboard.mjs";
import { apiKey, connectMcp, keychain, runApiTurn } from "./lib/engine-api.mjs";
import { prewarm, runSubscriptionTurn, subscriptionAvailable, subscriptionStatus } from "./lib/engine-sub.mjs";
import { log, onMessage, send } from "./lib/native.mjs";
import { pageActionNeedsApproval } from "./lib/pagetools.mjs";
import { turnContext } from "./lib/prompt.mjs";
import { deleteSkill, expandSkill, listSkills, saveSkill } from "./lib/skills.mjs";
import { convertAttachment } from "./lib/attachments.mjs";
import { cleanupStale } from "./lib/headless.mjs";
import { createConnections, friendly } from "./lib/connections.mjs";
import { forgetGithubToken, githubServerEntry, githubWidgetData, saveGithubToken } from "./lib/github.mjs";
import { MCP_PORT, mcpListening, setOAuthRoute, startMcpServer } from "./lib/mcpserver.mjs";
import * as store from "./lib/store.mjs";
import { config, configError, LOCAL_CONFIG } from "./lib/config.mjs";
import { listSpaces } from "./lib/zenspaces.mjs";
import { createTaskSources, refreshTargets } from "./lib/tasks.mjs";
import { createMondaySource } from "./lib/monday.mjs";

store.setDefaults(config.defaults);
if (configError) log(configError);

// Zen starts us with a minimal environment; MCP servers and the claude CLI need these.
process.env.PATH = [path.join(homedir(), ".volta/bin"), path.join(homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", process.env.PATH ?? "/usr/bin:/bin"].join(":");

// ---------- MCP server selection ----------

const toolPrefix = name => `mcp__${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

/** On/off per server: config.json defaults, overridden by the user's toggles in settings. */
function serverEnabled(name) {
  const override = store.getSettings().serverOverrides?.[name];
  if (typeof override === "boolean") return override;
  if (!config.servers[name] && connections.defs()[name]?.custom) return true; // added from the Tools page
  return config.servers[name]?.enabled ?? (name.startsWith("claude.ai ") ? true : config.enableNewServers ?? false);
}

// Where to set a tool up, and what it is good for (shown in the tools panel).
const CATALOG = {
  "claude.ai Gmail": { label: "Gmail", about: "Search, read and draft email in your Google account.", examples: ["What needs a reply from me today?", "Draft a reply to the last mail from my manager"] },
  "claude.ai Google Calendar": { label: "Calendar", about: "Your Google Calendar: events, free time, scheduling.", examples: ["What's on tomorrow?", "Find an hour for deep work this week"] },
  "claude.ai Google Drive": { label: "Drive", about: "Find and read files in Google Drive.", examples: ["Find my notes from last week's planning meeting", "Summarise the latest budget sheet"] },
  "claude.ai Google Docs": { label: "Docs", about: "Read and edit Google Docs.", examples: ["Tighten the intro of my draft"] },
  "claude.ai Microsoft 365": { label: "Microsoft 365", about: "Outlook mail and calendar, Teams chats and meetings, SharePoint and OneDrive.", examples: ["What happened in my Teams chats today?", "Which Outlook mails need me?"] },
  "claude.ai Slack": { label: "Slack", about: "Search channels and messages." },
  "claude.ai Notion": { label: "Notion", about: "Search and edit Notion pages." },
  github: { label: "GitHub", about: "Your pull requests, reviews, issues and notifications across all your orgs and repos (through the GitHub CLI's sign-in). Comments, reviews, labels and closing ask first unless you asked.", examples: ["What's waiting on me on GitHub?", "Why is CI failing on my latest PR?", "Which of my PRs have changes requested?"] },
  monday: { label: "monday.com", about: "Your monday.com boards, items, updates and docs (monday's own MCP server; you sign in with your monday account).", examples: ["What's assigned to me on monday.com this week?", "Summarise the updates on my team's board"] },
  ...(config.catalog ?? {}), // labels and examples for your own servers (config.local.json → catalog)
};
const CONNECT_URL = name => (name.startsWith("claude.ai ") ? "https://claude.ai/customize/connectors" : null);

// Remote MCP servers Ensō signs in to itself (OAuth, tokens in the Keychain):
// config.oauthServers plus servers added from the Tools page. See lib/connections.mjs.
const connections = createConnections({
  dataDir: store.DATA,
  builtIn: config.oauthServers ?? {},
  log,
  callbackBase: () => (mcpListening() ? `http://127.0.0.1:${MCP_PORT}` : null),
  openUrl: async url => (await browserRequest("browser.request", "tabs_open", { urls: [url] }))?.[0]?.tabId,
  closeTab: tabId => browserRequest("browser.request", "tabs_close", { tabIds: [tabId] }).catch(() => {}),
  onChange: done => {
    sendConnections(done);
    if (done?.ok) probeConnection(done.server);
  },
});
setOAuthRoute((req, res) => connections.route(req, res));

function sendConnections(done) {
  setServers([]);
  send({ type: "connections", connections: connections.list(), ...(done ? { done } : {}) });
}

/**
 * After signing in, and on Retry (connections.probe): list the server's tools
 * with the stored token so the Tools page can show them before the first chat,
 * or say that the server itself failed (signed in, but it returned an error).
 */
async function probeConnection(name) {
  const r = await connections.probe(name).catch(err => ({ status: "failed", error: friendly(err) }));
  setServers([{ name, status: r.status, ...(r.toolNames ? { toolNames: r.toolNames } : {}), ...(r.status === "failed" ? { error: r.error ?? "The server returned an error." } : {}) }]);
  if (name === mondayServer()) sendMonday({ fresh: true });
  return r;
}

async function externalServers() {
  let all = {};
  try {
    all = JSON.parse(readFileSync(path.join(homedir(), ".claude.json"), "utf8")).mcpServers ?? {};
  } catch (err) {
    log("could not read ~/.claude.json:", err.message);
  }
  for (const [name, def] of Object.entries(config.extraServers ?? {})) {
    const headers = { ...(def.headers ?? {}) };
    if (def.tokenKeychainService) {
      const token = keychain(def.tokenKeychainService);
      if (!token) continue;
      headers.Authorization = `Bearer ${token}`;
    }
    const { tokenKeychainService, ...rest } = def;
    all[name] = { ...rest, headers };
  }
  // Servers Ensō signs in to itself replace any Claude Code registration of the same name
  // (e.g. `claude mcp add notes`), and are only passed when connected.
  for (const name of Object.keys(connections.defs())) delete all[name];
  Object.assign(all, await connections.sessionServers());
  return Object.fromEntries(Object.entries(all).filter(([name]) => serverEnabled(name)));
}

/** claude.ai connectors (and anything else) switched off in config.servers. */
const disallowedTools = () => {
  const names = new Set([...Object.keys(config.servers), ...Object.keys(store.getSettings().serverOverrides ?? {}), ...serverStatus.map(s => s.name)]);
  return [...names].filter(n => !serverEnabled(n)).map(toolPrefix);
};

// Last known server status, so the UI can show "Your tools" before the first chat.
const SERVERS_FILE = path.join(store.DATA, "servers.json");
let serverStatus = (() => {
  try {
    return JSON.parse(readFileSync(SERVERS_FILE, "utf8"));
  } catch {
    return [];
  }
})();
function setServers(list) {
  const known = new Map(serverStatus.map(s => [s.name, s]));
  for (const s of list) {
    const next = { ...known.get(s.name), ...s };
    if (s.status && s.status !== "failed" && !s.error) delete next.error; // an old failure no longer applies
    known.set(s.name, next);
  }
  const auth = new Map(connections.list().map(c => [c.server, c]));
  for (const name of auth.keys()) if (!known.has(name)) known.set(name, { name, status: "needs-auth" });
  for (const s of serverStatus) if (s.auth?.custom && !auth.has(s.name)) known.delete(s.name); // removed custom server
  // The token may have expired mid-session; a server error (HTTP 5xx) isn't about the token, so no refresh for that.
  for (const s of list) if (auth.get(s.name)?.state === "connected" && /failed|needs-auth/.test(s.status ?? "") && !/server error|HTTP 5\d\d/i.test(s.error ?? "")) connections.recover(s.name);
  serverStatus = [...known.values()].map(s => {
    const meta = CATALOG[s.name] ?? {};
    const a = auth.get(s.name);
    return {
      name: s.name,
      label: meta.label ?? a?.label ?? s.name.replace(/^claude\.ai /, ""),
      status: a && a.state !== "connected" ? (a.state === "connecting" ? "pending" : "needs-auth") : s.status === "needs-auth" && a ? "connected" : s.status,
      enabled: serverEnabled(s.name),
      tools: s.toolNames?.length ?? s.tools ?? null,
      toolNames: s.toolNames ?? [],
      about: meta.about ?? (a?.custom ? `Added by you · ${a.url.replace(/^https?:\/\//, "")}` : ""),
      examples: meta.examples ?? [],
      connectUrl: s.connectUrl ?? CONNECT_URL(s.name),
      source: s.source ?? (s.name.startsWith("claude.ai ") ? "claude.ai connector" : "MCP server"),
      ...(a ? { auth: { type: "oauth", state: a.state, custom: a.custom, url: a.url, ...(a.error ? { error: a.error } : {}), ...(a.authUrl ? { authUrl: a.authUrl } : {}), ...(a.expiresAt ? { expiresAt: a.expiresAt } : {}) } } : {}),
      ...(s.detail ? { detail: s.detail, tokenEntry: !!s.tokenEntry } : {}),
      ...(s.status === "failed" && s.error ? { error: String(s.error).slice(0, 200) } : {}),
    };
  });
  writeFileSync(SERVERS_FILE, JSON.stringify(serverStatus));
  send({ type: "servers", servers: serverStatus });
}

// ---------- browser requests (page tools, tabs, history) ----------

const pending = new Map();
let reqSeq = 0;
function browserRequest(type, action, args, tabId, agent) {
  const reqId = `r${++reqSeq}`;
  send({ type, reqId, action, args, tabId, agent }); // agent: who is acting (MCP client label), shown on the page ribbon
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`The browser did not answer (${action}).`));
    }, action === "session_fetch" ? 75_000 : action === "navigate" || action === "back" ? 45_000 : 20_000);
    pending.set(reqId, { resolve, reject, timer });
  });
}

// ---------- turns ----------

const running = new Map(); // conversationId -> { abortController }
const approvals = new Map(); // toolUseId -> resolve(decision)
const PERSISTED = new Set(["user", "assistant", "thinking", "tool.call", "tool.result", "approval.request", "approval.resolved", "page.action", "notice", "error", "turn.start", "turn.end"]);

/** What the user wrote about a space (Settings → Profile), else config.spaceHints (config.local.json). */
function spaceHint(sp) {
  const own = store.getSettings().spaceHints ?? {};
  return own[sp.id] ?? own[sp.name] ?? config.spaceHints?.[sp.name] ?? "";
}

/** The conversation's space with its hint. */
function spaceInfo(space) {
  if (!space?.id) return null;
  const known = listSpaces().find(s => s.id === space.id) ?? space;
  return { id: known.id, name: known.name, icon: known.icon ?? null, hint: spaceHint(known) };
}

/** The profile for the UI: name and about from profile.md, space hints, and whether onboarding is due. */
function profileState() {
  const p = store.parseProfile();
  const settings = store.getSettings();
  return {
    name: p.name,
    about: p.about,
    summary: p.about.split("\n").map(l => l.replace(/^[-*]\s+/, "").trim()).find(Boolean)?.slice(0, 200) ?? "",
    set: p.set,
    onboarding: !p.set && !settings.onboardingDone,
    spaceHints: Object.fromEntries(listSpaces().map(sp => [sp.id, spaceHint(sp)])),
  };
}

function makeContext(conversationId, settings, tabId, space) {
  const pageQueue = new Map(); // page tool name -> [toolUseId]
  const ctx = {
    conversationId,
    settings,
    config,
    tabId,
    space,
    abortController: new AbortController(),
    emit(event) {
      const full = { id: store.newId(), at: store.now(), ...event };
      if (full.kind === "tool.call" && full.category === "page") {
        const q = pageQueue.get(full.tool) ?? [];
        q.push(full.toolUseId);
        pageQueue.set(full.tool, q);
      }
      if (PERSISTED.has(full.kind)) store.appendEvent(conversationId, full);
      send({ type: "event", conversationId, event: full });
      return full;
    },
    delta(kind, messageId, text) {
      send({ type: "event", conversationId, event: { kind, messageId, text } });
    },
    approve({ toolUseId, server, tool, title, input, reason, alwaysLabel }) {
      const id = toolUseId ?? store.newId();
      ctx.emit({ kind: "approval.request", toolUseId: id, server, tool, title, input, reason, ...(alwaysLabel ? { alwaysLabel } : {}) });
      return new Promise(resolve => {
        approvals.set(id, decision => {
          ctx.emit({ kind: "approval.resolved", toolUseId: id, decision });
          resolve(decision);
        });
        ctx.abortController.signal.addEventListener("abort", () => approvals.get(id)?.("deny"), { once: true });
      });
    },
    allowAlways(toolName) {
      const s = store.getSettings();
      if (!s.alwaysAllowedTools.includes(toolName)) send({ type: "settings", settings: store.updateSettings({ alwaysAllowedTools: [...s.alwaysAllowedTools, toolName] }) });
    },
    servers: setServers,
    page: (action, args, t) => browserRequest("page.request", action, args, t ?? tabId),
    browser: (action, args) => browserRequest("browser.request", action, args, tabId),
    // Shared with the developer/headless tools (see lib/devtools.mjs).
    external: false,
    mode: () => "full",
    toolUse: name => pageQueue.get(name)?.shift(),
    ask: ({ toolUseId, tool, title, input, reason, alwaysLabel }) => ctx.approve({ toolUseId, server: "Browser", tool, title, input, reason, alwaysLabel }),
    record({ toolUseId, action, url, title, target, ok }) {
      const ev = ctx.emit({ kind: "page.action", toolUseId, url: url ?? "", title: title ?? "", action, target: target ?? "", ok: ok !== false });
      let host = "";
      try {
        host = new URL(ev.url).host;
      } catch {}
      store.logAction({ id: ev.id, at: ev.at, conversationId, url: ev.url, title: ev.title, host, action, target: ev.target, ok: ev.ok });
    },
    async act(action, bridgeArgs, intent) {
      const toolName = `page_${action}`;
      const toolUseId = pageQueue.get(toolName)?.shift();
      if (pageActionNeedsApproval(intent)) {
        const titles = { eval: "Run JavaScript on the page", storage: "Read the page's storage values" };
        const decision = await ctx.approve({ toolUseId, server: "Page", tool: toolName, title: titles[action] ?? `${action[0].toUpperCase()}${action.slice(1)} on the page`, input: bridgeArgs, reason: intent.irreversible ? "This can't be undone." : "Claude suggested this step itself." });
        if (decision === "deny") throw new Error("The user declined this page action.");
      }
      let result;
      try {
        result = await ctx.page(action, bridgeArgs, intent?.tabId);
      } catch (err) {
        ctx.emit({ kind: "page.action", toolUseId, url: "", title: "", action, target: String(bridgeArgs.ref ?? bridgeArgs.url ?? ""), ok: false });
        throw err;
      }
      ctx.record({ toolUseId, action, url: result.url, title: result.title, target: result.description ?? bridgeArgs.url ?? bridgeArgs.key ?? "", ok: result.ok !== false });
      return result;
    },
    async confirm(tool, title, input) {
      return (await ctx.approve({ server: "Browser", tool, title, input, reason: "Claude suggested this step itself." })) !== "deny";
    },
    reportsChanged: () => send({ type: "reports", reports: store.listReports() }),
    onToolResult,
  };
  return ctx;
}

const tag = (name, attrs, body) => `<${name} ${Object.entries(attrs).map(([k, v]) => `${k}="${String(v ?? "").replace(/"/g, "'")}"`).join(" ")}>\n${body}\n</${name}>`;

function buildPrompt(msg, text) {
  const parts = [];
  const blocks = [];
  if (msg.page?.text) parts.push(tag("page", { url: msg.page.url, title: msg.page.title, note: "the tab the user is looking at" }, msg.page.text));
  for (const t of msg.mentionedTabs ?? []) parts.push(tag("tab", { url: t.url, title: t.title, note: "a tab the user mentioned" }, t.text ?? ""));
  if (msg.page?.screenshot) blocks.push({ type: "image", source: { type: "base64", media_type: "image/png", data: msg.page.screenshot.split(",")[1] } });
  for (const a of msg.attachments ?? []) {
    const { blocks: b, notes } = convertAttachment(a);
    blocks.push(...b);
    parts.push(...notes);
  }
  if (!msg.page?.text && msg.page?.url) parts.push(`(The user is on ${msg.page.url} — "${msg.page.title}". Use page_read if you need it.)`);
  const prose = [...parts, text].join("\n\n");
  return blocks.length ? [...blocks, { type: "text", text: prose }] : prose;
}

async function chat(msg) {
  const { conversationId } = msg;
  if (running.has(conversationId)) return send({ type: "event", conversationId, event: { kind: "notice", text: "Still answering the previous message." } });
  const conversation = store.getConversation(conversationId);
  if (!conversation) return send({ type: "event", conversationId, event: { kind: "error", text: "This conversation no longer exists." } });

  const settings = store.getSettings();
  if (!conversation.space && msg.space?.id) {
    const sp = spaceInfo(msg.space);
    store.updateConversation(conversationId, { space: { id: sp.id, name: sp.name, icon: sp.icon } });
  }
  const ctx = makeContext(conversationId, settings, msg.page?.tabId, spaceInfo(store.getConversation(conversationId).space));
  running.set(conversationId, ctx);
  const events = store.readEvents(conversationId);
  const text = msg.skill ? expandSkill(msg.skill, msg.text) : msg.text;

  ctx.emit({
    kind: "user",
    text: msg.skill ? `/${msg.skill}${msg.text ? " " + msg.text : ""}` : msg.text,
    page: msg.page?.text || msg.page?.screenshot ? { url: msg.page.url, title: msg.page.title } : null,
    tabs: (msg.mentionedTabs ?? []).map(t => ({ url: t.url, title: t.title })),
    attachments: (msg.attachments ?? []).map(a => ({ name: a.name, mimeType: a.mimeType })),
    screenshot: !!msg.page?.screenshot,
  });
  if (conversation.messageCount <= 1 && conversation.title === "New chat") {
    const title = (msg.skill ? `/${msg.skill} ${msg.text ?? ""}` : msg.text).replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
    send({ type: "conversation.updated", conversation: store.updateConversation(conversationId, { title, engine: settings.engine }) });
  }
  ctx.emit({ kind: "turn.start" });

  let usage = null;
  try {
    const prompt = buildPrompt(msg, turnContext({ space: ctx.space }) + text);
    usage =
      settings.engine === "api"
        ? await runApiTurn(ctx, { prompt, events })
        : await runSubscriptionTurn(ctx, { prompt, events, servers: await externalServers(), disallowed: disallowedTools() });
  } catch (err) {
    if (!ctx.abortController.signal.aborted) {
      log("turn failed:", err.stack ?? err);
      ctx.emit({ kind: "error", text: String(err.message ?? err).slice(0, 600), ...(err.code ? { code: err.code } : {}) });
    }
  } finally {
    running.delete(conversationId);
    const stopped = ctx.abortController.signal.aborted;
    if (stopped) ctx.emit({ kind: "notice", text: "Stopped." });
    ctx.emit({ kind: "turn.end", usage, stopped });
    send({ type: "conversation.updated", conversation: store.getConversation(conversationId) });
  }
}

// ---------- GitHub (built in: lib/github.mjs) ----------

/** Puts GitHub's connection status into the tools list. */
async function refreshGithub(fresh = false) {
  try {
    setServers([await githubServerEntry({ fresh })]);
  } catch (err) {
    log("github status:", err.message);
  }
}

// ---------- tasks (new-tab Tasks widget: lib/tasks.mjs) ----------

// Enabled, connected http servers that list_tasks, which the helper can call itself
// (claude.ai connectors can't be: their tasks come through the dashboard run).
const tasks = createTaskSources({
  log,
  candidates: async () => {
    const defs = await externalServers();
    return Object.entries(defs)
      .filter(([name, def]) => def.url && (def.type ?? "http") === "http" && serverStatus.find(s => s.name === name)?.toolNames?.includes("list_tasks"))
      .map(([name, def]) => ({ name, label: serverStatus.find(s => s.name === name)?.label ?? name, def }));
  },
});

async function sendTasks({ fresh = false, maxAge } = {}) {
  try {
    send({ type: "tasks", data: await tasks.widget({ fresh, maxAge }) });
  } catch (err) {
    send({ type: "tasks", error: String(err.message ?? err).slice(0, 300) });
  }
}

/** The user ticked a task in the widget: complete it at its app (an explicit click, so no approval), log it, refresh. */
async function completeTask({ server, id }) {
  const task = tasks.cached?.tasks.find(t => t.server === server && t.id === id);
  let ok = true;
  let error;
  try {
    await tasks.complete({ server, id });
  } catch (err) {
    ok = false;
    error = String(err.message ?? err).slice(0, 200);
    log(`complete task on ${server}:`, error);
  }
  let host = "";
  try {
    host = new URL(task?.url ?? "").host;
  } catch {}
  store.logAction({ id: store.newId(), at: store.now(), conversationId: null, source: "Tasks widget", url: task?.url ?? "", title: task?.source ?? server, host, action: "complete_task", target: task?.title ?? id, ok });
  send({ type: "tasks.completed", server, id, ok, ...(error ? { error } : {}) });
  await sendTasks({ fresh: true });
}

// ---------- monday.com (new-tab widget: lib/monday.mjs) ----------

/** The OAuth server for monday's hosted MCP (named "monday" from the Tools page, or any server at mcp.monday.com). */
function mondayServer() {
  const defs = connections.defs();
  if (defs.monday) return "monday";
  return Object.keys(defs).find(n => /(^|\.)monday\.com$/i.test((() => { try { return new URL(defs[n].url).hostname; } catch { return ""; } })())) ?? null;
}

const monday = createMondaySource({
  log,
  target: async () => {
    const name = mondayServer();
    if (!name) return { state: "not-connected", reason: serverStatus.some(s => /^claude\.ai .*monday/i.test(s.name)) ? "claude.ai" : "missing" };
    if (!serverEnabled(name)) return { state: "not-connected", reason: "off" };
    const c = connections.list().find(x => x.server === name);
    if (c?.state !== "connected") return { state: "not-connected", reason: c?.state ?? "disconnected" };
    const headers = await connections.headersFor(name).catch(() => null);
    if (!headers) return { state: "not-connected", reason: "expired" };
    return { state: "connected", name, def: { url: connections.defs()[name].url, headers } };
  },
});

async function sendMonday({ fresh = false, maxAge } = {}) {
  send({ type: "monday", data: await monday.widget({ fresh, maxAge }) });
}

// ---------- refresh widgets after a write (both engines call ctx.onToolResult) ----------

const pendingRefresh = new Map(); // "tasks|<server>" | "monday" -> timer

/** Debounced: several writes in one turn give one refetch, a moment after the last. */
function scheduleRefresh(key, run) {
  clearTimeout(pendingRefresh.get(key));
  pendingRefresh.set(key, setTimeout(() => {
    pendingRefresh.delete(key);
    run().catch(err => log(`refresh after write (${key}):`, err.message));
  }, 1200));
}

/**
 * A chat tool call finished. A successful write to a task app (create_task,
 * update_task, complete…) refetches that app's tasks and pushes them, with the
 * new ones marked; any write to monday refetches the monday widget.
 */
function onToolResult({ tool, ok }) {
  if (!ok) return;
  const target = refreshTargets(tool, {
    serverNames: new Set([...serverStatus.map(s => s.name), ...Object.keys(connections.defs()), ...Object.keys(config.extraServers ?? {})]),
    taskServers: serverStatus.filter(s => s.toolNames?.includes("list_tasks")).map(s => s.name),
    mondayServer: mondayServer(),
  });
  if (target.monday) {
    scheduleRefresh("monday", async () => {
      const { data, added } = await monday.refreshAfterWrite();
      send({ type: "monday", data, ...(added.length ? { added } : {}) });
    });
  }
  if (target.tasks) {
    scheduleRefresh(`tasks|${target.tasks}`, async () => {
      const { data, added } = await tasks.refreshAfterWrite(target.tasks);
      send({ type: "tasks", data, ...(added.length ? { added } : {}) });
    });
  }
}

/** What task apps and monday say is due soon, for the dashboard brief (already-fetched data, no extra calls). */
async function dueSoonBrief() {
  const lines = [];
  const t = await tasks.widget().catch(() => null);
  const m = await monday.widget().catch(() => null);
  const soon = d => d && Date.parse(d.length === 10 ? `${d}T23:59:59` : d) < Date.now() + 7 * 86_400_000;
  for (const x of t?.tasks ?? []) if (soon(x.due)) lines.push(`- ${x.title} · ${x.source} · due ${x.due}${x.remindAt ? ` (reminder ${x.remindAt})` : ""}${x.url ? ` · ${x.url}` : ""}`);
  if (m?.state === "ok") for (const x of m.items) if (soon(x.due)) lines.push(`- ${x.title} · monday.com (${x.board}${x.status ? `, ${x.status}` : ""}) · due ${x.due}${x.url ? ` · ${x.url}` : ""}`);
  return { text: lines.slice(0, 20).join("\n"), servers: [...(t?.servers ?? []).filter(s => s.ok).map(s => s.name), ...(m?.state === "ok" ? [mondayServer()] : [])] };
}

// ---------- dashboard ----------

async function dashboard(force) {
  const settings = store.getSettings();
  if (!force && !dashboardStale(settings)) return;
  if (!(await subscriptionAvailable())) return send({ type: "dashboard", error: (await subscriptionStatus()).reason || "The dashboard needs Claude Code, installed and signed in." });
  send({ type: "dashboard", loading: true });
  try {
    send({ type: "dashboard", data: await refreshDashboard({ servers: await externalServers(), disallowed: disallowedTools(), settings, dueSoon: await dueSoonBrief().catch(() => null) }) });
  } catch (err) {
    log("dashboard:", err.message);
    send({ type: "dashboard", error: String(err.message ?? err).slice(0, 300), data: store.getDashboard() });
  }
}

// ---------- engines ----------

async function enginesState() {
  const sub = await subscriptionStatus();
  return {
    subscription: { available: sub.available, label: "Claude subscription (Claude Code)", ...(sub.reason ? { reason: sub.reason } : {}), ...(sub.path ? { path: sub.path, version: sub.version } : {}) },
    api: { available: !!apiKey(config), label: "Anthropic API key" },
  };
}

// ---------- messages from the extension ----------

async function handle(msg) {
  switch (msg.type) {
    case "hello": {
      const settings = store.getSettings();
      setServers([]); // include servers Ensō signs in to itself, connected or not
      send({
        type: "state",
        settings,
        engines: await enginesState(),
        servers: serverStatus,
        connections: connections.list(),
        conversations: store.listConversations(),
        activeConversationId: [...running.keys()][0] ?? null,
        dashboard: store.getDashboard(),
        profile: profileState(),
        paths: { data: store.DATA, localConfig: LOCAL_CONFIG },
        skills: listSkills(),
        sensitiveHosts: config.sensitiveHosts,
        spaces: listSpaces(),
        reports: store.listReports(),
      });
      if (settings.engine === "api") connectMcp(await externalServers(), setServers);
      else if (await subscriptionAvailable()) prewarm({ settings, config, servers: await externalServers(), disallowed: disallowedTools() });
      dashboard(false);
      refreshGithub();
      break;
    }
    case "conversation.new":
      send({ type: "conversation.created", conversation: store.createConversation(store.getSettings().engine) });
      break;
    case "conversation.open": {
      const conversation = store.getConversation(msg.id);
      if (conversation) send({ type: "conversation.loaded", id: msg.id, conversation, events: store.readEvents(msg.id) });
      break;
    }
    case "conversation.rename":
      send({ type: "conversation.updated", conversation: store.updateConversation(msg.id, { title: String(msg.title).slice(0, 120), updatedAt: store.getConversation(msg.id)?.updatedAt }) });
      break;
    case "conversation.delete":
      running.get(msg.id)?.abortController.abort();
      store.deleteConversation(msg.id);
      send({ type: "conversation.deleted", id: msg.id });
      break;
    case "chat.send":
      await chat(msg);
      break;
    case "chat.stop":
      running.get(msg.conversationId)?.abortController.abort();
      break;
    case "approval.reply":
      approvals.get(msg.id)?.(msg.decision);
      approvals.delete(msg.id);
      break;
    case "history.search":
      send({ type: "history.results", query: msg.query, spaceId: msg.spaceId ?? null, results: store.searchHistory(msg.query, 30, msg.spaceId) });
      break;
    case "actions.list":
      send({ type: "actions.results", actions: store.listActions(msg) });
      break;
    case "dashboard.refresh":
      await dashboard(true);
      break;
    case "settings.update": {
      const settings = store.updateSettings(msg.patch ?? {});
      send({ type: "settings", settings });
      if ("claudePath" in (msg.patch ?? {})) send({ type: "engines", engines: await enginesState() });
      if (settings.engine === "api") connectMcp(await externalServers(), setServers);
      break;
    }
    case "profile.save": {
      // Onboarding and Settings → Profile. skip: true just marks onboarding as done.
      const patch = {};
      if (!msg.skip) store.saveProfile({ name: msg.name, about: msg.about });
      if (msg.skip || !store.getSettings().onboardingDone) patch.onboardingDone = true;
      if (msg.spaceHints && typeof msg.spaceHints === "object") {
        const hints = { ...(store.getSettings().spaceHints ?? {}) };
        for (const [id, text] of Object.entries(msg.spaceHints)) {
          const t = String(text ?? "").trim().slice(0, 600);
          if (t) hints[id] = t;
          else delete hints[id];
        }
        patch.spaceHints = hints;
      }
      if (Object.keys(patch).length) send({ type: "settings", settings: store.updateSettings(patch) });
      send({ type: "profile", profile: profileState() });
      break;
    }
    case "profile.get":
      send({ type: "profile", profile: profileState() });
      break;
    case "memory.get":
      send({ type: "memory", spaceId: msg.spaceId ?? null, text: store.getMemory(msg.spaceId) });
      break;
    case "memory.set":
      store.setMemory(String(msg.text ?? ""), msg.spaceId);
      send({ type: "memory", spaceId: msg.spaceId ?? null, text: store.getMemory(msg.spaceId) });
      break;
    case "tools.toggle": {
      const overrides = { ...(store.getSettings().serverOverrides ?? {}), [msg.name]: !!msg.enabled };
      send({ type: "settings", settings: store.updateSettings({ serverOverrides: overrides }) });
      setServers(serverStatus.map(s => ({ ...s })));
      break;
    }
    case "connections.status":
      sendConnections();
      break;
    case "connections.start":
      await connections.start(String(msg.server)).catch(err => log("connect failed:", err.message));
      break;
    case "connections.add":
      try {
        const name = connections.addCustom({ name: msg.name, url: msg.url, label: msg.label });
        await connections.start(name).catch(err => log("connect failed:", err.message));
      } catch (err) {
        send({ type: "connections", connections: connections.list(), done: { server: String(msg.name ?? ""), ok: false, error: err.message, add: true } });
      }
      break;
    case "connections.probe": {
      // Retry for a server that is signed in but failed: list its tools again (no new sign-in).
      const name = String(msg.server ?? "");
      if (!connections.has(name)) break;
      const r = await probeConnection(name);
      send({ type: "connections.probed", server: name, ok: !!r.ok, status: r.status, ...(r.error ? { error: r.error } : {}) });
      break;
    }
    case "connections.disconnect":
      await connections.disconnect(String(msg.server)).catch(err => log("disconnect failed:", err.message));
      setServers([{ name: String(msg.server), status: "needs-auth", toolNames: [] }]);
      break;
    case "connections.remove":
      await connections.removeCustom(String(msg.server)).catch(err => log("remove failed:", err.message));
      break;
    case "spaces.list":
      send({ type: "spaces", spaces: listSpaces() });
      break;
    case "skills.save":
      try {
        send({ type: "skills", skills: saveSkill(msg.skill) });
      } catch (err) {
        send({ type: "event", conversationId: null, event: { kind: "error", text: err.message } });
      }
      break;
    case "skills.delete":
      send({ type: "skills", skills: deleteSkill(msg.name) });
      break;
    case "report.get":
      send({ type: "report", report: store.getReport(msg.id) });
      break;
    case "reports.list":
      send({ type: "reports", reports: store.listReports() });
      break;
    case "github.widget":
      try {
        send({ type: "github", data: await githubWidgetData({ fresh: !!msg.force }) });
      } catch (err) {
        send({ type: "github", error: String(err.message ?? err).slice(0, 300) });
      }
      break;
    case "tasks.widget":
      await sendTasks({ fresh: !!msg.force, maxAge: Number(msg.maxAge) || undefined });
      break;
    case "monday.widget":
      await sendMonday({ fresh: !!msg.force, maxAge: Number(msg.maxAge) || undefined });
      break;
    case "tasks.complete":
      await completeTask({ server: String(msg.server ?? ""), id: String(msg.id ?? "") });
      break;
    case "github.token":
      try {
        const { login } = await saveGithubToken(msg.token);
        send({ type: "github.saved", ok: true, login });
      } catch (err) {
        send({ type: "github.saved", ok: false, error: String(err.message ?? err).slice(0, 200) });
      }
      await refreshGithub(true);
      break;
    case "github.forget":
      await forgetGithubToken();
      await refreshGithub(true);
      break;
    case "page.response":
    case "browser.response": {
      const p = pending.get(msg.reqId);
      if (!p) break;
      clearTimeout(p.timer);
      pending.delete(msg.reqId);
      if (msg.ok) p.resolve(msg.result ?? {});
      else p.reject(new Error(msg.error || "The page action failed."));
      break;
    }
  }
}

onMessage(msg => handle(msg).catch(err => log("handler failed:", err.stack ?? err)));

// Headless Zen leftovers from a helper that crashed.
cleanupStale();

// Let other Claude sessions (Claude Code, T3 Code) use Zen through MCP.
startMcpServer({ browserRequest, onReports: () => send({ type: "reports", reports: store.listReports() }) });
process.stdin.on("end", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
