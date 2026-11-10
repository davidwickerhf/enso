// End to end through host.mjs and its MCP endpoint, with a stand-in for
// background.js that uses the extension's own extension/transfer.js:
//   - page_type with 5 MB of text and page_eval with a 2 MB expression arrive
//     in chunk frames, every frame under native messaging's 1 MB limit;
//   - page_upload streams a file in upload_chunk requests, and what the
//     "extension" stages is byte for byte the file on disk (SHA-256 checked);
//     folders, URLs and files over the limit are refused before anything is sent;
//   - page_wait passes its condition and timeout through;
//   - timeouts: an extension that never answers gives "may still be running"
//     after timeoutMs (+5 s), and an awaited promise that times out says the
//     same; neither is reported as a plain failure.
//
//   node test/upload-host.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDirFor, isolatedEnv, stopAndRemove } from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createReassembler, createUploadStore } = require("../../extension/transfer.js");

const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-upload-")));
const port = 46100 + Math.floor(Math.random() * 800);
const env = isolatedEnv(home, { ENSO_MCP_PORT: String(port), ENSO_MAX_UPLOAD_MB: "5" });
const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
let stderr = "";
host.stderr.on("data", d => (stderr += d));

const TAB = { tabId: 42, url: "https://files.example.com/upload", title: "Upload" };
const chunks = createReassembler();
const store = createUploadStore();
const calls = [];
const frameSizes = [];
let silent = new Set(); // actions the stand-in never answers
let staged = null; // what "upload" took from the store
let inbox = [];
let waiters = [];

function post(msg) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  host.stdin.write(Buffer.concat([head, body]));
}
async function answer(msg) {
  calls.push(msg);
  if (silent.has(msg.action)) return;
  const reply = { type: msg.type.replace("request", "response"), reqId: msg.reqId, ok: true };
  const page = { url: TAB.url, title: TAB.title };
  try {
    switch (msg.action) {
      case "active_tab": reply.result = TAB; break;
      case "type": reply.result = { ...page, description: 'textbox "Body"' }; break;
      case "eval":
        reply.result = msg.args.expression.startsWith("slow") ? { ...page, ok: false, timedOut: true, waitedMs: msg.args.timeoutMs, error: `The promise did not settle within ${msg.args.timeoutMs / 1000} s.` } : { ...page, ok: true, type: "number", json: String(msg.args.expression.length) };
        break;
      case "wait": reply.result = { met: true, ms: 1200, detail: "1 matching element visible", url: TAB.url, title: TAB.title }; break;
      case "upload_begin": reply.result = store.begin(msg.args); break;
      case "upload_chunk": reply.result = store.chunk(msg.args); break;
      case "upload_discard": reply.result = { discarded: store.discard(msg.args.uploadId) }; break;
      case "upload": {
        staged = await store.take(msg.args.uploadId, msg.args.sha256);
        reply.result = { ...page, mode: msg.args.mode ?? "input", description: 'file "Choose files"', received: staged.map(f => ({ name: f.name, size: f.size, type: f.type })), target: `${staged.map(f => f.name).join(", ")} → file "Choose files"` };
        break;
      }
      default: reply.result = {};
    }
  } catch (err) {
    reply.ok = false;
    reply.error = err.message;
  }
  post(reply);
}
let buf = Buffer.alloc(0);
host.stdout.on("data", d => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    frameSizes.push(len);
    let msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
    buf = buf.subarray(4 + len);
    if (msg.type === "chunk") {
      msg = chunks.accept(msg);
      if (!msg) continue;
    }
    if (msg.type === "page.request" || msg.type === "browser.request") answer(msg);
    inbox.push(msg);
    waiters = waiters.filter(w => !(w.test(msg) && (w.resolve(msg), true)));
  }
});
function waitFor(test, ms = 20_000) {
  const hit = inbox.find(test);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting; stderr:\n${stderr}`)), ms);
    waiters.push({ test, resolve: m => (clearTimeout(timer), resolve(m)) });
  });
}

let rpc = 0;
async function call(name, args = {}) {
  const token = readFileSync(path.join(dataDirFor(home), "mcp-token"), "utf8").trim();
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, "MCP-Protocol-Version": "2025-06-18", "X-Enso-Client": "claude-code/2.1.3", "X-Enso-Session": "upload-test" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpc, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await res.text();
  const msg = (res.headers.get("content-type") ?? "").includes("event-stream") ? JSON.parse(body.split("\n").find(l => l.startsWith("data:")).slice(5)) : JSON.parse(body);
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return { isError: !!msg.result.isError, text: msg.result.content.map(c => c.text).join("\n") };
}
const since = () => calls.length;

try {
  post({ type: "hello" });
  await waitFor(m => m.type === "state");
  for (let i = 0; i < 100; i++) {
    try {
      readFileSync(path.join(dataDirFor(home), "mcp-token"));
      if ((await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST" })).status === 401) break;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }

  // ---- large payloads ----
  const text = `Dear team ✦ ${"Grüße aus 東京. ".repeat(20_000)}${randomBytes(3_600_000).toString("base64")}`;
  frameSizes.length = 0;
  let mark = since();
  let r = await call("page_type", { tabId: 42, ref: 3, text, requested_by_user: true, irreversible: false });
  assert.equal(r.isError, false, r.text);
  const typed = calls.slice(mark).find(c => c.action === "type");
  assert.ok(typed.args.text === text, `the 5 MB text arrived whole (${typed.args.text.length} of ${text.length} characters, first difference at ${[...text].findIndex((c, i) => typed.args.text[i] !== c)})`);
  assert.ok(Buffer.byteLength(text) > 5_000_000);
  assert.ok(frameSizes.length > 5 && frameSizes.every(n => n < 1024 * 1024), `${frameSizes.length} frames, largest ${Math.max(...frameSizes)} bytes`);
  const expression = `/* ${"x".repeat(2_000_000)} */ 1`;
  r = await call("page_eval", { tabId: 42, expression, requested_by_user: true, irreversible: false });
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, new RegExp(String(expression.length)));
  console.log(`ok - page_type with ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB of text and a 2 MB page_eval expression arrive whole, in frames under 1 MB`);

  // ---- page_upload ----
  mkdirSync(path.join(home, "Documents", "Folder"), { recursive: true });
  const doc = randomBytes(3 * 1024 * 1024 + 777);
  writeFileSync(path.join(home, "Documents", "Q3 report.docx"), doc);
  writeFileSync(path.join(home, "Documents", "notes.txt"), "Plain notes\n");
  frameSizes.length = 0;
  mark = since();
  r = await call("page_upload", { tabId: 42, selector: "input[type=file]", paths: [path.join(home, "Documents", "Q3 report.docx"), "~/Documents/notes.txt"], requested_by_user: true, irreversible: false });
  assert.equal(r.isError, false, r.text);
  const mine = calls.slice(mark);
  assert.equal(mine.filter(c => c.action === "upload_chunk").length, 7 + 1, "3 MB in 512 KiB chunks, plus the small file");
  assert.ok(frameSizes.every(n => n < 1024 * 1024));
  const up = mine.find(c => c.action === "upload");
  assert.equal(up.args.selector, "input[type=file]");
  assert.deepEqual(up.args.sha256, [createHash("sha256").update(doc).digest("hex"), createHash("sha256").update("Plain notes\n").digest("hex")]);
  assert.deepEqual(Buffer.concat(staged[0].parts.map(p => Buffer.from(p))), doc, "what reached the extension is the file on disk, byte for byte");
  assert.equal(staged[0].type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(staged[1].name, "notes.txt");
  assert.match(r.text, /Attached 2 files to file "Choose files"\./);
  assert.match(r.text, /Sent, unchanged \(size and SHA-256 checked\)/);
  assert.match(r.text, /use page_wait/);
  assert.equal(store.size(), 0);
  const logged = await waitFor(m => m.type === "actions.added" && m.action.action === "upload");
  assert.equal(logged.action.target, 'Q3 report.docx, notes.txt → file "Choose files"', "the activity log names the files");
  console.log("ok - page_upload streams files in chunks under 1 MB and they arrive unchanged (SHA-256 checked)");

  // Refused before anything is sent.
  writeFileSync(path.join(home, "Documents", "big.pdf"), Buffer.alloc(6 * 1024 * 1024));
  for (const [paths, re] of [
    [["~/Documents/big.pdf"], /6\.0 MB together; page_upload takes up to 5\.0 MB per call\. Nothing was sent\..*Never shrink, compress or edit/],
    [["~/Documents/Folder"], /is a folder/],
    [["https://example.com/a.pdf"], /is a URL/],
    [["Documents/notes.txt"], /not an absolute path/],
  ]) {
    mark = since();
    r = await call("page_upload", { tabId: 42, selector: "input[type=file]", paths, requested_by_user: true, irreversible: false });
    assert.equal(r.isError, true);
    assert.match(r.text, re);
    assert.equal(calls.slice(mark).filter(c => c.action.startsWith("upload")).length, 0, "nothing sent to the browser");
  }
  r = await call("page_upload", { tabId: 42, paths: ["~/Documents/notes.txt"], requested_by_user: true, irreversible: false });
  assert.equal(r.isError, true);
  assert.match(r.text, /Give the ref .* or a CSS selector/);
  console.log("ok - page_upload refuses folders, URLs, relative paths and files over the limit, before sending anything");

  // ---- page_wait ----
  mark = since();
  r = await call("page_wait", { tabId: 42, for: "gone", value: ".upload-progress", timeoutMs: 90_000 });
  assert.equal(r.isError, false, r.text);
  const w = calls.slice(mark).find(c => c.action === "wait");
  assert.deepEqual([w.args.for, w.args.value, w.args.timeoutMs], ["gone", ".upload-progress", 90_000]);
  assert.match(r.text, /^Done: gone ".upload-progress" after 1\.2 s/);
  r = await call("page_wait", { tabId: 42, for: "text" });
  assert.equal(r.isError, true);
  assert.match(r.text, /needs a value/);
  console.log("ok - page_wait passes the condition and timeout through");

  // ---- timeouts ----
  r = await call("page_eval", { tabId: 42, expression: "slow()", timeoutMs: 2000, requested_by_user: true, irreversible: false });
  assert.equal(r.isError, true);
  assert.match(r.text, /Timed out: The promise did not settle within 2 s\. This does not mean it failed: the code keeps running in the page/);
  silent = new Set(["wait"]);
  const t0 = Date.now();
  r = await call("page_wait", { tabId: 42, for: "load", timeoutMs: 1000 });
  const took = Date.now() - t0;
  assert.equal(r.isError, true);
  assert.match(r.text, /Timed out after 6 s waiting for the browser \(wait\)\. This does not mean it failed: the action may still be running in Zen/);
  assert.ok(took >= 5_500 && took < 9_000, `gave up after timeoutMs + 5 s (${took} ms)`);
  console.log("ok - timeouts say the action may still be running and how to check, instead of a bare failure");
} finally {
  await stopAndRemove(host, home);
}
