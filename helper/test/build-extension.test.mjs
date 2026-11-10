// scripts/build-extension.mjs: the listed (addons.mozilla.org) build has no
// page_eval code and no eval / new Function; the unlisted build keeps it;
// channel.js says which build it is; marker mistakes fail the build.
// Also the settings defaults that changed in 0.5.7 for new installs only
// (store.pinPreviousDefaults).
//
//   node test/build-extension.test.mjs

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "../..");
const src = path.join(repo, "extension");
const { build, channelSource, findDynamicCode, stripUnlistedOnly } = await import("../../scripts/build-extension.mjs");
const require = createRequire(import.meta.url);
const root = mkdtempSync(path.join(tmpdir(), "enso-build-"));
process.env.ENSO_DATA = path.join(root, "data"); // before anything imports lib/store.mjs
process.env.ENSO_LEGACY_DATA = "";

let n = 0;
const ok = name => console.log(`ok ${++n} - ${name}`);

try {
  // ---- marker parsing ----
  const sample = ["a();", "  // <unlisted-only>", "  b(eval('x'));", "  // </unlisted-only>", "c();"].join("\n");
  assert.deepEqual(stripUnlistedOnly(sample), { text: "a();\nc();", blocks: 1 });
  assert.equal(stripUnlistedOnly("x\ny").blocks, 0);
  assert.throws(() => stripUnlistedOnly("// <unlisted-only>\nx", "f.js"), /f\.js:1: <unlisted-only> is never closed/);
  assert.throws(() => stripUnlistedOnly("x\n// </unlisted-only>", "f.js"), /f\.js:2: <\/unlisted-only> without an opening marker/);
  assert.throws(() => stripUnlistedOnly("// <unlisted-only>\n// <unlisted-only>\n// </unlisted-only>"), /inside the block opened on line 1/);
  assert.equal(stripUnlistedOnly("// the <unlisted-only> markers in prose\nx").blocks, 0, "only whole-line markers count");
  ok("unlisted-only blocks are removed with their markers; unbalanced markers fail");

  // ---- dynamic code detection ----
  assert.deepEqual(findDynamicCode("const x = 1;\n// page_eval in the page world\nexportFunction(f)").map(h => h.match), []);
  assert.deepEqual(findDynamicCode("eval(code)").map(h => h.match), ["eval("]);
  assert.deepEqual(findDynamicCode("w.eval (code)").map(h => h.match), [".eval("]);
  assert.deepEqual(findDynamicCode("const f = new Function('a', b)").map(h => h.match), ["new Function"]);
  assert.equal(findDynamicCode("medieval(x); retrieval(y)").length, 0, "eval( only as its own word");
  ok("eval( / .eval( / new Function are found, words that contain eval are not");

  // ---- channel.js ----
  assert.equal(readFileSync(path.join(src, "channel.js"), "utf8").replace(/\r\n/g, "\n"), channelSource("dev"), "extension/channel.js is the dev channel file (CRLF on a Windows checkout)");
  const manifest = JSON.parse(readFileSync(path.join(src, "manifest.json"), "utf8"));
  assert.equal(manifest.background.scripts[0], "channel.js", "background.js sees ENSO_CHANNEL");
  assert.throws(() => channelSource("beta"), /Unknown channel/);
  ok("the source says dev, and the manifest loads channel.js first");

  // ---- the real extension, listed ----
  const listed = path.join(root, "listed");
  const r = build({ src, out: listed, channel: "listed" });
  assert.ok(r.blocks >= 3, `removed ${r.blocks} blocks`);
  const agent = readFileSync(path.join(listed, "pageagent.js"), "utf8");
  assert.ok(!/unlisted-only>/.test(agent), "no markers left");
  assert.ok(!/\beval\s*:\s*evaluate/.test(agent) && !/function evaluate\b/.test(agent), "no eval action");
  assert.ok(!/pw\.eval/.test(agent));
  assert.ok(/\bquery,/.test(agent) && /\binspect,/.test(agent) && /\bstorage,/.test(agent), "the other tools stay");
  assert.equal(require(path.join(listed, "channel.js")).CHANNEL, "listed");
  assert.equal(readFileSync(path.join(listed, "manifest.json"), "utf8"), readFileSync(path.join(src, "manifest.json"), "utf8"));
  new Function(agent); // still parses (not run)
  // The source is untouched.
  assert.match(readFileSync(path.join(src, "pageagent.js"), "utf8"), /pw\.eval\(expression\)/);
  ok("listed build: page_eval code removed, still valid JavaScript, channel listed, source untouched");

  // ---- unlisted keeps it ----
  const unlisted = path.join(root, "unlisted");
  const u = build({ src, out: unlisted, channel: "unlisted" });
  assert.equal(u.blocks, 0);
  assert.equal(readFileSync(path.join(unlisted, "pageagent.js"), "utf8"), readFileSync(path.join(src, "pageagent.js"), "utf8"));
  assert.equal(require(path.join(unlisted, "channel.js")).CHANNEL, "unlisted");
  ok("unlisted build: files as they are, channel unlisted");

  // ---- eval left outside the markers fails the listed build ----
  const bad = path.join(root, "bad-src");
  build({ src, out: bad, channel: "dev" });
  writeFileSync(path.join(bad, "ui", "extra.js"), "export const run = s => eval(s);\n");
  assert.throws(() => build({ src: bad, out: path.join(root, "bad-out"), channel: "listed" }), /Dynamic code left in the listed build:\nui\/extra\.js:1: eval\(/);
  writeFileSync(path.join(bad, "ui", "extra.js"), "export const run = s => new Function(s);\n");
  assert.throws(() => build({ src: bad, out: path.join(root, "bad-out"), channel: "listed" }), /new Function/);
  rmSync(path.join(bad, "ui", "extra.js"));
  writeFileSync(path.join(bad, "pill.js"), `${readFileSync(path.join(bad, "pill.js"), "utf8")}\n// <unlisted-only>\n`);
  assert.throws(() => build({ src: bad, out: path.join(root, "bad-out"), channel: "listed" }), /pill\.js:\d+: <unlisted-only> is never closed/);
  assert.throws(() => build({ src, out: src, channel: "listed" }), /--out must differ/);
  assert.throws(() => build({ src, out: path.join(root, "x"), channel: "nightly" }), /--channel must be one of/);
  ok("eval or new Function outside the markers, an unclosed marker, or bad arguments fail the build");

  // ---- defaults that changed for new installs only ----
  const { spawnSync } = await import("node:child_process");
  const pin = (data, setup) => {
    mkdirSync(data, { recursive: true });
    setup?.(data);
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", 'const s = await import(process.argv[1]); console.log(JSON.stringify({ r: s.pinPreviousDefaults(), again: s.pinPreviousDefaults() }));', pathToFileURL(path.join(here, "../lib/store.mjs")).href], { env: { ...process.env, ENSO_DATA: data, ENSO_LEGACY_DATA: "" }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return { out: JSON.parse(r.stdout.trim().split("\n").at(-1)), settings: JSON.parse(readFileSync(path.join(data, "settings.json"), "utf8")) };
  };
  let p = pin(path.join(root, "new"));
  assert.deepEqual(p.out.r.pinned, []);
  assert.equal(p.settings.dashboard, undefined, "a new install keeps the new default (brief off)");
  assert.equal(p.settings.settingsEpoch, 1);
  p = pin(path.join(root, "old"), d => writeFileSync(path.join(d, "mcp-token"), "x"));
  assert.deepEqual(p.out.r.pinned, ["dashboard.autoRefreshMinutes"]);
  assert.equal(p.settings.dashboard.autoRefreshMinutes, 60, "an existing install keeps the hourly brief it had");
  assert.deepEqual(p.out.again.pinned, [], "runs once");
  p = pin(path.join(root, "chosen"), d => writeFileSync(path.join(d, "settings.json"), JSON.stringify({ model: "m", dashboard: { autoRefreshMinutes: 0 } })));
  assert.deepEqual(p.settings, { model: "m", dashboard: { autoRefreshMinutes: 0 }, settingsEpoch: 1 }, "a value the user chose stays");
  p = pin(path.join(root, "chosen-15"), d => writeFileSync(path.join(d, "settings.json"), JSON.stringify({ dashboard: { autoRefreshMinutes: 15 } })));
  assert.equal(p.settings.dashboard.autoRefreshMinutes, 15);
  assert.equal(JSON.parse(readFileSync(path.join(here, "../config.json"), "utf8")).defaults.dashboard.autoRefreshMinutes, 0, "config.json: off for new installs");
  ok("brief: off for new installs; existing installs keep 60 unless they chose; runs once");

  const { dashboardStale } = await import("../lib/dashboard.mjs");
  assert.equal(dashboardStale({ dashboard: {} }), false, "no setting: never by itself");
  assert.equal(dashboardStale({ dashboard: { autoRefreshMinutes: 0 } }), false);
  ok("dashboardStale: off unless a refresh interval is set");
} finally {
  rmSync(root, { recursive: true, force: true });
}
