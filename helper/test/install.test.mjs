// scripts/install.sh in a throwaway HOME, twice, with a small fake helper
// tarball and this machine's Node (ENSO_NODE=system, so nothing is
// downloaded): files in place, native-messaging manifests, install.json, the
// `enso` link, a short summary, nothing asked, and the same result the second
// time. macOS only (the installer refuses other systems).
//
//   node test/install.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("skip - install.sh runs on macOS only");
  process.exit(0);
}

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
assert.equal(spawnSync("/usr/bin/tar", ["-czf", tarball, "-C", path.dirname(pkg), "helper"]).status, 0);

const app = path.join(home, "Library/Application Support/Enso");
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
  assert.match(readFileSync(path.join(app, "helper", "run.sh"), "utf8"), new RegExp(`exec "${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  for (const dir of ["Mozilla", "zen"]) {
    const m = JSON.parse(readFileSync(path.join(home, "Library/Application Support", dir, "NativeMessagingHosts", "enso.json"), "utf8"));
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
  assert.ok(!existsSync(path.join(app, "runtime")), "no private Node when this Mac has one");
  console.log("ok - install.sh: helper, run.sh, manifests for Zen and Firefox, install.json, ~/.local/bin/enso, short summary, no questions");

  const files = () => spawnSync("/usr/bin/find", [path.join(home, "Library")], { encoding: "utf8" }).stdout.split("\n").sort().join("\n");
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
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log("install checks passed");
