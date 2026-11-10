// `enso mcp`: the stdio launcher MCP clients spawn (Claude Code, Codex, Cursor…).
//
// It is a small stdio ↔ Streamable HTTP bridge to the zen-browser server the
// helper runs inside Zen (lib/mcpserver.mjs, stateless). Each JSON-RPC message
// read from stdin is POSTed to http://127.0.0.1:<port>/mcp with
//   Authorization: Bearer <token read from the 0600 file in the data folder, per request>
//   X-Enso-Client: <clientInfo name>/<version>   (from the client's initialize)
//   X-Enso-Session: <random id for this launcher process>  (one agent session: Pause, Stop, notes)
// so no token appears in any client config and `enso mcp rotate` needs no
// re-registration. Responses (JSON or SSE) are written back as lines on stdout.
//
// When Zen (and so the helper) isn't running, the launcher still answers:
// initialize and ping locally, tools/list from the last list it saw (cached in
// the data folder), and tools/call with a tool error asking the user to open
// Zen. It retries the helper on every request, polls it while it is down, and
// sends notifications/tools/list_changed once it is back.

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { dataDir, encodeClientHeader, readToken } from "./mcpauth.mjs";

export const DOWN_MESSAGE = "Zen isn't running: open Zen and try again.";
const DEFAULT_PORT = 47823;
const PROTOCOL_FALLBACK = "2025-06-18";

export function launcherUrl(port = Number(process.env.ENSO_MCP_PORT || process.env.ZEN_CHAT_MCP_PORT) || DEFAULT_PORT) {
  return `http://127.0.0.1:${port}/mcp`;
}

class HelperDown extends Error {}

/** Parse a text/event-stream body into the JSON messages of its `data:` fields. */
export function parseSse(text) {
  const out = [];
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter(l => l.startsWith("data:"))
      .map(l => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data.trim()) out.push(JSON.parse(data));
  }
  return out;
}

/**
 * Run the bridge. Options are for tests:
 *   scope        "full" | "read" (which token to send)
 *   clientLabel  fixed label instead of the clientInfo mapping (--client "T3 Code")
 *   url, dir     helper endpoint and data folder
 *   input/output streams (default stdin/stdout); pollMs for the down-state probe
 * Resolves when input ends.
 */
export function runLauncher({ scope = "full", clientLabel = "", url = launcherUrl(), dir = dataDir(), input = process.stdin, output = process.stdout, pollMs = Number(process.env.ENSO_MCP_POLL_MS) || 5000, logErr = m => process.stderr.write(`enso mcp: ${m}\n`) } = {}) {
  let clientInfo = null;
  let protocolVersion = null;
  let servedStale = false; // answered tools/list without the helper; tell the client when it is back
  let poller = null;
  const sessionId = randomBytes(9).toString("base64url"); // one per launcher process, i.e. per agent session
  const cacheFile = path.join(dir, `mcp-tools-cache${scope === "read" ? "-read" : ""}.json`);

  const write = msg => output.write(JSON.stringify(msg) + "\n");

  const headers = () => {
    const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${readToken(scope, dir)}` };
    const client = encodeClientHeader(clientInfo ?? {});
    if (client) h["X-Enso-Client"] = client;
    if (clientLabel) h["X-Enso-Client-Label"] = clientLabel;
    h["X-Enso-Session"] = sessionId;
    if (protocolVersion) h["MCP-Protocol-Version"] = protocolVersion;
    return h;
  };

  async function post(msg) {
    let res;
    try {
      res = await fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(msg) });
    } catch {
      throw new HelperDown(DOWN_MESSAGE);
    }
    if (res.status === 202) return [];
    const text = await res.text();
    if (res.status === 401) throw new Error("Ensō rejected the launcher's token. If you just ran `enso mcp rotate` with an older helper, quit and reopen Zen.");
    if (!res.ok) throw new Error(`Ensō's MCP server answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    if (!text.trim()) return [];
    const type = res.headers.get("content-type") ?? "";
    const parsed = type.includes("text/event-stream") ? parseSse(text) : JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  function back() {
    if (poller) clearInterval(poller);
    poller = null;
    if (servedStale) {
      servedStale = false;
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
    }
  }

  function startPolling() {
    if (poller || !pollMs) return;
    poller = setInterval(async () => {
      try {
        await post({ jsonrpc: "2.0", id: "enso-probe", method: "ping" });
        back();
      } catch {}
    }, pollMs);
    poller.unref?.();
  }

  const readCache = () => {
    try {
      return JSON.parse(readFileSync(cacheFile, "utf8")).tools ?? [];
    } catch {
      return [];
    }
  };
  const writeCache = tools => {
    try {
      mkdirSync(dir, { recursive: true });
      const tmp = `${cacheFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ at: new Date().toISOString(), tools }));
      renameSync(tmp, cacheFile);
    } catch {}
  };

  /** What to answer when the helper can't be reached (or a non-HelperDown failure for tools/call). */
  function offline(msg, err) {
    if (msg.id === undefined || msg.id === null) return null; // notification: nothing to answer
    const down = err instanceof HelperDown;
    if (down) startPolling();
    switch (msg.method) {
      case "initialize":
        if (!down) break;
        return {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: msg.params?.protocolVersion ?? PROTOCOL_FALLBACK,
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "zen-browser", version: "launcher" },
            instructions: `Controls the user's Zen browser through Ensō. ${DOWN_MESSAGE} The tools appear once Zen is open.`,
          },
        };
      case "ping":
        if (down) return { jsonrpc: "2.0", id: msg.id, result: {} };
        break;
      case "tools/list":
        if (!down) break;
        servedStale = true;
        return { jsonrpc: "2.0", id: msg.id, result: { tools: readCache() } };
      case "tools/call":
        return { jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: err.message }] } };
    }
    return { jsonrpc: "2.0", id: msg.id, error: { code: -32000, message: err.message } };
  }

  async function handle(msg) {
    if (msg?.method === "initialize") {
      const info = msg.params?.clientInfo;
      if (info?.name) clientInfo = { name: String(info.name), version: String(info.version ?? "") };
    }
    try {
      const replies = await post(msg);
      back();
      for (const r of replies) {
        if (msg.method === "initialize" && r.id === msg.id && r.result?.protocolVersion) protocolVersion = r.result.protocolVersion;
        if (msg.method === "tools/list" && r.id === msg.id && Array.isArray(r.result?.tools) && !msg.params?.cursor) writeCache(r.result.tools);
        write(r);
      }
    } catch (err) {
      if (!(err instanceof HelperDown)) logErr(err.message);
      const reply = offline(msg, err);
      if (reply) write(reply);
    }
  }

  return new Promise(resolve => {
    const rl = createInterface({ input, crlfDelay: Infinity });
    const inflight = new Set();
    rl.on("line", line => {
      if (!line.trim()) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        return;
      }
      // A batch (older protocol versions) is forwarded as one request; offline, each request is answered.
      const p = Array.isArray(msg)
        ? post(msg).then(
            rs => rs.forEach(write),
            err => msg.map(m => offline(m, err)).filter(Boolean).forEach(write),
          )
        : handle(msg);
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    });
    rl.on("close", async () => {
      await Promise.allSettled([...inflight]);
      if (poller) clearInterval(poller);
      resolve();
    });
  });
}
