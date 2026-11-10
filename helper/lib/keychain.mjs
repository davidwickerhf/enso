// Longer secrets (MCP sign-ins, the T3 token) in the OS's secret store
// (lib/secrets.mjs: the macOS Keychain, libsecret on Linux, the Windows
// Credential Manager). The name stays keychain.mjs for history.
//
// Values never appear on a command line (see lib/secrets.mjs). Some stores
// limit an item's size (`security -i` stops at ~4 KB per line, a Windows
// credential holds 2560 bytes), so a value is base64-encoded and split over
// several items: <service>, <service>~1, <service>~2, … The head item holds
// "enso1:<count>:<first chunk>". Stores without a limit get one item.

import { backend, checkName, DEFAULT_ACCOUNT } from "./secrets.mjs";

const ACCOUNT = DEFAULT_ACCOUNT;

function check(service) {
  checkName(service);
}

/** The stored string, or null when there is none (or it is damaged). */
export async function readSecret(service) {
  check(service);
  const b = backend();
  const head = await b.get(service, ACCOUNT);
  const m = head && /^enso1:(\d+):([A-Za-z0-9+/=]*)$/.exec(head);
  if (!m) return null;
  const count = Number(m[1]);
  let b64 = m[2];
  const rest = Array.from({ length: Math.max(0, count - 1) }, (_, i) => `${service}~${i + 1}`);
  const parts = b.getMany ? await b.getMany(rest, ACCOUNT) : await Promise.all(rest.map(s => b.get(s, ACCOUNT)));
  for (const part of parts) {
    if (part == null) return null;
    b64 += part;
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

async function deleteChunksFrom(service, start) {
  const b = backend();
  if (b.deleteMany) {
    // One round trip for a batch of candidates (Windows starts PowerShell per call).
    for (let from = start; from < 100; from += 20) {
      const ok = await b.deleteMany(Array.from({ length: 20 }, (_, i) => `${service}~${from + i}`));
      if (!ok.every(Boolean)) break;
    }
    return;
  }
  for (let i = start; i < 100; i++) if (!(await b.delete(`${service}~${i}`, ACCOUNT))) break;
}

/** Store (or replace) a string. Throws when the store did not take it. */
export async function writeSecret(service, value, label = "Enso MCP sign-in") {
  check(service);
  const b = backend();
  const b64 = Buffer.from(String(value), "utf8").toString("base64");
  const size = Number.isFinite(b.chunk) ? b.chunk : Math.max(b64.length, 1);
  const chunks = [];
  for (let i = 0; i < b64.length || i === 0; i += size) chunks.push(b64.slice(i, i + size));
  const items = chunks.map((c, i) => ({ service: i ? `${service}~${i}` : service, account: ACCOUNT, label, value: i ? c : `enso1:${chunks.length}:${c}` }));
  // Tail chunks first, the head last, so a reader never sees a head pointing at missing parts.
  await b.setMany([...items.slice(1), items[0]]);
  await deleteChunksFrom(service, chunks.length);
  if ((await readSecret(service)) !== String(value)) throw new Error(`${b.location()[0].toUpperCase()}${b.location().slice(1)} did not store the sign-in.`);
}

export async function deleteSecret(service) {
  check(service);
  await backend().delete(service, ACCOUNT);
  await deleteChunksFrom(service, 1);
}
