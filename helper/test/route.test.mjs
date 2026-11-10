// Address-bar routing (extension/ui/route.js): prefix parsing and setting → destination.
// The module is a classic script shared by background.js and the UI; under Node it
// fills module.exports.

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const R = require("../../extension/ui/route.js");

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

ok("no prefix: the text as typed, nothing forced", () => {
  assert.deepEqual(R.parsePrefix("  weather in lisbon "), { text: "weather in lisbon", force: null });
  assert.deepEqual(R.parsePrefix("what is a monad?"), { text: "what is a monad?", force: null }, "a question mark at the end is no prefix");
  assert.deepEqual(R.parsePrefix(""), { text: "", force: null });
  assert.deepEqual(R.parsePrefix(undefined), { text: "", force: null });
});

ok("prefixes that force Ensō: e, ?, @enso", () => {
  assert.deepEqual(R.parsePrefix("e plan my week"), { text: "plan my week", force: "enso" });
  assert.deepEqual(R.parsePrefix("E plan my week"), { text: "plan my week", force: "enso" });
  assert.deepEqual(R.parsePrefix("?plan my week"), { text: "plan my week", force: "enso" });
  assert.deepEqual(R.parsePrefix("? plan my week"), { text: "plan my week", force: "enso" });
  assert.deepEqual(R.parsePrefix("@enso plan my week"), { text: "plan my week", force: "enso" });
  assert.deepEqual(R.parsePrefix("@ENSO"), { text: "", force: "enso" });
});

ok("prefixes that force a web search: g, /", () => {
  assert.deepEqual(R.parsePrefix("g lisbon weather"), { text: "lisbon weather", force: "web" });
  assert.deepEqual(R.parsePrefix("G lisbon"), { text: "lisbon", force: "web" });
  assert.deepEqual(R.parsePrefix("/lisbon weather"), { text: "lisbon weather", force: "web" });
  assert.deepEqual(R.parsePrefix("/ lisbon"), { text: "lisbon", force: "web" });
});

ok("words that only start with e or g are not prefixes", () => {
  assert.equal(R.parsePrefix("email from sam").force, null);
  assert.equal(R.parsePrefix("google maps").force, null);
  assert.equal(R.parsePrefix("g").force, null);
  assert.equal(R.parsePrefix("e").force, null);
  assert.equal(R.parsePrefix("@ensomething").force, null);
});

ok("the setting decides plain queries", () => {
  assert.deepEqual(R.route("lisbon weather", "enso"), { to: "enso", text: "lisbon weather", forced: false });
  assert.deepEqual(R.route("lisbon weather", "web"), { to: "web", text: "lisbon weather", forced: false });
  assert.deepEqual(R.route("lisbon weather", "choose"), { to: "choose", text: "lisbon weather", forced: false });
  assert.equal(R.route("lisbon weather", undefined).to, "enso", "Ensō is the default");
  assert.equal(R.route("lisbon weather", "bogus").to, "enso");
});

ok("no guessing: questions and long queries follow the setting too", () => {
  assert.equal(R.route("why is the sky blue?", "web").to, "web");
  assert.equal(R.route("write a short note to sam about friday and the budget review", "web").to, "web");
  assert.equal(R.route("pizza", "enso").to, "enso");
});

ok("a prefix overrides every setting", () => {
  for (const mode of R.MODES) {
    assert.deepEqual(R.route("e lisbon", mode), { to: "enso", text: "lisbon", forced: true }, mode);
    assert.deepEqual(R.route("g lisbon", mode), { to: "web", text: "lisbon", forced: true }, mode);
  }
});

ok("Ensō not the default engine: the query came by @enso or its button, so it asks Ensō", () => {
  assert.equal(R.route("lisbon", "web", { ensoIsDefault: false }).to, "enso");
  assert.equal(R.route("lisbon", "choose", { ensoIsDefault: false }).to, "enso");
  assert.equal(R.route("g lisbon", "enso", { ensoIsDefault: false }).to, "web", "a prefix still wins");
});

ok("pickEngine: the saved engine, else Google, else the first; never Ensō", () => {
  const engines = [{ name: "Ensō", isDefault: true }, { name: "DuckDuckGo" }, { name: "Google" }, { name: "Bing" }];
  assert.equal(R.pickEngine(engines, "Bing"), "Bing");
  assert.equal(R.pickEngine(engines, "Gone"), "Google");
  assert.equal(R.pickEngine(engines, null), "Google");
  assert.equal(R.pickEngine(engines, "Ensō"), "Google");
  assert.equal(R.pickEngine([{ name: "Ensō" }, { name: "Ecosia" }], null), "Ecosia");
  assert.equal(R.pickEngine([{ name: "Ensō" }], null), null);
  assert.equal(R.pickEngine(undefined, null), null);
});

ok("queryFromUrl reads the fragment (what Zen sends) and ?q= (just in case)", () => {
  assert.equal(R.queryFromUrl("https://enso.wicker.life/ask#q=plan%20my%20week"), "plan my week");
  assert.equal(R.queryFromUrl("https://enso.wicker.life/ask#q=c%2B%2B%20%26%20rust"), "c++ & rust");
  assert.equal(R.queryFromUrl("https://enso.wicker.life/ask?q=hello+there"), "hello there");
  assert.equal(R.queryFromUrl("https://enso.wicker.life/ask"), "");
  assert.equal(R.queryFromUrl("not a url"), "");
});

ok("ruleLine names the active rule and the way around it", () => {
  assert.equal(R.ruleLine("enso", "Google"), "Address bar → Ensō · start with g to search Google");
  assert.equal(R.ruleLine("web", "DuckDuckGo"), "Address bar → DuckDuckGo · start with e to ask Ensō");
  assert.match(R.ruleLine("choose", "Google"), /choose each time/);
  assert.match(R.ruleLine("enso", "Google", { ensoIsDefault: false }), /isn't your default/);
});

console.log(`1..${n}`);
