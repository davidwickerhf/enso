// The helper's log file and `enso doctor`, in a temporary HOME. Nothing outside
// the temporary folder is read or written: HOME, ENSO_DATA and the log folder
// point into it, and the MCP port is a free one picked here.
//
//   - lib/logfile.mjs: rotation at the size limit (two files at most), redaction,
//     tail across the rotated file, crash lines written before exit;
//   - enso doctor against fake installs: a good one (the real host.mjs answers
//     hello), none at all, a wrong Node and extension id, and the port states.
//
//   node test/doctor.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPort, manifestPaths, parseRunSh, runDoctor } from "../lib/doctor.mjs";
import { createLog, logFile, redact, tailLines } from "../lib/logfile.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const HOST = path.join(here, "..", "host.mjs");
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-doctor-")));
// macOS and Linux run the full doctor against fake installs; Windows (registry,
// run.cmd) is covered by test/windows.test.mjs and the CI install job.
const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => r(port)); }); });

try {
  // ---------- log file ----------
  {
    const file = path.join(root, "logs", "helper.log");
    const log = createLog({ file, maxBytes: 2000, pid: 42 });
    for (let i = 0; i < 60; i++) log.write("info", `line ${i} ${"x".repeat(40)}`);
    log.close();
    assert.ok(existsSync(file) && existsSync(`${file}.1`), "rotated into helper.log.1");
    assert.ok(!existsSync(`${file}.2`), "two files at most");
    assert.ok(statSync(file).size <= 2000 && statSync(`${file}.1`).size <= 2000, "each under the limit");
    const tail = tailLines(file, 30);
    assert.equal(tail.length, 30);
    assert.match(tail.at(-1), /^\d{4}-\d\d-\d\dT[\d:.]+Z \[42\] INFO  line 59 x+$/);
    assert.ok(tail.some(l => / line 59 /.test(l)) && Number(tail[0].match(/line (\d+)/)[1]) === 30, "tail reads across helper.log.1");
    console.log("ok - log rotation: helper.log + helper.log.1 at the size limit, tail across both");

    const secret = createLog({ file: path.join(root, "logs", "secret.log") });
    secret.write("error", "sign-in failed: Bearer abcdefghijklmnop1234 at https://x.example/cb?code=s3cr3tc0de&state=1 key sk-ant-api03-ABCdef123456789 gh ghp_ABCDEFGHIJKLMNOPQRSTuvwx12 body {\"access_token\":\"tok123\"}\n  at /Users/maya/Library/Application Support/Enso/helper/node_modules/some-package/dist/index.js:1:2");
    const text = readFileSync(path.join(root, "logs", "secret.log"), "utf8");
    for (const leaked of ["abcdefghijklmnop1234", "s3cr3tc0de", "ABCdef123456789", "ghp_ABCDEFGHIJKLMNOPQRSTuvwx12", "tok123"]) assert.ok(!text.includes(leaked), `${leaked} redacted: ${text}`);
    assert.match(text, /node_modules\/some-package\/dist\/index\.js:1:2/, "paths in stacks are kept");
    assert.match(text, /\n {4} {2}at \/Users\/maya/, "continuation lines are indented");
    assert.equal(redact("Ensō helper 0.5.5 starting: Node v22.1.0"), "Ensō helper 0.5.5 starting: Node v22.1.0");
    console.log("ok - log lines are redacted (bearer tokens, OAuth codes, API keys, GitHub tokens, JSON secrets), paths kept");

    // A crash in the helper process: the stack is in the log before it exits.
    const data = path.join(root, "crash-data");
    const script = path.join(root, "crash.mjs");
    writeFileSync(script, `import ${JSON.stringify(path.join(here, "..", "lib", "boot-log.mjs"))};\nsetTimeout(() => { throw new Error("kaboom in a timer"); }, 10);\n`);
    const r = spawnSync(process.execPath, [script], { env: { ...(WIN ? process.env : {}), HOME: root, USERPROFILE: root, ENSO_DATA: data, PATH: WIN ? process.env.PATH : "/usr/bin:/bin" }, encoding: "utf8" });
    assert.equal(r.status, 1);
    const crash = readFileSync(logFile({ ENSO_DATA: data }), "utf8");
    assert.match(crash, /INFO  Ensō helper \S+ starting: Node v[\d.]+ at .+, (darwin|linux|win32)/);
    assert.match(crash, /FATAL Uncaught exception: Error: kaboom in a timer\n {4}\s+at /);
    assert.match(crash, /INFO  exiting \(code 1\)/);
    console.log("ok - uncaught exceptions are logged with their stack before the helper exits");
  }

  if (WIN) {
    console.log("skip - enso doctor against fake run.sh installs (macOS and Linux; Windows: windows.test.mjs)");
    console.log("doctor checks passed");
    process.exit(0);
  }
  // ---------- enso doctor ----------
  const write = (f, text, mode) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); if (mode) chmodSync(f, mode); };
  const support = home => path.join(home, "Library", "Application Support");
  const manifest = (home, runSh, ids = ["enso@wicker.life"]) => {
    for (const m of manifestPaths(home)) write(m.file, JSON.stringify({ name: "enso", description: "Ensō helper", path: runSh, type: "stdio", allowed_extensions: ids }));
  };
  // The manifest that must be right (macOS: Firefox's folder; Linux: ~/.mozilla, read by both).
  const firefoxManifest = home => manifestPaths(home).find(m => /Firefox/.test(m.label)).file;
  const FF = MAC ? "Firefox manifest" : "Zen\\/Firefox manifest";
  const runShText = node => `#!/bin/bash\nNODE="${node}"\nHOST="${HOST}"\nexec "$NODE" "$HOST" "$@"\n`;
  async function doctor(home, extra = {}) {
    const lines = [];
    const port = extra.port ?? (await freePort());
    const env = { HOME: home, ENSO_DATA: path.join(home, "data"), ENSO_MCP_PORT: String(port), PATH: "/usr/bin:/bin", TMPDIR: tmpdir() };
    const r = await runDoctor({ home, env, port, out: s => lines.push(s), helloTimeoutMs: 20_000 });
    return { ...r, text: lines.join("\n") };
  }

  assert.deepEqual(parseRunSh(runShText("/n/node")), { node: "/n/node", host: HOST });
  assert.deepEqual(parseRunSh(`#!/bin/bash\nexec "/opt/homebrew/bin/node" "/Users/m/Library/Application Support/Enso/helper/host.mjs"\n`), { node: "/opt/homebrew/bin/node", host: "/Users/m/Library/Application Support/Enso/helper/host.mjs" });

  // Good install: the real host.mjs answers hello; the log's last 30 lines, redacted.
  {
    const home = path.join(root, "good");
    const runSh = path.join(support(home), "Enso", "helper", "run.sh");
    write(runSh, runShText(process.execPath), 0o755);
    manifest(home, runSh);
    const log = path.join(home, "data", "logs", "helper.log");
    write(log, Array.from({ length: 40 }, (_, i) => `2026-11-10T10:00:${String(i).padStart(2, "0")}.000Z [1] INFO  old line ${i}`).join("\n") + "\n2026-11-10T10:01:00.000Z [1] ERROR token=hunter2hunter2 failed\n");
    const r = await doctor(home);
    assert.equal(r.ok, true, r.text);
    if (MAC) assert.match(r.text, /✓ Zen manifest +~\/Library\/Application Support\/zen\/NativeMessagingHosts\/enso\.json → /);
    else assert.match(r.text, /✓ Zen\/Firefox manifest +~\/\.mozilla\/native-messaging-hosts\/enso\.json → /);
    assert.match(r.text, new RegExp(`✓ ${FF}`));
    assert.match(r.text, /✓ Node +Node \d+\.\d+\.\d+ at /);
    assert.match(r.text, /✓ Helper +\S+ started and answered hello in \d+\.\d s/);
    assert.match(r.text, /· MCP port \d+ +free/);
    assert.match(r.text, /Last 30 lines of .*helper\.log:/);
    assert.ok(!r.text.includes("old line 10\n") && r.text.includes("old line 11"), "only the last 30 lines");
    assert.ok(!r.text.includes("hunter2"), "log lines redacted");
    console.log("ok - enso doctor on a good install: manifests, Node, hello answered by host.mjs, port free, last 30 log lines (redacted)");
  }

  // Nothing installed.
  {
    const home = path.join(root, "missing");
    mkdirSync(home, { recursive: true });
    const r = await doctor(home);
    assert.equal(r.ok, false);
    assert.match(r.text, MAC ? /✗ Zen manifest +missing/ : /· Zen manifest +missing.*written for later/);
    assert.match(r.text, new RegExp(`✗ ${FF} +missing`));
    assert.match(r.text, /Fix: Run the installer again \((Terminal|a terminal)\): curl -fsSL https:\/\/enso\.wicker\.life\/install\.sh \| bash/);
    assert.match(r.text, /✗ Helper +not checked/);
    assert.match(r.text, /No .*helper\.log yet/);
    console.log("ok - enso doctor with nothing installed: ✗ for each manifest, with the installer as the fix");
  }

  // Wrong Node (too old), wrong extension id in one manifest.
  {
    const home = path.join(root, "oldnode");
    const fakeNode = path.join(home, "bin", "node");
    write(fakeNode, `#!/bin/sh\nif [ "$1" = "-p" ]; then echo 16.20.2; exit 0; fi\necho "SyntaxError: Unexpected token '?'" >&2\nexit 1\n`, 0o755);
    const runSh = path.join(support(home), "Enso", "helper", "run.sh");
    write(runSh, runShText(fakeNode), 0o755);
    manifest(home, runSh);
    write(firefoxManifest(home), JSON.stringify({ name: "enso", path: runSh, type: "stdio", allowed_extensions: ["someone-else@example.com"] }));
    const r = await doctor(home);
    assert.equal(r.ok, false);
    if (MAC) assert.match(r.text, /✓ Zen manifest/);
    assert.match(r.text, new RegExp(`✗ ${FF} +allowed_extensions`));
    assert.match(r.text, /allowed_extensions \["someone-else@example\.com"\] doesn't include enso@wicker\.life/);
    assert.match(r.text, /✗ Node +Node 16\.20\.2 at .* is too old \(Ensō needs 18 or newer\)/);
    assert.match(r.text, /ENSO_NODE=private/);
    assert.match(r.text, /✗ Helper +exited before answering hello \(exit code 1\): SyntaxError/);
    console.log("ok - enso doctor with an old Node and a wrong extension id: ✗ with the reason and a fix");

    // Node gone altogether.
    rmSync(fakeNode);
    const gone = await doctor(home);
    assert.match(gone.text, /✗ Node +.*bin\/node doesn't exist any more/);
    console.log("ok - enso doctor when run.sh's Node was removed");
  }

  // The MCP port: Ensō's helper, or another program.
  {
    const ensoLike = http.createServer((req, res) => res.writeHead(401).end("Missing or wrong token.")).listen(0, "127.0.0.1");
    const other = http.createServer((req, res) => res.writeHead(200).end("hello")).listen(0, "127.0.0.1");
    await Promise.all([ensoLike, other].map(s => new Promise(r => s.once("listening", r))));
    assert.equal((await checkPort(ensoLike.address().port)).state, "enso");
    const busy = await checkPort(other.address().port);
    assert.equal(busy.state, "other");
    assert.match(busy.fix, MAC ? /lsof -nP -iTCP:\d+ -sTCP:LISTEN/ : /ss -ltnp 'sport = :\d+'/);
    const r = await doctor(path.join(root, "missing"), { port: other.address().port });
    assert.match(r.text, /✗ MCP port \d+ +busy: another program answers on it \(HTTP 200\)/);
    ensoLike.close();
    other.close();
    console.log("ok - MCP port: Ensō's helper (401 asking for a token) vs another program (✗ with lsof / ss)");
  }

  // A system outside SUPPORTED_PLATFORMS: one plain line, no checks that can't apply.
  {
    const lines = [];
    const r = await runDoctor({ home: path.join(root, "missing"), env: { HOME: path.join(root, "missing"), ENSO_DATA: path.join(root, "missing", "data") }, platform: "freebsd", out: l => lines.push(l) });
    assert.equal(r.ok, false);
    assert.match(lines.join("\n"), /✗ Ensō's helper runs on macOS, Linux and Windows; this system \(freebsd\) isn't supported\.\n.*docs\/install#requirements/);
    assert.ok(!lines.some(l => /manifest|Node/.test(l)));
    console.log("ok - enso doctor on an unsupported system says so, plainly (supported list from lib/platform.mjs)");
  }

  // The CLI itself.
  {
    const home = path.join(root, "missing");
    const r = spawnSync(process.execPath, [path.join(here, "..", "bin", "enso.mjs"), "doctor"], { env: { HOME: home, ENSO_DATA: path.join(home, "data"), ENSO_MCP_PORT: String(await freePort()), PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 30_000 });
    assert.equal(r.status, 1);
    assert.match(r.stdout, MAC ? /^Ensō doctor\n✗ Zen manifest/ : /^Ensō doctor\n✗ Zen\/Firefox manifest/);
    console.log("ok - `enso doctor` exits 1 when something needs fixing");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("doctor checks passed");
