// Secrets in the macOS login Keychain, through /usr/bin/security.
//
// Values never appear on a command line (where `ps` could read them): writes
// go through `security -i`, which reads its commands from stdin, and reads use
// `find-generic-password -w`, which prints the secret to our stdout pipe.
// `security -i` stops at ~4 KB per line, so a value is base64-encoded and
// split over several items: <service>, <service>~1, <service>~2, …
// The head item holds "enso1:<count>:<first chunk>".

import { spawn } from "node:child_process";

const ACCOUNT = "enso";
const CHUNK = 3000;
const SAFE = /^[A-Za-z0-9._~-]+$/;

function run(args, input) {
  return new Promise(resolve => {
    const child = spawn("/usr/bin/security", args, { stdio: [input == null ? "ignore" : "pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", d => (out += d));
    child.on("error", () => resolve({ code: 1, out: "" }));
    child.on("close", code => resolve({ code, out }));
    if (input != null) child.stdin.end(input);
  });
}

function check(service) {
  if (!SAFE.test(service)) throw new Error(`Bad Keychain service name: ${service}`);
}

async function readItem(service) {
  const r = await run(["find-generic-password", "-a", ACCOUNT, "-s", service, "-w"]);
  return r.code === 0 ? r.out.replace(/\n$/, "") : null;
}

/** The stored string, or null when there is none (or it is damaged). */
export async function readSecret(service) {
  check(service);
  const head = await readItem(service);
  const m = head && /^enso1:(\d+):([A-Za-z0-9+/=]*)$/.exec(head);
  if (!m) return null;
  let b64 = m[2];
  for (let i = 1; i < Number(m[1]); i++) {
    const part = await readItem(`${service}~${i}`);
    if (part == null) return null;
    b64 += part;
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

async function deleteChunksFrom(service, start) {
  for (let i = start; i < 100; i++) {
    const r = await run(["delete-generic-password", "-a", ACCOUNT, "-s", `${service}~${i}`]);
    if (r.code !== 0) break;
  }
}

/** Store (or replace) a string. Throws when the Keychain did not take it. */
export async function writeSecret(service, value, label = "Enso MCP sign-in") {
  check(service);
  const b64 = Buffer.from(String(value), "utf8").toString("base64");
  const chunks = [];
  for (let i = 0; i < b64.length || i === 0; i += CHUNK) chunks.push(b64.slice(i, i + CHUNK));
  // Tail chunks first, the head last, so a reader never sees a head pointing at missing parts.
  const lines = chunks.map((c, i) => ({ i, line: `add-generic-password -U -a ${ACCOUNT} -s ${i ? `${service}~${i}` : service} -l "${String(label).replace(/["\\\n]/g, "")}" -w ${i ? c : `enso1:${chunks.length}:${c}`}` }));
  const ordered = [...lines.slice(1), lines[0]].map(l => l.line).join("\n") + "\n";
  await run(["-i"], ordered);
  await deleteChunksFrom(service, chunks.length);
  if ((await readSecret(service)) !== String(value)) throw new Error("The Keychain did not store the sign-in.");
}

export async function deleteSecret(service) {
  check(service);
  await run(["delete-generic-password", "-a", ACCOUNT, "-s", service]);
  await deleteChunksFrom(service, 1);
}
