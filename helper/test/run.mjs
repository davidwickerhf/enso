// Runs the helper's checks in order. All of them work offline, on macOS,
// Linux and Windows (Windows skips the ones built on bash fakes, marked *).
//   unit, hello, tasks, monday always
//   platform                   always (lib/platform.mjs for all three OSes, the secrets file fallback)
//   secrets-store              with ENSO_TEST_REAL_SECRETS=1 (this machine's real store: libsecret, Credential Manager)
//   connections, host-connect  macOS (they store and delete test items in the login
//                              Keychain; skip with ENSO_SKIP_KEYCHAIN=1), and any OS with
//                              ENSO_TEST_REAL_SECRETS=1 (libsecret, Credential Manager)
//   mcp *                      always (launcher, scopes, client registration)
//   agents                     always (agent sessions, steering, the live push to the UI, screenshots to agents)
//   t3 *                       always (T3 Code: fake server and CLI, target order, token store, launcher header, installers)
//   setup *                    always (Setup checklist: setup.status / setup.run with fakes, through host.mjs too)
//   install *                  macOS and Linux (scripts/install.sh twice in a throwaway HOME with a fake helper tarball)
//   doctor                     always (helper.log rotation and redaction, `enso doctor` against fake installs)
//   ui-loading                 always (the extension store: no endless Loading…, Copy diagnostics text)
//   pageagent                  always; skips itself without Playwright's Chromium
//                              (Google Docs typing, title prefix, page pill)
//   sdk-mcp                    only with ENSO_TEST_SDK=1 (one real turn on your Claude plan)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const POSIX_ONLY = new Set(["mcp.test.mjs", "t3.test.mjs", "setup.test.mjs", "install.test.mjs"]); // fake CLIs are bash scripts
const all = ["unit.test.mjs", "platform.test.mjs", "secrets-store.test.mjs", "hello.test.mjs", "tasks.test.mjs", "monday.test.mjs", "mcp.test.mjs", "agents.test.mjs", "t3.test.mjs", "setup.test.mjs", "install.test.mjs", "doctor.test.mjs", "ui-loading.test.mjs", "pageagent.test.mjs"];
const tests = all.filter(t => !(process.platform === "win32" && POSIX_ONLY.has(t)));
for (const t of all.filter(t => !tests.includes(t))) console.log(`skip - ${t} (bash fakes; runs on macOS and Linux)`);
if ((process.platform === "darwin" && process.env.ENSO_SKIP_KEYCHAIN !== "1") || process.env.ENSO_TEST_REAL_SECRETS === "1") tests.push("connections.test.mjs", "host-connect.test.mjs");
if (process.env.ENSO_TEST_SDK === "1") tests.push("sdk-mcp.test.mjs");

let failed = 0;
for (const t of tests) {
  console.log(`\n# ${t}`);
  const r = spawnSync(process.execPath, [path.join(here, t)], { stdio: "inherit", timeout: 120_000 });
  if (r.status !== 0) {
    failed++;
    console.log(`not ok - ${t} (exit ${r.status ?? r.signal})`);
  }
}
console.log(failed ? `\n${failed} of ${tests.length} test files failed` : `\nall ${tests.length} test files passed`);
process.exit(failed ? 1 : 0);
