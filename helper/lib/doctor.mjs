// `enso doctor`: why doesn't Zen's helper start? Checks, in order:
//   1. the native-messaging manifests Zen and Firefox read (exists, valid,
//      points at an executable run.sh / run.cmd, allows Ensō's extension id);
//      on Windows first the registry key that points at the manifest;
//   2. the Node that run.sh starts (still there, version 18 or newer);
//   3. the helper itself: starts it the way Zen does (run.sh with native
//      messaging framing on stdin/stdout) and waits for its answer to hello;
//   4. the MCP port (47823): Ensō's running helper, free, or another program;
//   5. where secrets are kept (a warning on Linux without a keyring);
//   6. the last lines of helper.log (folder per OS: lib/platform.mjs).
// Each failure comes with a suggested fix. Nothing is changed, and nothing
// secret is printed (log lines pass through redact()).
//
// The helper started in step 3 runs with ENSO_DOCTOR=1: it answers hello but
// doesn't take the MCP port, start Claude, refresh the dashboard or clean up
// the running helper's headless Zen.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { logFile, tailLines } from "./logfile.mjs";
import { currentPlatform, installCommand, isExecutable as platformIsExecutable, nativeHostDirs, nativeHostRegistryKeys, PLATFORM_NAMES, SUPPORTED_PLATFORMS } from "./platform.mjs";
import { secretsInfo } from "./secrets.mjs";

export const EXTENSION_ID = "enso@wicker.life";
export const HOST_NAME = "enso";
export const MIN_NODE = 18;
const PLATFORM = currentPlatform();
const INSTALL = installCommand("https://enso.wicker.life");
const WHERE = PLATFORM === "darwin" ? "Terminal" : PLATFORM === "win32" ? "PowerShell" : "a terminal";
/** Supported systems come from lib/platform.mjs (SUPPORTED_PLATFORMS). */
export const unsupportedText = platform => `Ensō's helper runs on ${SUPPORTED_PLATFORMS.map(p => PLATFORM_NAMES[p]).join(", ").replace(/, ([^,]+)$/, " and $1")}; this system (${platform}) isn't supported.`;
export const UNSUPPORTED = unsupportedText(process.platform);
const REINSTALL = `Run the installer again (${WHERE}): ${INSTALL}`;

const isExecutable = f => platformIsExecutable(f, PLATFORM);

/** The manifest files to check (macOS, Linux). Windows: registryManifest() first. */
export function manifestPaths(home, platform = PLATFORM) {
  if (platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return [
      { label: "Zen manifest", file: path.join(support, "zen", "NativeMessagingHosts", `${HOST_NAME}.json`) },
      { label: "Firefox manifest", file: path.join(support, "Mozilla", "NativeMessagingHosts", `${HOST_NAME}.json`) },
    ];
  }
  // Linux: Zen and Firefox both read ~/.mozilla; ~/.zen is written for when Zen reads its own folder.
  const [mozilla, zen] = nativeHostDirs({ platform: "linux", home });
  return [
    { label: "Zen/Firefox manifest", file: path.join(mozilla, `${HOST_NAME}.json`) },
    { label: "Zen manifest", file: path.join(zen, `${HOST_NAME}.json`), optional: true },
  ];
}

/** Windows: the manifest file HKCU\Software\Mozilla\NativeMessagingHosts\enso points at, or { error }. */
export function registryManifest({ run = spawnSync } = {}) {
  const key = nativeHostRegistryKeys(HOST_NAME)[0];
  const r = run("reg", ["query", key, "/ve"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  const file = /REG_SZ\s+(.+?)\s*$/m.exec(String(r.stdout ?? ""))?.[1];
  return file ? { key, file } : { key, error: `${key} is missing` };
}

/** { ok, detail, fix, manifest } for one manifest file. */
export function checkManifest(file, extensionId = EXTENSION_ID) {
  if (!existsSync(file)) return { ok: false, detail: `missing (${file})`, fix: REINSTALL };
  let m;
  try {
    m = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return { ok: false, detail: `not valid JSON (${err.message})`, fix: REINSTALL };
  }
  if (m.name !== HOST_NAME) return { ok: false, detail: `"name" is ${JSON.stringify(m.name)}, not "${HOST_NAME}"`, fix: REINSTALL, manifest: m };
  if (m.type !== "stdio") return { ok: false, detail: `"type" is ${JSON.stringify(m.type)}, not "stdio"`, fix: REINSTALL, manifest: m };
  if (!m.path || !existsSync(m.path)) return { ok: false, detail: `points at ${m.path ?? "nothing"}, which doesn't exist`, fix: REINSTALL, manifest: m };
  if (!isExecutable(m.path)) return { ok: false, detail: `${m.path} isn't executable`, fix: `chmod +x "${m.path}" (or run the installer again)`, manifest: m };
  if (!Array.isArray(m.allowed_extensions) || !m.allowed_extensions.includes(extensionId)) {
    return { ok: false, detail: `allowed_extensions ${JSON.stringify(m.allowed_extensions ?? [])} doesn't include ${extensionId}`, fix: REINSTALL, manifest: m };
  }
  return { ok: true, detail: `${file} → ${m.path}`, manifest: m };
}

/** The node and host.mjs paths a run.sh (or Windows run.cmd) starts (install scripts' and dev.sh's, old and new style). */
export function parseRunSh(text) {
  const cmd = /^\s*"([^"]+node(?:\.exe)?)"\s+"([^"]+host\.mjs)"/im.exec(text);
  const setVar = name => new RegExp(`^set "${name}=([^"]+)"`, "im").exec(text)?.[1];
  const node = text.match(/^NODE="([^"]+)"/m)?.[1] ?? text.match(/^exec "([^"$]+)" "/m)?.[1] ?? setVar("NODE") ?? cmd?.[1] ?? null;
  const host = text.match(/^HOST="([^"]+)"/m)?.[1] ?? text.match(/^exec "[^"]+" "([^"$]+)"/m)?.[1] ?? setVar("HOST") ?? cmd?.[2] ?? null;
  return { node, host };
}

export function checkNode(node) {
  if (!node) return { ok: false, detail: "run.sh doesn't name a Node.js binary", fix: REINSTALL };
  if (!existsSync(node)) return { ok: false, detail: `${node} doesn't exist any more (Node was removed or moved)`, fix: REINSTALL };
  if (!isExecutable(node)) return { ok: false, detail: `${node} isn't executable`, fix: REINSTALL };
  const r = spawnSync(node, ["-p", "process.versions.node"], { encoding: "utf8", timeout: 10_000, windowsHide: true, env: PLATFORM === "win32" ? process.env : { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? homedir() } });
  const version = String(r.stdout ?? "").trim();
  const major = Number.parseInt(version, 10);
  if (r.status !== 0 || !Number.isFinite(major)) return { ok: false, detail: `${node} doesn't run${r.stderr ? `: ${String(r.stderr).trim().split("\n")[0]}` : ""}`, fix: `${REINSTALL}\n(It picks a working Node, or downloads Ensō's own copy.)` };
  if (major < MIN_NODE) return { ok: false, detail: `Node ${version} at ${node} is too old (Ensō needs ${MIN_NODE} or newer)`, fix: `Update Node.js (https://nodejs.org), or run the installer again with ENSO_NODE=private to use Ensō's own copy:\n${INSTALL.replace("| bash", "| ENSO_NODE=private bash")}` };
  return { ok: true, detail: `Node ${version} at ${node}`, version };
}

/**
 * Starts the helper as Zen does (the manifest's path, with the manifest file and
 * the extension id as arguments) and sends hello in native-messaging framing.
 * Resolves { ok, ms, detail } once a `state` message arrives, or on exit / timeout.
 */
export function checkHello(command, { manifestFile = "", extensionId = EXTENSION_ID, env = process.env, timeoutMs = 10_000 } = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    let child;
    try {
      // Firefox starts a .cmd/.bat host through cmd.exe; so does this.
      const viaCmd = /\.(cmd|bat)$/i.test(command);
      child = viaCmd
        ? spawn(`"${command}"`, [`"${manifestFile}"`, extensionId], { env: { ...env, ENSO_DOCTOR: "1" }, stdio: ["pipe", "pipe", "pipe"], cwd: tmpdir(), shell: true, windowsHide: true })
        : spawn(command, [manifestFile, extensionId], { env: { ...env, ENSO_DOCTOR: "1" }, stdio: ["pipe", "pipe", "pipe"], cwd: "/" });
    } catch (err) {
      return resolve({ ok: false, detail: `couldn't start ${command}: ${err.message}`, fix: REINSTALL });
    }
    let inbox = Buffer.alloc(0);
    let stderr = "";
    let done = false;
    const finish = r => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch {}
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 1500).unref();
      resolve({ ms: Date.now() - started, ...r });
    };
    const timer = setTimeout(() => finish({ ok: false, detail: `started, but didn't answer hello within ${Math.round(timeoutMs / 1000)} s`, fix: "Look at the helper.log lines below for what it was doing. Then quit and reopen Zen; if it keeps happening, send the log." }), timeoutMs);
    child.on("error", err => finish({ ok: false, detail: `couldn't start ${command}: ${err.message}`, fix: REINSTALL }));
    child.stderr.on("data", d => {
      stderr = (stderr + d).slice(-4000);
    });
    child.stdout.on("data", chunk => {
      inbox = Buffer.concat([inbox, chunk]);
      while (inbox.length >= 4) {
        const len = inbox.readUInt32LE(0);
        if (inbox.length < 4 + len) break;
        let msg = null;
        try {
          msg = JSON.parse(inbox.subarray(4, 4 + len).toString("utf8"));
        } catch {}
        inbox = inbox.subarray(4 + len);
        if (msg?.type === "state") return finish({ ok: true, detail: "started and answered hello" });
      }
    });
    // "close", not "exit": stderr may still be in the pipe when the process exits.
    child.on("close", (code, signal) => {
      const last = stderr.trim().split("\n").filter(Boolean).slice(-3).join(" / ");
      finish({ ok: false, detail: `exited before answering hello (${signal ? `signal ${signal}` : `exit code ${code}`})${last ? `: ${last}` : ""}`, fix: code === 127 ? REINSTALL : "The helper.log lines below say why. Running the installer again repairs a broken install." });
    });
    const body = Buffer.from(JSON.stringify({ type: "hello" }));
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.on("error", () => {});
    child.stdin.write(Buffer.concat([header, body]));
  });
}

/** How to see which program listens on a port, per OS. */
export function whoListens(port, platform = PLATFORM) {
  if (platform === "win32") return `netstat -ano | findstr :${port}   (then: tasklist /FI "PID eq <pid>")`;
  if (platform === "linux") return `ss -ltnp 'sport = :${port}'`;
  return `lsof -nP -iTCP:${port} -sTCP:LISTEN`;
}

/** { state: "enso" | "free" | "other", detail, fix? } for the MCP port. */
export function checkPort(port, { timeoutMs = 2000 } = {}) {
  return new Promise(resolve => {
    const req = http.get({ host: "127.0.0.1", port, path: "/mcp", timeout: timeoutMs }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", d => {
        body = (body + d).slice(0, 2000);
      });
      res.on("end", () => {
        if (res.statusCode === 401 && /token/i.test(body)) resolve({ state: "enso", detail: `in use by Ensō's helper (Zen is running it)` });
        else resolve({ state: "other", detail: `busy: another program answers on it (HTTP ${res.statusCode})`, fix: `See which one with: ${whoListens(port)}\nQuit it, or move Ensō to another port: set ENSO_MCP_PORT for Zen and your MCP clients.` });
      });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ state: "other", detail: "busy: something accepts connections but doesn't answer", fix: `See which program with: ${whoListens(port)}` });
    });
    req.on("error", err => {
      if (err.code === "ECONNREFUSED") resolve({ state: "free", detail: "free (no helper is serving agents right now; normal while Zen is closed)" });
      else resolve({ state: "other", detail: `couldn't check (${err.code ?? err.message})` });
    });
  });
}

/**
 * Runs every check and writes the report with out(line). Returns { ok, results }.
 * Options are for tests: home, env (for the helper started in the hello check), port.
 */
export async function runDoctor({ home = process.env.HOME || homedir(), env = process.env, port = Number(env.ENSO_MCP_PORT) || 47823, extensionId = EXTENSION_ID, out = s => console.log(s), helloTimeoutMs = 10_000, logLines = 30, platform = process.platform } = {}) {
  const results = [];
  const tilde = p => (p ? String(p).replaceAll(`${home}/`, "~/") : p);
  const line = (mark, label, detail, fix) => {
    out(`${mark} ${label.padEnd(17)} ${tilde(detail)}`);
    if (fix) for (const f of fix.split("\n")) out(`    ${f}`);
  };
  const add = (label, r) => {
    results.push({ label, ...r });
    line(r.ok === true ? "✓" : r.ok === false ? "✗" : "·", label, r.detail, r.ok === false ? `Fix: ${r.fix ?? REINSTALL}`.replace(/\n/g, "\n     ") : null);
  };

  out("Ensō doctor");
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    const text = unsupportedText(platform);
    out(`✗ ${text}`);
    out("    Requirements: https://enso.wicker.life/docs/install#requirements · Follow along: https://github.com/davidwickerhf/enso");
    return { ok: false, results: [{ label: "Platform", ok: false, detail: text }] };
  }
  // 1. Manifests (Windows: the registry key first, then the file it names)
  let manifests;
  if (platform === "win32") {
    const reg = registryManifest();
    add("Registry key", reg.file ? { ok: true, detail: `${reg.key} → ${reg.file}` } : { ok: false, detail: reg.error, fix: REINSTALL });
    manifests = reg.file ? [{ label: "Manifest", file: reg.file, ...checkManifest(reg.file, extensionId) }] : [];
  } else {
    manifests = manifestPaths(home, platform).map(m => ({ ...m, ...checkManifest(m.file, extensionId) }));
  }
  // An optional manifest (Linux ~/.zen) that is missing is a note, not a failure.
  for (const m of manifests) add(m.label, m.optional && !m.ok && !existsSync(m.file) ? { ...m, ok: null, detail: `${m.detail}; not read by Zen yet, written for later` } : m);

  // 2. run.sh's Node (from the first manifest that points at something readable)
  const runSh = manifests.map(m => m.manifest?.path).find(p => p && existsSync(p));
  let parsed = { node: null, host: null };
  if (runSh) {
    try {
      parsed = parseRunSh(readFileSync(runSh, "utf8"));
    } catch {}
    add("Node", checkNode(parsed.node));
  } else {
    add("Node", { ok: false, detail: "no run.sh to read (see the manifests above)", fix: REINSTALL });
  }

  // The log as it was before the test start below adds its own lines.
  const file = logFile({ ...env, HOME: home });
  const lines = tailLines(file, logLines);

  // 3. The helper answers hello
  if (runSh) {
    const version = parsed.host ? readVersion(path.dirname(parsed.host)) : null;
    const r = await checkHello(runSh, { manifestFile: manifests.find(m => m.manifest?.path === runSh)?.file, extensionId, env, timeoutMs: helloTimeoutMs });
    add("Helper", { ...r, detail: r.ok ? `${version ? `${version} ` : ""}${r.detail} in ${(r.ms / 1000).toFixed(1)} s` : r.detail });
  } else {
    add("Helper", { ok: false, detail: "not checked: nothing to start", fix: REINSTALL });
  }

  // 4. MCP port
  const p = await checkPort(port);
  add(`MCP port ${port}`, { ok: p.state === "enso" ? true : p.state === "free" ? null : false, detail: p.detail, fix: p.fix });

  // 5. Secrets
  try {
    const si = secretsInfo({ env, platform });
    add("Secrets", { ok: si.secure ? true : null, detail: si.secure ? `kept in ${si.location}` : si.warning ?? `kept in ${si.location}` });
  } catch {}

  // 6. The log (read before the test start)
  out("");
  if (!lines.length) out(`No ${tilde(file)} yet: the helper hasn't started since it was updated to a version that writes one (run the installer again).`);
  else {
    out(`Last ${lines.length} lines of ${tilde(file)}:`);
    for (const l of lines) out(`  ${l}`);
  }

  // Windows: run.cmd keeps what the helper printed before its own log started.
  const stderrFile = path.join(path.dirname(file), "helper-stderr.log");
  if (platform === "win32" && existsSync(stderrFile)) {
    const errLines = tailLines(stderrFile, 15);
    if (errLines.length) {
      out("");
      out(`Last ${errLines.length} lines of ${tilde(stderrFile)} (the helper's last start):`);
      for (const l of errLines) out(`  ${l}`);
    }
  }

  const ok = results.every(r => r.ok !== false);
  out("");
  out(ok ? "Everything Ensō needs looks fine. If Ensō still says the helper stopped, send the log above (or Copy diagnostics in Ensō)." : `Something needs fixing (✗ above). Still stuck? Send this output and ${tilde(file)}.`);
  return { ok, results };
}

function readVersion(dir) {
  for (const f of ["VERSION", "package.json"]) {
    try {
      const raw = readFileSync(path.join(dir, f), "utf8");
      return f === "VERSION" ? raw.trim() : JSON.parse(raw).version;
    } catch {}
  }
  return null;
}
