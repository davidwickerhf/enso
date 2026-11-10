// Everything the helper remembers, in the data folder (lib/platform.mjs:
// ~/Library/Application Support/Enso on macOS, ~/.local/share/enso on Linux,
// %APPDATA%\Enso on Windows):
//   settings.json           user settings (merged over config.json defaults)
//   config.local.json       the user's config overlay (see lib/config.mjs)
//   profile.md              who the user is, written by onboarding (editable)
//   memory.md, memory/      what the assistant has learned (global, per space)
//   dashboard.json          last dashboard briefing
//   conversations/index.json        summaries, newest first
//   conversations/<id>.jsonl        one persisted event per line
//   conversations/<id>.engine.json  engine state (session id, API message history)
//   actions.jsonl           every page action, across conversations
//   helper/                 the installed helper itself (install.sh), not data
//
// Installs from before the rename kept their data in ~/Library/Application
// Support/zen-chat; it is copied over once on first start (migrateLegacyData).

import { randomUUID } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dataDir, legacyDataDir } from "./platform.mjs";

// ENSO_DATA (or the older ZEN_CHAT_DATA) points the helper at another folder, e.g. for tests.
const DATA_OVERRIDE = process.env.ENSO_DATA || process.env.ZEN_CHAT_DATA || "";
export const DATA = dataDir();
// Where pre-rename installs kept their data (macOS only). With a data override, only an explicit ENSO_LEGACY_DATA is migrated.
const LEGACY = process.env.ENSO_LEGACY_DATA || (DATA_OVERRIDE ? "" : legacyDataDir());
const MIGRATED = ".migrated-from-zen-chat";
export const LEGACY_ITEMS = ["conversations", "memory", "memory.md", "profile.md", "reports", "actions.jsonl", "settings.json", "servers.json", "connections.json", "skills.json", "mcp-token", "dashboard.json"];

/**
 * One-time copy of a pre-rename data folder into the new one. Runs when the
 * old folder exists and the new one has no conversations yet; items already in
 * the new folder (e.g. a profile.md put there by an install script) are kept.
 * The old folder is only read, never changed.
 */
export function migrateLegacyData(from = LEGACY, to = DATA) {
  if (!from || !existsSync(from) || path.resolve(from) === path.resolve(to)) return [];
  if (existsSync(path.join(to, MIGRATED)) || existsSync(path.join(to, "conversations", "index.json"))) return [];
  mkdirSync(to, { recursive: true });
  const copied = [];
  for (const item of LEGACY_ITEMS) {
    const src = path.join(from, item);
    const dst = path.join(to, item);
    if (!existsSync(src) || existsSync(dst)) continue;
    try {
      cpSync(src, dst, { recursive: true, preserveTimestamps: true, errorOnExist: false });
      copied.push(item);
    } catch (err) {
      process.stderr.write(`[enso] could not copy ${item} from ${from}: ${err.message}\n`);
    }
  }
  writeFileSync(path.join(to, MIGRATED), JSON.stringify({ from, at: new Date().toISOString(), copied }, null, 2));
  if (copied.length) process.stderr.write(`[enso] copied ${copied.join(", ")} from ${from}\n`);
  return copied;
}
export const migrated = migrateLegacyData();

const CONV = path.join(DATA, "conversations");
mkdirSync(CONV, { recursive: true });
mkdirSync(path.join(DATA, "workspace"), { recursive: true });

export const WORKSPACE = path.join(DATA, "workspace");
export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, file);
}

// ---------- settings ----------

let defaults = {};
export function setDefaults(d) {
  defaults = d;
}
export function getSettings() {
  const user = readJson(path.join(DATA, "settings.json"), {});
  return { ...defaults, ...user, dashboard: { ...defaults.dashboard, ...user.dashboard } };
}
export function updateSettings(patch) {
  const user = readJson(path.join(DATA, "settings.json"), {});
  writeJson(path.join(DATA, "settings.json"), { ...user, ...patch });
  return getSettings();
}

// ---------- memory / profile ----------

const MEMORY = path.join(DATA, "memory.md");
const PROFILE = path.join(DATA, "profile.md");
mkdirSync(path.join(DATA, "memory"), { recursive: true });
const memoryFile = spaceId => (spaceId ? path.join(DATA, "memory", `${String(spaceId).replace(/[^a-zA-Z0-9-]/g, "")}.md`) : MEMORY);
/** Global memory, or one space's memory when spaceId is given. */
export const getMemory = spaceId => (existsSync(memoryFile(spaceId)) ? readFileSync(memoryFile(spaceId), "utf8") : "");
export const setMemory = (text, spaceId) => writeFileSync(memoryFile(spaceId), text);
export function appendMemory(fact, spaceId) {
  const cur = getMemory(spaceId);
  appendFileSync(memoryFile(spaceId), (cur && !cur.endsWith("\n") ? "\n" : "") + `- ${fact.trim()} (${now().slice(0, 10)})\n`);
}
/** profile.md as written (Markdown), or "" before onboarding. */
export const getProfile = () => (existsSync(PROFILE) ? readFileSync(PROFILE, "utf8") : "");

/**
 * The profile split into its parts: the first "# Heading" is the name, the
 * rest is what the user wrote about themselves. Older profiles may start with
 * "# Name" and continue with "- " bullets; those work the same way.
 */
export function parseProfile(text = getProfile()) {
  const t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return { name: "", about: "", set: false };
  const m = /^#\s+(.+)\n?/.exec(t);
  const name = m ? m[1].trim() : "";
  const about = (m ? t.slice(m[0].length) : t).trim();
  return { name, about, set: true };
}

export function saveProfile({ name, about }) {
  const n = String(name ?? "").replace(/[\r\n#]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const a = String(about ?? "").replace(/\r\n/g, "\n").trim().slice(0, 4000);
  writeFileSync(PROFILE, `# ${n || "Me"}\n\n${a}\n`);
  return parseProfile();
}

// ---------- dashboard ----------

const DASH = path.join(DATA, "dashboard.json");
export const getDashboard = () => readJson(DASH, null);
export const setDashboard = data => writeJson(DASH, data);

// ---------- conversations ----------

const INDEX = path.join(CONV, "index.json");
let index = readJson(INDEX, { conversations: [] }).conversations;
const saveIndex = () => writeJson(INDEX, { conversations: index });

export const listConversations = () => [...index].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export const getConversation = id => index.find(c => c.id === id) ?? null;

export function createConversation(engine) {
  const c = { id: newId(), title: "New chat", createdAt: now(), updatedAt: now(), engine, messageCount: 0, actionCount: 0, pages: [], preview: "" };
  index.push(c);
  saveIndex();
  return c;
}

export function updateConversation(id, patch) {
  const c = getConversation(id);
  if (!c) return null;
  Object.assign(c, patch, { updatedAt: patch.updatedAt ?? now() });
  saveIndex();
  return c;
}

export function deleteConversation(id) {
  index = index.filter(c => c.id !== id);
  saveIndex();
  for (const suffix of [".jsonl", ".engine.json"]) rmSync(path.join(CONV, id + suffix), { force: true });
}

export function appendEvent(id, event) {
  appendFileSync(path.join(CONV, `${id}.jsonl`), JSON.stringify(event) + "\n");
  const c = getConversation(id);
  if (!c) return;
  if (event.kind === "user") c.messageCount++;
  if (event.kind === "assistant") c.preview = event.text.split("\n").find(l => l.trim())?.slice(0, 140) ?? "";
  if (event.kind === "page.action") c.actionCount++;
  const page = event.page ?? (event.kind === "page.action" ? { url: event.url, title: event.title } : null);
  if (page?.url && !c.pages.some(p => p.url === page.url)) c.pages = [...c.pages, { url: page.url, title: page.title ?? "" }].slice(-12);
  c.updatedAt = event.at ?? now();
  saveIndex();
}

export function readEvents(id) {
  const file = path.join(CONV, `${id}.jsonl`);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
}

export const getEngineState = id => readJson(path.join(CONV, `${id}.engine.json`), {});
export const setEngineState = (id, state) => writeJson(path.join(CONV, `${id}.engine.json`), state);

export function searchHistory(query, limit = 30, spaceId = null) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results = [];
  for (const c of listConversations()) {
    if (spaceId && c.space?.id !== spaceId) continue;
    if (c.title.toLowerCase().includes(q)) {
      results.push({ conversationId: c.id, title: c.title, snippet: c.preview, at: c.updatedAt });
      continue;
    }
    for (const e of readEvents(c.id)) {
      const text = e.text ?? (e.kind === "tool.call" ? `${e.title} ${JSON.stringify(e.input)}` : e.kind === "page.action" ? `${e.action} ${e.target} ${e.url}` : "");
      const i = text.toLowerCase().indexOf(q);
      if (i >= 0) {
        results.push({ conversationId: c.id, title: c.title, snippet: text.slice(Math.max(0, i - 60), i + 100), at: e.at });
        break;
      }
    }
    if (results.length >= limit) break;
  }
  return results;
}

// ---------- page action log ----------

const ACTIONS = path.join(DATA, "actions.jsonl");
export function logAction(action) {
  appendFileSync(ACTIONS, JSON.stringify(action) + "\n");
}
export function listActions({ url, host, limit = 100 } = {}) {
  if (!existsSync(ACTIONS)) return [];
  const all = readFileSync(ACTIONS, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
  return all
    .filter(a => (!url || a.url === url) && (!host || a.host === host))
    .slice(-limit)
    .reverse();
}

// ---------- reports ----------

const REPORTS = path.join(DATA, "reports");
mkdirSync(REPORTS, { recursive: true });

export function createReport({ title, markdown, conversationId }) {
  const report = { id: newId(), title, markdown, conversationId: conversationId ?? null, createdAt: now() };
  writeJson(path.join(REPORTS, `${report.id}.json`), report);
  return report;
}
export const getReport = id => (/^[0-9a-f-]{36}$/.test(id) ? readJson(path.join(REPORTS, `${id}.json`), null) : null);
export function listReports() {
  return readdirSync(REPORTS)
    .filter(f => f.endsWith(".json"))
    .map(f => readJson(path.join(REPORTS, f), null))
    .filter(Boolean)
    .map(({ id, title, createdAt, conversationId }) => ({ id, title, createdAt, conversationId }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
