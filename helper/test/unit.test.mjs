// Offline checks of the pieces that need no browser, network or Keychain:
// the config overlay, the profile file, the one-time migration from the old
// zen-chat folder and finding the Claude Code CLI.
//
//   node test/unit.test.mjs

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "enso-unit-"));
process.env.ENSO_DATA = path.join(root, "data");
delete process.env.ENSO_LEGACY_DATA;

try {
  const store = await import("../lib/store.mjs");
  const { mergeConfig } = await import("../lib/config.mjs");
  const { findClaude, candidates } = await import("../lib/claude-cli.mjs");

  // ---- config overlay ----
  const base = { defaults: { engine: "subscription", effort: "low" }, servers: { github: { enabled: true }, "claude.ai Gmail": { enabled: true } }, sensitiveHosts: ["*bank*"], spaceHints: {}, oauthServers: {}, webSearch: true };
  const merged = mergeConfig(base, {
    "//": "comment keys are ignored",
    defaults: { effort: "high" },
    servers: { "claude.ai Gmail": { enabled: false }, notes: { enabled: true }, legacy: true },
    sensitiveHosts: ["*.mybank.example", "*bank*"],
    spaceHints: { Work: "Work things." },
    oauthServers: { notes: { url: "https://notes.example.com/mcp" } },
    webSearch: false,
  });
  assert.deepEqual(merged.defaults, { engine: "subscription", effort: "high" });
  assert.deepEqual(merged.servers, { github: { enabled: true }, "claude.ai Gmail": { enabled: false }, notes: { enabled: true }, legacy: { enabled: true } });
  assert.deepEqual(merged.sensitiveHosts, ["*bank*", "*.mybank.example"]);
  assert.equal(merged.spaceHints.Work, "Work things.");
  assert.equal(merged.oauthServers.notes.url, "https://notes.example.com/mcp");
  assert.equal(merged.webSearch, false);
  assert.ok(!("//" in merged));
  assert.equal(base.servers["claude.ai Gmail"].enabled, true, "the shipped config is not mutated");
  console.log("ok - config.local.json merges over the shipped config");

  // ---- profile ----
  assert.deepEqual(store.parseProfile(""), { name: "", about: "", set: false });
  const saved = store.saveProfile({ name: "Maya #1\n", about: "Designer at Northwind.\r\nLikes short answers." });
  assert.equal(saved.name, "Maya 1");
  assert.equal(saved.about, "Designer at Northwind.\nLikes short answers.");
  assert.equal(readFileSync(path.join(process.env.ENSO_DATA, "profile.md"), "utf8"), "# Maya 1\n\nDesigner at Northwind.\nLikes short answers.\n");
  assert.deepEqual(store.parseProfile("# Sam\n\n- Teacher\n- Lives by the sea"), { name: "Sam", about: "- Teacher\n- Lives by the sea", set: true });
  console.log("ok - profile.md is written and read back");

  // ---- migration ----
  const legacy = path.join(root, "zen-chat");
  mkdirSync(path.join(legacy, "conversations"), { recursive: true });
  mkdirSync(path.join(legacy, "workspace"), { recursive: true });
  writeFileSync(path.join(legacy, "conversations", "index.json"), JSON.stringify({ conversations: [{ id: "c1", title: "Old chat" }] }));
  writeFileSync(path.join(legacy, "conversations", "c1.jsonl"), '{"kind":"user","text":"hi"}\n');
  writeFileSync(path.join(legacy, "profile.md"), "# Old profile\n");
  writeFileSync(path.join(legacy, "mcp-token"), "abc123");
  writeFileSync(path.join(legacy, "settings.json"), '{"effort":"high"}');
  writeFileSync(path.join(legacy, "workspace", "scratch.txt"), "not copied");
  const target = path.join(root, "Enso");
  mkdirSync(path.join(target, "helper"), { recursive: true }); // install.sh puts the helper here first
  writeFileSync(path.join(target, "profile.md"), "# New profile\n"); // and maybe a profile
  const copied = store.migrateLegacyData(legacy, target);
  assert.deepEqual(copied.sort(), ["conversations", "mcp-token", "settings.json"]);
  assert.equal(readFileSync(path.join(target, "profile.md"), "utf8"), "# New profile\n", "files already in the new folder win");
  assert.equal(readFileSync(path.join(target, "mcp-token"), "utf8"), "abc123");
  assert.ok(existsSync(path.join(target, "conversations", "c1.jsonl")));
  assert.ok(!existsSync(path.join(target, "workspace", "scratch.txt")));
  assert.ok(existsSync(path.join(legacy, "conversations", "c1.jsonl")), "the old folder is left alone");
  assert.deepEqual(store.migrateLegacyData(legacy, target), [], "runs only once");
  assert.deepEqual(store.migrateLegacyData(path.join(root, "missing"), path.join(root, "x")), []);
  console.log("ok - the zen-chat folder is copied once, without overwriting");

  // ---- Claude Code CLI ----
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  const fake = path.join(bin, "claude");
  writeFileSync(fake, '#!/bin/sh\necho "9.9.9 (Claude Code)"\n');
  chmodSync(fake, 0o755);
  const hit = findClaude([fake]);
  assert.equal(hit.found, true);
  assert.equal(hit.version, "9.9.9 (Claude Code)");
  const savedPath = process.env.PATH;
  process.env.PATH = bin;
  assert.equal(candidates([])[0], fake, "PATH comes before the known locations");
  process.env.PATH = savedPath;
  const miss = findClaude([path.join(root, "nope", "claude")]);
  if (!miss.found) assert.match(miss.reason, /not found at/);
  console.log(`ok - Claude Code CLI lookup (${miss.found ? "a real claude is installed here too" : "missing path reported"})`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("unit checks passed");
