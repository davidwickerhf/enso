// Ensō → T3 Code: send screenshots (and a message) to the user's own T3 Code
// threads on this Mac. Docs: docs/PROTOCOL.md "T3", docs/security.md "T3 Code".
//
// How Ensō reaches T3 (checked against T3 Code 0.1.9-nightly, orchestration
// protocol 2; the server is open source, github.com/pingdotgg/t3code):
//
//   token     `t3 auth session issue --scope orchestration:read --scope
//             orchestration:operate --label Ensō --ttl 30d --json`, kept in the
//             login Keychain (service enso-t3). Nothing else is granted: no
//             settings, terminal, filesystem or source-control scopes.
//   status    GET  /.well-known/t3/environment          (no auth: environment id,
//                                                         protocol, capabilities)
//             GET  /api/auth/session                     (bearer: is the token alive)
//   threads   GET  /api/orchestration/shell?omitOlderSettled=1&omitIdleSubagents=1
//             (bearer + x-t3-orchestration-protocol: 2)
//   upload    POST /api/auth/websocket-ticket/rpc → ticket
//             WS   /ws?orchestrationProtocol=2&wsTicket=…  (Effect RPC, JSON frames)
//                  attachments.createUploadUrl {type:image,name,mimeType,sizeBytes}
//             POST <relativeUrl>  the exact bytes (a signed, 10-minute upload URL)
//   send      WS   orchestration.dispatchCommand {type:"message.dispatch", …,
//                  attachments:[{type:image,id,…}], dispatchMode:{type:"queue_after_active"}}
//             A busy thread gets it as its next turn; nothing is interrupted.
//
// This is the API T3's own web and mobile clients use with a paired bearer
// session. T3's MCP endpoint (/mcp, t3_attachment_prepare_upload …) only
// accepts MCP-client sessions, which cap the runtime mode at approval-required
// and so refuse every full-access thread; it is not used.
//
// Fallback (no WebSocket in this Node, the server lacks attachment uploads or
// speaks another protocol): the PNG is saved under the data folder's
// screenshots/ and its path is sent as text with `t3 thread send <id> -`,
// T3's public CLI. Claude Code and Codex open images by path.
//
// Only loopback origins are used: screenshots never leave this Mac.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { deleteSecret, readSecret, writeSecret } from "./keychain.mjs";

export const T3_SERVICE = "enso-t3";
export const T3_SCOPES = ["orchestration:read", "orchestration:operate"];
export const T3_LABEL = "Ensō";
export const T3_TTL = "30d";
export const PROTOCOL = "2";
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // T3's per-image limit
const DEFAULT_ORIGIN = "http://127.0.0.1:3773";
const TIMEOUT_MS = 15_000;

export class T3Error extends Error {
  /** code: cli_missing | not_connected | server_down | unauthorized | incompatible | not_found | too_large | failed */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MESSAGES = {
  cli_missing: "T3 Code's `t3` command wasn't found. Open T3 Code once (it installs ~/.t3/bin/t3), then try again.",
  not_connected: "Ensō isn't connected to T3 Code yet. Connect it in Settings → Connections → T3 Code (or run `enso t3 connect`).",
  server_down: "T3 Code isn't running. Open T3 Code and try again.",
  unauthorized: "T3 Code no longer accepts Ensō's token (it expired or was revoked). Connect again in Settings → Connections → T3 Code.",
  incompatible: "This T3 Code version speaks a different protocol than Ensō expects.",
};
const err = (code, message = MESSAGES[code]) => new T3Error(code, message);

export function t3Home(env = process.env) {
  return env.T3CODE_HOME || path.join(env.HOME || homedir(), ".t3");
}

export function cliPath(env = process.env) {
  const candidates = [env.T3CODE_CLI_PATH, path.join(t3Home(env), "bin", "t3")].filter(Boolean);
  return candidates.find(p => existsSync(p)) ?? null;
}

const isLoopback = origin => {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
};

/** The running server's origin (from its runtime file), loopback only. */
export function serverOrigin(env = process.env) {
  if (env.ENSO_T3_ORIGIN && isLoopback(env.ENSO_T3_ORIGIN)) return env.ENSO_T3_ORIGIN.replace(/\/$/, "");
  try {
    const rt = JSON.parse(readFileSync(path.join(t3Home(env), "userdata", "server-runtime.json"), "utf8"));
    if (rt.origin && isLoopback(rt.origin)) return String(rt.origin).replace(/\/$/, "");
    if (Number.isInteger(rt.port)) return `http://127.0.0.1:${rt.port}`;
  } catch {}
  return DEFAULT_ORIGIN;
}

/** The T3 app bundle the CLI wrapper points at (Nightly and Alpha can both be installed). */
export function appBundle(env = process.env) {
  const cli = cliPath(env);
  if (!cli) return null;
  try {
    const m = /app='([^']+\.app)\//.exec(readFileSync(cli, "utf8"));
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function defaultRunCli(env) {
  return (args, { input } = {}) =>
    new Promise(resolve => {
      const cli = cliPath(env);
      if (!cli) return resolve({ code: 127, stdout: "", stderr: "" });
      const childEnv = { ...env };
      delete childEnv.T3CODE_THREAD_ID; // Ensō acts for the user, not as the agent that started it
      const child = spawn(cli, args, { env: childEnv, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", d => (stdout += d));
      child.stderr.on("data", d => (stderr += d));
      child.on("error", () => resolve({ code: 127, stdout: "", stderr: "" }));
      child.on("close", code => resolve({ code, stdout, stderr }));
      if (input != null) child.stdin.end(input);
    });
}

export const keychainStore = {
  read: () => readSecret(T3_SERVICE),
  write: value => writeSecret(T3_SERVICE, value, "Enso T3 token"),
  delete: () => deleteSecret(T3_SERVICE),
};

// ---------- thread list and target resolution (pure) ----------

const time = iso => (iso ? Date.parse(iso) || 0 : 0);

/** Compact rows for the picker: no subagents, archived or deleted threads. */
export function mapShell(shell) {
  const projects = (shell?.projects ?? [])
    .filter(p => !p.archivedAt)
    .map(p => ({
      id: p.id,
      title: p.title,
      workspaceRoot: p.workspaceRoot ?? "",
      repo: p.repositoryIdentity?.canonicalKey ?? "",
      repoName: p.repositoryIdentity?.name ?? "",
      repoOwner: p.repositoryIdentity?.owner ?? "",
      scripts: (p.scripts ?? []).map(s => String(s?.command ?? "")).filter(Boolean).slice(0, 20),
    }));
  const titleOf = new Map(projects.map(p => [p.id, p.title]));
  const threads = (shell?.threads ?? [])
    .filter(t => !t.archivedAt && !t.deletedAt && t.lineage?.relationshipToParent !== "subagent")
    .map(t => {
      const waiting = !!t.pendingRuntimeRequest || t.status === "waiting";
      const running = !waiting && (t.status === "running" || (t.activeRunId != null && t.status !== "idle"));
      const activeAt = Math.max(time(t.latestRunRequestedAt), time(t.latestUserMessageAt), time(t.updatedAt), time(t.lastVisitedAt));
      return { id: t.id, title: t.title || "Untitled thread", projectId: t.projectId, projectTitle: titleOf.get(t.projectId) ?? "", status: waiting ? "waiting" : t.status ?? "idle", running, waiting, activeAt: activeAt ? new Date(activeAt).toISOString() : null };
    })
    .sort((a, b) => Number(b.waiting || b.running) - Number(a.waiting || a.running) || time(b.activeAt) - time(a.activeAt));
  return { threads, projects };
}

const GENERIC = new Set(["www", "app", "apps", "localhost", "com", "org", "net", "io", "dev", "co", "uk", "nl", "de", "edu", "html", "web", "local", "test", "example", "staging", "beta", "preview", "vercel", "netlify", "github", "gitlab", "pages"]);
const words = s =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 3 && !GENERIC.has(w));

/** How well a project matches a page URL: 3 repo page, 2 dev-server port, 1 name, 0 none. */
export function projectMatch(project, url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 0;
  }
  const [owner, name] = u.pathname.split("/").filter(Boolean);
  if (project.repo && owner && name) {
    const key = `${u.hostname}/${owner}/${name}`.toLowerCase().replace(/\.git$/, "");
    if (project.repo.toLowerCase() === key) return 3;
  }
  if (["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(u.hostname) && u.port) {
    const p = u.port;
    if ((project.scripts ?? []).some(c => new RegExp(`(?:--port[ =]|PORT=|:)${p}\\b`).test(c))) return 2;
    return 0;
  }
  const hostWords = words(u.hostname);
  const projWords = new Set([...words(project.title), ...words(project.repoName), ...words(path.basename(project.workspaceRoot ?? ""))]);
  return hostWords.some(w => projWords.has(w)) ? 1 : 0;
}

/** Picker order: running/waiting first, then recent threads in matching projects, then the rest by recency. */
export function orderForPicker(threads, projects, url, preferProjectId = null) {
  const score = new Map(projects.map(p => [p.id, p.id === preferProjectId ? 10 : projectMatch(p, url)]));
  return [...threads].sort(
    (a, b) =>
      Number(b.waiting || b.running) - Number(a.waiting || a.running) ||
      (score.get(b.projectId) ?? 0) - (score.get(a.projectId) ?? 0) ||
      time(b.activeAt) - time(a.activeAt),
  );
}

export const hostKey = url => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? u.host.toLowerCase() : "";
  } catch {
    return "";
  }
};

/**
 * Where a screenshot of this tab goes, in order:
 *   1. agent      an external agent works on this tab: its T3 thread when its launcher
 *                 said so (T3CODE_THREAD_ID), else the agent itself (MCP inbox)
 *   2. tab-link   the user linked this tab to a T3 thread or an agent
 *   3. host-link  the user linked this site to a T3 project: its most active, most recent thread
 *   4. picker     nothing known: the user picks
 * → { target: { kind: "t3" | "agent", id } | null, source, client?, projectId?, suggestions }
 * sessions: agent sessions (agentsessions list()); agents: connected agents (connected()).
 */
export function resolveTarget({ tabId = null, url = "", sessions = [], agents = [], links = {}, threads = [], projects = [] }) {
  const host = hostKey(url);
  const suggestions = hostProject => orderForPicker(threads, projects, url, hostProject);
  const session = tabId != null ? sessions.find(s => s.tabId === tabId && !s.stopped && (s.t3ThreadId || s.agentId)) : null;
  if (session?.t3ThreadId) return { target: { kind: "t3", id: session.t3ThreadId }, source: "agent", client: session.client, suggestions: suggestions() };
  if (session?.agentId && agents.some(a => a.id === session.agentId)) return { target: { kind: "agent", id: session.agentId }, source: "agent", client: session.client, suggestions: suggestions() };
  const tabLink = tabId != null ? (links.tabs ?? []).find(l => l.tabId === tabId && (!l.host || !host || l.host === host)) : null;
  if (tabLink && (tabLink.kind !== "agent" || agents.some(a => a.id === tabLink.id))) return { target: { kind: tabLink.kind ?? "t3", id: tabLink.id ?? tabLink.threadId }, source: "tab-link", suggestions: suggestions() };
  const hostLink = host ? links.hosts?.[host] : null;
  if (hostLink?.projectId) {
    const list = suggestions(hostLink.projectId);
    const best = list.find(t => t.projectId === hostLink.projectId) ?? null;
    return { target: best ? { kind: "t3", id: best.id } : null, source: "host-link", projectId: hostLink.projectId, suggestions: list };
  }
  return { target: null, source: "picker", suggestions: suggestions() };
}

/** The text that goes with a screenshot. */
export function composeMessage({ message = "", url = "", title = "", consoleErrors = [], path: filePath = "" } = {}) {
  const parts = [];
  const m = String(message ?? "").trim();
  if (m) parts.push(m);
  const ctx = [];
  if (url) ctx.push(`Page: ${title ? `${String(title).slice(0, 200)} — ` : ""}${url}`);
  if (consoleErrors.length) {
    const lines = consoleErrors.slice(-20).map(e => `- ${String(e.text ?? e).replace(/\s+/g, " ").slice(0, 300)}`);
    ctx.push(`Console errors (${consoleErrors.length}, most recent last):\n${lines.join("\n")}`);
  }
  if (filePath) ctx.push(`Screenshot (PNG, open it to see the page): ${filePath}`);
  if (ctx.length) parts.push(`${filePath ? "From Ensō" : "Screenshot from Ensō"}\n${ctx.join("\n")}`);
  return parts.join("\n\n") || "Screenshot from Ensō";
}

// ---------- the client ----------

/**
 * createT3({ env, secrets, runCli, fetch, WebSocket, origin }) → client.
 * Every dependency is injectable for tests (test/t3.test.mjs uses a fake server,
 * a fake CLI and an in-memory store).
 */
export function createT3({ env = process.env, secrets = keychainStore, runCli = defaultRunCli(env), fetch: fetchImpl = globalThis.fetch, WebSocket: WS = globalThis.WebSocket, origin: fixedOrigin = null, timeoutMs = TIMEOUT_MS } = {}) {
  const origin = () => fixedOrigin ?? serverOrigin(env);
  let descriptorCache = null; // { at, value }
  let lastShell = null; // { at, threads, projects }

  async function readStored() {
    const raw = await secrets.read().catch(() => null);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return typeof v?.token === "string" && v.token ? v : null;
    } catch {
      return null;
    }
  }

  async function request(p, { method = "GET", headers = {}, body, token, protocol = false } = {}) {
    const h = { ...headers };
    if (token) h.authorization = `Bearer ${token}`;
    if (protocol) h["x-t3-orchestration-protocol"] = PROTOCOL;
    let res;
    try {
      res = await fetchImpl(origin() + p, { method, headers: h, body, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw err("server_down");
    }
    if (res.status === 401) throw err("unauthorized");
    if (res.status === 426) throw err("incompatible");
    return res;
  }

  async function descriptor(fresh = false) {
    if (!fresh && descriptorCache && Date.now() - descriptorCache.at < 60_000) return descriptorCache.value;
    const res = await request("/.well-known/t3/environment");
    if (!res.ok) throw err("server_down");
    const value = await res.json();
    descriptorCache = { at: Date.now(), value };
    return value;
  }

  const attachmentsSupported = d => !!WS && String(d?.orchestrationProtocolVersion) === PROTOCOL && d?.capabilities?.attachmentUploads === true;

  async function requireToken() {
    const stored = await readStored();
    if (!stored) throw err("not_connected");
    return stored.token;
  }

  // ---- Effect RPC over T3's WebSocket (one short connection per operation) ----
  async function withRpc(fn) {
    const token = await requireToken();
    const tr = await request("/api/auth/websocket-ticket/rpc", { method: "POST", token });
    if (!tr.ok) throw err("failed", `T3 Code refused a WebSocket ticket (${tr.status}).`);
    const { ticket } = await tr.json();
    const ws = new WS(`${origin().replace(/^http/, "ws")}/ws?orchestrationProtocol=${PROTOCOL}&wsTicket=${encodeURIComponent(ticket)}`);
    const pending = new Map();
    let nextId = 0;
    let closed = null;
    const failAll = e => {
      closed = e;
      for (const p of pending.values()) p.reject(e);
      pending.clear();
    };
    ws.onmessage = ev => {
      let msgs;
      try {
        msgs = [].concat(JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8")));
      } catch {
        return;
      }
      for (const m of msgs) {
        if (m?._tag === "Ping") ws.send(JSON.stringify({ _tag: "Pong" }));
        if (m?._tag !== "Exit") continue;
        const p = pending.get(String(m.requestId));
        if (!p) continue;
        pending.delete(String(m.requestId));
        if (m.exit?._tag === "Success") p.resolve(m.exit.value);
        else p.reject(rpcFailure(m.exit));
      }
    };
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(err("server_down")), timeoutMs);
      ws.onopen = () => (clearTimeout(timer), resolve());
      ws.onerror = () => (clearTimeout(timer), reject(err("server_down")));
      ws.onclose = ev => (clearTimeout(timer), reject(ev?.code === 1008 || ev?.code === 4401 ? err("unauthorized") : err("server_down")));
    });
    ws.onclose = () => failAll(err("server_down"));
    ws.onerror = () => failAll(err("server_down"));
    const call = (tag, payload) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(closed);
        const id = String(++nextId);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(err("failed", `T3 Code didn't answer ${tag} in time.`));
        }, timeoutMs);
        pending.set(id, { resolve: v => (clearTimeout(timer), resolve(v)), reject: e => (clearTimeout(timer), reject(e)) });
        ws.send(JSON.stringify({ _tag: "Request", id, tag, payload, headers: [] }));
      });
    try {
      return await fn(call);
    } finally {
      try {
        ws.close();
      } catch {}
    }
  }

  function rpcFailure(exit) {
    const cause = [].concat(exit?.cause ?? []);
    const first = cause.find(c => c?._tag === "Fail")?.error ?? cause.find(c => c?._tag === "Die")?.defect ?? null;
    const text = typeof first === "string" ? first : first?.detail || first?.message || JSON.stringify(first ?? exit).slice(0, 300);
    if (/Unknown request tag|Missing key|Expected/i.test(text)) return err("incompatible", `${MESSAGES.incompatible} (${String(text).split("\n")[0].slice(0, 160)})`);
    if (/not found|NotFound|No orchestration projection/i.test(text)) return err("not_found", "That T3 thread no longer exists.");
    if (/archiv/i.test(text)) return err("failed", "That T3 thread is archived. Unarchive it in T3 Code first.");
    return err("failed", `T3 Code refused the message: ${String(text).slice(0, 200)}`);
  }

  const api = {
    origin,

    /** Is T3 reachable, is Ensō connected, does the token work, which route will a send take. Never contains the token. */
    async status() {
      const cli = !!cliPath(env);
      const out = { cli, origin: origin(), reachable: false, connected: false, tokenValid: null, environmentId: null, serverVersion: null, label: null, route: null, attachments: false, expiresAt: null, error: null };
      const stored = await readStored();
      out.connected = !!stored;
      out.expiresAt = stored?.expiresAt ?? null;
      try {
        const d = await descriptor(true);
        out.reachable = true;
        out.environmentId = d.environmentId ?? null;
        out.serverVersion = d.serverVersion ?? null;
        out.label = d.label ?? null;
        out.attachments = attachmentsSupported(d);
      } catch (e) {
        out.error = e.code === "server_down" ? MESSAGES.server_down : e.message;
        out.route = stored ? (out.attachments ? "attachment" : "path") : null;
        return out;
      }
      if (stored) {
        try {
          const res = await request("/api/auth/session", { token: stored.token });
          const s = res.ok ? await res.json() : null;
          out.tokenValid = !!s?.authenticated && T3_SCOPES.every(sc => (s.scopes ?? T3_SCOPES).includes(sc));
          if (s?.expiresAt) out.expiresAt = s.expiresAt;
          if (!out.tokenValid) out.error = MESSAGES.unauthorized;
        } catch (e) {
          out.tokenValid = e.code === "unauthorized" ? false : null;
          out.error = e.code === "unauthorized" ? MESSAGES.unauthorized : e.message;
        }
      }
      out.route = !stored ? null : out.attachments ? "attachment" : "path";
      return out;
    },

    /**
     * Issue a scoped session through T3's CLI and keep it in the Keychain. The
     * CLI's output goes from its stdout pipe into `security -i`'s stdin; it is
     * never printed, logged, written to a file or put on a command line.
     */
    async connect({ label = T3_LABEL, ttl = T3_TTL } = {}) {
      const args = ["auth", "session", "issue", ...T3_SCOPES.flatMap(s => ["--scope", s]), "--label", label, "--ttl", ttl, "--json"];
      const r = await runCli(args);
      if (r.code === 127) throw err("cli_missing");
      if (r.code !== 0) throw err("failed", `T3 Code's CLI couldn't issue a token${r.stderr ? `: ${String(r.stderr).replace(/\s+/g, " ").trim().slice(0, 200)}` : "."}`);
      let issued;
      try {
        issued = JSON.parse(r.stdout);
      } catch {
        throw err("failed", "T3 Code's CLI answered in an unexpected format.");
      }
      if (typeof issued?.token !== "string" || !issued.token || typeof issued.sessionId !== "string") throw err("failed", "T3 Code's CLI didn't return a session.");
      const previous = await readStored();
      await secrets.write(JSON.stringify({ token: issued.token, sessionId: issued.sessionId, expiresAt: issued.expiresAt ?? null, scopes: issued.scopes ?? T3_SCOPES, label, issuedAt: new Date().toISOString() }));
      issued = null;
      if (previous?.sessionId) await runCli(["auth", "session", "revoke", previous.sessionId]).catch(() => {});
      return api.status();
    },

    /** Revoke Ensō's T3 session and delete the Keychain item. */
    async disconnect() {
      const stored = await readStored();
      let revoked = false;
      if (stored?.sessionId) {
        const r = await runCli(["auth", "session", "revoke", stored.sessionId]).catch(() => ({ code: 1 }));
        revoked = r.code === 0;
      }
      await secrets.delete();
      lastShell = null;
      return { ...(await api.status()), revoked };
    },

    /** Threads for the picker (running and waiting first) and projects. Cached for 15 s unless fresh. */
    async listThreads({ fresh = false } = {}) {
      if (!fresh && lastShell && Date.now() - lastShell.at < 15_000) return lastShell;
      const token = await requireToken();
      const res = await request("/api/orchestration/shell?omitOlderSettled=1&omitIdleSubagents=1", { token, protocol: true });
      if (!res.ok) throw err("failed", `T3 Code couldn't list threads (${res.status}).`);
      lastShell = { at: Date.now(), ...mapShell(await res.json()) };
      return lastShell;
    },

    /** The last thread list without a request (for agent cards). */
    cached: () => lastShell,
    threadInfo(id) {
      const t = lastShell?.threads.find(x => x.id === id);
      return t ? { threadId: t.id, title: t.title, projectTitle: t.projectTitle, status: t.status } : null;
    },

    /** t3code://threads/<environment>/<thread>, opened by T3's desktop app; null when unknown. */
    async threadUrl(threadId) {
      try {
        const d = await descriptor();
        return d.environmentId ? `t3code://threads/${encodeURIComponent(d.environmentId)}/${encodeURIComponent(threadId)}` : null;
      } catch {
        return null;
      }
    },

    /** Which route a send takes right now: "attachment" (upload + message) or "path" (PNG on disk + CLI text). */
    async route() {
      try {
        return attachmentsSupported(await descriptor()) ? "attachment" : "path";
      } catch {
        return "path";
      }
    },

    /** Upload one image as a pending attachment → { id, name, mimeType, sizeBytes, type }. */
    async uploadImage(bytes, { name = "screenshot.png", mimeType = "image/png" } = {}, call = null) {
      const buf = Buffer.from(bytes);
      if (!buf.length) throw err("failed", "The screenshot is empty.");
      if (buf.length > MAX_IMAGE_BYTES) throw err("too_large", "The screenshot is larger than T3 Code's 10 MB image limit. Try a smaller region.");
      const run = async c => {
        const up = await c("attachments.createUploadUrl", { type: "image", name, mimeType, sizeBytes: buf.length });
        if (!up?.relativeUrl?.startsWith("/api/attachments/upload/")) throw err("incompatible");
        const res = await request(up.relativeUrl, { method: "POST", headers: { "content-type": mimeType, "content-length": String(buf.length) }, body: buf });
        if (res.status !== 204 && !res.ok) throw err("failed", `T3 Code refused the upload (${res.status}).`);
        return { type: "image", id: up.attachmentId, name, mimeType, sizeBytes: buf.length };
      };
      return call ? run(call) : withRpc(run);
    },

    /** Send a message (with uploaded attachments) to a thread; queued after a running turn. */
    async send({ threadId, text, attachments = [], dispatchMode = { type: "queue_after_active" } }, call = null) {
      if (!threadId) throw err("failed", "Choose a T3 thread first.");
      const run = async c => {
        const id = randomUUID();
        const result = await c("orchestration.dispatchCommand", {
          type: "message.dispatch",
          commandId: `enso-${id}`,
          threadId,
          messageId: `enso-${id}`,
          text: String(text ?? ""),
          attachments,
          dispatchMode,
          createdBy: "user",
          creationSource: "web",
        });
        return { threadId, sequence: result?.sequence ?? null };
      };
      return call ? run(call) : withRpc(run);
    },

    /** Upload and send in one WebSocket session. */
    async sendScreenshot({ threadId, text, png, name, mimeType = "image/png", dispatchMode }) {
      return withRpc(async call => {
        const attachment = await api.uploadImage(png, { name: name ?? "screenshot.png", mimeType }, call);
        return { ...(await api.send({ threadId, text, attachments: [attachment], ...(dispatchMode ? { dispatchMode } : {}) }, call)), attachment: { id: attachment.id, sizeBytes: attachment.sizeBytes } };
      });
    },

    /** Fallback: text only, through `t3 thread send <id> -` (T3's public CLI). */
    async sendText({ threadId, text }) {
      if (!threadId) throw err("failed", "Choose a T3 thread first.");
      const r = await runCli(["thread", "send", threadId, "-"], { input: String(text ?? "") });
      if (r.code === 127) throw err("cli_missing");
      if (r.code !== 0) {
        const detail = String(r.stderr || r.stdout || "").replace(/\s+/g, " ").trim().slice(0, 200);
        if (/Could not reach|not running/i.test(detail)) throw err("server_down");
        throw err("failed", `T3 Code's CLI couldn't send the message${detail ? `: ${detail}` : "."}`);
      }
      return { threadId };
    },
  };
  return api;
}
