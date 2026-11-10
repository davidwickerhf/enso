// The OS's secret store, one small interface for the rest of the helper:
//
//   macOS    the login Keychain through /usr/bin/security (unchanged from before)
//   Linux    libsecret through `secret-tool` (GNOME Keyring, KWallet's Secret
//            Service, KeePassXC…). Without one (no desktop session, no
//            secret-tool), a 0600 file in the data folder, and Setup/doctor
//            say so.
//   Windows  the Credential Manager (generic credentials), through Windows
//            PowerShell 5.1 calling CredRead/CredWrite/CredDelete with Add-Type.
//            No native Node module, nothing to install.
//
// Values never appear on a command line (where another process could read
// them): macOS writes go through `security -i` on stdin, secret-tool reads the
// secret from stdin, and the PowerShell script gets its items as JSON on stdin.
// Reads come back on our stdout pipe.
//
// Items are (service, account). Most of Ensō's items use account "enso"; a
// read without an account matches any account (the API key and GitHub token
// may have been added by hand with another one).
//
// ENSO_SECRETS=keychain|libsecret|credman|file forces a backend (tests, CI).

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { currentPlatform, dataDir, powershellExe, which } from "./platform.mjs";

export const DEFAULT_ACCOUNT = "enso";
const SAFE = /^[A-Za-z0-9._~-]+$/;
export const checkName = (service, what = "service") => {
  if (!SAFE.test(String(service))) throw new Error(`Bad secret ${what} name: ${service}`);
};

// ---------- process helpers ----------

function run(cmd, args, { input, env } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"], windowsHide: true, ...(env ? { env } : {}) });
    } catch {
      return resolve({ code: 127, out: "", err: "" });
    }
    let out = "";
    let err = "";
    child.stdout.on("data", d => (out += d));
    child.stderr.on("data", d => (err += d));
    child.on("error", () => resolve({ code: 127, out: "", err: "" }));
    child.on("close", code => resolve({ code: code ?? 1, out, err }));
    if (input != null) child.stdin.end(input);
  });
}
function runSync(cmd, args, { input } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"], timeout: 20_000, windowsHide: true });
  return { code: r.error ? 127 : r.status ?? 1, out: r.stdout ?? "", err: r.stderr ?? "" };
}

// ---------- macOS Keychain ----------

const SECURITY = "/usr/bin/security";
const keychain = {
  name: "keychain",
  chunk: 3000, // `security -i` stops at ~4 KB per line
  location: () => "your macOS login Keychain",
  async get(service, account) {
    const r = await run(SECURITY, ["find-generic-password", ...(account ? ["-a", account] : []), "-s", service, "-w"]);
    return r.code === 0 ? r.out.replace(/\n$/, "") : null;
  },
  getSync(service, account) {
    const r = runSync(SECURITY, ["find-generic-password", ...(account ? ["-a", account] : []), "-s", service, "-w"]);
    return r.code === 0 ? r.out.replace(/\n$/, "") : null;
  },
  async has(service, account) {
    // No -w: the value never reaches this process.
    return (await run(SECURITY, ["find-generic-password", ...(account ? ["-a", account] : []), "-s", service])).code === 0;
  },
  /** items: [{ service, account, value, label }], written in this order in one `security -i`. */
  async setMany(items) {
    const lines = items.map(i => `add-generic-password -U -a ${i.account} -s ${i.service}${i.label ? ` -l "${String(i.label).replace(/["\\\n]/g, "")}"` : ""} -w ${i.value}`);
    await run(SECURITY, ["-i"], { input: lines.join("\n") + "\n" });
  },
  async delete(service, account) {
    return (await run(SECURITY, ["delete-generic-password", ...(account ? ["-a", account] : []), "-s", service])).code === 0;
  },
};

// ---------- Linux: libsecret ----------

const attrs = (service, account) => ["service", service, ...(account ? ["account", account] : [])];
const libsecret = {
  name: "libsecret",
  chunk: Infinity,
  location: () => "your desktop keyring (libsecret)",
  async get(service, account) {
    const r = await run("secret-tool", ["lookup", ...attrs(service, account)]);
    return r.code === 0 ? r.out.replace(/\n$/, "") : null;
  },
  getSync(service, account) {
    const r = runSync("secret-tool", ["lookup", ...attrs(service, account)]);
    return r.code === 0 ? r.out.replace(/\n$/, "") : null;
  },
  async has(service, account) {
    return (await libsecret.get(service, account)) != null;
  },
  async setMany(items) {
    for (const i of items) {
      const r = await run("secret-tool", ["store", `--label=${String(i.label || `Ensō ${i.service}`).replace(/\n/g, " ")}`, ...attrs(i.service, i.account)], { input: String(i.value) });
      if (r.code !== 0) throw new Error("The keyring did not store the secret.");
    }
  },
  async delete(service, account) {
    const had = await libsecret.has(service, account);
    await run("secret-tool", ["clear", ...attrs(service, account)]);
    return had;
  },
};

// ---------- Windows: Credential Manager ----------

// Generic credentials, target name = service, user name = account. A blob is at
// most 2560 bytes (CRED_MAX_CREDENTIAL_BLOB_SIZE), so long values are split.
const CREDMAN_PS = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EnsoCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL cred, int flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string target, int type, int flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr p);
  public static string Read(string target, string user) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (!String.IsNullOrEmpty(user) && c.UserName != user) return null;
      byte[] b = new byte[c.CredentialBlobSize];
      if (b.Length > 0) Marshal.Copy(c.CredentialBlob, b, 0, b.Length);
      return Convert.ToBase64String(b);
    } finally { CredFree(p); }
  }
  public static bool Write(string target, string user, string comment, string b64) {
    byte[] b = Convert.FromBase64String(b64);
    CREDENTIAL c = new CREDENTIAL();
    c.Type = 1; c.TargetName = target; c.UserName = user; c.Comment = comment; c.Persist = 2;
    c.CredentialBlobSize = b.Length; c.CredentialBlob = Marshal.AllocHGlobal(Math.Max(b.Length, 1));
    try { Marshal.Copy(b, 0, c.CredentialBlob, b.Length); return CredWriteW(ref c, 0); }
    finally { Marshal.FreeHGlobal(c.CredentialBlob); }
  }
  public static bool Delete(string target) { return CredDeleteW(target, 1, 0); }
}
'@
$req = [Console]::In.ReadToEnd() | ConvertFrom-Json
$out = New-Object System.Collections.ArrayList
foreach ($it in @($req.items)) {
  if ($req.op -eq 'get') { [void]$out.Add(@{ value = [EnsoCred]::Read($it.service, $it.account) }) }
  elseif ($req.op -eq 'set') { [void]$out.Add(@{ ok = [EnsoCred]::Write($it.service, $it.account, $it.label, $it.value) }) }
  elseif ($req.op -eq 'delete') { [void]$out.Add(@{ ok = [EnsoCred]::Delete($it.service) }) }
}
ConvertTo-Json -InputObject @{ items = $out.ToArray() } -Compress -Depth 4
`;
const credmanArgs = () => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(CREDMAN_PS, "utf16le").toString("base64")];

/** Our writes are UTF-8; `cmdkey /pass` stores UTF-16LE. */
export function decodeBlob(b64) {
  if (b64 == null) return null;
  const buf = Buffer.from(b64, "base64");
  const utf16 = buf.length >= 2 && buf.length % 2 === 0 && [...buf].every((b, i) => (i % 2 ? b === 0 : true));
  return utf16 ? buf.toString("utf16le") : buf.toString("utf8");
}
function parseCredman(r) {
  if (r.code !== 0) throw new Error(`The Windows Credential Manager could not be reached${r.err ? ` (${r.err.split("\n")[0].slice(0, 160)})` : ""}.`);
  const j = JSON.parse(r.out.trim() || "{}");
  return Array.isArray(j.items) ? j.items : j.items ? [j.items] : [];
}
const credman = {
  name: "credman",
  chunk: 1800,
  location: () => "the Windows Credential Manager",
  async getMany(services, account) {
    const r = await run(powershellExe(), credmanArgs(), { input: JSON.stringify({ op: "get", items: services.map(service => ({ service, account: account ?? "" })) }) });
    return parseCredman(r).map(i => decodeBlob(i.value));
  },
  async get(service, account) {
    return (await credman.getMany([service], account))[0] ?? null;
  },
  getSync(service, account) {
    const r = runSync(powershellExe(), credmanArgs(), { input: JSON.stringify({ op: "get", items: [{ service, account: account ?? "" }] }) });
    try {
      return decodeBlob(parseCredman(r)[0]?.value);
    } catch {
      return null;
    }
  },
  async has(service, account) {
    return (await credman.get(service, account)) != null;
  },
  async setMany(items) {
    const r = await run(powershellExe(), credmanArgs(), {
      input: JSON.stringify({ op: "set", items: items.map(i => ({ service: i.service, account: i.account, label: i.label ?? "", value: Buffer.from(String(i.value), "utf8").toString("base64") })) }),
    });
    if (parseCredman(r).some(i => !i.ok)) throw new Error("The Credential Manager did not store the secret.");
  },
  async delete(service) {
    const r = await run(powershellExe(), credmanArgs(), { input: JSON.stringify({ op: "delete", items: [{ service }] }) });
    try {
      return !!parseCredman(r)[0]?.ok;
    } catch {
      return false;
    }
  },
  async deleteMany(services) {
    const r = await run(powershellExe(), credmanArgs(), { input: JSON.stringify({ op: "delete", items: services.map(service => ({ service })) }) });
    try {
      return parseCredman(r).map(i => !!i.ok);
    } catch {
      return services.map(() => false);
    }
  },
};

// ---------- fallback: a 0600 file ----------

export const secretsFile = (dir = dataDir()) => path.join(dir, "secrets.json");
function fileBackend(dir) {
  const file = () => secretsFile(dir ?? dataDir());
  const load = () => {
    try {
      return JSON.parse(readFileSync(file(), "utf8")).items ?? {};
    } catch {
      return {};
    }
  };
  const save = items => {
    mkdirSync(path.dirname(file()), { recursive: true });
    const tmp = `${file()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ "//": "Ensō's secrets (no system keyring was available). Keep this file private.", items }, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file());
  };
  const find = (items, service, account) => (account ? items[`${service}|${account}`] : Object.entries(items).find(([k]) => k.split("|")[0] === service)?.[1]);
  const b = {
    name: "file",
    chunk: Infinity,
    location: () => file(),
    async get(service, account) {
      return b.getSync(service, account);
    },
    getSync(service, account) {
      return find(load(), service, account) ?? null;
    },
    async has(service, account) {
      return b.getSync(service, account) != null;
    },
    async setMany(list) {
      const items = load();
      for (const i of list) items[`${i.service}|${i.account}`] = String(i.value);
      save(items);
    },
    async delete(service, account) {
      const items = load();
      const keys = Object.keys(items).filter(k => (account ? k === `${service}|${account}` : k.split("|")[0] === service));
      keys.forEach(k => delete items[k]);
      if (keys.length) save(items);
      return keys.length > 0;
    },
  };
  return b;
}

// ---------- choosing one ----------

let chosen = null;
let probeNote = null;

/** Is secret-tool there, and does it reach a Secret Service? (A miss exits 1 with nothing on stderr.) */
function libsecretWorks(env = process.env) {
  if (!which("secret-tool", { env })) return { ok: false, note: "secret-tool isn't installed (it comes with libsecret-tools / libsecret)" };
  const r = runSync("secret-tool", ["lookup", "service", "enso-probe", "account", DEFAULT_ACCOUNT]);
  if (r.code === 0 || (r.code === 1 && !r.err.trim())) return { ok: true };
  return { ok: false, note: `no keyring answered (${r.err.split("\n")[0].trim().slice(0, 120) || `exit ${r.code}`})` };
}

/** The backend for this process. */
export function backend({ env = process.env, platform = currentPlatform(env) } = {}) {
  if (chosen) return chosen;
  const forced = env.ENSO_SECRETS;
  if (forced === "file") chosen = fileBackend();
  else if (forced === "keychain") chosen = keychain;
  else if (forced === "libsecret") chosen = libsecret;
  else if (forced === "credman") chosen = credman;
  else if (platform === "darwin") chosen = keychain;
  else if (platform === "win32") chosen = credman;
  else {
    const probe = libsecretWorks(env);
    chosen = probe.ok ? libsecret : fileBackend();
    probeNote = probe.ok ? null : probe.note;
  }
  return chosen;
}

/** Tests: forget the chosen backend (after changing ENSO_SECRETS). */
export function resetBackend() {
  chosen = null;
  probeNote = null;
}

/**
 * For Setup and `enso doctor`: { backend, location, secure, warning }.
 * secure = false only for the file fallback.
 */
export function secretsInfo(o) {
  const b = backend(o);
  const secure = b.name !== "file";
  const forced = (o?.env ?? process.env).ENSO_SECRETS === "file";
  return {
    backend: b.name,
    location: b.location(),
    secure,
    warning: secure || forced
      ? null
      : `No system keyring: ${probeNote ?? "secret-tool didn't answer"}. Sign-ins and keys are kept in ${b.location()} (readable only by you). Install libsecret-tools and run a keyring (GNOME Keyring, KWallet, KeePassXC) for better protection, then save them again.`,
  };
}

// ---------- plain items (one value per item) ----------

/** Read one item; null when missing. */
export async function getItem(service, { account } = {}) {
  checkName(service);
  return backend().get(service, account);
}
/** Synchronous read (the API key, read while building a request). */
export function getItemSync(service, { account } = {}) {
  checkName(service);
  try {
    return backend().getSync(service, account);
  } catch {
    return null;
  }
}
/** Is there an item? On macOS the value doesn't even reach this process. */
export async function hasItem(service, { account } = {}) {
  checkName(service);
  return backend().has(service, account);
}
/** Store (or replace) one item. Throws when the store didn't take it. */
export async function setItem(service, value, { account = DEFAULT_ACCOUNT, label } = {}) {
  checkName(service);
  checkName(account, "account");
  const b = backend();
  if (String(value).length > b.chunk) throw new Error("That value is too long for the system's secret store.");
  if (/[\r\n]/.test(String(value)) && b.name === "keychain") throw new Error("Secrets can't contain line breaks.");
  await b.setMany([{ service, account, value: String(value), label }]);
}
/** Delete an item (every account when none is given, up to `max` items). */
export async function deleteItem(service, { account, max = 10 } = {}) {
  checkName(service);
  const b = backend();
  for (let i = 0; i < max; i++) if (!(await b.delete(service, account))) break;
}

/** How to add an item by hand on this machine (for error messages; never contains a value). */
export function addItemHint(service) {
  checkName(service);
  const b = backend();
  if (b.name === "keychain") return `security add-generic-password -s ${service} -a enso -w`;
  if (b.name === "libsecret") return `secret-tool store --label=Ensō service ${service} account enso`;
  if (b.name === "credman") return `cmdkey /generic:${service} /user:enso /pass`;
  return "Ensō → Settings → Setup";
}
