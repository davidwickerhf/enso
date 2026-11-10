// Zen spaces (workspaces), read from Zen's own session file. WebExtensions
// can't see spaces, but each of the user's spaces has its own container, and the
// session file lists every space with its container and its tabs.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { config } from "./config.mjs";
import { zenProfileDir } from "./platform.mjs";
import { getSettings } from "./store.mjs";

// The profile folder per OS comes from lib/platform.mjs (installs.ini, else profiles.ini).
const profileDir = () => zenProfileDir();

// mozLz4: "mozLz40\0", 4-byte little-endian size, then one LZ4 block.
function lz4Block(src, size) {
  const dst = Buffer.alloc(size);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) for (let b = 255; b === 255; ) lit += b = src[i++];
    src.copy(dst, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    let len = token & 15;
    if (len === 15) for (let b = 255; b === 255; ) len += b = src[i++];
    len += 4;
    for (let k = 0; k < len; k++, o++) dst[o] = dst[o - offset];
  }
  return dst.subarray(0, o);
}

function readMozLz4(file) {
  const data = readFileSync(file);
  if (data.subarray(0, 8).toString("latin1") !== "mozLz40\0") throw new Error("not a mozLz4 file");
  return JSON.parse(lz4Block(data.subarray(12), data.readUInt32LE(8)).toString("utf8"));
}

let cache = { mtime: 0, spaces: [] };

/** [{ id, name, icon, containerId, urls }] — urls: the space's tab URLs (for telling apart spaces that share a container). */
export function listSpaces() {
  const dir = profileDir();
  const file = dir && path.join(dir, "zen-sessions.jsonlz4");
  if (!file || !existsSync(file)) return [];
  const mtime = statSync(file).mtimeMs;
  if (mtime === cache.mtime) return cache.spaces;
  try {
    const session = readMozLz4(file);
    const urls = new Map();
    for (const t of session.tabs ?? []) {
      const ws = t.zenWorkspace;
      const entry = t.entries?.[(t.index ?? t.entries.length) - 1];
      if (ws && entry?.url?.startsWith("http")) urls.set(ws, [...(urls.get(ws) ?? []), entry.url]);
    }
    const spaces = (session.spaces ?? []).map(s => ({
      id: s.uuid,
      name: s.name,
      icon: (s.icon ?? "").match(/([a-z0-9-]+)\.svg$/)?.[1] ?? (s.icon && !s.icon.includes("/") ? s.icon : null),
      containerId: s.containerTabId ?? 0,
      urls: (urls.get(s.uuid) ?? []).slice(0, 200),
    }));
    cache = { mtime, spaces };
  } catch {
    // keep the last good read
  }
  return cache.spaces;
}

// ---------- what an agent needs to pick a space (spaces_list, tabs_open, session_start) ----------

/** What the user wrote about a space (Settings → You & memory), else config.spaceHints (config.local.json). */
export function spaceHint(sp, { settings = getSettings(), hints = config.spaceHints } = {}) {
  const own = settings?.spaceHints ?? {};
  return own[sp.id] ?? own[sp.name] ?? hints?.[sp.name] ?? "";
}

const bare = s => String(s ?? "").trim().replace(/^\{|\}$/g, "").toLowerCase();

/**
 * A space by name (any case) or id (with or without braces). Returns { space } or
 * { error } naming the valid spaces, so an agent can correct itself.
 */
export function findSpace(query, spaces = listSpaces()) {
  const q = String(query ?? "").trim();
  if (!spaces.length) return { error: "Ensō can't see any Zen spaces (Zen's session file wasn't found or has no spaces), so a space can't be chosen. Leave out space to use the current one." };
  const lower = q.toLowerCase();
  const prefixed = spaces.filter(s => s.name.toLowerCase().startsWith(lower));
  const hit = spaces.find(s => bare(s.id) === bare(q)) ?? spaces.find(s => s.name.toLowerCase() === lower) ?? (prefixed.length === 1 ? prefixed[0] : null);
  if (hit && q) return { space: hit };
  return { error: `There's no Zen space called "${q}". The user's spaces are: ${spaces.map(s => s.name).join(", ")}. Use one of these names (spaces_list describes them).` };
}

/**
 * Zen prefs that decide where a container tab lands (prefs.js; Zen's default is false):
 * zen.workspaces.force-container-workspace moves a tab opened with a space's
 * container into that space, and then switches the window to it.
 */
export function zenPrefs(dir = profileDir()) {
  const out = { forceContainerWorkspace: false };
  try {
    const text = readFileSync(path.join(dir, "prefs.js"), "utf8");
    const m = /user_pref\("zen\.workspaces\.force-container-workspace",\s*(true|false)\)/.exec(text);
    if (m) out.forceContainerWorkspace = m[1] === "true";
  } catch {}
  return out;
}

/** The user's Space routing rules (zen-space-routing.jsonlz4): [{ reference, matchType, openIn }]. */
export function listRoutes(dir = profileDir()) {
  const file = dir && path.join(dir, "zen-space-routing.jsonlz4");
  if (!file || !existsSync(file)) return [];
  try {
    const data = readMozLz4(file);
    return (data.routes ?? []).filter(r => typeof r?.reference === "string" && r.reference.trim());
  } catch {
    return [];
  }
}

/** The space id a routing rule sends this URL to (Zen's own matching), or null. */
export function routeFor(url, routes = listRoutes()) {
  const uri = String(url).toLowerCase();
  const norm = u => u.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
  for (const r of routes) {
    const ref = r.reference.toLowerCase();
    let hit = false;
    if (r.matchType === "contains") hit = uri.includes(ref);
    else if (r.matchType === "equal-to") hit = norm(uri) === norm(ref);
    else if (r.matchType === "regex") {
      try {
        hit = new RegExp(r.reference, "i").test(url);
      } catch {}
    }
    if (hit) return r.openIn === "most-recent-space" ? null : r.openIn;
  }
  return null;
}
