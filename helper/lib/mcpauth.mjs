// Tokens, scopes and client identity for the zen-browser MCP server.
// No side effects on import (the `enso` CLI and the stdio launcher use it
// without loading the rest of the helper).
//
//   <data>/mcp-token        full access (every tool), 0600
//   <data>/mcp-token-read   read-only tools only, 0600
//
// Both are read on every request, so `enso mcp rotate` takes effect without
// restarting the helper, and launcher-based clients (which read the file
// themselves) keep working. Clients registered with the old http + bearer
// header config have to be updated after a rotate.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Same folder as lib/store.mjs, without importing it (store.mjs creates folders on import). */
export function dataDir() {
  return process.env.ENSO_DATA || process.env.ZEN_CHAT_DATA || path.join(homedir(), "Library/Application Support/Enso");
}

export const SCOPES = ["full", "read"];
export const tokenFile = (scope = "full", dir = dataDir()) => path.join(dir, scope === "read" ? "mcp-token-read" : "mcp-token");

function writeSecret(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, value, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

/** The token for a scope, created (0600) when missing. */
export function readToken(scope = "full", dir = dataDir()) {
  const file = tokenFile(scope, dir);
  if (!existsSync(file)) writeSecret(file, randomBytes(32).toString("hex"));
  return readFileSync(file, "utf8").trim();
}

/** New tokens for both scopes. Returns the files written (never the values). */
export function rotateTokens(dir = dataDir()) {
  return SCOPES.map(scope => {
    const file = tokenFile(scope, dir);
    writeSecret(file, randomBytes(32).toString("hex"));
    return file;
  });
}

function same(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** "full" | "read" for a valid Authorization header, else null. */
export function scopeForAuthorization(header, dir = dataDir()) {
  const got = String(header ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!got) return null;
  for (const scope of SCOPES) {
    if (same(got, readToken(scope, dir))) return scope;
  }
  return null;
}

// ---------- client identity ----------

const LABELS = [
  [/claude[-_ ]?code/i, "Claude Code"],
  [/^t3([-_ ]?code)?\b/i, "T3 Code"],
  [/codex/i, "Codex"],
  [/cursor/i, "Cursor"],
  [/claude[-_ ]?(ai|desktop)/i, "Claude Desktop"],
  [/windsurf/i, "Windsurf"],
  [/^zed\b/i, "Zed"],
  [/visual studio code|vscode|^vs code/i, "VS Code"],
];

/** A friendly label for an MCP clientInfo name ("claude-code" → "Claude Code"), or the raw name, tidied. */
export function clientLabel(name) {
  const raw = String(name ?? "").replace(/[^\x20-\x7e]/g, "").trim();
  if (!raw) return "An MCP client";
  for (const [re, label] of LABELS) if (re.test(raw)) return label;
  return raw.slice(0, 40);
}

/** Header value the launcher sends: "<name>/<version>", printable ASCII only. */
export function encodeClientHeader({ name, version } = {}) {
  const clean = s => String(s ?? "").replace(/[^\x21-\x7e ]/g, "").replace(/\//g, "-").trim().slice(0, 80);
  const n = clean(name);
  if (!n) return "";
  const v = clean(version);
  return v ? `${n}/${v}` : n;
}

/** Inverse of encodeClientHeader. An explicit label wins over the mapping ("label=Custom name"). */
export function parseClientHeader(value) {
  const s = String(value ?? "").trim();
  if (!s) return null;
  const slash = s.lastIndexOf("/");
  const name = slash > 0 ? s.slice(0, slash) : s;
  const version = slash > 0 ? s.slice(slash + 1) : "";
  return { name, version };
}

/**
 * Who made an HTTP request: the launcher's X-Enso-Client header, else the
 * clientInfo of an initialize request, else a known User-Agent, else unknown.
 * `label` is what Ensō shows ("Codex is working on this page"). `session` is
 * the launcher's per-process id, when sent.
 */
export function identifyClient({ headers = {}, body, scope = "full" } = {}) {
  let info = parseClientHeader(headers["x-enso-client"]);
  let via = info ? "launcher" : "http";
  if (!info) {
    const msgs = Array.isArray(body) ? body : [body];
    const init = msgs.find(m => m?.method === "initialize")?.params?.clientInfo;
    if (init?.name) info = { name: String(init.name), version: String(init.version ?? "") };
  }
  if (!info) {
    const ua = String(headers["user-agent"] ?? "");
    if (/claude|codex|cursor|t3/i.test(ua) && !/^node$|undici/i.test(ua)) info = { name: ua.split(/[\s(]/)[0], version: "" };
  }
  const label = headers["x-enso-client-label"] ? clientLabel(headers["x-enso-client-label"]) : clientLabel(info?.name);
  // The launcher's per-process id (X-Enso-Session): one agent session, for Pause, Stop and notes.
  const session = String(headers["x-enso-session"] ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  // The T3 Code thread the agent runs in (launcher: $T3CODE_THREAD_ID): screenshots of its tab go there.
  const t3Thread = String(headers["x-enso-t3-thread"] ?? "").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 128);
  // The agent process that started the launcher (its parent pid): the Claude Code prompt hook finds its session by it.
  const agentPid = Number.parseInt(String(headers["x-enso-agent-pid"] ?? ""), 10);
  return { name: info?.name ?? "", version: info?.version ?? "", label, scope, via, ...(session ? { session } : {}), ...(t3Thread ? { t3Thread } : {}), ...(agentPid > 1 ? { agentPid } : {}) };
}
