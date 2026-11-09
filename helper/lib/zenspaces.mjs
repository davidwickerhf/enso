// Zen spaces (workspaces), read from Zen's own session file. WebExtensions
// can't see spaces, but each of the user's spaces has its own container, and the
// session file lists every space with its container and its tabs.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ZEN = path.join(homedir(), "Library/Application Support/zen");

function profileDir() {
  try {
    const ini = readFileSync(path.join(ZEN, "installs.ini"), "utf8");
    const rel = ini.match(/^Default=(.+)$/m)?.[1]?.trim();
    return rel ? path.join(ZEN, rel) : null;
  } catch {
    return null;
  }
}

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
