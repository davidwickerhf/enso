// The "make Ensō the default search engine" card (extension/ui/nudge.js): when it
// shows, "Not now" (30 days) and "Don't ask again", and its states on a page.
// A classic script shared with the UI; under Node it fills module.exports.

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const N = require("../../extension/ui/nudge.js");

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };
const NOW = Date.UTC(2026, 10, 10, 12);

ok("shows only when Ensō is known not to be the default", () => {
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: null, now: NOW }), true);
  assert.equal(N.shouldShow({ ensoIsDefault: true, dismissal: null, now: NOW }), false);
  assert.equal(N.shouldShow({ ensoIsDefault: null, dismissal: null, now: NOW }), false, "search.get failed: don't nag");
  assert.equal(N.shouldShow({ ensoIsDefault: undefined, now: NOW }), false);
  assert.equal(N.shouldShow(), false);
});

ok("Not now hides it for 30 days, then it comes back", () => {
  const d = N.dismiss("later", NOW);
  assert.equal(d.until, NOW + 30 * N.DAY);
  assert.equal(N.SNOOZE_DAYS, 30);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: NOW }), false);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: NOW + 29 * N.DAY }), false);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: d.until - 1 }), false);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: d.until }), true);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: NOW + 31 * N.DAY }), true);
});

ok("Don't ask again hides it for good", () => {
  const d = N.dismiss("never", NOW);
  assert.equal(d.never, true);
  assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: d, now: NOW + 3650 * N.DAY }), false);
  assert.throws(() => N.dismiss("maybe", NOW), /Unknown dismissal/);
});

ok("a broken or hand-edited dismissal counts as none", () => {
  for (const bad of [null, {}, { until: "soon" }, { until: -5 }, { never: "yes" }, "x", 42]) {
    assert.equal(N.shouldShow({ ensoIsDefault: false, dismissal: bad, now: NOW }), true, JSON.stringify(bad));
  }
  assert.deepEqual(N.normalize({ until: String(NOW) }), { until: NOW, never: false });
});

ok("card states: ask, then Done once it becomes the default; never Done out of nowhere", () => {
  assert.equal(N.cardState({ ensoIsDefault: false, shown: false, dismissal: null, now: NOW }), "ask");
  assert.equal(N.cardState({ ensoIsDefault: true, shown: true, now: NOW }), "done");
  assert.equal(N.cardState({ ensoIsDefault: true, shown: false, now: NOW }), "hidden");
  assert.equal(N.cardState({ ensoIsDefault: false, shown: false, dismissal: N.dismiss("later", NOW), now: NOW }), "hidden");
  assert.equal(N.cardState({ ensoIsDefault: false, shown: true, dismissal: N.dismiss("later", NOW - 31 * N.DAY), now: NOW }), "ask", "already on screen stays");
  assert.equal(N.cardState({ ensoIsDefault: null, shown: false, now: NOW }), "hidden");
});

ok("the settings page it points at", () => {
  assert.equal(N.SETTINGS_PATH, "about:preferences#search");
});

console.log(`1..${n}`);
