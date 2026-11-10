// page_upload and page_wait in the page agent (extension/pageagent.js), in a
// headless Chromium against a local fixture (served under an https URL by
// request interception; nothing leaves the machine):
//   - files set on an <input type=file> (by selector, through a <label>, inside
//     an open shadow root, hidden) arrive with the right name, size, type,
//     lastModified and bytes (the page hashes them), with input and change events;
//   - a single-file input refuses two files; a non-input target in input mode
//     says where the file inputs are;
//   - drag-and-drop on a drop zone: the page's drop handler gets the files;
//     a target without a drop handler is reported as not handled;
//   - incomplete files are refused; page_wait's probes (selector, gone, text).
// Firefox's content-script compartments are covered by upload-firefox.test.mjs.
// Needs Playwright's Chromium; skips when it isn't installed.
//
//   node test/pageupload.test.mjs

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT = readFileSync(path.join(here, "../../extension/pageagent.js"), "utf8");
export const UPLOAD_FIXTURE = readFileSync(path.join(here, "fixtures/upload/upload.html"), "utf8");

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.log("ok - skipped: playwright-core is not installed (npm install in helper/)");
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch();
} catch (err) {
  console.log(`ok - skipped: no Playwright Chromium (${String(err.message).split("\n")[0]})`);
  process.exit(0);
}

const STUB = `window.browser = { runtime: {
  onMessage: { addListener(fn) { window.__enso = msg => fn(msg); } },
  sendMessage: async () => {},
  getURL: p => "about:blank#" + p,
} };`;

const sha = b => createHash("sha256").update(b).digest("hex");
const docx = { name: "Q3 report.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", lastModified: 1_762_000_000_000, bytes: randomBytes(300_000) };
const pdf = { name: "Résumé (final).pdf", type: "application/pdf", lastModified: 1_761_000_000_000, bytes: randomBytes(70_001) };
const empty = { name: "empty.txt", type: "text/plain", lastModified: 1_760_000_000_000, bytes: Buffer.alloc(0) };

let failed = false;
try {
  const context = await browser.newContext();
  await context.route("https://upload.example.com/**", route => route.fulfill({ status: 200, contentType: "text/html", body: UPLOAD_FIXTURE }));
  const page = await context.newPage();
  await page.goto("https://upload.example.com/form");
  await page.waitForFunction(() => window.ready === true);
  await page.addScriptTag({ content: STUB });
  await page.addScriptTag({ content: AGENT });
  const send = (action, args = {}) => page.evaluate(([action, args]) => window.__enso({ enso: true, action, args, agent: "Claude Code" }), [action, args]);
  // What background.js does: the bytes in parts (here split in two), then "upload".
  let n = 0;
  async function upload(files, target) {
    const uploadId = `u${++n}`;
    await page.evaluate(() => (window.got = {}));
    for (const [index, f] of files.entries()) {
      const meta = { name: f.name, type: f.type, lastModified: f.lastModified, size: f.bytes.length };
      const halves = f.bytes.length ? [f.bytes.subarray(0, f.bytes.length >> 1), f.bytes.subarray(f.bytes.length >> 1)] : [f.bytes];
      for (const part of halves) {
        const r = await page.evaluate(([uploadId, index, count, meta, b64]) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return window.__enso({ enso: true, action: "upload_part", args: { uploadId, index, count, meta, bytes } });
        }, [uploadId, index, files.length, meta, part.toString("base64")]);
        assert.equal(r.ok, true, r.error);
      }
    }
    return send("upload", { uploadId, ...target });
  }
  const got = async id => (await page.waitForFunction(id => window.got[id], id, { timeout: 5000 })).jsonValue();
  const expectFiles = (seen, files) => assert.deepEqual(seen, files.map(f => ({ name: f.name, size: f.bytes.length, type: f.type, lastModified: f.lastModified, sha256: sha(f.bytes) })));

  // input, by selector, one file: name, size, type, lastModified and bytes intact; input + change events.
  let r = await upload([docx], { selector: "#single" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.mode, "input");
  assert.deepEqual(r.result.received.map(f => [f.name, f.size]), [[docx.name, docx.bytes.length]]);
  assert.deepEqual(r.result.notAccepted, []);
  expectFiles(await got("single"), [docx]);
  assert.deepEqual(await page.evaluate(() => window.events.filter(e => e.startsWith("single"))), ["single:input", "single:change"]);
  console.log("ok - input mode: the page's change handler gets the file unchanged (name, size, type, lastModified, SHA-256)");

  // A single-file input refuses two files; nothing changes.
  r = await upload([docx, pdf], { selector: "#single" });
  assert.equal(r.ok, false);
  assert.match(r.error, /takes one file \(no multiple attribute\); you gave 2/);

  // Through a <label>, several files, including an empty one and a non-ASCII name.
  r = await upload([pdf, docx, empty], { selector: "label[for=multi]" });
  assert.equal(r.ok, true, r.error);
  expectFiles(await got("multi"), [pdf, docx, empty]);
  // accept= mismatch is reported, not enforced.
  r = await upload([empty], { selector: "#single" });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result.notAccepted, ["empty.txt"]);
  console.log("ok - a label leads to its input; several files (empty, non-ASCII names) arrive; accept mismatches are reported; one-file inputs refuse two");

  // Hidden input (display:none, the usual "Upload" button pattern) and one inside an open shadow root.
  r = await upload([pdf], { selector: "#hidden" });
  assert.equal(r.ok, true, r.error);
  expectFiles(await got("hidden"), [pdf]);
  r = await upload([docx], { selector: "input.in-shadow" });
  assert.equal(r.ok, true, r.error);
  expectFiles(await got("shadow"), [docx]);
  console.log("ok - hidden inputs and inputs in an open shadow root are found by selector");

  // Drop zone: dragenter, dragover, drop with a DataTransfer; the page handles it.
  r = await upload([pdf, docx], { selector: "#zone" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.mode, "drop");
  assert.equal(r.result.handled, true);
  expectFiles(await got("zone"), [pdf, docx]);
  assert.deepEqual(await page.evaluate(() => window.events.filter(e => e.startsWith("zone"))), ["zone:dragenter", "zone:dragover", "zone:drop"]);
  r = await upload([pdf], { selector: "#deaf" });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.handled, false);
  console.log("ok - drop mode: the drop zone's handler gets the files; a target without one is reported as not handled");

  // Wrong targets and incomplete data.
  r = await upload([pdf], { selector: "#deaf", mode: "input" });
  assert.equal(r.ok, false);
  assert.match(r.error, /is not a file input; this page has 4 file inputs: pass selector "input\[type=file\]"/);
  r = await upload([pdf], { selector: "#nothing-here" });
  assert.match(r.error, /No element matches "#nothing-here"/);
  await send("upload_part", { uploadId: "broken", index: 0, count: 1, meta: { name: "x.bin", type: "", lastModified: 1, size: 10 }, bytes: [] });
  r = await send("upload", { uploadId: "broken", selector: "#single" });
  assert.match(r.error, /arrived incomplete in the page \(0 of 10 bytes\); nothing was attached/);
  r = await send("upload", { uploadId: "never-sent", selector: "#single" });
  assert.match(r.error, /didn't reach the page/);
  console.log("ok - wrong targets and incomplete files give clear errors and attach nothing");

  // page_wait's probes.
  r = await send("probe", { for: "selector", value: "#later" });
  assert.equal(r.result.met, false);
  r = await send("probe", { for: "gone", value: "#spinner" });
  assert.equal(r.result.met, false);
  r = await send("probe", { for: "text", value: "Upload complete" });
  assert.equal(r.result.met, false);
  await page.evaluate(() => window.showLater());
  r = await send("probe", { for: "selector", value: "#later" });
  assert.equal(r.result.met, true);
  r = await send("probe", { for: "selector", value: "#hidden", visible: false });
  assert.equal(r.result.met, true, "visible:false counts hidden elements");
  r = await send("probe", { for: "text", value: "Upload complete" });
  assert.equal(r.result.met, true);
  r = await send("probe", { for: "text", value: "/upload\\s+COMPLETE/i" });
  assert.equal(r.result.met, true);
  r = await send("probe", { for: "gone", value: "#spinner" });
  assert.equal(r.result.met, true, "the spinner is hidden now");
  r = await send("probe", { for: "selector", value: "##bad" });
  assert.match(r.error, /Invalid CSS selector/);
  console.log("ok - page_wait probes: selector (visible or present), gone, text and /regex/");
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
