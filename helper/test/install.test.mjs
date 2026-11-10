// scripts/install.sh in a throwaway HOME, twice, with a small fake helper
// tarball and this machine's Node (ENSO_NODE=system, so nothing is
// downloaded): files in place, native-messaging manifests, install.json, the
// `enso` link, a short summary, nothing asked, and the same result the second
// time. macOS and Linux (Windows: install.ps1, tested in CI's Windows job).
// On Linux it also installs Ensō's own Node from a fake nodejs.org when
// ENSO_TEST_PRIVATE_NODE=1 (Docker / CI), since that path differs per OS.
//
//   node test/install.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.log("skip - install.sh is for macOS and Linux (Windows: install.ps1)");
  process.exit(0);
}
const MAC = process.platform === "darwin";
const tar = MAC ? "/usr/bin/tar" : "tar";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "..", "..", "scripts", "install.sh");
const root = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-install-")));
const home = path.join(root, "home");
const pkg = path.join(root, "pkg", "helper");
mkdirSync(path.join(pkg, "bin"), { recursive: true });
mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
writeFileSync(path.join(pkg, "host.mjs"), "// fake helper\n");
writeFileSync(path.join(pkg, "bin", "enso.mjs"), "// fake enso\n");
writeFileSync(path.join(pkg, "VERSION"), "9.9.9\n");
const tarball = path.join(root, "helper.tar.gz");
assert.equal(spawnSync(tar, ["-czf", tarball, "-C", path.dirname(pkg), "helper"]).status, 0);

const { dataDir, logDir, nativeHostDirs } = await import("../lib/platform.mjs");
const app = dataDir({ home, env: {} });
const logs = logDir({ home, env: {} });
const top = MAC ? path.join(home, "Library") : home; // everything the installer writes is under here
const env = { HOME: home, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, ENSO_HELPER_URL: `file://${tarball}`, ENSO_NO_OPEN: "1", ENSO_NODE: "system", TMPDIR: tmpdir() };
const run = () => spawnSync("/bin/bash", [script], { env, encoding: "utf8", input: "", timeout: 60_000 });

try {
  writeFileSync(path.join(root, "keep"), "");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "config.local.json"), '{"mine":true}\n');

  const first = run();
  assert.equal(first.status, 0, first.stderr + first.stdout);
  assert.match(first.stdout, /Done\. Ensō 9\.9\.9 is installed\./);
  assert.match(first.stdout, /Claude +(not installed yet|.+)/);
  assert.match(first.stdout, /Settings → Setup/);
  assert.doesNotMatch(first.stdout, /\[y\/N\]/, "never asks");
  assert.equal(readFileSync(path.join(app, "helper", "VERSION"), "utf8").trim(), "9.9.9");
  const runSh = readFileSync(path.join(app, "helper", "run.sh"), "utf8");
  assert.ok(runSh.includes(`NODE="${process.execPath}"`), runSh);
  assert.match(runSh, /exec "\$NODE" "\$HOST" "\$@" 2>>"\$LOG"/, "stderr goes to helper.log");
  assert.ok(runSh.includes(`LOG_DIR="${logs}"`), runSh);
  for (const dir of nativeHostDirs({ home })) {
    const m = JSON.parse(readFileSync(path.join(dir, "enso.json"), "utf8"));
    assert.equal(m.name, "enso");
    assert.deepEqual(m.allowed_extensions, ["enso@wicker.life"]);
    assert.equal(m.path, path.join(app, "helper", "run.sh"));
  }
  const status = JSON.parse(readFileSync(path.join(app, "install.json"), "utf8"));
  assert.equal(status.version, "9.9.9");
  assert.equal(status.node.source, "system");
  assert.equal(status.node.path, process.execPath);
  assert.ok(lstatSync(path.join(home, ".local/bin/enso")).isSymbolicLink());
  assert.equal(readlinkSync(path.join(home, ".local/bin/enso")), path.join(app, "bin", "enso"));
  assert.equal(readFileSync(path.join(app, "config.local.json"), "utf8"), '{"mine":true}\n', "config.local.json kept");
  assert.ok(!existsSync(path.join(app, "runtime")), "no private Node when the system has one");
  console.log("ok - install.sh: helper, run.sh, manifests for Zen and Firefox, install.json, ~/.local/bin/enso, short summary, no questions");

  const files = () => spawnSync("find", [top], { encoding: "utf8" }).stdout.split("\n").sort().join("\n");
  const before = files();
  const second = run();
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(files(), before, "the same files after a second run");
  assert.ok(!existsSync(path.join(app, "helper.new")) && !existsSync(path.join(app, "helper.old")));
  console.log("ok - install.sh is idempotent (second run leaves the same files)");

  const broken = spawnSync("/bin/bash", [script], { env: { ...env, ENSO_HELPER_URL: `file://${path.join(root, "keep")}` }, encoding: "utf8", input: "", timeout: 60_000 });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stderr, /not a valid archive|does not contain the helper/);
  assert.equal(readFileSync(path.join(app, "helper", "VERSION"), "utf8").trim(), "9.9.9", "a bad download leaves the installed helper alone");
  console.log("ok - a bad download stops with a clear error and keeps the installed helper");

  // run.sh: the helper's stderr (here a syntax error, as on a too-old Node) lands in <log folder>/helper.log.
  const log = path.join(logs, "helper.log");
  const runPath = path.join(app, "helper", "run.sh");
  writeFileSync(path.join(app, "helper", "host.mjs"), "process.stderr.write('stderr before any logging\\n');\nconst = ;\n");
  const crashed = spawnSync(runPath, [], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 20_000 });
  assert.notEqual(crashed.status, 0);
  const logged = readFileSync(log, "utf8");
  assert.match(logged, /SyntaxError/, logged);
  assert.equal(crashed.stderr, "", "stderr went to the log, not the terminal");
  // Node gone: run.sh says so in the log and exits 127.
  writeFileSync(runPath, runSh.replace(`NODE="${process.execPath}"`, `NODE="${path.join(root, "no-node")}"`));
  const noNode = spawnSync(runPath, [], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8", timeout: 20_000 });
  assert.equal(noNode.status, 127);
  assert.match(readFileSync(log, "utf8"), /run\.sh: Node\.js is not at .*no-node any more/);
  console.log("ok - run.sh appends the helper's stderr to the log folder's helper.log, and says when Node is missing");

  // Without ENSO_NO_OPEN, a throwaway HOME still never opens Zen (a fake `open` first on PATH records any call).
  const fakeBin = path.join(root, "fakebin");
  mkdirSync(fakeBin);
  for (const name of ["open", "zen", "xdg-open", "flatpak"]) writeFileSync(path.join(fakeBin, name), `#!/bin/sh\necho "$@" >> "${path.join(root, "open-calls")}"\n`, { mode: 0o755 });
  const { ENSO_NO_OPEN, ...noFlag } = env;
  const quiet = spawnSync("/bin/bash", [script], { env: { ...noFlag, DISPLAY: ":0", PATH: `${fakeBin}:${env.PATH}` }, encoding: "utf8", input: "", timeout: 60_000 });
  assert.equal(quiet.status, 0, quiet.stderr + quiet.stdout);
  assert.ok(!existsSync(path.join(root, "open-calls")), "open was not called");
  assert.match(quiet.stdout, /Add the extension from/);
  console.log("ok - install.sh in a temporary HOME doesn't open Zen, even without ENSO_NO_OPEN");

  // Another system (a fake uname): a plain message, nothing installed; Git Bash on Windows points at install.ps1.
  for (const [sys, re] of [["FreeBSD", /runs on macOS, Linux and Windows; FreeBSD isn't supported/], ["MINGW64_NT-10.0", /irm .*\/install\.ps1 \| iex/]]) {
    writeFileSync(path.join(fakeBin, "uname"), `#!/bin/sh\necho ${sys}\n`, { mode: 0o755 });
    const other = spawnSync("/bin/bash", [script], { env: { ...env, HOME: path.join(root, "other-home"), PATH: `${fakeBin}:${env.PATH}` }, encoding: "utf8", input: "", timeout: 60_000 });
    assert.notEqual(other.status, 0);
    assert.match(other.stderr, re);
    assert.ok(!existsSync(path.join(root, "other-home")), "nothing written");
  }
  rmSync(path.join(fakeBin, "uname"));
  console.log("ok - install.sh on an unsupported system says so (and sends Git Bash on Windows to install.ps1), installs nothing");

  // Linux: Ensō's own Node from a fake nodejs.org, checked against the pinned SHA-256 (Docker / CI).
  if (!MAC && process.env.ENSO_TEST_PRIVATE_NODE === "1") {
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const name = `node-v24.22.2-linux-${arch}`;
    const fakeCurl = path.join(root, "curlbin");
    mkdirSync(fakeCurl);
    const real = process.env.ENSO_TEST_NODE_TARBALL; // the real nodejs.org file, downloaded by the caller
    assert.ok(real && existsSync(real), "ENSO_TEST_NODE_TARBALL points at the downloaded Node archive");
    writeFileSync(path.join(fakeCurl, "curl"), `#!/bin/bash\nout=""; url=""\nwhile [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift ;; http*|file*) url="$1" ;; esac; shift; done\ncase "$url" in *nodejs.org*${name}.tar.xz) cp "${real}" "$out" ;; file://*) cp "\${url#file://}" "$out" ;; *) exit 22 ;; esac\n`, { mode: 0o755 });
    const home2 = path.join(root, "home-private");
    const r = spawnSync("/bin/bash", [script], { env: { ...env, HOME: home2, ENSO_NODE: "private", PATH: `${fakeCurl}:/usr/bin:/bin` }, encoding: "utf8", input: "", timeout: 180_000 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const app2 = dataDir({ home: home2, env: {} });
    assert.match(readFileSync(path.join(app2, "helper", "run.sh"), "utf8"), new RegExp(`NODE="${app2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/runtime/node/bin/node"`));
    assert.equal(JSON.parse(readFileSync(path.join(app2, "install.json"), "utf8")).node.source, "private");
    assert.match(r.stdout, /Node 24\.22\.2 verified \(SHA-256\)/);
    console.log("ok - Linux: Ensō's own Node 24.22.2 downloaded, SHA-256 checked, run.sh points at it");
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("install checks passed");
