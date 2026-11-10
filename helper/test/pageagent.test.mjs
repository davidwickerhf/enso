// The page agent (extension/pageagent.js) in a headless browser, against local
// fixtures served under docs.google.com URLs by request interception (no
// network, no real documents):
//   - page_type into a Google Docs body through its hidden input iframe
//     (.docs-texteventtarget-iframe), with no ref and with the canvas's ref,
//     newlines as Enter; a real input on the Docs page still takes the normal path;
//   - Google Sheets keeps the normal path (no Docs typing there);
//   - the "✦ " title prefix while an agent session is active, following a
//     page that rewrites its title, restored exactly at the end;
//   - the session pill appears and goes;
//   - page_query and page_inspect (fixed queries, no code evaluation) on a
//     fixture page, in the source and in the listed build, which has no eval action.
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
const { stripUnlistedOnly } = await import("../../scripts/build-extension.mjs");
const LISTED_AGENT = stripUnlistedOnly(AGENT, "pageagent.js").text;

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


const queryFixture = `<!doctype html><html><head><title>Fixture shop</title><base href="https://shop.example.test/catalog/">
<style>
  body { margin: 0; font: 16px/1.5 sans-serif; }
  .card { display: block; width: 200px; height: 60px; margin: 8px 12px; padding: 4px; color: rgb(10, 20, 30); }
  #hidden { display: none; }
  #banner { position: fixed; top: 0; left: 0; width: 100%; height: 300px; z-index: 50; background: rgba(0,0,0,.5); }
  #clip { width: 100px; height: 40px; overflow: hidden; white-space: nowrap; }
</style></head><body>
<a class="card" href="item/1" data-id="1" aria-label="First item">  First
   item  </a>
<a class="card" href="/item/2" data-id="2">Second item</a>
<a class="card" id="hidden" href="https://other.example.test/x">Hidden link</a>
<input id="pw" type="password" aria-label="Password" value="hunter2-secret">
<input id="q" type="search" value="blue shoes">
<div id="clip">A long line of text that overflows its little box</div>
<div id="banner"></div>
<script>window.ready = true;</script>
</body></html>`;

let failed = false;
try {
  const context = await browser.newContext();
  await context.route("https://docs.google.com/**", route => {
    const app = /\/spreadsheets\//.test(route.request().url()) ? "Sheets" : "Docs";
    route.fulfill({ status: 200, contentType: "text/html", body: docsFixture(app) });
  });
  await context.route("https://shop.example.test/**", route => route.fulfill({ status: 200, contentType: "text/html", body: queryFixture }));
  const open = async (url, agentCode = AGENT) => {
    const page = await context.newPage();
    await page.goto(url);
    await page.waitForFunction(() => window.ready === true);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: agentCode });
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

  // ---- page_query and page_inspect: fixed queries ----
  for (const [label, code] of [["source", AGENT], ["listed build", LISTED_AGENT]]) {
    const shop = await open("https://shop.example.test/catalog/index.html", code);
    let q = await send(shop, "query", { selector: "a.card", attributes: ["href", "data-id", "aria-label", "onclick"], limit: 50, includeText: true });
    assert.equal(q.ok, true, q.error);
    assert.equal(q.result.total, 3);
    assert.deepEqual(q.result.elements.map(e => e.text), ["First item", "Second item", "Hidden link"]);
    assert.equal(q.result.elements[0].attributes.href, "https://shop.example.test/catalog/item/1", "relative URLs resolved against the base");
    assert.equal(q.result.elements[1].attributes.href, "https://shop.example.test/item/2");
    assert.equal(q.result.elements[0].attributes["data-id"], "1");
    assert.equal(q.result.elements[0].attributes["aria-label"], "First item");
    assert.deepEqual(q.result.refusedAttributes, ["onclick"], "event-handler attributes aren't returned");
    assert.equal(q.result.elements[0].visible, true);
    assert.equal(q.result.elements[2].visible, false, "display:none is not visible");
    assert.deepEqual(q.result.elements[0].rect, { x: 12, y: 8, width: 208, height: 68 });
    q = await send(shop, "query", { selector: "a.card", limit: 1, includeText: false });
    assert.equal(q.result.count, 1);
    assert.equal(q.result.truncated, true);
    assert.equal(q.result.elements[0].text, undefined);
    q = await send(shop, "query", { selector: "input", attributes: ["value", "type"] });
    assert.equal(q.result.elements[0].attributes.value, "[redacted: password field]", "password values never leave");
    assert.equal(q.result.elements[1].attributes.value, "blue shoes");
    q = await send(shop, "query", { selector: "a[[" });
    assert.equal(q.ok, false);
    assert.match(q.error, /Not a valid CSS selector/);

    let i = await send(shop, "inspect", { selector: "a.card" });
    assert.equal(i.ok, true, i.error);
    assert.equal(i.result.tag, "a");
    assert.equal(i.result.role, "link");
    assert.equal(i.result.name, "First item");
    assert.equal(i.result.matched, 3);
    assert.equal(i.result.styles.display, "block");
    assert.equal(i.result.styles.color, "rgb(10, 20, 30)");
    assert.equal(i.result.styles["margin-left"], "12px");
    assert.equal(i.result.inView, true);
    assert.equal(i.result.covered, true, "under the fixed banner");
    assert.match(i.result.coveredBy, /^div#banner/);
    i = await send(shop, "inspect", { selector: "#clip" });
    assert.ok(i.result.scroll.scrollWidth > i.result.scroll.clientWidth, "overflowing content shows in the scroll size");
    assert.equal(i.result.styles["overflow-x"], "hidden");
    i = await send(shop, "inspect", { selector: "#pw" });
    assert.equal(i.result.name, "Password", "the accessible name never includes a password value");
    assert.ok(!JSON.stringify(i.result).includes("hunter2"), "no password anywhere in the result");
    const refs = (await send(shop, "snapshot")).result.elements;
    i = await send(shop, "inspect", { ref: refs.find(e => e.name === "Second item").ref });
    assert.equal(i.result.name, "Second item");
    i = await send(shop, "inspect", { selector: ".nope" });
    assert.equal(i.ok, false);
    assert.match(i.error, /Nothing matches/);
    const ev = await send(shop, "eval", { expression: "1+1" });
    if (label === "listed build") {
      assert.equal(ev.ok, false);
      assert.match(ev.error, /Unknown page action eval/, "the listed build has no eval action");
    } else assert.equal(ev.ok, true, "the source keeps the eval action");
    await shop.close();
    console.log(`ok - page_query and page_inspect on a fixture page (${label})`);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
