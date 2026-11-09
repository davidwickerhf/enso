// Runs the helper's checks in order. All of them work offline.
//   unit, hello                always
//   connections, host-connect  macOS only (they store and delete test items in the
//                              login Keychain); skip with ENSO_SKIP_KEYCHAIN=1
//   mcp                        always (launcher, scopes, client registration)
//   sdk-mcp                    only with ENSO_TEST_SDK=1 (one real turn on your Claude plan)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tests = ["unit.test.mjs", "hello.test.mjs"];
tests.push("mcp.test.mjs");
if (process.platform === "darwin" && process.env.ENSO_SKIP_KEYCHAIN !== "1") tests.push("connections.test.mjs", "host-connect.test.mjs");
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
