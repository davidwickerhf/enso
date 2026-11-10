#!/usr/bin/env node
// Builds the extension for one release channel: copies extension/ to an output
// folder and writes channel.js there.
//
//   node scripts/build-extension.mjs --channel listed   [--src extension] [--out build/extension]
//   node scripts/build-extension.mjs --channel unlisted [--src extension] [--out build/extension]
//
// Channels:
//   listed    the build submitted to addons.mozilla.org. Every block between a
//             `// <unlisted-only>` line and a `// </unlisted-only>` line (in .js
//             files) is removed, marker lines included: that is the code behind
//             page_eval, which evaluates JavaScript an agent wrote. The build
//             fails if `eval(` or `new Function` is still in any .js or .html file.
//   unlisted  the self-distributed build for enso.wicker.life (four-part
//             versions such as 0.5.7.1): the files as they are.
//   dev       the source default (extension/channel.js says "dev").
//
// channel.js sets globalThis.ENSO_CHANNEL (module.exports under Node). The
// extension reports it to the helper, which then hides page_eval from agents
// when the extension can't run it (helper/lib/extinfo.mjs).
//
// Tested by helper/test/build-extension.test.mjs.

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHANNELS = ["listed", "unlisted", "dev"];

const OPEN = /^\s*\/\/\s*<unlisted-only>\s*$/;
const CLOSE = /^\s*\/\/\s*<\/unlisted-only>\s*$/;

/** The text of channel.js for a channel (extension/channel.js is this for "dev"). */
export function channelSource(channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`Unknown channel ${channel}`);
  return `// Which build this is: "dev" in the source, "listed" (addons.mozilla.org) or
// "unlisted" (self-distributed, enso.wicker.life) in a release. Written by
// scripts/build-extension.mjs; the listed build has no page_eval.
(function (root) {
  const CHANNEL = ${JSON.stringify(channel)};
  if (typeof module === "object" && module.exports) module.exports = { CHANNEL };
  else root.ENSO_CHANNEL = CHANNEL;
})(globalThis);
`;
}

/** Removes the unlisted-only blocks from one file's text. Throws on unbalanced markers. */
export function stripUnlistedOnly(text, file = "file") {
  const out = [];
  let open = 0; // line number of the open marker, 0 outside a block
  let removed = 0;
  text.split("\n").forEach((line, i) => {
    if (OPEN.test(line)) {
      if (open) throw new Error(`${file}:${i + 1}: <unlisted-only> inside the block opened on line ${open}`);
      open = i + 1;
      removed++;
      return;
    }
    if (CLOSE.test(line)) {
      if (!open) throw new Error(`${file}:${i + 1}: </unlisted-only> without an opening marker`);
      open = 0;
      return;
    }
    if (!open) out.push(line);
  });
  if (open) throw new Error(`${file}:${open}: <unlisted-only> is never closed`);
  return { text: out.join("\n"), blocks: removed };
}

const DYNAMIC = [
  [/(^|[^\w$.])eval\s*\(/, "eval("],
  [/\.eval\s*\(/, ".eval("],
  [/\bnew\s+Function\b/, "new Function"],
];

/** Dynamic-code constructs left in a file's text: [{ line, match }]. */
export function findDynamicCode(text) {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    for (const [re, name] of DYNAMIC) if (re.test(line)) hits.push({ line: i + 1, match: name, text: line.trim().slice(0, 120) });
  });
  return hits;
}

function walk(dir) {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Copies src to out for a channel. → { files, blocks } (blocks removed, listed only). */
export function build({ src, out, channel }) {
  if (!CHANNELS.includes(channel)) throw new Error(`--channel must be one of ${CHANNELS.join(", ")}`);
  if (!existsSync(path.join(src, "manifest.json"))) throw new Error(`${src} has no manifest.json`);
  if (path.resolve(src) === path.resolve(out)) throw new Error("--out must differ from --src");
  rmSync(out, { recursive: true, force: true });
  cpSync(src, out, { recursive: true });
  let blocks = 0;
  const files = walk(out);
  if (channel === "listed") {
    for (const f of files.filter(f => f.endsWith(".js"))) {
      const before = readFileSync(f, "utf8");
      const r = stripUnlistedOnly(before, path.relative(out, f));
      if (r.blocks) writeFileSync(f, r.text);
      blocks += r.blocks;
    }
  }
  writeFileSync(path.join(out, "channel.js"), channelSource(channel));
  if (channel === "listed") {
    const left = files
      .filter(f => /\.(m?js|html?)$/.test(f))
      .flatMap(f => findDynamicCode(readFileSync(f, "utf8")).map(h => `${path.relative(out, f)}:${h.line}: ${h.match}  ${h.text}`));
    if (left.length) throw new Error(`Dynamic code left in the listed build:\n${left.join("\n")}`);
    if (!blocks) throw new Error("No <unlisted-only> blocks found: is this the right source folder?");
  }
  return { files: files.length, blocks };
}

function args(argv) {
  const o = { src: "extension", out: "build/extension", channel: "" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--channel" || k === "--src" || k === "--out") o[k.slice(2)] = argv[++i] ?? "";
    else throw new Error(`Unknown argument ${k}`);
  }
  return o;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const o = args(process.argv.slice(2));
    const r = build(o);
    console.log(`${o.channel}: ${o.src} -> ${o.out} (${r.files} files${o.channel === "listed" ? `, ${r.blocks} unlisted-only block${r.blocks === 1 ? "" : "s"} removed, no eval or new Function left` : ""})`);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }
}
