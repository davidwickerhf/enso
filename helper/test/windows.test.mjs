// Windows only: the pieces install.ps1 and the helper use there, in a
// temporary profile (USERPROFILE, APPDATA, LOCALAPPDATA point into it).
//   - a run.cmd like install.ps1's starts host.mjs, which answers hello in
//     native-messaging framing (as Zen starts it, through cmd.exe);
//   - doctor reads run.cmd (set "NODE=…") and the registry value format;
//   - `enso mcp install` writes enso.cmd and registers Node + enso.mjs with
//     Cursor (a .cmd can't be spawned by Node-based clients without a shell).
// install.ps1 itself runs in CI's Windows job (a fresh install, a second run,
// and a run while the helper holds its folder).
//
//   node test/windows.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  console.log("skip - Windows only (run.cmd, enso.cmd, registry)");
  process.exit(0);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const { isolatedEnv, dataDirFor, logDirFor } = await import("./env.mjs");
const { checkHello, parseRunSh, registryManifest } = await import("../lib/doctor.mjs");
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-win-")));
const home = path.join(root, "Maya Test"); // a space, as in many Windows user names
mkdirSync(home, { recursive: true });
const env = isolatedEnv(home, { ENSO_MCP_PORT: String(48000 + Math.floor(Math.random() * 900)) });
const data = dataDirFor(home);
const logs = logDirFor(home);
const HOST = path.join(here, "..", "host.mjs");

try {
  // run.cmd as install.ps1 writes it.
  const runCmd = path.join(data, "bin", "run.cmd");
  mkdirSync(path.dirname(runCmd), { recursive: true });
  const lines = [
    "@echo off",
    "rem Started by Zen/Firefox through native messaging. Written by install.ps1.",
    `set "NODE=${process.execPath}"`,
    `set "HOST=${HOST}"`,
    `set "LOG_DIR=${logs}"`,
    'if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul',
    'if not exist "%NODE%" (',
    "  exit /b 127",
    ")",
    'set "ENSO_LOG_DIR=%LOG_DIR%"',
    'set "ENSO_LOG_NO_ECHO=1"',
    '"%NODE%" "%HOST%" %* 2>"%LOG_DIR%\\helper-stderr.log"',
  ];
  writeFileSync(runCmd, lines.join("\r\n") + "\r\n");
  assert.deepEqual(parseRunSh(readFileSync(runCmd, "utf8")), { node: process.execPath, host: HOST });
  const manifest = path.join(data, "enso.json");
  writeFileSync(manifest, JSON.stringify({ name: "enso", path: runCmd, type: "stdio", allowed_extensions: ["enso@wicker.life"] }));
  const r = await checkHello(runCmd, { manifestFile: manifest, env, timeoutMs: 30_000 });
  assert.equal(r.ok, true, JSON.stringify(r));
  const log = readFileSync(path.join(logs, "helper.log"), "utf8");
  assert.match(log, /starting \(started by (run\.cmd|enso doctor)\): Node v[\d.]+ at .+, win32 /);
  console.log("ok - run.cmd (path with a space) starts host.mjs through cmd.exe; it answers hello and logs to %LOCALAPPDATA%\\Enso\\Logs");

  // reg query output format → manifest path.
  const fake = () => ({ stdout: `\r\nHKEY_CURRENT_USER\\Software\\Mozilla\\NativeMessagingHosts\\enso\r\n    (Default)    REG_SZ    ${manifest}\r\n\r\n` });
  assert.deepEqual(registryManifest({ run: fake }), { key: "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\enso", file: manifest });
  assert.match(registryManifest({ run: () => ({ stdout: "" }) }).error, /missing/);
  console.log("ok - doctor reads the registry value (reg query) and reports a missing key");

  // enso mcp install --client cursor: enso.cmd written, Cursor starts Node with enso.mjs.
  mkdirSync(path.join(home, ".cursor"), { recursive: true });
  const cli = spawnSync(process.execPath, [path.join(here, "..", "bin", "enso.mjs"), "mcp", "install", "--client", "cursor"], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
  const shim = readFileSync(path.join(data, "bin", "enso.cmd"), "utf8");
  assert.match(shim, /^@echo off\r\n/);
  assert.ok(shim.includes(`"${process.execPath}"`) && shim.includes("enso.mjs\" %*"));
  const entry = JSON.parse(readFileSync(path.join(home, ".cursor", "mcp.json"), "utf8")).mcpServers["zen-browser"];
  assert.equal(entry.command, process.execPath);
  assert.match(entry.args[0], /enso\.mjs$/);
  assert.deepEqual(entry.args.slice(1), ["mcp"]);
  console.log("ok - enso mcp install on Windows: enso.cmd for people, node.exe + enso.mjs for Cursor");
} finally {
  const { rmSync } = await import("node:fs");
  await new Promise(r => setTimeout(r, 2500)); // checkHello ends the helper's process tree 1.5 s after it answered
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 300 });
  } catch (err) {
    console.log(`note - couldn't remove ${root} (${err.code}); it is a temporary folder`);
  }
}
console.log("windows checks passed");
