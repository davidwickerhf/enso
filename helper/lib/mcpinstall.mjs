// `enso mcp install | uninstall | status | rotate`: registers the stdio
// launcher (`<data>/bin/enso mcp`) with MCP clients, so no token sits in their
// configs.
//
//   Claude Code  `claude mcp remove zen-browser -s user`, then
//                `claude mcp add --scope user zen-browser -- <launcher> mcp [--read-only]`
//   Codex        ~/.codex/config.toml  [mcp_servers.zen-browser] command/args; the old
//                url, bearer and http_headers entries are removed. Line-based and
//                TOML-aware: everything else in the file is kept byte for byte.
//   Cursor       ~/.cursor/mcp.json  mcpServers["zen-browser"] = { command, args }
//
// Config files are backed up (0600) before they are changed. Only what changed
// is printed, never values: these files hold other services' secrets.

import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir } from "./mcpauth.mjs";

export const SERVER_NAME = "zen-browser";
export const CLIENTS = ["claude", "codex", "cursor"];
export const CLIENT_NAMES = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" };

const home = () => homedir();
const codexConfig = () => path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "config.toml");
const cursorConfig = () => path.join(home(), ".cursor", "mcp.json");
const claudeJson = () => path.join(home(), ".claude.json");
const ENSO_MJS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "enso.mjs");

// ---------- launcher path ----------

/** The stable launcher: <data>/bin/enso, written by install.sh / dev.sh (or here, when missing). */
export const launcherPath = (dir = dataDir()) => path.join(dir, "bin", "enso");

export function ensureLauncher(dir = dataDir(), log = () => {}) {
  const file = launcherPath(dir);
  if (existsSync(file)) return file;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `#!/bin/bash\n# Ensō launcher (\`enso mcp\` and friends). Written by \`enso mcp install\`.\nexec "${process.execPath}" "${path.resolve(ENSO_MJS)}" "$@"\n`, { mode: 0o755 });
  chmodSync(file, 0o755);
  log(`Wrote ${file}`);
  return file;
}

const launcherArgs = readOnly => (readOnly ? ["mcp", "--read-only"] : ["mcp"]);

// ---------- backups and atomic writes ----------

function backup(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${file}.enso-backup-${stamp}`;
  copyFileSync(file, dest);
  chmodSync(dest, 0o600);
  return dest;
}

function writeKeepingMode(file, text) {
  let mode = 0o600;
  try {
    mode = statSync(file).mode & 0o777;
  } catch {}
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.enso-${process.pid}.tmp`;
  writeFileSync(tmp, text, { mode });
  chmodSync(tmp, mode);
  renameSync(tmp, file);
}

// ---------- TOML (Codex) ----------

const BARE = /[A-Za-z0-9_-]/;

/** Parse a dotted TOML key at s[i…]; returns { keys, end } or null. */
function parseKey(s, i) {
  const keys = [];
  for (;;) {
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] === '"') {
      let j = i + 1;
      let v = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\") {
          const e = s[j + 1];
          v += { n: "\n", t: "\t", '"': '"', "\\": "\\" }[e] ?? e;
          j += 2;
        } else v += s[j++];
      }
      if (s[j] !== '"') return null;
      keys.push(v);
      i = j + 1;
    } else if (s[i] === "'") {
      const j = s.indexOf("'", i + 1);
      if (j < 0) return null;
      keys.push(s.slice(i + 1, j));
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && BARE.test(s[j])) j++;
      if (j === i) return null;
      keys.push(s.slice(i, j));
      i = j;
    }
    while (s[i] === " " || s[i] === "\t") i++;
    if (s[i] !== ".") return { keys, end: i };
    i++;
  }
}

/**
 * Split a TOML document into statements: { type: "header" | "kv" | "other",
 * start, end (line indexes, inclusive), table (current table path), keys }.
 * Tracks multi-line strings and arrays/inline tables so lines inside them are
 * never mistaken for headers.
 */
export function tomlStatements(lines) {
  const out = [];
  let table = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].replace(/\r?\n$/, "");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      out.push({ type: "other", start: i, end: i, table });
      i++;
      continue;
    }
    if (trimmed.startsWith("[")) {
      const arr = trimmed.startsWith("[[");
      const k = parseKey(trimmed, arr ? 2 : 1);
      const close = arr ? "]]" : "]";
      if (k && trimmed.slice(k.end, k.end + close.length) === close && /^\s*(#.*)?$/.test(trimmed.slice(k.end + close.length))) {
        table = k.keys;
        out.push({ type: "header", start: i, end: i, table, keys: k.keys, array: arr });
        i++;
        continue;
      }
    }
    const k = parseKey(line, 0);
    if (!k || line[k.end] !== "=") {
      out.push({ type: "other", start: i, end: i, table });
      i++;
      continue;
    }
    // Scan the value to its end, possibly over several lines.
    const start = i;
    let depth = 0;
    let str = null; // '"' | "'" | '"""' | "'''"
    let pos = k.end + 1;
    let text = line;
    for (;;) {
      while (pos < text.length) {
        if (str) {
          if (str.length === 3) {
            if (text.startsWith(str, pos)) {
              pos += 3;
              while (text[pos] === str[0]) pos++; // up to two extra quotes belong to the string
              str = null;
              continue;
            }
            if (str === '"""' && text[pos] === "\\") pos++;
            pos++;
          } else {
            if (text[pos] === "\\" && str === '"') pos += 2;
            else if (text[pos] === str) {
              str = null;
              pos++;
            } else pos++;
          }
          continue;
        }
        const c = text[pos];
        if (text.startsWith('"""', pos) || text.startsWith("'''", pos)) {
          str = text.slice(pos, pos + 3);
          pos += 3;
        } else if (c === '"' || c === "'") {
          str = c;
          pos++;
        } else if (c === "#") break;
        else {
          if (c === "[" || c === "{") depth++;
          else if (c === "]" || c === "}") depth--;
          pos++;
        }
      }
      if (str && str.length === 1) str = null; // unterminated single-line string: stop at the line end
      if (!str && depth <= 0) break;
      if (i + 1 >= lines.length) break;
      i++;
      text = lines[i].replace(/\r?\n$/, "");
      pos = 0;
    }
    out.push({ type: "kv", start, end: i, table, keys: [...table, ...k.keys] });
    i++;
  }
  return out;
}

const startsWith = (keys, prefix) => prefix.every((p, n) => keys[n] === p);
const SERVER = ["mcp_servers", SERVER_NAME];
// Keys of the old http registration (and the ones we set) inside [mcp_servers.zen-browser].
const HTTP_KEYS = new Set(["url", "http_headers", "env_http_headers", "bearer_token", "bearer_token_env_var", "command", "args", "transport", "type"]);
const HTTP_TABLES = new Set(["http_headers", "env_http_headers"]);

const splitLines = text => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const tomlString = s => JSON.stringify(s); // TOML basic strings use the same escapes for our paths

/**
 * Edit Codex's config.toml text: `mode` "install" sets command/args (keeping
 * other keys of the table, e.g. tool approvals or timeouts), "uninstall"
 * removes the server. Returns { text, changes } where changes are short
 * descriptions without values.
 */
export function editCodexToml(text, { mode = "install", command, args = ["mcp"] } = {}) {
  const lines = splitLines(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const stmts = tomlStatements(lines);
  const drop = new Set();
  const changes = [];
  const describe = keys => keys.slice(2).join(".") || SERVER_NAME;

  for (let n = 0; n < stmts.length; n++) {
    const s = stmts[n];
    let remove = false;
    let label = "";
    if (s.type === "header" && startsWith(s.keys, SERVER)) {
      const sub = s.keys[2];
      if (mode === "uninstall" ? true : s.keys.length > 2 && HTTP_TABLES.has(sub)) {
        remove = true;
        label = `[${s.keys.join(".")}] table`;
        // the whole section, but not the comments right above the next header
        let last = n;
        while (last + 1 < stmts.length && stmts[last + 1].type !== "header") last++;
        let keep = last;
        while (keep > n && stmts[keep].type === "other" && lines[stmts[keep].start].trim().startsWith("#")) keep--;
        for (let m = n; m <= keep; m++) for (let l = stmts[m].start; l <= stmts[m].end; l++) drop.add(l);
        changes.push(`removed ${label}`);
        n = keep;
        continue;
      }
    }
    if (s.type === "kv" && startsWith(s.keys, SERVER)) {
      const rest = s.keys.slice(2);
      if (mode === "uninstall" || rest.length === 0 || HTTP_KEYS.has(rest[0])) {
        remove = true;
        label = rest.length === 0 ? `inline ${SERVER_NAME} entry` : describe(s.keys);
      }
    }
    if (remove) {
      for (let l = s.start; l <= s.end; l++) drop.add(l);
      if (!(mode === "install" && ["command", "args"].includes(label))) changes.push(`removed ${label}`);
    }
  }

  // Keep every line not dropped; where a run was dropped, don't leave two blank lines meeting.
  const kept = []; // { line, orig }
  let seam = false;
  lines.forEach((line, n) => {
    if (drop.has(n)) return void (seam = true);
    if (seam && line.trim() === "" && (kept.length === 0 || kept[kept.length - 1].line.trim() === "")) return;
    seam = false;
    kept.push({ line, orig: n });
  });
  const at = orig => kept.findIndex(k => k.orig === orig);

  if (mode === "install") {
    const body = [`command = ${tomlString(command)}${eol}`, `args = [${args.map(tomlString).join(", ")}]${eol}`].map(line => ({ line }));
    const header = stmts.find(s => s.type === "header" && !s.array && s.keys.length === 2 && startsWith(s.keys, SERVER) && !drop.has(s.start));
    const sub = stmts.find(s => s.type === "header" && s.keys.length > 2 && startsWith(s.keys, SERVER) && !drop.has(s.start));
    const last = () => kept[kept.length - 1];
    if (header) {
      const i = at(header.start);
      if (!kept[i].line.endsWith("\n")) kept[i].line += eol;
      kept.splice(i + 1, 0, ...body);
    } else {
      const block = [{ line: `[mcp_servers.${SERVER_NAME}]${eol}` }, ...body];
      if (sub) {
        kept.splice(at(sub.start), 0, ...block, { line: eol });
      } else {
        if (kept.length && !last().line.endsWith("\n")) last().line += eol;
        if (kept.length && last().line.trim() !== "") kept.push({ line: eol });
        kept.push(...block);
      }
    }
    changes.push(`set [mcp_servers.${SERVER_NAME}] command and args (${args.join(" ")})`);
  }
  const out = kept.map(k => k.line);
  return { text: out.join(""), changes };
}

/** Which kind of zen-browser entry a Codex config has: "launcher" | "launcher-read" | "http" | "other" | null. */
export function codexEntryKind(text) {
  const stmts = tomlStatements(splitLines(text));
  const has = stmts.filter(s => (s.type === "header" || s.type === "kv") && startsWith(s.keys, SERVER));
  if (!has.length) return null;
  const lines = splitLines(text);
  const kv = key => has.find(s => s.type === "kv" && s.keys.length === 3 && s.keys[2] === key);
  if (kv("url") || has.some(s => s.keys[2] === "http_headers")) return "http";
  const argsStmt = kv("args");
  if (kv("command")) {
    const argsText = argsStmt ? lines.slice(argsStmt.start, argsStmt.end + 1).join("") : "";
    return /--read-only/.test(argsText) ? "launcher-read" : "launcher";
  }
  return "other";
}

// ---------- Claude Code ----------

function executable(file) {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

export function findClaudeBin() {
  if (process.env.ENSO_CLAUDE_PATH) return executable(process.env.ENSO_CLAUDE_PATH) ? process.env.ENSO_CLAUDE_PATH : null;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) if (dir && executable(path.join(dir, "claude"))) return path.join(dir, "claude");
  for (const f of [path.join(home(), ".local/bin/claude"), path.join(home(), ".claude/local/claude"), "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) if (executable(f)) return f;
  return null;
}

function claudeEntry() {
  try {
    const j = JSON.parse(readFileSync(claudeJson(), "utf8"));
    return j.mcpServers?.[SERVER_NAME] ?? null;
  } catch {
    return null;
  }
}

const entryKind = e => {
  if (!e) return null;
  if (e.url || e.type === "http" || e.type === "sse") return "http";
  if (e.command) return (e.args ?? []).includes("--read-only") ? "launcher-read" : "launcher";
  return "other";
};

function installClaude({ launcher, readOnly }) {
  const bin = findClaudeBin();
  if (!bin) return { client: "claude", ok: false, changes: [], note: "Claude Code not found (install it, or set ENSO_CLAUDE_PATH)" };
  const changes = [];
  const before = entryKind(claudeEntry());
  const rm = spawnSync(bin, ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore", timeout: 30_000 });
  if (rm.status === 0) changes.push(`removed the previous ${SERVER_NAME} entry${before ? ` (${before})` : ""}`);
  const add = spawnSync(bin, ["mcp", "add", "--scope", "user", SERVER_NAME, "--", launcher, ...launcherArgs(readOnly)], { stdio: "ignore", timeout: 30_000 });
  if (add.status !== 0) return { client: "claude", ok: false, changes, note: `claude mcp add failed (exit ${add.status ?? add.signal})` };
  changes.push(`added ${SERVER_NAME} (user scope, stdio launcher${readOnly ? ", read-only" : ""})`);
  return { client: "claude", ok: true, changes };
}

function uninstallClaude() {
  const bin = findClaudeBin();
  if (!bin) return { client: "claude", ok: false, changes: [], note: "Claude Code not found" };
  const rm = spawnSync(bin, ["mcp", "remove", SERVER_NAME, "-s", "user"], { stdio: "ignore", timeout: 30_000 });
  return { client: "claude", ok: true, changes: rm.status === 0 ? [`removed ${SERVER_NAME} (user scope)`] : [], note: rm.status === 0 ? "" : "not registered" };
}

// ---------- Codex ----------

function editCodex(mode, { launcher, readOnly } = {}) {
  const file = codexConfig();
  const exists = existsSync(file);
  if (!exists && mode === "uninstall") return { client: "codex", ok: true, changes: [], note: "no config.toml" };
  const text = exists ? readFileSync(file, "utf8") : "";
  const { text: next, changes } = editCodexToml(text, { mode, command: launcher, args: launcherArgs(readOnly) });
  if (next === text) return { client: "codex", ok: true, changes: [], note: mode === "uninstall" ? "not registered" : "already up to date" };
  const backupFile = exists ? backup(file) : null;
  writeKeepingMode(file, next);
  return { client: "codex", ok: true, changes, file, backup: backupFile };
}

// ---------- Cursor ----------

function editCursor(mode, { launcher, readOnly } = {}) {
  const file = cursorConfig();
  const exists = existsSync(file);
  if (!exists && mode === "uninstall") return { client: "cursor", ok: true, changes: [], note: "no mcp.json" };
  const text = exists ? readFileSync(file, "utf8") : "";
  let json;
  try {
    json = text.trim() ? JSON.parse(text) : {};
  } catch {
    return { client: "cursor", ok: false, changes: [], note: `${file} is not valid JSON; left unchanged` };
  }
  json.mcpServers ??= {};
  const before = entryKind(json.mcpServers[SERVER_NAME]);
  const changes = [];
  if (mode === "uninstall") {
    if (!before) return { client: "cursor", ok: true, changes: [], note: "not registered" };
    delete json.mcpServers[SERVER_NAME];
    changes.push(`removed mcpServers.${SERVER_NAME}`);
  } else {
    const entry = { command: launcher, args: launcherArgs(readOnly) };
    if (JSON.stringify(json.mcpServers[SERVER_NAME]) === JSON.stringify(entry)) return { client: "cursor", ok: true, changes: [], note: "already up to date" };
    json.mcpServers[SERVER_NAME] = entry;
    changes.push(`${before ? `replaced the ${before} entry with` : "added"} mcpServers.${SERVER_NAME} (stdio launcher${readOnly ? ", read-only" : ""})`);
  }
  const indent = text.match(/^\{\r?\n([ \t]+)"/)?.[1] ?? "  ";
  const backupFile = exists ? backup(file) : null;
  writeKeepingMode(file, JSON.stringify(json, null, indent) + "\n");
  return { client: "cursor", ok: true, changes, file, backup: backupFile };
}

// ---------- commands ----------

/** "all" = every client that looks installed on this machine. */
export function resolveClients(which = "all") {
  if (which !== "all") {
    if (!CLIENTS.includes(which)) throw new Error(`Unknown client "${which}" (claude, codex, cursor or all)`);
    return [which];
  }
  return CLIENTS.filter(c => (c === "claude" ? !!findClaudeBin() : c === "codex" ? existsSync(path.dirname(codexConfig())) : existsSync(path.dirname(cursorConfig()))));
}

export function install({ client = "all", readOnly = false, dir = dataDir(), log = () => {} } = {}) {
  const launcher = ensureLauncher(dir, log);
  return resolveClients(client).map(c => (c === "claude" ? installClaude({ launcher, readOnly }) : c === "codex" ? editCodex("install", { launcher, readOnly }) : editCursor("install", { launcher, readOnly })));
}

export function uninstall({ client = "all" } = {}) {
  return resolveClients(client).map(c => (c === "claude" ? uninstallClaude() : c === "codex" ? editCodex("uninstall") : editCursor("uninstall")));
}

/** Which clients have zen-browser registered, and how (never values). */
export function registrations() {
  const read = f => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return null;
    }
  };
  const codex = read(codexConfig());
  let cursor = null;
  try {
    cursor = entryKind(JSON.parse(read(cursorConfig()) ?? "{}").mcpServers?.[SERVER_NAME]);
  } catch {}
  return { claude: entryKind(claudeEntry()), codex: codex == null ? null : codexEntryKind(codex), cursor };
}

/** Is the helper's MCP server up, and does it accept our token? */
export async function helperStatus({ url, token, timeoutMs = 3000 }) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "X-Enso-Client": "enso-status" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.text().catch(() => "");
    if (res.status === 401) return { reachable: true, ok: false, note: "token rejected (an older helper keeps the old token until Zen restarts)" };
    return { reachable: true, ok: res.ok, note: res.ok ? "" : `answered ${res.status}` };
  } catch {
    return { reachable: false, ok: false, note: "not running (open Zen)" };
  }
}
