// Setup (lib/setup.mjs, `setup.status` / `setup.run`): every check and action
// against a throwaway HOME with fakes for Claude Code, gh, the Keychain, T3,
// GitHub, Terminal and the installer. Then the same through host.mjs over
// native messaging. Nothing outside the temporary folder is changed: HOME,
// ENSO_DATA and the Applications folder point into it, and secrets go to a fake
// store.
//
//   node test/setup.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-setup-")));
const home = path.join(root, "home");
const data = path.join(root, "data");
const bin = path.join(root, "bin");
const apps = path.join(root, "Applications");
for (const d of [home, data, bin, apps]) mkdirSync(d, { recursive: true });
const claudeLog = path.join(root, "claude.log");

// A fake `claude`: --version, auth status, and mcp add/remove that keep ~/.claude.json the way Claude Code does.
const fakeClaude = path.join(bin, "claude");
writeFileSync(
  fakeClaude,
  `#!/bin/bash
echo "$*" >> ${JSON.stringify(claudeLog)}
CFG="$HOME/.claude.json"
case "$1" in
  --version) echo "2.1.0 (Claude Code)"; exit 0 ;;
  auth) if [ -f "$HOME/.signed-in" ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max","email":"maya@example.com","orgId":"secret-org"}'; else echo '{"loggedIn":false,"authMethod":"none"}'; exit 1; fi ;;
  mcp)
    if [ "$2" = "add" ]; then
      shift 6
      launcher="$1"; shift
      args=$(printf '"%s",' "$@"); args="[\${args%,}]"
      printf '{"mcpServers":{"zen-browser":{"type":"stdio","command":"%s","args":%s}}}' "$launcher" "$args" > "$CFG"
      exit 0
    fi
    if [ "$2" = "remove" ]; then [ -f "$CFG" ] && grep -q zen-browser "$CFG" && rm "$CFG" && exit 0; exit 1; fi ;;
esac
exit 0
`,
);
chmodSync(fakeClaude, 0o755);

Object.assign(process.env, { HOME: home, ENSO_DATA: data, ENSO_CLAUDE_PATH: fakeClaude, PATH: "/usr/bin:/bin" });
for (const k of ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "T3CODE_HOME", "T3CODE_CLI_PATH", "ANTHROPIC_API_KEY"]) delete process.env[k];

const { createSetup, compareVersions, runInstaller, SETUP_STEPS } = await import("../lib/setup.mjs");
const mcp = await import("../lib/mcpinstall.mjs");

// A release-style helper folder (VERSION present) and a checkout-style one.
const releaseDir = path.join(root, "helper-release");
mkdirSync(releaseDir);
writeFileSync(path.join(releaseDir, "VERSION"), "0.5.4\n");
writeFileSync(path.join(releaseDir, "package.json"), JSON.stringify({ version: "0.5.4" }));
const checkoutDir = path.join(root, "helper-checkout");
mkdirSync(checkoutDir);
writeFileSync(path.join(checkoutDir, "package.json"), JSON.stringify({ version: "0.5.4" }));

function fakeFetch(routes) {
  return async (url, init = {}) => {
    const hit = Object.entries(routes).find(([prefix]) => String(url).startsWith(prefix));
    if (!hit) throw new Error(`offline: ${url}`);
    const r = typeof hit[1] === "function" ? hit[1](url, init) : hit[1];
    return { ok: r.status < 300, status: r.status, json: async () => r.body, text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)) };
  };
}

const secrets = { value: null, saves: 0 };
const apiKeys = { has: async () => !!secrets.value, save: async k => { secrets.value = k; secrets.saves++; }, remove: async () => { secrets.value = null; } };
let keyChanges = 0;
const terminals = [];
const ghState = { connected: false };
const github = {
  status: async () => (ghState.connected ? { connected: true, login: "maya", via: "Keychain" } : { connected: false, error: "no token" }),
  saveToken: async t => {
    if (t === "ghp_bad_but_long_enough_000000") throw new Error(`GitHub rejected ${t}`);
    ghState.connected = true;
    return { login: "maya" };
  },
  forget: async () => void (ghState.connected = false),
};
const t3Calls = [];
const t3 = {
  status: async () => ({ connected: t3Calls.includes("connect") && !t3Calls.includes("disconnect"), reachable: true, tokenValid: true, serverVersion: "0.1.9" }),
  connect: async () => void t3Calls.push("connect"),
  disconnect: async () => (t3Calls.push("disconnect"), { revoked: true }),
};
let installerRuns = 0;
let installerFails = false;

function make(over = {}) {
  return createSetup({
    env: process.env,
    dataDir: data,
    helperDir: releaseDir,
    site: "https://enso.example",
    fetch: fakeFetch({ "https://enso.example/api/latest": { status: 200, body: { helper: { version: "0.6.0" } } }, "https://api.anthropic.com/": (url, init) => ({ status: init.headers["x-api-key"].endsWith("good") ? 200 : 401, body: {} }) }),
    claude: () => ({ found: true, path: fakeClaude, version: "2.1.0 (Claude Code)" }),
    apiKeys,
    onApiKeyChange: () => keyChanges++,
    github,
    t3,
    applicationsDir: apps,
    openInTerminal: async file => void terminals.push(file),
    runInstaller: async () => {
      installerRuns++;
      if (installerFails) throw new Error("The installer stopped: no network");
      writeFileSync(path.join(releaseDir, "VERSION"), "0.6.0\n");
    },
    servers: () => [{ name: "a", enabled: true, status: "connected" }, { name: "b", enabled: true, status: "needs-auth" }, { name: "c", enabled: false }],
    ...over,
  });
}

try {
  assert.equal(compareVersions("0.5.4", "0.6.0"), -1);
  assert.equal(compareVersions("v1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("1.0", "1.0.0"), 0);
  assert.ok(SETUP_STEPS.includes("agents.register"));

  // ---- status on a fresh machine ----
  const setup = make();
  let st = await setup.status();
  assert.equal(st.helper.version, "0.5.4");
  assert.equal(st.helper.dev, false);
  assert.equal(st.helper.latest, "0.6.0");
  assert.equal(st.helper.updateAvailable, true);
  assert.equal(st.helper.node.source, "system");
  assert.equal(st.engine.selected, "subscription");
  assert.equal(st.engine.subscription.found, true);
  assert.equal(st.engine.subscription.loggedIn, false);
  assert.equal(st.engine.api.stored, false);
  assert.deepEqual(st.agents.clients.map(c => [c.id, c.detected, c.registration]), [["claude", true, null], ["codex", false, null], ["cursor", false, null], ["opencode", false, null]]);
  assert.equal(st.agents.hook, false);
  assert.equal(st.t3.installed, false);
  assert.equal(st.github.connected, false);
  assert.equal(st.github.error, null, "'no token' is not an error to show");
  assert.deepEqual(st.tools, { total: 3, on: 2, needsAuth: 1 });
  console.log("ok - status on a fresh machine: update available, Claude Code found but signed out, nothing registered");

  writeFileSync(path.join(home, ".signed-in"), "");
  st = await setup.status();
  assert.equal(st.engine.subscription.loggedIn, true);
  assert.equal(st.engine.subscription.subscriptionType, "max");
  assert.ok(!("orgId" in st.engine.subscription), "only the fields Setup shows are kept");
  console.log("ok - claude auth status --json is read (signed in, plan)");

  const dev = await make({ helperDir: checkoutDir }).status();
  assert.equal(dev.helper.dev, true);
  assert.equal(dev.helper.updateAvailable, false);
  const offline = await make({ fetch: fakeFetch({}) }).status();
  assert.equal(offline.helper.latest, null);
  assert.match(offline.helper.error, /Couldn't check for updates/);
  console.log("ok - a checkout never offers updates; offline says it couldn't check");

  // ---- agents ----
  let r = await setup.run("agents.register", { client: "claude" });
  assert.equal(r.ok, true, r.error);
  assert.match(readFileSync(claudeLog, "utf8"), new RegExp(`mcp add --scope user zen-browser -- ${mcp.launcherPath(data).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} mcp\n`));
  assert.ok(existsSync(mcp.launcherPath(data)), "the launcher is written when missing");
  mkdirSync(path.join(home, ".codex"));
  r = await setup.run("agents.register", { client: "codex", readOnly: true });
  assert.equal(r.ok, true, r.error);
  assert.match(readFileSync(path.join(home, ".codex", "config.toml"), "utf8"), /--read-only/);
  st = await setup.status();
  assert.deepEqual(st.agents.clients.filter(c => c.detected).map(c => [c.id, c.registration]), [["claude", "launcher"], ["codex", "launcher-read"]]);
  assert.equal(st.agents.readOnly, false, "mixed: not all read only");
  console.log("ok - agents.register: Claude Code (claude mcp add with the launcher) and Codex read only (config.toml)");

  r = await setup.run("agents.readOnly", { readOnly: true });
  assert.equal(r.ok, true, r.error);
  st = await setup.status();
  assert.deepEqual(st.agents.clients.filter(c => c.registration).map(c => c.registration), ["launcher-read", "launcher-read"]);
  assert.equal(st.agents.readOnly, true);
  r = await setup.run("agents.readOnly", { readOnly: false });
  st = await setup.status();
  assert.deepEqual(st.agents.clients.filter(c => c.registration).map(c => c.registration), ["launcher", "launcher"]);
  console.log("ok - agents.readOnly re-registers every registered client");

  r = await setup.run("agents.hook", { on: true });
  assert.equal(r.ok, true, r.error);
  assert.match(readFileSync(path.join(home, ".claude", "settings.json"), "utf8"), /inbox --session-env/);
  assert.equal((await setup.status()).agents.hook, true);
  r = await setup.run("agents.hook", { on: false });
  assert.equal((await setup.status()).agents.hook, false);
  r = await setup.run("agents.unregister", { client: "codex" });
  assert.equal(r.ok, true, r.error);
  assert.equal((await setup.status()).agents.clients.find(c => c.id === "codex").registration, null);
  r = await setup.run("agents.register", { client: "emacs" });
  assert.equal(r.ok, false);
  console.log("ok - agents.hook on/off, agents.unregister, unknown clients refused");

  // ---- engine ----
  const typed = "sk-ant-api03-not-a-real-key-but-long-bad";
  r = await setup.run("engine.apiKey", { key: "hello" });
  assert.equal(r.ok, false);
  assert.match(r.error, /doesn't look like/);
  r = await setup.run("engine.apiKey", { key: typed });
  assert.equal(r.ok, false);
  assert.match(r.error, /didn't accept/);
  assert.ok(!JSON.stringify(r).includes(typed), "the key never comes back");
  assert.equal(secrets.saves, 0);
  const good = "sk-ant-api03-this-one-is-fine-good";
  r = await setup.run("engine.apiKey", { key: good });
  assert.equal(r.ok, true, r.error);
  assert.equal(secrets.value, good);
  assert.equal(keyChanges, 1);
  st = await setup.status();
  assert.deepEqual(st.engine.api, { stored: true, source: "keychain" });
  assert.ok(!JSON.stringify(st).includes(good));
  const leaky = make({ apiKeys: { ...apiKeys, save: async k => { throw new Error(`security refused ${k}`); } } });
  r = await leaky.run("engine.apiKey", { key: good });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes(good) && r.error.includes("[hidden]"), "errors never quote the key");
  r = await setup.run("engine.forgetApiKey");
  assert.equal(r.ok, true);
  assert.equal((await setup.status()).engine.api.stored, false);
  console.log("ok - engine.apiKey: format and Anthropic checked, stored in the Keychain store, never echoed; forget removes it");

  r = await setup.run("engine.login");
  assert.equal(r.ok, true, r.error);
  const loginFile = terminals.at(-1);
  assert.equal(path.dirname(loginFile), path.join(data, "run"));
  assert.ok(readFileSync(loginFile, "utf8").includes(`'${fakeClaude}' auth login`));
  assert.equal(statSync(loginFile).mode & 0o777, 0o700);
  r = await setup.run("engine.install");
  assert.match(readFileSync(terminals.at(-1), "utf8"), /curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash && "\$HOME\/\.local\/bin\/claude" auth login/);
  r = await make({ claude: () => ({ found: false, reason: "nope" }) }).run("engine.login");
  assert.equal(r.ok, false);
  console.log("ok - engine.login / engine.install open a .command file in Terminal with the fixed command");

  // ---- GitHub ----
  r = await make({ env: { ...process.env, PATH: path.join(root, "no-such-dir") } }).run("github.login"); // CI runners have gh in /usr/bin
  assert.equal(r.ok, false, "no gh on PATH");
  const fakeGh = path.join(bin, "gh");
  writeFileSync(fakeGh, "#!/bin/bash\nexit 0\n");
  chmodSync(fakeGh, 0o755);
  r = await make({ env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } }).run("github.login");
  assert.equal(r.ok, true, r.error);
  assert.ok(readFileSync(terminals.at(-1), "utf8").includes(`'${fakeGh}' auth login --hostname github.com`));
  assert.equal((await make({ env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } }).status()).github.ghInstalled, true);
  r = await setup.run("github.token", { token: "ghp_bad_but_long_enough_000000" });
  assert.equal(r.ok, false);
  assert.ok(!r.error.includes("ghp_bad"), "token hidden in errors");
  r = await setup.run("github.token", { token: "ghp_good_token_000000000000" });
  assert.equal(r.ok, true);
  assert.equal((await setup.status()).github.login, "maya");
  r = await setup.run("github.forget");
  assert.equal((await setup.status()).github.connected, false);
  console.log("ok - github.login (gh in Terminal), github.token, github.forget");

  // ---- T3 ----
  assert.equal((await setup.status()).t3.installed, false);
  mkdirSync(path.join(apps, "T3 Code (Nightly).app"));
  st = await setup.status();
  assert.equal(st.t3.installed, true);
  assert.equal(st.t3.connected, false);
  r = await setup.run("t3.connect");
  assert.equal(r.ok, true);
  assert.equal((await setup.status()).t3.connected, true);
  r = await setup.run("t3.disconnect");
  assert.match(r.message, /Revoked/);
  console.log("ok - T3 Code detected from /Applications; connect and disconnect");

  // ---- MCP token, update, unknown step ----
  const { readToken } = await import("../lib/mcpauth.mjs");
  const before = readToken("full", data);
  r = await setup.run("mcp.rotate");
  assert.equal(r.ok, true);
  assert.notEqual(readFileSync(path.join(data, "mcp-token"), "utf8"), before);
  r = await make({ helperDir: checkoutDir }).run("helper.update");
  assert.equal(r.ok, false);
  assert.match(r.error, /checkout/);
  assert.equal(installerRuns, 0);
  r = await setup.run("helper.update");
  assert.equal(r.ok, true, r.error);
  assert.equal(r.restart, true);
  assert.match(r.message, /Updated to 0\.6\.0/);
  installerFails = true;
  r = await setup.run("helper.update");
  assert.equal(r.ok, false);
  assert.equal(r.restart, undefined);
  r = await setup.run("rm -rf");
  assert.equal(r.ok, false);
  console.log("ok - mcp.rotate, helper.update (checkout refused, success restarts, failure doesn't), unknown steps refused");

  // ---- the real installer runner, against a local site serving a fake install.sh ----
  const marker = path.join(root, "installer-env");
  const site = createServer((req, res) => {
    if (req.url === "/install.sh") return res.end(`#!/bin/bash\necho "ENSO_NO_OPEN=$ENSO_NO_OPEN ENSO_SITE=$ENSO_SITE" > ${JSON.stringify(marker)}\necho "all good"\n`);
    if (req.url === "/broken.sh") return res.end("<html>not a script</html>");
    res.statusCode = 404;
    res.end();
  });
  await new Promise(resolve => site.listen(0, "127.0.0.1", resolve));
  const siteUrl = `http://127.0.0.1:${site.address().port}`;
  const ran = await runInstaller({ site: siteUrl, dataDir: data, fetchImpl: fetch, env: { PATH: "/usr/bin:/bin", HOME: home } });
  assert.equal(readFileSync(marker, "utf8").trim(), `ENSO_NO_OPEN=1 ENSO_SITE=${siteUrl}`);
  assert.match(readFileSync(ran.log, "utf8"), /exit 0[\s\S]*all good/);
  await assert.rejects(runInstaller({ site: `${siteUrl}/nope`, dataDir: data, fetchImpl: fetch, env: {} }), /Couldn't download the installer \(404\)/);
  site.close();
  console.log("ok - the installer runner downloads install.sh, runs it non-interactively (ENSO_NO_OPEN=1) and logs to logs/update.log");

  // ---- through host.mjs ----
  const port = 48900 + Math.floor(Math.random() * 90);
  const hostHome = path.join(root, "host-home");
  mkdirSync(path.join(hostHome, ".codex"), { recursive: true });
  const env = { HOME: hostHome, PATH: "/usr/bin:/bin", ENSO_MCP_PORT: String(port), ENSO_CLAUDE_PATH: fakeClaude, ENSO_SITE: "http://127.0.0.1:9", ENSO_APPLICATIONS_DIR: apps, TMPDIR: tmpdir() };
  const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env, cwd: hostHome, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  host.stderr.on("data", d => (stderr += d));
  const inbox = []; // not yet taken by waitFor
  const seen = []; // everything the host sent
  let waiters = [];
  let buf = Buffer.alloc(0);
  host.stdout.on("data", chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 4) {
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) break;
      const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
      buf = buf.subarray(4 + len);
      seen.push(msg);
      const w = waiters.find(x => x.test(msg));
      if (w) {
        waiters = waiters.filter(x => x !== w);
        w.resolve(msg);
      } else inbox.push(msg);
    }
  });
  const post = msg => {
    const body = Buffer.from(JSON.stringify(msg));
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    host.stdin.write(Buffer.concat([head, body]));
  };
  const waitFor = (test, ms = 20_000) => {
    const i = inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      waiters.push({ test, resolve });
      setTimeout(() => reject(new Error(`timed out; stderr:\n${stderr}`)), ms);
    });
  };
  try {
    post({ type: "setup.status" });
    const s1 = await waitFor(m => m.type === "setup" && !m.done);
    assert.equal(s1.status.helper.dev, true, "the test runs from a checkout");
    assert.equal(s1.status.engine.subscription.found, true);
    assert.deepEqual(s1.status.agents.clients.filter(c => c.detected).map(c => c.id), ["claude", "codex"]);
    assert.equal(s1.status.mcp.port, port);
    console.log("ok - host: setup.status answers with setup { status }");

    post({ type: "setup.run", step: "agents.register", options: { client: "codex" } });
    const s2 = await waitFor(m => m.type === "setup" && m.done);
    assert.equal(s2.done.ok, true, s2.done.error);
    assert.equal(s2.status.agents.clients.find(c => c.id === "codex").registration, "launcher");
    assert.match(readFileSync(path.join(hostHome, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.zen-browser\]/);
    console.log("ok - host: setup.run agents.register writes the client config and answers with the new status");

    const secret = "sk-ant-api03-host-test-not-real-bad";
    post({ type: "setup.run", step: "engine.apiKey", options: { key: secret.replace("sk-ant-", "sk-nope-") } });
    const s3 = await waitFor(m => m.type === "setup" && m.done);
    assert.equal(s3.done.ok, false, JSON.stringify(s3.done));
    await waitFor(m => m.type === "engines");
    assert.ok(!seen.some(m => JSON.stringify(m).includes("host-test-not-real")), "nothing sent back contains the key");
    assert.ok(!stderr.includes("host-test-not-real"), "nothing logged contains the key");
    post({ type: "setup.run", step: "helper.update" });
    const s4 = await waitFor(m => m.type === "setup" && m.done);
    assert.equal(s4.done.ok, false);
    assert.match(s4.done.error, /checkout/);
    console.log("ok - host: a bad key is refused without echoing it (and engines is re-sent); a checkout can't self-update");
  } finally {
    host.stdin.end();
    host.kill();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("setup checks passed");
