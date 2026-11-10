// Screenshots from Ensō to the user's agents (docs/PROTOCOL.md "Send screenshots").
//
// Targets are pluggable:
//   t3      a T3 Code thread (lib/t3.mjs): image attachment, or the saved PNG's path as text
//   agent   an agent connected through `enso mcp` (Claude Code, Codex, OpenCode, Cursor…):
//           queued in its inbox (lib/agentsessions.mjs) and delivered with its next tool
//           call as MCP image content, by inbox_read, or by Claude Code's prompt hook
// The extension adds the universal fallback itself: copy the image to the clipboard,
// or save it here (save()) and copy the path.
//
// Saved PNGs go to <data>/screenshots (0700 folder, 0600 files) and are deleted after 14 days.

import { chmodSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { composeMessage, hostKey, resolveTarget } from "./t3.mjs";

const KEEP_DAYS = 14;
const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_LINKS = 200;

/** data:image/png;base64,… → Buffer (PNG or JPEG only). */
export function decodeImage(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new Error("The screenshot isn't a PNG or JPEG image.");
  const buf = Buffer.from(m[2], "base64");
  if (!buf.length || buf.length > MAX_BYTES) throw new Error("The screenshot is empty or too large.");
  return { buf, mimeType: m[1] };
}

export function screenshotsDir(dataDir) {
  return path.join(dataDir, "screenshots");
}

/** Save an image under <data>/screenshots; returns its path. Old files are pruned. */
export function savePng(dataDir, dataUrl, { url = "", now = new Date() } = {}) {
  const { buf, mimeType } = decodeImage(dataUrl);
  const dir = screenshotsDir(dataDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {}
  prune(dir, now);
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const host = (hostKey(url) || "page").replace(/[^a-z0-9.-]/gi, "-").slice(0, 60);
  const file = path.join(dir, `${stamp}-${host}-${Math.random().toString(36).slice(2, 6)}.${mimeType === "image/png" ? "png" : "jpg"}`);
  writeFileSync(file, buf, { mode: 0o600 });
  return file;
}

function prune(dir, now) {
  try {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (now - statSync(p).mtimeMs > KEEP_DAYS * 86_400_000) unlinkSync(p);
    }
  } catch {}
}

/** Links the user made: tab → thread/agent (until the tab closes), site → T3 project (kept). */
export function normalizeLinks(raw) {
  const links = { tabs: [], hosts: {} };
  for (const l of Array.isArray(raw?.tabs) ? raw.tabs : []) {
    if (!Number.isInteger(l?.tabId) || !["t3", "agent"].includes(l.kind ?? "t3") || !String(l.id ?? "")) continue;
    links.tabs.push({ tabId: l.tabId, host: String(l.host ?? ""), kind: l.kind ?? "t3", id: String(l.id), title: String(l.title ?? "").slice(0, 200), pageTitle: String(l.pageTitle ?? "").slice(0, 200), at: l.at ?? new Date().toISOString() });
  }
  for (const [host, v] of Object.entries(raw?.hosts ?? {})) {
    if (!host || !v?.projectId) continue;
    links.hosts[host.toLowerCase()] = { projectId: String(v.projectId), projectTitle: String(v.projectTitle ?? "").slice(0, 200), at: v.at ?? new Date().toISOString() };
  }
  links.tabs = links.tabs.slice(-MAX_LINKS);
  return links;
}

export function addLink(links, link) {
  const next = normalizeLinks(links);
  if (link.type === "host") {
    const host = String(link.host ?? "").toLowerCase();
    if (host && link.projectId) next.hosts[host] = { projectId: String(link.projectId), projectTitle: String(link.projectTitle ?? ""), at: new Date().toISOString() };
  } else if (Number.isInteger(link.tabId) && link.id) {
    next.tabs = next.tabs.filter(l => l.tabId !== link.tabId);
    next.tabs.push({ tabId: link.tabId, host: String(link.host ?? ""), kind: link.kind === "agent" ? "agent" : "t3", id: String(link.id), title: String(link.title ?? ""), pageTitle: String(link.pageTitle ?? ""), at: new Date().toISOString() });
  }
  return normalizeLinks(next);
}

export function removeLink(links, { type, tabId, host }) {
  const next = normalizeLinks(links);
  if (type === "host") delete next.hosts[String(host ?? "").toLowerCase()];
  else next.tabs = next.tabs.filter(l => l.tabId !== tabId);
  return next;
}

/**
 * createSender({ t3, sessions, dataDir, getLinks }) → { targets(), send() }.
 * sessions is the agent registry (lib/agentsessions.mjs).
 */
export function createSender({ t3, sessions, dataDir, getLinks = () => ({}) }) {
  /** Everything the send sheet and picker need for this tab. T3 being down only empties its part. */
  async function targets({ tabId = null, url = "" } = {}) {
    const links = normalizeLinks(getLinks());
    const agents = sessions.connected();
    let t3Status = null;
    let threads = [];
    let projects = [];
    let t3Error = null;
    try {
      t3Status = await t3.status();
      if (t3Status.connected && t3Status.reachable && t3Status.tokenValid !== false) ({ threads, projects } = await t3.listThreads());
    } catch (e) {
      t3Error = e.message;
    }
    const resolved = resolveTarget({ tabId, url, sessions: sessions.list(), agents, links, threads, projects });
    return {
      tabId,
      url,
      host: hostKey(url),
      t3: t3Status ? { ...t3Status, error: t3Error ?? t3Status.error } : { connected: false, reachable: false, error: t3Error },
      threads: resolved.suggestions.slice(0, 200),
      projects: projects.map(({ id, title, repo }) => ({ id, title, repo })),
      agents: agents.map(({ inbox, ...a }) => a),
      target: resolved.target,
      source: resolved.source,
      client: resolved.client ?? null,
      projectId: resolved.projectId ?? null,
      links,
    };
  }

  /**
   * Send one screenshot. msg: { target: { kind, id }, image (data URL), message,
   * url, title, includePage, consoleErrors }. → { ok, kind, title, route, path?, openUrl? }
   */
  async function send(msg) {
    const target = msg.target ?? {};
    const includePage = msg.includePage !== false;
    const consoleErrors = Array.isArray(msg.consoleErrors) ? msg.consoleErrors.slice(-50) : [];
    const ctx = { message: msg.message, url: includePage ? String(msg.url ?? "") : "", title: includePage ? String(msg.title ?? "") : "", consoleErrors };
    const { buf, mimeType } = decodeImage(msg.image);

    if (target.kind === "agent") {
      const agent = sessions.connected().find(a => a.id === target.id);
      if (!agent) throw new Error("That agent isn't connected anymore. Pick another target, or copy the image instead.");
      const file = savePng(dataDir, msg.image, { url: msg.url }); // for the prompt hook, which can only pass text
      const line = [String(msg.message ?? "").trim(), ctx.url ? `${ctx.title ? `${ctx.title}, ` : ""}${ctx.url}` : ""].filter(Boolean).join(", ") || "(no message)";
      const errors = consoleErrors.length ? ` Console errors: ${consoleErrors.slice(-10).map(e => String(e.text ?? e).replace(/\s+/g, " ").slice(0, 200)).join(" | ")}` : "";
      const queued = sessions.queue(agent.id, { text: `${line}${errors}`, image: { data: buf.toString("base64"), mimeType }, path: file });
      if (!queued) throw new Error(`${agent.client} was stopped in Ensō; it can't receive screenshots right now.`);
      return { ok: true, kind: "agent", title: agent.client, route: "inbox", path: file, queued: true };
    }

    if (target.kind === "t3") {
      const info = t3.threadInfo(target.id);
      const route = await t3.route();
      if (route === "attachment") {
        await t3.sendScreenshot({ threadId: target.id, text: composeMessage(ctx), png: buf, mimeType, name: `screenshot-${hostKey(msg.url) || "page"}.${mimeType === "image/png" ? "png" : "jpg"}` });
        return { ok: true, kind: "t3", title: info?.title ?? "the T3 thread", route, openUrl: await t3.threadUrl(target.id) };
      }
      const file = savePng(dataDir, msg.image, { url: msg.url });
      await t3.sendText({ threadId: target.id, text: composeMessage({ ...ctx, path: file }) });
      return { ok: true, kind: "t3", title: info?.title ?? "the T3 thread", route: "path", path: file, openUrl: await t3.threadUrl(target.id) };
    }
    throw new Error("Choose where to send the screenshot first.");
  }

  return { targets, send, save: (image, url) => savePng(dataDir, image, { url }) };
}
