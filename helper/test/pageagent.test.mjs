// The page agent (extension/pageagent.js) in a headless browser, against local
// fixtures served under docs.google.com URLs by request interception (no
// network, no real documents):
//   - page_type into a Google Docs body through its hidden input iframe
//     (.docs-texteventtarget-iframe), with no ref and with the canvas's ref,
//     newlines as Enter; a real input on the Docs page still takes the normal path;
//   - Google Sheets keeps the normal path (no Docs typing there);
//   - the "✦ " title prefix while an agent session is active, following a
//     page that rewrites its title, restored exactly at the end;
//   - the session pill appears and goes.
// Needs Playwright's Chromium (playwright-core is a dev dependency; the browser
// comes from `npx playwright install chromium`). Skips when it isn't installed.
//
//   node test/pageagent.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const AGENT = readFileSync(path.join(here, "../../extension/pageagent.js"), "utf8");

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

// A stand-in for the WebExtension APIs the page agent uses.
const STUB = `window.browser = { runtime: {
  onMessage: { addListener(fn) { window.__enso = msg => fn(msg); } },
  sendMessage: async () => {},
  getURL: p => "about:blank#" + p,
} };`;

// Mimics Docs: a canvas editor, and a hidden same-origin iframe with a
// contenteditable that receives the typing. The page builds its "document"
// from the iframe's input events and Enter keydowns, like Docs does.
const docsFixture = app => `<!doctype html><html><head><title>Methods draft - Google ${app}</title></head><body>
<input id="title" aria-label="Rename" value="Methods draft">
<div class="kix-appview-editor" tabindex="0" role="textbox" aria-label="Document content" style="width:640px;height:300px;border:1px solid #ccc"><canvas width="640" height="300"></canvas></div>
<iframe class="docs-texteventtarget-iframe" style="position:absolute;top:-10000px;width:10px;height:10px" srcdoc="<html><body><div contenteditable='true' role='textbox'></div></body></html>"></iframe>
<script>
  window.model = "";
  const frame = document.querySelector(".docs-texteventtarget-iframe");
  frame.addEventListener("load", () => {
    const doc = frame.contentDocument;
    const ed = doc.querySelector("[contenteditable]");
    ed.addEventListener("input", e => { if (e.inputType === "insertText") { window.model += e.data; ed.textContent = ""; } });
    ed.addEventListener("keydown", e => { if (e.keyCode === 13) { window.model += "\\n"; e.preventDefault(); } });
    window.ready = true;
  });
</script></body></html>`;

let failed = false;
try {
  const context = await browser.newContext();
  await context.route("https://docs.google.com/**", route => {
    const app = /\/spreadsheets\//.test(route.request().url()) ? "Sheets" : "Docs";
    route.fulfill({ status: 200, contentType: "text/html", body: docsFixture(app) });
  });
  const open = async url => {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.ready === true);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: AGENT });
    return page;
  };
  const send = (page, action, args = {}) => page.evaluate(([action, args]) => window.__enso({ enso: true, action, args, agent: "Claude Code" }), [action, args]);

  // ---- Google Docs ----
  const docs = await open("https://docs.google.com/document/d/fixture/edit");
  let r = await send(docs, "type", { text: "Methods\nWe compared six charts." });
  assert.equal(r.ok, true, r.error);
  assert.match(r.result.description, /Google Docs document body/);
  assert.equal(await docs.evaluate(() => window.model), "Methods\nWe compared six charts.");
  console.log("ok - Docs: page_type without a ref types into the body at the cursor, newlines as Enter");

  const snap = (await send(docs, "snapshot")).result;
  const canvasRef = snap.elements.find(e => e.name === "Document content").ref;
  const titleRef = snap.elements.find(e => e.name === "Rename").ref;
  r = await send(docs, "type", { ref: canvasRef, text: " More." });
  assert.equal(r.ok, true, r.error);
  assert.equal(await docs.evaluate(() => window.model), "Methods\nWe compared six charts. More.");
  console.log("ok - Docs: page_type with the canvas's ref also types into the body");

  r = await send(docs, "type", { ref: titleRef, text: "Methods (v2)" });
  assert.equal(r.ok, true, r.error);
  assert.equal(await docs.evaluate(() => document.getElementById("title").value), "Methods (v2)");
  assert.equal(await docs.evaluate(() => window.model), "Methods\nWe compared six charts. More.", "a real input isn't the body");
  console.log("ok - Docs: a real input on the page still takes the normal path");

  // ---- title prefix and the pill ----
  r = await send(docs, "presence", { label: "Claude Code", task: "Draft the methods", running: true, titlePrefix: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(await docs.title(), "✦ Methods draft - Google Docs");
  assert.equal(await docs.locator("[data-enso-pill]").count(), 1, "the pill is shown for the session");
  await docs.evaluate(() => (document.title = "Methods draft (saved) - Google Docs")); // Docs rewrites its title
  await docs.waitForFunction(() => document.title === "✦ Methods draft (saved) - Google Docs");
  await send(docs, "presence", { label: "Claude Code", task: "Draft the methods", running: false, titlePrefix: true }); // an update doesn't double it
  assert.equal(await docs.title(), "✦ Methods draft (saved) - Google Docs");
  await send(docs, "presence", { off: true });
  assert.equal(await docs.title(), "Methods draft (saved) - Google Docs", "the page's own latest title, exactly");
  await docs.waitForTimeout(400);
  assert.equal(await docs.locator("[data-enso-pill]").count(), 0, "the pill goes with the session");
  await docs.evaluate(() => (document.title = "After"));
  await docs.waitForTimeout(50);
  assert.equal(await docs.title(), "After", "no prefix after the session");
  await send(docs, "presence", { label: "Codex", task: "", titlePrefix: false });
  assert.equal(await docs.title(), "After", "the setting turns the prefix off");
  await send(docs, "presence", { off: true });
  console.log("ok - title prefix follows title rewrites and is restored exactly; the pill comes and goes");

  // ---- Google Sheets keeps the normal path ----
  const sheets = await open("https://docs.google.com/spreadsheets/d/fixture/edit");
  r = await send(sheets, "type", { text: "42" });
  assert.equal(r.ok, false, "no ref and no focused field: an error, not Docs typing");
  assert.match(r.error, /No ref given/);
  assert.equal(await sheets.evaluate(() => window.model), "");
  const sref = (await send(sheets, "snapshot")).result.elements.find(e => e.name === "Rename").ref;
  r = await send(sheets, "type", { ref: sref, text: "Budget" });
  assert.equal(r.ok, true, r.error);
  assert.equal(await sheets.evaluate(() => document.getElementById("title").value), "Budget");
  console.log("ok - Sheets keeps the normal typing path");

  // ---- no ref elsewhere: the focused field ----
  await sheets.focus("#title");
  r = await send(sheets, "type", { text: "Q4 budget" });
  assert.equal(r.ok, true, r.error);
  assert.equal(await sheets.evaluate(() => document.getElementById("title").value), "Q4 budget");
  console.log("ok - page_type without a ref types into the focused field");
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
