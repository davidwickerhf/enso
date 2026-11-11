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
//   - several agents on one tab: one pill ("2 agents · …"), a list on hover
//     with each agent's task and state, "✦ " in the title exactly once and
//     restored when the sessions end in any order, a shade per agent on the
//     outline flashes, and a new copy of the script (an extension update)
//     removing the old copy's pill, flashes and doubled title prefix;
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

// A page several agents work on at once (the SharePoint document of the bug report, simplified).
const multiFixture = `<!doctype html><html><head><title>Interview notes</title>
<style>body { margin: 0; font: 15px/1.5 -apple-system, system-ui, sans-serif; background: #f4f1ec; color: #222; }
header { height: 48px; background: #185abd; color: #fff; display: flex; align-items: center; padding: 0 16px; font-weight: 600; }
main { max-width: 760px; margin: 28px auto; background: #fff; padding: 40px 56px; min-height: 520px; box-shadow: 0 1px 4px rgba(0,0,0,.12); }
h1 { font-size: 24px; margin: 0 0 12px; } button { margin: 4px 8px 4px 0; padding: 6px 12px; }</style></head><body>
<header>Word · Interview notes</header>
<main><h1>Interview notes</h1>
<p>Participant 4 described the onboarding flow as slow and asked for a way to export the summary.</p>
<button id="share">Share</button><button id="download">Download</button><button id="comment">Comment</button>
<p>Follow-up questions are in the second section.</p></main>
<script>window.ready = true;</script></body></html>`;

let failed = false;
try {
  const context = await browser.newContext();
  await context.route("https://docs.google.com/**", route => {
    const app = /\/spreadsheets\//.test(route.request().url()) ? "Sheets" : "Docs";
    route.fulfill({ status: 200, contentType: "text/html", body: docsFixture(app) });
  });
  await context.route("https://work.example.test/**", route => route.fulfill({ status: 200, contentType: "text/html", body: multiFixture }));
  await context.route("https://desec.io.example.test/**", route => route.fulfill({ status: 200, contentType: "text/html", body: multiFixture }));
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

  // ---- several agents on one tab: one pill, the title prefix once ----
  {
    const page = await open("https://work.example.test/sites/team/interview.docx");
    const A = { id: "a1", label: "Claude Code", task: "Summarise the interview", startedAt: "2026-11-10T10:00:00Z", running: true };
    const B = { id: "b2", label: "Claude Code", task: "Export the notes as PDF and download it", startedAt: "2026-11-10T10:01:00Z", running: false };
    const C = { id: "c3", label: "Codex", task: "", startedAt: "2026-11-10T10:02:00Z", paused: true };
    const presence = (...agents) => send(page, "presence", { agents, titlePrefix: true });
    const state = async () => (await send(page, "pill_state")).result;
    const pills = () => page.locator("[data-enso-pill]").count();

    r = await presence(A);
    assert.equal(r.ok, true, r.error);
    let st = await state();
    assert.equal(await pills(), 1);
    assert.equal(st.text, "✦ Claude Code · Summarise the interview");
    assert.equal(st.state, "");
    assert.equal(await page.title(), "✦ Interview notes");
    await page.hover("[data-enso-pill]");
    await page.waitForTimeout(50);
    assert.equal((await state()).expanded, false, "one agent: the pill already says it all, no list");
    await page.mouse.move(5, 400);
    console.log("ok - one agent: one pill, \"Claude Code · <task>\", one prefix");
    await presence({ ...A, space: "BISS" });
    assert.equal((await state()).text, "✦ Claude Code · BISS · Summarise the interview", "the session's Zen space on the pill");
    await presence(A);

    await presence(B, A); // newest first, as background.js sends them
    st = await state();
    assert.equal(await pills(), 1, "still one pill");
    assert.equal(st.text, "✦ 2 agents · Claude Code: Summarise the interview (+1)", "the working agent leads");
    assert.equal(await page.title(), "✦ Interview notes", "the prefix once with two sessions");
    await page.hover("[data-enso-pill]");
    await page.waitForFunction(() => document.querySelector("[data-enso-pill]")?.hasAttribute("data-expanded"));
    st = await state();
    assert.equal(st.expanded, true);
    assert.deepEqual(st.rows.map(x => [x.id, x.state]), [["a1", "working"], ["b2", "idle"]]);
    assert.match(st.rows[1].text, /Claude Code · Export the notes as PDF and download it\s*Idle/);
    assert.equal(st.shades.a1, "#d9643a", "the oldest keeps Ensō's copper");
    assert.notEqual(st.shades.b2, st.shades.a1, "a distinct shade per agent");
    await page.mouse.move(5, 400);
    await page.waitForFunction(() => !document.querySelector("[data-enso-pill]")?.hasAttribute("data-expanded"));
    console.log("ok - two agents: one pill, \"2 agents · …(+1)\", the list on hover");

    await presence(C, B, { ...A, running: false });
    st = await state();
    assert.equal(await pills(), 1);
    assert.equal(st.text, "✦ 3 agents · Codex (+2)", "nobody working: the paused one leads");
    assert.equal(st.state, "· Paused");
    await page.hover("[data-enso-pill]");
    await page.waitForFunction(() => document.querySelector("[data-enso-pill]")?.hasAttribute("data-expanded"));
    st = await state();
    assert.deepEqual(st.rows.map(x => [x.id, x.state]), [["c3", "paused"], ["b2", "idle"], ["a1", "idle"]]);
    assert.match(st.rows[0].text, /Codex · no task given\s*Paused/);
    assert.equal(new Set(Object.values(st.shades)).size, 3, "three shades");
    const pick = await send(page, "pill_pick", { y: 0 });
    assert.equal(pick.result.sessionId, "c3", "a click on the pill itself: the agent it leads with");
    await page.mouse.move(5, 400);
    await presence(C, B, A); // A working again
    st = await state();
    assert.equal(st.text, "✦ 3 agents · Claude Code: Summarise the interview (+2)");
    assert.equal(st.state, "· 1 paused");
    assert.equal(await page.title(), "✦ Interview notes");
    console.log("ok - three agents: one pill, the most important state leads, paused shown per agent");

    // Each agent's flash in its own shade, with its name.
    const snapRefs = (await send(page, "snapshot")).result.elements;
    const ref = name => snapRefs.find(e => e.name === name).ref;
    const flashOf = async (session, agentLabel, name) => {
      await page.evaluate(([action, args, agent, session]) => window.__enso({ enso: true, action, args, agent, session }), ["click", { ref: ref(name) }, agentLabel, session]);
      return page.evaluate(() => { const f = [...document.querySelectorAll("[data-enso-flash]")].at(-1); return { session: f.getAttribute("data-session"), border: f.style.borderColor, label: f.textContent }; });
    };
    const fa = await flashOf("a1", "Claude Code", "Share");
    const fc = await flashOf("c3", "Codex", "Comment");
    assert.equal(fa.session, "a1");
    assert.equal(fc.session, "c3");
    assert.notEqual(fa.border, fc.border, "two agents' flashes differ in colour");
    assert.equal(fa.label, "Claude Code · clicking");
    assert.equal(fc.label, "Codex · clicking");
    console.log("ok - outline flashes carry the acting agent's shade and name");

    // Two sessions of the same client: the exact session id picks the flash, never the name.
    const fb = await flashOf("b2", "Claude Code", "Share");
    assert.equal(fb.session, "b2", "the second Claude Code session, not the first one with that name");
    assert.notEqual(fb.border, fa.border);
    const unknown = await flashOf("zz", "Claude Code", "Share");
    assert.equal(unknown.session, null, "an id the page doesn't know yet: no guess by name");
    assert.equal(unknown.label, "Claude Code · clicking");
    console.log("ok - the session id from the helper attributes flashes exactly between two sessions of one client");

    // Tab leases in the pill: who is in control, who waits for the tab.
    await presence({ ...C, paused: false, control: "waiting" }, { ...B, control: null }, { ...A, control: "holder" });
    st = await state();
    assert.equal(st.state, "· 1 waiting");
    await page.hover("[data-enso-pill]");
    await page.waitForFunction(() => document.querySelector("[data-enso-pill]")?.hasAttribute("data-expanded"));
    st = await state();
    const rowOf = id => st.rows.find(x => x.id === id).text;
    assert.match(rowOf("a1"), /Working · in control$/);
    assert.match(rowOf("c3"), /Waiting for the tab$/);
    await page.mouse.move(5, 400);
    await presence(C, B, A);
    console.log("ok - the pill shows who is in control and who is waiting for the tab");

    // The page rewrites its title; sessions end in a mixed order; the prefix stays single, then goes exactly.
    await page.evaluate(() => (document.title = "Interview notes (saved)"));
    await page.waitForFunction(() => document.title === "✦ Interview notes (saved)");
    await presence(C, A); // B ends
    assert.equal(await page.title(), "✦ Interview notes (saved)");
    await presence(C); // A ends
    assert.equal(await page.title(), "✦ Interview notes (saved)");
    assert.equal((await state()).text, "✦ Codex is working on this page");
    await presence(); // C ends: an empty list
    assert.equal(await page.title(), "Interview notes (saved)", "removed only with the last session, the page's title exactly");
    await page.waitForTimeout(400);
    assert.equal(await pills(), 0);
    for (const order of [[A, B, C], [C, A, B]]) {
      await presence(...order);
      for (let i = order.length - 1; i >= 1; i--) {
        await presence(...order.slice(0, i).reverse());
        assert.equal(await page.title(), "✦ Interview notes (saved)");
      }
      await send(page, "presence", { off: true });
      assert.equal(await page.title(), "Interview notes (saved)");
    }
    console.log("ok - title prefix exactly once, removed only when the last session ends, in any order");

    // An older build left a doubled prefix: cleaned up, never stacked.
    await page.evaluate(() => (document.title = "✦ ✦ Interview notes"));
    await presence(A);
    assert.equal(await page.title(), "✦ Interview notes", "a doubled prefix is collapsed to one");
    await page.evaluate(() => (document.title = "✦ Interview notes v2")); // a stray prefix arriving with a rewrite
    await page.waitForFunction(() => document.title === "✦ Interview notes v2");
    await send(page, "presence", { off: true });
    assert.equal(await page.title(), "Interview notes v2");
    console.log("ok - a doubled \"✦ ✦ \" prefix from an older build is cleaned up");

    // An extension update: a new copy of the script in a new sandbox. The live old copy stands down,
    // and what a dead old copy (or an older build) left is removed.
    await presence(B, A);
    await page.evaluate(() => {
      const ghost = document.createElement("div"); // an older build's pill and flash, whose code is gone
      ghost.setAttribute("data-enso-pill", "");
      ghost.textContent = "✦ Claude Code is working on this page";
      document.documentElement.appendChild(ghost);
      const flash = document.createElement("div");
      flash.setAttribute("aria-hidden", "true");
      Object.assign(flash.style, { position: "fixed", zIndex: 2147483646, pointerEvents: "none", border: "2px solid #d9643a" });
      document.documentElement.appendChild(flash);
      document.title = "✦ ✦ Interview notes";
    });
    assert.equal(await pills(), 2);
    await page.evaluate(() => delete window.__ensoAgent); // a new sandbox doesn't see the old copy's marker
    await page.addScriptTag({ content: AGENT });
    assert.equal(await pills(), 0, "the old copy's pill and the older build's pill are gone");
    assert.equal(await page.evaluate(() => [...document.documentElement.children].filter(n => n.style?.zIndex === "2147483646").length), 0, "stale flashes are gone");
    assert.equal(await page.title(), "Interview notes", "the stale prefix is gone until a session says otherwise");
    await page.evaluate(() => (document.title = "Interview notes!"));
    await page.waitForTimeout(50);
    assert.equal(await page.title(), "Interview notes!", "the old copy no longer follows the title");
    await presence(B, A); // background.js sends the sessions to the new copy
    assert.equal(await pills(), 1, "one pill from the new copy");
    assert.equal(await page.title(), "✦ Interview notes!");
    await send(page, "presence", { off: true });
    assert.equal(await page.title(), "Interview notes!");
    console.log("ok - a re-injected copy replaces the old one: its pill, flashes and title prefix go");
    await page.close();
  }

  // ---- a session-access request on the pill: Allow / Not now ----
  {
    const page = await open("https://desec.io.example.test/domains");
    await page.evaluate(() => {
      window.__sent = [];
      browser.runtime.sendMessage = async m => void window.__sent.push(m);
    });
    const state = async () => (await send(page, "pill_state")).result;
    const REQ = { id: "ar-1", label: "Claude Code", origin: "https://desec.io.example.test", status: "pending" };
    const A = { id: "a1", label: "Claude Code", task: "Check the staging DNS records", startedAt: "2026-11-10T10:00:00Z", running: false };

    // No agent on this tab, only the request: the pill shows it, without a title prefix
    r = await send(page, "presence", { agents: [], titlePrefix: true, access: [REQ] });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.shown, true);
    let st = await state();
    assert.equal(st.text, "✦ Claude Code is asking to use your login here");
    assert.equal(st.access.length, 1);
    assert.match(st.access[0].text, /^Claude Code wants to use your login on desec\.io\.example\.test/);
    assert.equal(st.access[0].status, "pending");
    assert.equal(await page.title(), "Interview notes", "no ✦ prefix for a request alone");
    assert.ok(await page.evaluate(() => document.querySelector("[data-enso-pill]").hasAttribute("data-access")), "the request row is shown without hovering");

    // With the agent's session: its pill, and the request row under it
    await send(page, "presence", { agents: [A], titlePrefix: true, access: [REQ] });
    st = await state();
    assert.equal(st.text, "✦ Claude Code · Check the staging DNS records");
    assert.equal(st.access.length, 1);
    const { allow, dismiss } = st.access[0].buttons;
    assert.ok(allow && dismiss, "Allow and Not now");

    // pill_pick (what background.js asks for a trusted click in pill.html) names the button
    let pick = (await send(page, "pill_pick", allow)).result;
    assert.deepEqual(pick.access, { id: "ar-1", choice: "allow" });
    pick = (await send(page, "pill_pick", dismiss)).result;
    assert.deepEqual(pick.access, { id: "ar-1", choice: "dismiss" });
    pick = (await send(page, "pill_pick", { x: 20, y: 12 })).result;
    assert.equal(pick.access, null, "a click on the pill itself isn't an answer");
    assert.equal(pick.sessionId, "a1");

    // The page can't answer: synthetic clicks (untrusted) and clicks into the closed shadow root do nothing
    const box = await page.evaluate(() => { const r = document.querySelector("[data-enso-pill]").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await page.evaluate(([x, y]) => {
      const host = document.querySelector("[data-enso-pill]");
      host.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }));
      document.elementFromPoint(x, y)?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, clientX: x, clientY: y }));
      host.shadowRoot?.querySelector("span")?.click();
    }, [box.x + allow.x, box.y + allow.y]);
    await page.waitForTimeout(50);
    assert.deepEqual(await page.evaluate(() => window.__sent), [], "a page script's click sends nothing");
    assert.equal(await page.evaluate(() => document.querySelector("[data-enso-pill]").shadowRoot), null, "the pill's shadow root is closed to the page");
    // The content script's own (fallback) handler, even on a real click, only opens Ensō: it never names an answer
    await page.mouse.click(box.x + allow.x, box.y + allow.y);
    await page.waitForTimeout(50);
    const sent = (await page.evaluate(() => window.__sent)).filter(m => !m.ensoUserInput); // the user's own click also reports "the user used this tab" (agent tabs)
    assert.ok(sent.length >= 1, "the real click reached the fallback handler");
    assert.ok(sent.every(m => m.ensoPillFallback && !("access" in m) && !("choice" in m)), `fallback messages only: ${JSON.stringify(sent)}`);

    // The granted state, then the request goes
    await send(page, "presence", { agents: [A], titlePrefix: true, access: [{ ...REQ, status: "granted" }] });
    st = await state();
    assert.match(st.access[0].text, /Allowed desec\.io\.example\.test\. Claude Code can retry\./);
    assert.deepEqual(st.access[0].buttons, {}, "no buttons once answered");
    await send(page, "presence", { agents: [{ ...A }], titlePrefix: true });
    st = await state();
    assert.equal(st.access.length, 0);
    await send(page, "presence", { off: true });
    console.log("ok - a session-access request on the pill: shown on the site's tab, Allow / Not now named by pill_pick, nothing a page script can trigger");
    await page.close();
  }

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
