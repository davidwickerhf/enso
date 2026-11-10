// The extension's "no infinite Loading…" logic (extension/ui/store.js wait /
// loadState) and the Copy diagnostics text (views/helperstate.js), run in Node
// without a browser: a fake transport records what the store sends.
//
//   node test/ui-loading.test.mjs

import assert from "node:assert/strict";
import { createStore } from "../../extension/ui/store.js";
import { describeHelper, diagnosticsText } from "../../extension/ui/views/helperstate.js";

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tick = () => new Promise(r => queueMicrotask(r));

function make() {
  const store = createStore({ waitMs: 60 });
  const sent = [];
  const topics = [];
  store.actions.attach({ kind: "test", send: m => sent.push(m) });
  store.subscribe(t => topics.push(...t));
  return { store, sent, topics };
}

{
  const { store, sent, topics } = make();
  store.receive({ type: "helper.status", state: "connected", at: Date.now() });
  store.actions.hello();
  assert.equal(store.loadState("state"), "loading");
  await sleep(90);
  assert.equal(store.loadState("state"), "timeout", "no answer within the wait: timeout");
  assert.ok(topics.includes("waits"), "views are told (waits topic)");
  // Retry asks again and is loading again; the answer settles it.
  const before = sent.filter(m => m.type === "hello").length;
  store.actions.retryLoad("state");
  assert.equal(sent.filter(m => m.type === "hello").length, before + 1);
  assert.equal(store.loadState("state"), "loading");
  store.receive({ type: "state", settings: {}, conversations: [] });
  await sleep(90);
  assert.equal(store.state.waits.has("state"), false, "answered: no longer waiting");
  console.log("ok - a request without an answer turns into timeout after the wait; Retry asks again; the answer settles it");
}

{
  const { store, sent } = make();
  store.receive({ type: "helper.status", state: "connected", at: Date.now() });
  store.actions.loadMemory();
  store.actions.setupStatus();
  store.receive({ type: "helper.status", state: "stopped", reason: "An unexpected error occurred", at: Date.now(), failures: 2, lastError: { message: "An unexpected error occurred", state: "stopped", at: Date.now(), ranMs: 1200 } });
  assert.equal(store.loadState("memory"), "down", "helper stopped: down, not loading");
  assert.equal(store.helperDown().state, "stopped");
  // Try again while down asks background.js to reconnect, not the helper.
  store.actions.retryLoad("memory");
  assert.equal(sent.at(-1).type, "helper.retry");
  // Back: hello again, plus what views were still waiting for.
  sent.length = 0;
  store.receive({ type: "helper.status", state: "connected", at: Date.now() });
  const types = sent.map(m => m.type);
  assert.ok(types.includes("hello") && types.includes("memory.get") && types.includes("setup.status"), types.join());
  store.receive({ type: "memory", text: "x" });
  assert.equal(store.state.waits.has("memory"), false);
  await tick();
  console.log("ok - helper stopped: waiting sections are 'down'; when it's back, the pending requests are sent again");
}

{
  const { store } = make();
  store.receive({ type: "helper.status", state: "missing", reason: "No such native application enso", at: Date.now() });
  await store.actions.detectPlatform("linux");
  assert.equal(store.unsupported(), true);
  assert.equal(store.helperDown().unsupported, true);
  store.receive({ type: "helper.status", state: "connecting", at: Date.now() });
  assert.equal(store.loadState("state"), "down", "on Linux a helper that isn't connected is down, even while 'connecting'");
  await store.actions.detectPlatform("mac");
  assert.equal(store.unsupported(), false);
  assert.equal(store.helperDown(), null);
  console.log("ok - Linux/Windows: the helper counts as not running (unsupported) unless it connected");
}

{
  assert.equal(describeHelper({ state: "missing" }).kind, "not found");
  assert.equal(describeHelper({ state: "failed", reason: "the helper exited as soon as it started" }).reason, "", "background.js's own fallback isn't shown as a reason");
  assert.equal(describeHelper({ state: "stopped", reason: "An unexpected error occurred" }).kind, "exited");
  const helper = { state: "stopped", at: Date.UTC(2026, 10, 10, 14, 2), failures: 3, lastError: { message: "An unexpected error occurred", state: "stopped", at: Date.UTC(2026, 10, 10, 14, 2), ranMs: 2300 } };
  const offline = diagnosticsText({ extVersion: "0.5.5", browserName: "Zen 1.17.2b", platform: "mac aarch64", helper, helperLog: null, now: Date.UTC(2026, 10, 10, 14, 5) });
  assert.match(offline, /^Ensō diagnostics \(2026-11-10T14:05:00\.000Z\)\nExtension: 0\.5\.5\nBrowser: Zen 1\.17\.2b\nPlatform: mac aarch64\n/);
  assert.match(offline, /Helper status: stopped \(exited\) since 2026-11-10T14:02:00\.000Z, 3 failed attempts in a row/);
  assert.match(offline, /Last error: "An unexpected error occurred" \(stopped, 2026-11-10T14:02:00\.000Z, after running 2 s\)/);
  assert.match(offline, /Also send ~\/Library\/Logs\/Enso\/helper\.log/);
  const online = diagnosticsText({ extVersion: "0.5.5", browserName: "Zen", platform: "mac", helper: { state: "connected" }, helperLog: { version: "0.5.5", node: { version: "v22.1.0", path: "/opt/homebrew/bin/node" }, platform: "darwin arm64", lines: ["a", "b"] } });
  assert.match(online, /Helper: 0\.5\.5, Node v22\.1\.0 at \/opt\/homebrew\/bin\/node, darwin arm64\n\nLast 2 lines of ~\/Library\/Logs\/Enso\/helper\.log \(secrets removed\):\na\nb$/);
  assert.doesNotMatch(online, /Also send/);
  console.log("ok - Copy diagnostics: versions, status, last error, browser, platform; the log's end when the helper answers, else the path to send");
}
console.log("ui loading checks passed");
