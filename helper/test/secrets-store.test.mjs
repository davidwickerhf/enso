// The real secret store of this machine (lib/secrets.mjs): libsecret on Linux,
// the Credential Manager on Windows, the login Keychain on macOS. Writes,
// reads, splits and deletes items named enso-test-store-* and removes them
// again. Runs only with ENSO_TEST_REAL_SECRETS=1 (CI does: a throwaway
// keyring on Linux, the runner's Credential Manager on Windows).
//
//   ENSO_TEST_REAL_SECRETS=1 node test/secrets-store.test.mjs

import assert from "node:assert/strict";

if (process.env.ENSO_TEST_REAL_SECRETS !== "1") {
  console.log("skip - real secret store (set ENSO_TEST_REAL_SECRETS=1)");
  process.exit(0);
}
delete process.env.ENSO_SECRETS;
const secrets = await import("../lib/secrets.mjs");
const keychain = await import("../lib/keychain.mjs");
const expected = { darwin: "keychain", linux: "libsecret", win32: "credman" }[process.platform];
const info = secrets.secretsInfo();
assert.equal(info.backend, expected, `expected ${expected}, got ${info.backend}: ${info.warning ?? ""}`);
console.log(`ok - backend ${info.backend} (${info.location})`);

const S = `enso-test-store-${process.pid}`;
try {
  await secrets.setItem(`${S}-plain`, "value with spaces & symbols;'\"", { label: "Enso test" });
  assert.equal(await secrets.getItem(`${S}-plain`), "value with spaces & symbols;'\"");
  assert.equal(secrets.getItemSync(`${S}-plain`), "value with spaces & symbols;'\"");
  assert.equal(await secrets.hasItem(`${S}-plain`), true);
  await secrets.setItem(`${S}-plain`, "replaced");
  assert.equal(await secrets.getItem(`${S}-plain`), "replaced");
  await secrets.deleteItem(`${S}-plain`);
  assert.equal(await secrets.getItem(`${S}-plain`), null);
  assert.equal(await secrets.hasItem(`${S}-plain`), false);
  console.log("ok - one item: write, read (async and sync), replace, delete");

  const long = JSON.stringify({ access_token: "x".repeat(7000), note: "é✓" });
  await keychain.writeSecret(`${S}-long`, long);
  assert.equal(await keychain.readSecret(`${S}-long`), long);
  await keychain.writeSecret(`${S}-long`, "short now");
  assert.equal(await keychain.readSecret(`${S}-long`), "short now");
  await keychain.deleteSecret(`${S}-long`);
  assert.equal(await keychain.readSecret(`${S}-long`), null);
  console.log("ok - a long value split over items, shrunk, deleted");
} finally {
  await secrets.deleteItem(`${S}-plain`).catch(() => {});
  await keychain.deleteSecret(`${S}-long`).catch(() => {});
}
console.log("secret store checks passed");
