// Send screenshots to agents (lib/t3.mjs, lib/screenshots.mjs, lib/agentsessions.mjs inbox):
//   - a fake T3 Code server (HTTP + an Effect RPC WebSocket): connect through a fake
//     `t3` CLI into an injectable token store, status, the thread list, an image
//     upload + message, the CLI text fallback, a revoked token and a server that is down;
//   - the target resolution order (agent → tab link → site link → picker);
//   - the token never reaching status output, logs or the CLI's arguments;
//   - agents connected through `enso mcp`: a queued screenshot delivered as MCP image
//     content on the next tool call, inbox_read, and the prompt hook (by process id);
//   - the launcher announcing T3CODE_THREAD_ID and its parent pid;
//   - `enso mcp install --client opencode --hooks` and Codex's env_vars, in a throwaway HOME.
// Nothing here talks to a real T3 Code, a real agent or the login Keychain.
//
//   node test/t3.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const { createT3, resolveTarget, mapShell, projectMatch, composeMessage, T3_SCOPES } = await import("../lib/t3.mjs");
const { createSender, savePng, normalizeLinks, addLink, removeLink } = await import("../lib/screenshots.mjs");
const { createAgentSessions, SCREENSHOT_PREFIX } = await import("../lib/agentsessions.mjs");
const { runLauncher, t3ThreadFromEnv } = await import("../lib/mcplauncher.mjs");
const { identifyClient } = await import("../lib/mcpauth.mjs");
const { editOpencodeJson, editClaudeHooks, editCodexToml } = await import("../lib/mcpinstall.mjs");

const TOKEN = "t3tok_SECRET_value_9f8e7d";
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("fake png body for the test")]);
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-t3-")));

// ---------- a fake T3 Code server ----------
function fakeT3({ attachments = true } = {}) {
  const state = { tokens: new Set([TOKEN]), tickets: new Set(), uploads: new Map(), commands: [], requests: [], up: true };
  const shell = {
    projects: [
      { id: "p-atlas", title: "atlas-web", workspaceRoot: "/Users/x/atlas-web", repositoryIdentity: { canonicalKey: "github.com/northwind/atlas-web", owner: "northwind", name: "atlas-web" }, scripts: [{ command: "vite --port 5173" }], archivedAt: null },
      { id: "p-notes", title: "notes", workspaceRoot: "/Users/x/notes", repositoryIdentity: null, scripts: [], archivedAt: null },
    ],
    threads: [
      { id: "th-old", projectId: "p-notes", title: "Old notes thread", status: "completed", updatedAt: "2026-11-01T10:00:00Z", archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, pendingRuntimeRequest: null },
      { id: "th-run", projectId: "p-atlas", title: "Fix the legend", status: "running", activeRunId: "r1", updatedAt: "2026-11-09T10:00:00Z", archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, pendingRuntimeRequest: null },
      { id: "th-wait", projectId: "p-notes", title: "Waiting on me", status: "running", updatedAt: "2026-11-08T10:00:00Z", archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, pendingRuntimeRequest: { id: "q" } },
      { id: "th-atlas-idle", projectId: "p-atlas", title: "Atlas idle", status: "idle", updatedAt: "2026-11-05T10:00:00Z", archivedAt: null, deletedAt: null, lineage: { relationshipToParent: null }, pendingRuntimeRequest: null },
      { id: "th-sub", projectId: "p-atlas", title: "a subagent", status: "running", updatedAt: "2026-11-10T10:00:00Z", archivedAt: null, deletedAt: null, lineage: { relationshipToParent: "subagent" } },
      { id: "th-arch", projectId: "p-atlas", title: "archived", status: "idle", updatedAt: "2026-11-10T10:00:00Z", archivedAt: "2026-11-10T11:00:00Z", deletedAt: null, lineage: {} },
    ],
  };
  const bearer = req => (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const json = (res, code, body) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
  const server = http.createServer(async (req, res) => {
    state.requests.push({ method: req.method, url: req.url, headers: req.headers });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/.well-known/t3/environment") return json(res, 200, { environmentId: "env-1", serverVersion: "0.1.9-test", orchestrationProtocolVersion: 2, capabilities: { attachmentUploads: attachments } });
    if (url.pathname === "/api/auth/session") return state.tokens.has(bearer(req)) ? json(res, 200, { authenticated: true, scopes: T3_SCOPES, expiresAt: "2026-12-10T00:00:00Z" }) : json(res, 200, { authenticated: false });
    if (url.pathname.startsWith("/api/attachments/upload/")) {
      const tok = url.pathname.split("/").pop();
      const want = state.uploads.get(tok);
      if (!want) return res.writeHead(404).end();
      if (Number(req.headers["content-length"]) !== want.sizeBytes || body.length !== want.sizeBytes) return res.writeHead(400).end();
      want.received = body;
      return res.writeHead(204).end();
    }
    if (!state.tokens.has(bearer(req))) return json(res, 401, { error: "invalid_token" });
    if (url.pathname === "/api/orchestration/shell") {
      if (req.headers["x-t3-orchestration-protocol"] !== "2") return res.writeHead(426).end();
      return json(res, 200, shell);
    }
    if (url.pathname === "/api/auth/websocket-ticket/rpc" && req.method === "POST") {
      const ticket = `wst-${state.tickets.size + 1}`;
      state.tickets.add(ticket);
      return json(res, 200, { ticket, expiresAt: "2026-11-10T12:00:00Z" });
    }
    res.writeHead(404).end();
  });
  // A minimal WebSocket server: handshake, masked text frames in, text frames out.
  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname !== "/ws" || url.searchParams.get("orchestrationProtocol") !== "2" || !state.tickets.has(url.searchParams.get("wsTicket"))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const sendText = text => {
      const p = Buffer.from(text);
      const head = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
      socket.write(Buffer.concat([head, p]));
    };
    let buf = Buffer.alloc(0);
    socket.on("data", d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 2) {
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) (len = buf.readUInt16BE(2)), (off = 4);
        if (buf.length < off + 4 + len) return;
        const mask = buf.subarray(off, off + 4);
        const payload = Buffer.from(buf.subarray(off + 4, off + 4 + len).map((b, i) => b ^ mask[i % 4]));
        buf = buf.subarray(off + 4 + len);
        if (op === 8) return void socket.end();
        if (op !== 1) continue;
        const m = JSON.parse(payload.toString());
        const exit = value => sendText(JSON.stringify({ _tag: "Exit", requestId: m.id, exit: { _tag: "Success", value } }));
        const fail = defect => sendText(JSON.stringify({ _tag: "Exit", requestId: m.id, exit: { _tag: "Failure", cause: [{ _tag: "Die", defect }] } }));
        if (m.tag === "attachments.createUploadUrl") {
          const tok = `signed${state.uploads.size + 1}`;
          state.uploads.set(tok, { ...m.payload });
          exit({ attachmentId: `pending-${state.uploads.size}`, relativeUrl: `/api/attachments/upload/${tok}`, expiresAt: Date.now() + 600000 });
        } else if (m.tag === "orchestration.dispatchCommand") {
          if (!m.payload.createdBy) fail('Missing key\n  at ["createdBy"]');
          else if (m.payload.threadId === "th-gone") fail("No orchestration projection exists for thread th-gone.");
          else {
            state.commands.push(m.payload);
            exit({ sequence: state.commands.length });
          }
        } else fail(`Unknown request tag: ${m.tag}`);
      }
    });
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ server, state, origin: `http://127.0.0.1:${server.address().port}` })));
}

// A fake `t3` CLI: records its arguments (never the token) and answers like the real one.
const cliDir = path.join(root, "cli");
mkdirSync(cliDir, { recursive: true });
const cliLog = path.join(cliDir, "calls.jsonl");
const fakeCli = path.join(cliDir, "t3");
writeFileSync(
  fakeCli,
  `#!${process.execPath}
const fs = require("fs");
const args = process.argv.slice(2);
let input = "";
if (args.at(-1) === "-") input = fs.readFileSync(0, "utf8");
fs.appendFileSync(${JSON.stringify(cliLog)}, JSON.stringify({ args, input, env: !!process.env.T3CODE_THREAD_ID }) + "\\n");
if (args[0] === "auth" && args[2] === "issue") { process.stdout.write(JSON.stringify({ sessionId: "sess-" + Date.now(), token: ${JSON.stringify(TOKEN)}, method: "bearer-access-token", scopes: ${JSON.stringify(T3_SCOPES)}, expiresAt: "2026-12-10T00:00:00.000Z" })); process.exit(0); }
if (args[0] === "auth" && args[2] === "revoke") process.exit(0);
if (args[0] === "thread" && args[1] === "send") process.exit(args[2] === "th-down" ? 1 : 0);
process.exit(2);
`,
);
chmodSync(fakeCli, 0o755);
const cliCalls = () => (existsSync(cliLog) ? readFileSync(cliLog, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []);

function memoryStore() {
  let v = null;
  return { read: async () => v, write: async x => void (v = x), delete: async () => void (v = null), peek: () => v };
}

const fakes = [];
try {
  // ---------- connect, status, list, upload + send ----------
  const t3srv = await fakeT3();
  fakes.push(t3srv.server);
  const secrets = memoryStore();
  const env = { HOME: root, T3CODE_CLI_PATH: fakeCli, T3CODE_THREAD_ID: "th-agent-own" };
  const t3 = createT3({ env, secrets, origin: t3srv.origin });

  let st = await t3.status();
  assert.equal(st.reachable, true);
  assert.equal(st.connected, false);
  assert.equal(st.route, null);

  st = await t3.connect();
  const issue = cliCalls().find(c => c.args[2] === "issue");
  assert.deepEqual(issue.args, ["auth", "session", "issue", "--scope", "orchestration:read", "--scope", "orchestration:operate", "--label", "Ensō", "--ttl", "30d", "--json"], "only orchestration read + operate");
  assert.equal(issue.env, false, "T3CODE_THREAD_ID isn't passed to the CLI");
  assert.equal(JSON.parse(secrets.peek()).token, TOKEN, "the token went to the store");
  assert.equal(st.connected, true);
  assert.equal(st.tokenValid, true);
  assert.equal(st.route, "attachment");
  assert.equal(st.environmentId, "env-1");
  assert.ok(!JSON.stringify(st).includes(TOKEN), "status never carries the token");
  assert.ok(!cliCalls().some(c => JSON.stringify(c.args).includes(TOKEN)), "the token is never a CLI argument");
  console.log("ok - connect issues an orchestration-scoped token into the store; status hides it");

  const { threads, projects } = await t3.listThreads({ fresh: true });
  assert.deepEqual(threads.map(t => t.id), ["th-run", "th-wait", "th-atlas-idle", "th-old"], "running and waiting first, no subagents or archived");
  assert.equal(threads.find(t => t.id === "th-wait").status, "waiting");
  assert.equal(threads[0].projectTitle, "atlas-web");
  assert.ok(t3srv.state.requests.some(r => r.url.includes("omitOlderSettled=1") && r.headers["x-t3-orchestration-protocol"] === "2"));
  assert.equal(projectMatch(projects[0], "https://github.com/northwind/atlas-web/pull/3"), 3);
  assert.equal(projectMatch(projects[0], "http://localhost:5173/"), 2, "dev-server port from the project's scripts");
  assert.equal(projectMatch(projects[0], "https://atlas-web.vercel.app/"), 1);
  assert.equal(projectMatch(projects[1], "https://example.org/"), 0);
  console.log("ok - the thread list orders running and waiting first and matches projects to pages");

  const sent = await t3.sendScreenshot({ threadId: "th-run", text: composeMessage({ message: "Legend overlaps", url: "http://localhost:5173/", title: "Dash" }), png: PNG, name: "shot.png" });
  const [upload] = [...t3srv.state.uploads.values()];
  assert.deepEqual({ type: upload.type, name: upload.name, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes }, { type: "image", name: "shot.png", mimeType: "image/png", sizeBytes: PNG.length });
  assert.ok(upload.received.equals(PNG), "the exact bytes were uploaded");
  const cmd = t3srv.state.commands.at(-1);
  assert.equal(cmd.type, "message.dispatch");
  assert.equal(cmd.threadId, "th-run");
  assert.deepEqual(cmd.dispatchMode, { type: "queue_after_active" }, "a busy thread gets it next; nothing is interrupted");
  assert.deepEqual(cmd.attachments, [{ type: "image", id: "pending-1", name: "shot.png", mimeType: "image/png", sizeBytes: PNG.length }]);
  assert.match(cmd.text, /^Legend overlaps\n\nScreenshot from Ensō\nPage: Dash — http:\/\/localhost:5173\/$/);
  assert.equal(sent.sequence, 1);
  assert.equal(await t3.threadUrl("th-run"), "t3code://threads/env-1/th-run");
  await assert.rejects(t3.send({ threadId: "th-gone", text: "x" }), e => e.code === "not_found");
  console.log("ok - a screenshot is uploaded and sent as an image attachment over T3's RPC WebSocket");

  // ---------- the sender: T3 targets, the CLI fallback, agent targets ----------
  const reg = createAgentSessions({ timers: false, alive: () => true });
  const dataDir = path.join(root, "data");
  let links = {};
  const sender = createSender({ t3, sessions: reg, dataDir, getLinks: () => links });
  let r = await sender.send({ target: { kind: "t3", id: "th-run" }, image: DATA_URL, message: "hi", url: "https://example.com/a", title: "A", includePage: false });
  assert.equal(r.route, "attachment");
  assert.ok(!t3srv.state.commands.at(-1).text.includes("example.com"), "page URL left out when unticked");

  const noAttach = await fakeT3({ attachments: false });
  fakes.push(noAttach.server);
  const t3b = createT3({ env, secrets, origin: noAttach.origin });
  const senderB = createSender({ t3: t3b, sessions: reg, dataDir, getLinks: () => ({}) });
  r = await senderB.send({ target: { kind: "t3", id: "th-run" }, image: DATA_URL, message: "Look", url: "https://example.com/a", title: "A", consoleErrors: [{ text: "TypeError: x" }] });
  assert.equal(r.route, "path");
  assert.ok(r.path.startsWith(path.join(dataDir, "screenshots")));
  assert.ok(readFileSync(r.path).equals(PNG));
  assert.equal(statSync(r.path).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(r.path)).mode & 0o777, 0o700);
  const cliSend = cliCalls().filter(c => c.args[0] === "thread").at(-1);
  assert.deepEqual(cliSend.args, ["thread", "send", "th-run", "-"]);
  assert.match(cliSend.input, /Screenshot \(PNG, open it to see the page\): .*\.png/);
  assert.match(cliSend.input, /Console errors \(1, most recent last\):\n- TypeError: x/);
  assert.equal(noAttach.state.uploads.size, 0);
  console.log("ok - without attachment uploads, the PNG is saved (0600) and its path sent with `t3 thread send`");

  // ---------- revoked token, server down ----------
  t3srv.state.tokens.clear();
  st = await t3.status();
  assert.equal(st.tokenValid, false);
  assert.match(st.error, /expired or was revoked/);
  await assert.rejects(t3.listThreads({ fresh: true }), e => e.code === "unauthorized");
  await assert.rejects(t3.sendScreenshot({ threadId: "th-run", text: "x", png: PNG }), e => e.code === "unauthorized");
  t3srv.state.tokens.add(TOKEN);
  const down = createT3({ env, secrets, origin: "http://127.0.0.1:9" });
  st = await down.status();
  assert.equal(st.reachable, false);
  assert.match(st.error, /isn't running/);
  await assert.rejects(down.listThreads(), e => e.code === "server_down");
  const nobody = createT3({ env, secrets: memoryStore(), origin: t3srv.origin });
  await assert.rejects(nobody.listThreads(), e => e.code === "not_connected");
  console.log("ok - a revoked token and a stopped server give clear errors");

  st = await t3.disconnect();
  assert.equal(st.connected, false);
  assert.equal(st.revoked, true);
  assert.equal(secrets.peek(), null);
  assert.ok(cliCalls().some(c => c.args[0] === "auth" && c.args[2] === "revoke" && c.args[3].startsWith("sess-")));
  console.log("ok - disconnect revokes the session and deletes the token");

  // ---------- target resolution order ----------
  const T = [{ id: "a1", projectId: "p-atlas", running: false, waiting: false, activeAt: "2026-11-09T00:00:00Z" }, { id: "n1", projectId: "p-notes", running: true, waiting: false, activeAt: "2026-11-01T00:00:00Z" }, { id: "a2", projectId: "p-atlas", running: false, waiting: false, activeAt: "2026-11-10T00:00:00Z" }];
  const P = [{ id: "p-atlas", title: "atlas-web", repo: "github.com/northwind/atlas-web", scripts: [] }, { id: "p-notes", title: "notes", scripts: [] }];
  const base = { tabId: 7, url: "https://atlas.example.com/x", threads: T, projects: P };
  const agentsList = [{ id: "ag-1" }];
  let res = resolveTarget({ ...base, sessions: [{ tabId: 7, t3ThreadId: "th-from-agent", agentId: "ag-1", client: "Claude Code" }], links: { tabs: [{ tabId: 7, kind: "t3", id: "linked" }] }, agents: agentsList });
  assert.deepEqual([res.source, res.target], ["agent", { kind: "t3", id: "th-from-agent" }]);
  res = resolveTarget({ ...base, sessions: [{ tabId: 7, agentId: "ag-1", client: "Codex" }], agents: agentsList, links: { tabs: [{ tabId: 7, kind: "t3", id: "linked" }] } });
  assert.deepEqual([res.source, res.target], ["agent", { kind: "agent", id: "ag-1" }], "an agent without a T3 thread gets it itself");
  res = resolveTarget({ ...base, sessions: [{ tabId: 7, t3ThreadId: "x", stopped: true }], links: { tabs: [{ tabId: 7, host: "atlas.example.com", kind: "t3", id: "linked" }], hosts: { "atlas.example.com": { projectId: "p-atlas" } } } });
  assert.deepEqual([res.source, res.target], ["tab-link", { kind: "t3", id: "linked" }], "a stopped agent doesn't count; the tab link wins over the site");
  res = resolveTarget({ ...base, links: { tabs: [{ tabId: 7, host: "other.example.com", kind: "t3", id: "stale" }], hosts: { "atlas.example.com": { projectId: "p-atlas" } } } });
  assert.deepEqual([res.source, res.target], ["host-link", { kind: "t3", id: "a2" }], "a tab link for another site is stale; the site's project gives its latest thread");
  res = resolveTarget({ ...base, links: { tabs: [{ tabId: 7, kind: "agent", id: "ag-gone" }] } });
  assert.equal(res.source, "picker", "a link to a disconnected agent falls through");
  assert.equal(res.target, null);
  assert.deepEqual(res.suggestions.map(t => t.id), ["n1", "a2", "a1"], "picker: running first, then the matching project, then recency");
  console.log("ok - target resolution: agent on the tab, tab link, site link, then the picker");

  links = addLink({}, { type: "tab", tabId: 7, host: "a.com", kind: "t3", id: "th-1", title: "T" });
  links = addLink(links, { type: "host", host: "A.com", projectId: "p-atlas", projectTitle: "atlas-web" });
  assert.equal(normalizeLinks(links).hosts["a.com"].projectTitle, "atlas-web");
  assert.equal(removeLink(links, { type: "tab", tabId: 7 }).tabs.length, 0);
  assert.equal(Object.keys(removeLink(links, { type: "host", host: "a.com" }).hosts).length, 0);
  console.log("ok - tab and site links are added, normalised and removed");

  // ---------- agents connected through `enso mcp`: the inbox ----------
  const claude = { label: "Claude Code", name: "claude-code", session: "L1", via: "launcher", agentPid: 4242 };
  reg.seen(claude);
  const [ag] = reg.connected();
  assert.equal(ag.client, "Claude Code");
  assert.equal(ag.active, true);
  r = await sender.send({ target: { kind: "agent", id: ag.id }, image: DATA_URL, message: "This button", url: "https://example.com/p", title: "Page" });
  assert.equal(r.route, "inbox");
  assert.equal(reg.connected()[0].pending, 1);
  assert.ok(!JSON.stringify(reg.connected()).includes(PNG.toString("base64")), "the UI never gets the bytes");
  const delivered = reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).messages;
  assert.equal(delivered[0], `${SCREENSHOT_PREFIX} This button, Page, https://example.com/p`);
  assert.deepEqual(delivered[1], { type: "image", data: PNG.toString("base64"), mimeType: "image/png" });
  assert.deepEqual(reg.before(claude, { tool: "page_read", kind: "read", tabId: 3 }).messages, [], "delivered once");
  assert.equal(reg.connected()[0].pending, 0);

  await sender.send({ target: { kind: "agent", id: ag.id }, image: DATA_URL, message: "Second", url: "" });
  const viaTool = reg.inbox(claude);
  assert.equal(viaTool.length, 2, "inbox_read: the text line and the image");
  await sender.send({ target: { kind: "agent", id: ag.id }, image: DATA_URL, message: "For the hook", url: "" });
  assert.deepEqual(reg.takeForAgent({ pids: [1111, 2222] }), [], "other processes get nothing");
  const hooked = reg.takeForAgent({ pids: [999, 4242] });
  assert.equal(hooked.length, 1);
  assert.match(hooked[0], new RegExp(`^${SCREENSHOT_PREFIX.replace(/[()]/g, "\\$&")} For the hook Saved at .*\\.png \\(open it to see the image\\)\\.$`));
  reg.seen({ label: "Codex", name: "codex", session: "L2", t3Thread: "th-77" });
  const codexAg = reg.connected().find(a => a.client === "Codex");
  reg.queue(codexAg.id, { text: "via thread", path: "/x.png" });
  assert.equal(reg.takeForAgent({ t3Thread: "th-77" }).length, 1, "the hook also finds an agent by its T3 thread");
  const gone = createAgentSessions({ timers: false, alive: pid => pid !== 5555 });
  gone.seen({ label: "OpenCode", session: "L3", agentPid: 5555 });
  assert.equal(gone.connected().length, 0, "an agent whose process exited isn't offered");
  await assert.rejects(sender.send({ target: { kind: "agent", id: "ag-nope" }, image: DATA_URL }), /isn't connected/);
  console.log("ok - agent targets: queued, delivered as MCP image content once, inbox_read, and the prompt hook by pid");

  // ---------- the launcher announces T3's thread id and its parent pid ----------
  assert.equal(t3ThreadFromEnv({ T3CODE_THREAD_ID: "dbf0175c-20de-4b7c-abb3-5c9221c11a82" }), "dbf0175c-20de-4b7c-abb3-5c9221c11a82");
  assert.equal(t3ThreadFromEnv({ T3CODE_THREAD_ID: "x\r\nEvil: 1" }), "xEvil:1", "no CR, LF or spaces");
  const seenHeaders = [];
  const helper = http.createServer(async (req, res) => {
    for await (const _ of req);
    seenHeaders.push(req.headers);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  });
  fakes.push(helper);
  await new Promise(r => helper.listen(0, "127.0.0.1", r));
  const dir = path.join(root, "launcher");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "mcp-token"), "tok-launcher\n", { mode: 0o600 });
  const input = new PassThrough();
  const output = new PassThrough();
  const done = runLauncher({ t3Thread: "th-launch-1", agentPid: 31337, url: `http://127.0.0.1:${helper.address().port}/mcp`, dir, input, output, pollMs: 0, logErr: () => {} });
  input.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) + "\n");
  await done;
  assert.equal(seenHeaders[0]["x-enso-t3-thread"], "th-launch-1");
  assert.equal(seenHeaders[0]["x-enso-agent-pid"], "31337");
  const ident = identifyClient({ headers: { "x-enso-client": "claude-code/2", "x-enso-session": "S", "x-enso-t3-thread": seenHeaders[0]["x-enso-t3-thread"], "x-enso-agent-pid": "31337" } });
  assert.equal(ident.t3Thread, "th-launch-1");
  assert.equal(ident.agentPid, 31337);
  const reg2 = createAgentSessions({ timers: false });
  reg2.finish(reg2.begin(ident, { tool: "page_click", title: "Click", tabId: 9 }), { ok: true });
  assert.equal(reg2.list()[0].t3ThreadId, "th-launch-1", "the session knows its T3 thread");
  console.log("ok - the launcher passes T3CODE_THREAD_ID (X-Enso-T3-Thread) and its parent pid through to the session");

  // ---------- installers: OpenCode, Claude Code hook, Codex env_vars ----------
  assert.deepEqual(editOpencodeJson({ theme: "x" }, { launcher: "/L/enso" }).json, { theme: "x", mcp: { servers: { "zen-browser": { type: "local", command: ["/L/enso", "mcp", "--client", "OpenCode"] } } } });
  assert.deepEqual(editOpencodeJson({ mcp: { other: { type: "remote", url: "u" } } }, { launcher: "/L/enso" }).json.mcp["zen-browser"], { type: "local", command: ["/L/enso", "mcp", "--client", "OpenCode"], enabled: true }, "older layout kept");
  const hooked1 = editClaudeHooks({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "other" }] }] } }, { launcher: "/A B/enso" }).json;
  assert.equal(hooked1.hooks.UserPromptSubmit.length, 2);
  assert.equal(hooked1.hooks.UserPromptSubmit[1].hooks[0].command, '"/A B/enso" inbox --session-env');
  assert.equal(editClaudeHooks(hooked1, { launcher: "/A B/enso" }).changes.length, 0, "idempotent");
  assert.deepEqual(editClaudeHooks(hooked1, { mode: "uninstall" }).json.hooks.UserPromptSubmit, [{ hooks: [{ type: "command", command: "other" }] }]);
  assert.match(editCodexToml("", { command: "/e", envVars: ["T3CODE_THREAD_ID"] }).text, /env_vars = \["T3CODE_THREAD_ID"\]\n$/);

  const home = path.join(root, "home");
  mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
  mkdirSync(path.join(home, ".claude"), { recursive: true });
  writeFileSync(path.join(home, ".config", "opencode", "opencode.json"), JSON.stringify({ $schema: "https://opencode.ai/config.json", provider: { anthropic: { options: { apiKey: "OPENCODE_SECRET" } } } }, null, 2));
  writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }, null, 2));
  const cleanEnv = { PATH: "/usr/bin:/bin", HOME: home, ENSO_DATA: path.join(home, "data") };
  const ENSO = path.join(here, "../bin/enso.mjs");
  const out = spawnSync(process.execPath, [ENSO, "mcp", "install", "--client", "opencode", "--hooks"], { env: cleanEnv, encoding: "utf8" });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.ok(!out.stdout.includes("OPENCODE_SECRET"), "values are never printed");
  const oc = JSON.parse(readFileSync(path.join(home, ".config", "opencode", "opencode.json"), "utf8"));
  assert.deepEqual(oc.mcp.servers["zen-browser"].command, [path.join(home, "data", "bin", "enso"), "mcp", "--client", "OpenCode"]);
  assert.equal(oc.provider.anthropic.options.apiKey, "OPENCODE_SECRET", "the rest of the file is kept");
  const cs = JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));
  assert.equal(cs.hooks.Stop[0].hooks[0].command, "say done");
  assert.match(cs.hooks.UserPromptSubmit[0].hooks[0].command, /enso" inbox --session-env$/);
  const status = spawnSync(process.execPath, [ENSO, "mcp", "status"], { env: { ...cleanEnv, ENSO_MCP_PORT: "9" }, encoding: "utf8" });
  assert.match(status.stdout, /OpenCode\s+registered \(launcher, full access\)/);
  assert.match(status.stdout, /Prompt hook\s+on/);
  const un = spawnSync(process.execPath, [ENSO, "mcp", "uninstall", "--client", "opencode", "--hooks"], { env: cleanEnv, encoding: "utf8" });
  assert.equal(un.status, 0, un.stdout + un.stderr);
  assert.equal(JSON.parse(readFileSync(path.join(home, ".config", "opencode", "opencode.json"), "utf8")).mcp, undefined);
  assert.equal(JSON.parse(readFileSync(path.join(home, ".claude", "settings.json"), "utf8")).hooks.UserPromptSubmit, undefined);
  // The hook command itself: silent (and exit 0) when Ensō isn't running.
  const hookRun = spawnSync(process.execPath, [ENSO, "inbox", "--session-env"], { env: { ...cleanEnv, ENSO_MCP_PORT: "9" }, encoding: "utf8", input: "{}" });
  assert.equal(hookRun.status, 0);
  assert.equal(hookRun.stdout, "");
  console.log("ok - enso mcp install --client opencode --hooks (temporary HOME), Codex env_vars, and a silent hook");

  // `enso t3 status` prints no token (the fake CLI, a fake server; no Keychain item is created by status).
  savePng(path.join(root, "prune"), DATA_URL, { url: "https://x.y/" });
  console.log("\nall t3 checks passed");
} finally {
  for (const s of fakes) s.close();
  rmSync(root, { recursive: true, force: true });
}
