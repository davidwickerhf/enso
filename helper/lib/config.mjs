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

import { existsSync, readFileSync } from "node:fs";
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
    } else if (["defaults", "extraServers", "oauthServers", "spaceHints"].includes(key) && isObject(value)) out[key] = { ...(base[key] ?? {}), ...value };
    else out[key] = value;
  }
  return out;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export let configError = null;

function load() {
  const base = readJson(SHIPPED_CONFIG);
  if (!existsSync(LOCAL_CONFIG)) return base;
  try {
    return mergeConfig(base, readJson(LOCAL_CONFIG));
  } catch (err) {
    configError = `Ignored ${LOCAL_CONFIG}: ${err.message}`;
    process.stderr.write(`[enso] ${configError}\n`);
    return base;
  }
}

export const config = load();
