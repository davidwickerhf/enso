// lib/platform.mjs and lib/secrets.mjs, with each OS asked for explicitly
// ({ platform, env, home }), so all three are checked on any machine. Nothing
// outside a temporary folder is read or written; processes are fakes.
//
//   node test/platform.test.mjs

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-platform-")));
process.env.ENSO_SECRETS = "file";
process.env.ENSO_DATA = path.join(root, "data");
const P = await import("../lib/platform.mjs");
const secrets = await import("../lib/secrets.mjs");
const keychain = await import("../lib/keychain.mjs");
const { launcherCommand } = await import("../lib/mcpinstall.mjs");

const mac = { platform: "darwin", env: {}, home: "/Users/maya" };
const linux = { platform: "linux", env: {}, home: "/home/maya" };
const win = { platform: "win32", env: { APPDATA: "C:\\Users\\Maya\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\Maya\\AppData\\Local", ProgramFiles: "C:\\Program Files" }, home: "C:\\Users\\Maya" };

try {
  // ---------- folders ----------
  assert.equal(P.dataDir(mac), "/Users/maya/Library/Application Support/Enso");
  assert.equal(P.dataDir(linux), "/home/maya/.local/share/enso");
  assert.equal(P.dataDir({ ...linux, env: { XDG_DATA_HOME: "/data/x" } }), "/data/x/enso");
  assert.equal(P.dataDir(win), "C:\\Users\\Maya\\AppData\\Roaming\\Enso");
  assert.equal(P.dataDir({ ...win, env: { ENSO_DATA: "D:\\enso" } }), "D:\\enso");
  assert.equal(P.logDir(mac), "/Users/maya/Library/Logs/Enso");
  assert.equal(P.logDir(linux), "/home/maya/.local/state/enso");
  assert.equal(P.logDir({ ...linux, env: { XDG_STATE_HOME: "/st" } }), "/st/enso");
  assert.equal(P.logDir(win), "C:\\Users\\Maya\\AppData\\Local\\Enso\\Logs");
  assert.equal(P.logDir({ ...mac, env: { ENSO_DATA: "/tmp/d" } }), "/tmp/d/logs");
  assert.equal(P.legacyDataDir(mac), "/Users/maya/Library/Application Support/zen-chat");
  assert.equal(P.legacyDataDir(linux), "");
  assert.equal(P.launcherFile("/d", mac), "/d/bin/enso");
  assert.equal(P.launcherFile("C:\\d", win), "C:\\d\\bin\\enso.cmd");
  assert.equal(P.userBinDir(linux), "/home/maya/.local/bin");
  assert.equal(P.userBinDir(win), null);
  assert.ok(P.augmentedPath({ ...mac, env: { PATH: "/usr/bin:/bin" } }).startsWith("/Users/maya/.volta/bin:/Users/maya/.local/bin:/opt/homebrew/bin:/usr/local/bin:"), "macOS PATH unchanged from before");
  assert.ok(P.augmentedPath({ ...win, env: { ...win.env, PATH: "C:\\Windows" } }).split(";").includes("C:\\Windows"));
  console.log("ok - data, log and launcher folders per OS (XDG on Linux, APPDATA/LOCALAPPDATA on Windows, ENSO_DATA wins)");

  // ---------- browser ----------
  assert.deepEqual(P.nativeHostDirs(mac), ["/Users/maya/Library/Application Support/Mozilla/NativeMessagingHosts", "/Users/maya/Library/Application Support/zen/NativeMessagingHosts"]);
  assert.deepEqual(P.nativeHostDirs(linux), ["/home/maya/.mozilla/native-messaging-hosts", "/home/maya/.zen/native-messaging-hosts"]);
  assert.deepEqual(P.nativeHostDirs(win), []);
  assert.deepEqual(P.nativeHostRegistryKeys(), ["HKCU\\Software\\Mozilla\\NativeMessagingHosts\\enso"]);
  assert.equal(P.browserProfileRoots(linux)[0].dir, "/home/maya/.zen");
  assert.equal(P.browserProfileRoots(win)[0].dir, "C:\\Users\\Maya\\AppData\\Roaming\\zen");
  assert.ok(P.browserBinaries(win).some(b => b.bin === "C:\\Program Files\\Zen Browser\\zen.exe"));
  assert.equal(P.browserBinaries(mac)[0].bin, "/Applications/Zen.app/Contents/MacOS/zen");
  assert.equal(P.browserBinaries({ ...linux, env: { ENSO_BROWSER_BIN: "/x/firefox" } })[0].browser, "firefox");

  // installs.ini first, then profiles.ini (Default=1, relative paths)
  const zen = path.join(root, "home", ".zen");
  mkdirSync(path.join(zen, "abc.Default (release)"), { recursive: true });
  writeFileSync(path.join(zen, "profiles.ini"), "[General]\nStartWithLastProfile=1\n\n[Profile0]\nName=Default\nIsRelative=1\nPath=abc.Default (release)\nDefault=1\n");
  const lx = { platform: process.platform === "win32" ? "win32" : "linux", env: { APPDATA: path.join(root, "home") }, home: path.join(root, "home") };
  if (lx.platform === "linux") {
    assert.equal(P.zenProfileDir(lx), path.join(zen, "abc.Default (release)"));
    mkdirSync(path.join(zen, "xyz.Other"), { recursive: true });
    writeFileSync(path.join(zen, "installs.ini"), "[ABCDEF]\nDefault=xyz.Other\nLocked=1\n");
    assert.equal(P.zenProfileDir(lx), path.join(zen, "xyz.Other"));
    mkdirSync(path.join(zen, "xyz.Other"), { recursive: true });
    writeFileSync(path.join(zen, "xyz.Other", "extensions.json"), '{"addons":[{"id":"enso@wicker.life"}]}');
    assert.equal(P.extensionInstalled("enso@wicker.life", lx), true);
    assert.equal(P.extensionInstalled("other@x", lx), false);
  }
  console.log("ok - native-messaging locations (Mozilla's folder/key, which Zen reads too), Zen profile from installs.ini / profiles.ini, browser binaries");

  // ---------- clients and commands ----------
  assert.equal(P.clientConfigPaths(win).cursorConfig, "C:\\Users\\Maya\\.cursor\\mcp.json");
  assert.equal(P.clientConfigPaths(win).opencodeDir, "C:\\Users\\Maya\\.config\\opencode");
  assert.equal(P.clientConfigPaths({ ...linux, env: { XDG_CONFIG_HOME: "/cfg" } }).opencodeDir, "/cfg/opencode");
  assert.equal(P.clientConfigPaths(mac).claudeJson, "/Users/maya/.claude.json");
  assert.equal(P.claudeCandidates(win)[0], "C:\\Users\\Maya\\.local\\bin\\claude.exe");
  assert.equal(P.claudeInstallCommand(win), "irm https://claude.ai/install.ps1 | iex");
  assert.equal(P.claudeInstallCommand(mac), "curl -fsSL https://claude.ai/install.sh | bash");
  assert.equal(P.installCommand("https://enso.wicker.life", win), "irm https://enso.wicker.life/install.ps1 | iex");
  assert.equal(P.installCommand("https://enso.wicker.life", linux), "curl -fsSL https://enso.wicker.life/install.sh | bash");
  const lw = launcherCommand("C:\\d\\bin\\enso.cmd", ["mcp"], { platform: "win32" });
  assert.equal(lw.command, process.execPath);
  assert.match(lw.args[0], /enso\.mjs$/);
  assert.deepEqual(lw.args.slice(1), ["mcp"]);
  assert.deepEqual(launcherCommand("/d/bin/enso", ["mcp"], { platform: "linux" }), { command: "/d/bin/enso", args: ["mcp"] });
  console.log("ok - client config paths, installer commands per OS; Windows clients start Node with enso.mjs, not the .cmd shim");

  // ---------- terminal scripts ----------
  const cmd = { sh: "'/x/claude' auth login", ps: "& '/x/claude' auth login" };
  const sm = P.terminalScript({ title: "sign in", command: cmd }, { platform: "darwin" });
  assert.equal(sm.ext, ".command");
  assert.ok(sm.body.startsWith("#!/bin/bash\n") && sm.body.includes("\n'/x/claude' auth login\n") && !sm.body.includes("read -r"));
  const sl = P.terminalScript({ title: "sign in", command: cmd }, { platform: "linux" });
  assert.equal(sl.ext, ".sh");
  assert.match(sl.body, /read -r -p "Press Enter/);
  const sw = P.terminalScript({ title: "it's a test", command: cmd }, { platform: "win32" });
  assert.equal(sw.ext, ".ps1");
  assert.ok(sw.body.includes("\r\n& '/x/claude' auth login\r\n") && sw.body.includes("'Ensō: it''s a test'"));
  assert.equal(P.psQuote("a'b"), "'a''b'");
  assert.equal(P.shellQuote("a'b"), `'a'\\''b'`);

  // Linux: the first terminal on PATH; none → the command to copy.
  const fakeSpawn = calls => (cmd, args) => {
    calls.push([cmd, ...args]);
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  if (process.platform !== "win32") {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "konsole"), "#!/bin/sh\n");
    chmodSync(path.join(bin, "konsole"), 0o755);
    const calls = [];
    await P.openTerminal("/d/run/x.sh", { platform: "linux", env: { PATH: bin }, spawnImpl: fakeSpawn(calls) });
    assert.deepEqual(calls, [[path.join(bin, "konsole"), "-e", "/bin/bash", "/d/run/x.sh"]]);
    await assert.rejects(P.openTerminal("/d/run/x.sh", { platform: "linux", env: { PATH: path.join(root, "empty") }, spawnImpl: fakeSpawn([]), command: "claude auth login" }), err => err.code === "no_terminal" && /Run this in a terminal yourself: claude auth login/.test(err.message));
  }
  const opened = [];
  P.openUrl("t3code://threads/a/b", { platform: "win32", spawnImpl: fakeSpawn(opened) });
  P.openUrl("t3code://threads/a/b", { platform: "linux", spawnImpl: fakeSpawn(opened) });
  P.openUrl("t3code://threads/a/b", { platform: "darwin", app: "/Applications/T3 Code.app", spawnImpl: fakeSpawn(opened) });
  assert.deepEqual(opened, [
    ["rundll32.exe", "url.dll,FileProtocolHandler", "t3code://threads/a/b"],
    ["xdg-open", "t3code://threads/a/b"],
    ["/usr/bin/open", "-a", "/Applications/T3 Code.app", "t3code://threads/a/b"],
  ]);
  console.log("ok - terminal scripts per OS (.command, .sh that waits, .ps1), Linux terminal lookup with a copyable fallback, URL openers");

  // ---------- secrets: the file fallback, and chunking on top of it ----------
  assert.equal(secrets.backend().name, "file");
  await secrets.setItem("enso-test-plain", "s3cret-value");
  assert.equal(await secrets.getItem("enso-test-plain"), "s3cret-value");
  assert.equal(await secrets.getItem("enso-test-plain", { account: "enso" }), "s3cret-value");
  assert.equal(secrets.getItemSync("enso-test-plain"), "s3cret-value");
  assert.equal(await secrets.hasItem("enso-test-plain"), true);
  await secrets.deleteItem("enso-test-plain");
  assert.equal(await secrets.getItem("enso-test-plain"), null);
  const file = secrets.secretsFile(process.env.ENSO_DATA);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600, "secrets.json is 0600");
  const long = JSON.stringify({ access_token: "a".repeat(9000), refresh: "é✓" });
  await keychain.writeSecret("enso-test-long", long);
  assert.equal(await keychain.readSecret("enso-test-long"), long);
  await keychain.deleteSecret("enso-test-long");
  assert.equal(await keychain.readSecret("enso-test-long"), null);
  assert.throws(() => secrets.checkName("bad name;rm"), /Bad secret/);
  assert.equal(secrets.secretsInfo().backend, "file");
  assert.equal(secrets.secretsInfo().warning, null, "no warning when the file store was chosen on purpose");
  // Windows: cmdkey stores UTF-16LE, Ensō writes UTF-8; both read back.
  assert.equal(secrets.decodeBlob(Buffer.from("sk-ant-x", "utf16le").toString("base64")), "sk-ant-x");
  assert.equal(secrets.decodeBlob(Buffer.from("sk-ant-é", "utf8").toString("base64")), "sk-ant-é");
  console.log("ok - secrets: file fallback (0600), long values through keychain.mjs, names checked, Credential Manager blobs decoded");
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("platform checks passed");
