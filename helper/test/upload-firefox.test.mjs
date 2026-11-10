// page_upload and page_wait in a real Gecko (Zen, or Firefox), with real
// content-script compartments: a separate headless browser (own throwaway
// profile, -no-remote, never the user's windows) gets a temporary test
// extension whose background page does what background.js does: stages files
// with extension/transfer.js (base64 chunks, size and SHA-256 checked), sends
// them to extension/pageagent.js as Uint8Array parts (structured clone), and
// asks it to attach them to a file input and to drop them on a drop zone. The
// fixture page (test/fixtures/upload/upload.html, served on 127.0.0.1) reports
// what its own handlers received. This checks Firefox's security model: File
// and DataTransfer built in the page's compartment, input.files assigned and
// events dispatched so that page code can read the files.
// Also: page_wait probes and page_eval awaiting a promise with timeoutMs.
// (With File and DataTransfer built in the content script's own realm instead,
// the input case still works but the page's drop handler sees no files: Gecko
// hides DataTransfer items added under the content script's principal.)
//
// Skips when no Zen or Firefox is installed, with ENSO_SKIP_FIREFOX=1, and in CI
// unless ENSO_TEST_FIREFOX=1 (it was written against Zen; the runners' Firefox is untried).
//
//   node test/upload-firefox.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marionette } from "../lib/marionette.mjs";
import { findBrowserBinary } from "../lib/platform.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(here, "../../extension");

if (process.env.ENSO_SKIP_FIREFOX === "1" || (process.env.CI && process.env.ENSO_TEST_FIREFOX !== "1")) {
  console.log(`ok - skipped (${process.env.ENSO_SKIP_FIREFOX === "1" ? "ENSO_SKIP_FIREFOX=1" : "CI; set ENSO_TEST_FIREFOX=1 to run it there"})`);
  process.exit(0);
}
const found = findBrowserBinary();
if (!found) {
  console.log("ok - skipped: no Zen or Firefox found (set ENSO_BROWSER_BIN to run this)");
  process.exit(0);
}

const sha = b => createHash("sha256").update(b).digest("hex");
const FILES = {
  "report.docx": { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", lastModified: 1_762_000_000_000, bytes: randomBytes(1_200_000) },
  "Résumé.pdf": { type: "application/pdf", lastModified: 1_761_000_000_000, bytes: randomBytes(90_001) },
};

// The background page of the test extension: background.js's upload path, step by step.
const BACKGROUND = `
const { createUploadStore } = globalThis.EnsoTransfer;
const store = createUploadStore();
const BASE = "__BASE__";
const report = (kind, body) => fetch(BASE + "/report/" + kind, { method: "POST", body: JSON.stringify(body) });
const b64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const hex = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
async function send(tabId, action, args) {
  const res = await browser.tabs.sendMessage(tabId, { enso: true, action, args, agent: "Test" });
  if (!res?.ok) throw new Error(res?.error ?? "no answer");
  return res.result;
}
async function upload(tabId, names, target) {
  const uploadId = crypto.randomUUID();
  const files = [];
  for (const name of names) {
    const bytes = new Uint8Array(await (await fetch(BASE + "/file/" + encodeURIComponent(name))).arrayBuffer());
    const meta = await (await fetch(BASE + "/meta/" + encodeURIComponent(name))).json();
    files.push({ name, bytes, ...meta });
  }
  store.begin({ uploadId, files: files.map(f => ({ name: f.name, type: f.type, lastModified: f.lastModified, size: f.bytes.length })) });
  for (const [index, f] of files.entries()) for (let at = 0; at < f.bytes.length; at += 512 * 1024) store.chunk({ uploadId, index, offset: at, data: b64(f.bytes.subarray(at, at + 512 * 1024)) });
  const staged = await store.take(uploadId, await Promise.all(files.map(f => hex(f.bytes))));
  for (const [index, f] of staged.entries()) {
    const total = f.parts.reduce((n, p) => n + p.byteLength, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const p of f.parts) { bytes.set(p, at); at += p.byteLength; }
    await send(tabId, "upload_part", { uploadId, index, count: staged.length, meta: { name: f.name, type: f.type, lastModified: f.lastModified, size: f.size }, bytes, last: true });
  }
  return send(tabId, "upload", { uploadId, ...target });
}
async function run(tabId) {
  const out = {};
  try {
    await browser.tabs.executeScript(tabId, { file: "/pageagent.js" });
    out.input = await upload(tabId, ["report.docx"], { selector: "#single" });
    out.multi = await upload(tabId, ["Résumé.pdf", "report.docx"], { selector: "label[for=multi]" });
    out.hidden = await upload(tabId, ["Résumé.pdf"], { selector: "#hidden" });
    out.shadow = await upload(tabId, ["report.docx"], { selector: "input.in-shadow" });
    out.drop = await upload(tabId, ["Résumé.pdf", "report.docx"], { selector: "#zone" });
    out.deaf = await upload(tabId, ["Résumé.pdf"], { selector: "#deaf" });
    out.gone0 = await send(tabId, "probe", { for: "gone", value: "#spinner" });
    out.evalAwait = await send(tabId, "eval", { expression: "new Promise(r => setTimeout(() => r({ done: 42 }), 1500))", timeoutMs: 5000 });
    out.evalSlow = await send(tabId, "eval", { expression: "new Promise(r => setTimeout(() => { window.showLater(); r(1); }, 2500))", timeoutMs: 1000 });
    await new Promise(r => setTimeout(r, 2000));
    out.later = await send(tabId, "probe", { for: "selector", value: "#later" });
    out.text = await send(tabId, "probe", { for: "text", value: "Upload complete" });
    out.gone1 = await send(tabId, "probe", { for: "gone", value: "#spinner" });
  } catch (err) {
    out.error = String(err?.message ?? err);
  }
  await report("result", out);
}
let started = false;
browser.tabs.onUpdated.addListener(async (_id, info) => {
  if (started || info.status !== "complete") return;
  const tab = (await browser.tabs.query({})).find(t => t.id >= 0 && String(t.url).startsWith(BASE + "/form") && t.status === "complete");
  if (!tab || started) return;
  started = true;
  run(tab.id);
});
`;

const dir = mkdtempSync(path.join(tmpdir(), "enso-upload-firefox-"));
const profile = path.join(dir, "profile");
const addon = path.join(dir, "addon");
let proc = null;
let mn = null;
let server = null;
let failed = false;
const reports = { got: [], result: null };
let onReport = () => {};

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once("error", reject);
  s.listen(0, "127.0.0.1", () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});
const until = (test, ms, what) => new Promise((resolve, reject) => {
  if (test()) return resolve();
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
  onReport = () => test() && (clearTimeout(t), resolve());
});

try {
  // The fixture, the test files, and where the page and the extension report to.
  const fixture = readFileSync(path.join(here, "fixtures/upload/upload.html"), "utf8").replace(
    "window.got[id] = await describe(e.target.files);",
    "window.got[id] = await describe(e.target.files); fetch('/report/got', { method: 'POST', body: JSON.stringify({ id, files: window.got[id] }) });",
  ).replace(
    "window.got.zone = await describe(e.dataTransfer.files);",
    "window.got.zone = await describe(e.dataTransfer.files); fetch('/report/got', { method: 'POST', body: JSON.stringify({ id: 'zone', files: window.got.zone }) });",
  );
  server = http.createServer(async (req, res) => {
    const url = decodeURIComponent(req.url);
    if (req.method === "POST" && url.startsWith("/report/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (url === "/report/got") reports.got.push(body);
      else reports.result = body;
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end();
      onReport();
      return;
    }
    if (url.startsWith("/file/")) return void res.writeHead(200, { "Content-Type": "application/octet-stream", "Access-Control-Allow-Origin": "*" }).end(FILES[url.slice(6)].bytes);
    if (url.startsWith("/meta/")) {
      const f = FILES[url.slice(6)];
      return void res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }).end(JSON.stringify({ type: f.type, lastModified: f.lastModified }));
    }
    if (url.startsWith("/form")) return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(fixture);
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // The test extension: transfer.js and pageagent.js as shipped, plus the background above.
  mkdirSync(addon, { recursive: true });
  copyFileSync(path.join(EXT, "transfer.js"), path.join(addon, "transfer.js"));
  copyFileSync(path.join(EXT, "pageagent.js"), path.join(addon, "pageagent.js"));
  writeFileSync(path.join(addon, "test-background.js"), BACKGROUND.replace("__BASE__", base));
  writeFileSync(path.join(addon, "manifest.json"), JSON.stringify({ manifest_version: 2, name: "Ensō upload test", version: "1.0", browser_specific_settings: { gecko: { id: "enso-upload-test@wicker.life" } }, permissions: ["tabs", "<all_urls>"], background: { scripts: ["transfer.js", "test-background.js"] } }));

  // A separate headless browser with its own profile.
  mkdirSync(profile);
  const port = await freePort();
  const prefs = { "marionette.port": port, "browser.shell.checkDefaultBrowser": false, "browser.startup.page": 0, "browser.startup.homepage": "about:blank", "browser.aboutwelcome.enabled": false, "zen.welcome-screen.seen": true, "datareporting.policy.dataSubmissionEnabled": false, "app.update.disabledForTesting": true, "xpinstall.signatures.required": false, "extensions.autoDisableScopes": 0, "browser.sessionstore.resume_from_crash": false };
  writeFileSync(path.join(profile, "user.js"), Object.entries(prefs).map(([k, v]) => `user_pref(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join("\n") + "\n");
  proc = spawn(found.bin, ["-headless", "-no-remote", "-profile", profile, "--marionette"], { env: { ...process.env, MOZ_HEADLESS: "1", MOZ_CRASHREPORTER_DISABLE: "1" }, stdio: "ignore" });
  for (let i = 0; i < 100 && !mn; i++) {
    const m = new Marionette();
    try {
      await m.connect(port, "127.0.0.1", 2000);
      mn = m;
    } catch {
      m.close?.();
      await new Promise(r => setTimeout(r, 400));
    }
  }
  if (!mn) throw new Error("the headless browser didn't open Marionette");
  await mn.send("WebDriver:NewSession", { capabilities: { alwaysMatch: { pageLoadStrategy: "normal" } } }, 30_000);
  await mn.send("Addon:Install", { path: addon, temporary: true }, 15_000);
  // A new tab: the first window's tab isn't visible to extensions installed after it opened (Zen, headless).
  await new Promise(r => setTimeout(r, 1000));
  const win = await mn.send("WebDriver:NewWindow", { type: "tab" }, 15_000);
  await mn.send("WebDriver:SwitchToWindow", { handle: win.handle ?? win.value?.handle, focus: true }, 15_000);
  await mn.send("WebDriver:Navigate", { url: `${base}/form` }, 30_000);
  await until(() => reports.result, 60_000, "the test extension's result");
  const r = reports.result;
  assert.equal(r.error, undefined, r.error);
  await until(() => ["single", "multi", "hidden", "shadow", "zone"].every(id => reports.got.some(g => g.id === id)), 10_000, "the page's own reports");

  const expect = names => names.map(n => ({ name: n, size: FILES[n].bytes.length, type: FILES[n].type, lastModified: FILES[n].lastModified, sha256: sha(FILES[n].bytes) }));
  const seen = id => reports.got.find(g => g.id === id).files;
  assert.equal(r.input.mode, "input");
  assert.deepEqual(r.input.received.map(f => [f.name, f.size, f.type]), [["report.docx", FILES["report.docx"].bytes.length, FILES["report.docx"].type]]);
  assert.deepEqual(seen("single"), expect(["report.docx"]));
  assert.deepEqual(seen("multi"), expect(["Résumé.pdf", "report.docx"]));
  assert.deepEqual(seen("hidden"), expect(["Résumé.pdf"]));
  assert.deepEqual(seen("shadow"), expect(["report.docx"]));
  console.log(`ok - ${path.basename(found.bin)}: files set on file inputs (direct, via a label, hidden, in a shadow root) reach the page's change handlers unchanged`);
  assert.equal(r.drop.mode, "drop");
  assert.equal(r.drop.handled, true);
  assert.deepEqual(seen("zone"), expect(["Résumé.pdf", "report.docx"]));
  assert.equal(r.deaf.handled, false);
  console.log(`ok - ${path.basename(found.bin)}: a synthetic drop with a page-compartment DataTransfer reaches the page's drop handler with the files`);
  assert.equal(r.evalAwait.ok, true, r.evalAwait.error);
  assert.match(r.evalAwait.json, /"done": 42/);
  assert.equal(r.evalSlow.ok, false);
  assert.equal(r.evalSlow.timedOut, true);
  assert.equal(r.gone0.met, false);
  assert.equal(r.later.met, true, "the timed-out promise kept running and finished");
  assert.equal(r.text.met, true);
  assert.equal(r.gone1.met, true);
  console.log(`ok - ${path.basename(found.bin)}: page_eval awaits a promise within timeoutMs, reports a timeout while the code keeps running, and page_wait probes see the result`);
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  try {
    await mn?.send("Marionette:Quit", { flags: ["eForceQuit"] }, 5000);
  } catch {}
  mn?.close?.();
  if (proc && proc.exitCode === null) {
    await new Promise(r => {
      const t = setTimeout(() => (proc.kill("SIGKILL"), r()), 5000);
      proc.once("exit", () => (clearTimeout(t), r()));
    });
  }
  server?.close();
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
