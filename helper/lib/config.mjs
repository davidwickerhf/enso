// Configuration: the shipped defaults (../config.json) with the user's own
// overlay merged on top. The overlay lives outside the helper, so updates
// never overwrite it:
//
//   <data dir>/config.local.json      e.g. ~/Library/Application Support/Enso/config.local.json
//
// Merge rules (everything optional):
//   defaults        shallow merge (engine, model, effort, …)
//   servers         per server: { "claude.ai Gmail": { "enabled": false }, "my-server": { "enabled": true } }
//   extraServers    added/replaced by name (MCP servers not registered in Claude Code)
//   oauthServers    added/replaced by name (remote MCP servers Ensō signs in to itself)
//   spaceHints      added/replaced by Zen space name
//   sensitiveHosts  appended to the shipped list (it can't be shortened from here)
//   anything else   replaced
//
// Edits take effect when the helper restarts (quit and reopen Zen).

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SHIPPED_CONFIG = path.join(here, "..", "config.json");
export const LOCAL_CONFIG = path.join(DATA, "config.local.json");

const isObject = v => v && typeof v === "object" && !Array.isArray(v);

export function mergeConfig(base, local) {
  if (!isObject(local)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(local)) {
    if (key.startsWith("//") || key === "$comment") continue;
    if (key === "sensitiveHosts" && Array.isArray(value)) out.sensitiveHosts = [...new Set([...(base.sensitiveHosts ?? []), ...value.map(String)])];
    else if (key === "servers" && isObject(value)) {
      out.servers = { ...(base.servers ?? {}) };
      for (const [name, def] of Object.entries(value)) out.servers[name] = { ...(out.servers[name] ?? {}), ...(isObject(def) ? def : { enabled: !!def }) };
    } else if (["defaults", "extraServers", "oauthServers", "spaceHints", "anvil"].includes(key) && isObject(value)) out[key] = { ...(base[key] ?? {}), ...value };
    else out[key] = value;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function statSignature(file) {
  try {
    const st = statSync(file);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch {
    return null;
  }
}

export let configError = null;
let lastLocalStat = null;

export function loadConfig(localFile = LOCAL_CONFIG) {
  const base = readJson(SHIPPED_CONFIG);
  const track = path.resolve(localFile) === path.resolve(LOCAL_CONFIG);
  if (track) lastLocalStat = statSignature(localFile);
  if (!existsSync(localFile)) {
    if (track) configError = null;
    return base;
  }
  try {
    const merged = mergeConfig(base, readJson(localFile));
    if (track) configError = null;
    return merged;
  } catch (err) {
    const msg = `Ignored ${localFile}: ${err.message}`;
    if (track) configError = msg;
    process.stderr.write(`[enso] ${msg}\n`);
    return base;
  }
}

export const config = loadConfig();

/** Re-reads config.json + config.local.json and updates the exported `config` object in place. */
export function reloadConfig() {
  const next = loadConfig(LOCAL_CONFIG);
  for (const k of Object.keys(config)) delete config[k];
  Object.assign(config, next);
  return config;
}

/** Reloads `config` in place if `config.local.json` changed on disk since the last load. */
export function reloadConfigIfChanged() {
  const sig = statSignature(LOCAL_CONFIG);
  if (sig === lastLocalStat) return { config, changed: false };
  reloadConfig();
  return { config, changed: true };
}

/** Reads `config.local.json` (or `{}` when absent). Throws on malformed JSON so edits never clobber a broken file. */
export function readLocalConfig(localFile = LOCAL_CONFIG) {
  if (!existsSync(localFile)) return {};
  let parsed;
  try {
    parsed = readJson(localFile);
  } catch (err) {
    throw new Error(`Could not parse ${path.basename(localFile)}: ${err.message}`);
  }
  if (!isObject(parsed)) {
    throw new Error(`${path.basename(localFile)} must contain a JSON object.`);
  }
  return parsed;
}

/** Atomically updates `config.local.json` and hot-reloads `config` when targeting `LOCAL_CONFIG`. */
export function updateLocalConfig(updater, localFile = LOCAL_CONFIG) {
  const current = readLocalConfig(localFile);
  const next = typeof updater === "function" ? updater(current) : { ...current, ...(isObject(updater) ? updater : {}) };
  if (!isObject(next)) throw new Error("Local config must be a JSON object.");
  mkdirSync(path.dirname(localFile), { recursive: true });
  const tmp = `${localFile}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, localFile);
  if (path.resolve(localFile) === path.resolve(LOCAL_CONFIG)) reloadConfig();
  return next;
}
