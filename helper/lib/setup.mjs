// Setup: what the Setup checklist in Ensō (Settings → Setup) and `enso setup`
// show, and the one-click actions behind its buttons. The checks and actions
// are the same functions the CLI uses (`enso mcp install`, `enso t3 connect`,
// `enso mcp rotate`…), so everything stays possible from a terminal.
//
//   status()               → SetupStatus (docs/PROTOCOL.md "Setup")
//   run(step, options)     → { step, ok, message?, error?, restart? }
//
// Steps (SETUP_STEPS): helper.update, engine.login, engine.install,
// engine.apiKey {key}, engine.forgetApiKey, agents.register {client, readOnly},
// agents.unregister {client}, agents.readOnly {readOnly}, agents.hook {on},
// t3.connect, t3.disconnect, github.login, github.token {token}, github.forget,
// mcp.rotate.
//
// Secrets (an API key, a GitHub token) go from the UI's password field to the
// Keychain through `security -i` on stdin. They are never logged, returned,
// written to a file or put on a command line, and errors never quote them.
//
// Terminal steps (signing in to Claude Code or gh, installing Claude Code)
// write a small .command file under <data>/run and open it with Terminal
// (`open -a Terminal`): no Automation permission is needed, and the user sees
// exactly what runs. Only these fixed commands can be opened; the UI can't
// pass a command of its own.
//
// Everything is injectable so tests run against a temporary HOME with fakes.

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir as defaultDataDir, rotateTokens } from "./mcpauth.mjs";
import * as mcpinstall from "./mcpinstall.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SITE = "https://enso.wicker.life";
export const CLAUDE_INSTALL_COMMAND = "curl -fsSL https://claude.ai/install.sh | bash";
export const SETUP_STEPS = [
  "helper.update",
  "engine.login",
  "engine.install",
  "engine.apiKey",
  "engine.forgetApiKey",
  "agents.register",
  "agents.unregister",
  "agents.readOnly",
  "agents.hook",
  "t3.connect",
  "t3.disconnect",
  "github.login",
  "github.token",
  "github.forget",
  "mcp.rotate",
];
const LATEST_TTL_MS = 30 * 60_000;
const API_KEY = /^sk-ant-[A-Za-z0-9_-]{20,200}$/;

/** Single-quote for bash. */
export const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Compare dotted versions: -1, 0, 1 (missing parts count as 0, suffixes ignored). */
export function compareVersions(a, b) {
  const pa = String(a ?? "").replace(/^v/, "").split(/[.+-]/).map(n => Number.parseInt(n, 10) || 0);
  const pb = String(b ?? "").replace(/^v/, "").split(/[.+-]/).map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  return 0;
}

/** Run a program; resolves { code, stdout, stderr } (code 127 when it can't start). */
export function runFile(file, args = [], { input, timeout = 15_000, env = process.env } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(file, args, { env, stdio: [input == null ? "ignore" : "pipe", "pipe", "pipe"] });
    } catch {
      return resolve({ code: 127, stdout: "", stderr: "" });
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", d => (stdout += d));
    child.stderr.on("data", d => (stderr += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr });
    });
    child.on("close", code => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
  });
}

/** The Anthropic API key in the login Keychain (service from config.json, account "enso"). Only `-i` on stdin ever sees the value. */
export function keychainApiKeyStore({ service = "enso-anthropic", legacy = [], run = runFile } = {}) {
  const SAFE = /^[A-Za-z0-9._~-]+$/;
  if (!SAFE.test(service)) throw new Error("Bad Keychain service name");
  const removeAll = async () => {
    for (let i = 0; i < 10; i++) if ((await run("/usr/bin/security", ["delete-generic-password", "-s", service])).code !== 0) break;
  };
  return {
    /** Is there a key? Uses no -w, so the value never reaches this process. */
    async has() {
      for (const s of [service, ...legacy]) if ((await run("/usr/bin/security", ["find-generic-password", "-s", s])).code === 0) return true;
      return false;
    },
    async save(key) {
      await removeAll();
      await run("/usr/bin/security", ["-i"], { input: `add-generic-password -U -s ${service} -a enso -l "Enso Anthropic API key" -w ${key}\n` });
      if ((await run("/usr/bin/security", ["find-generic-password", "-s", service])).code !== 0) throw new Error("The Keychain did not store the key.");
    },
    async remove() {
      await removeAll();
    },
  };
}

/** Write <dir>/<name>.command and open it in Terminal. */
async function defaultOpenInTerminal(file) {
  const r = await runFile("/usr/bin/open", ["-a", "Terminal", file], { timeout: 10_000 });
  if (r.code !== 0) throw new Error("Couldn't open Terminal.");
}

/** Download install.sh from the site and run it (non-interactive, no Zen tab opened). Output goes to <data>/logs/update.log. */
async function defaultRunInstaller({ site, dataDir, fetchImpl, env }) {
  const res = await fetchImpl(`${site}/install.sh`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Couldn't download the installer (${res.status}).`);
  const script = await res.text();
  if (!script.startsWith("#!")) throw new Error("The installer download looks wrong; nothing was changed.");
  const logs = path.join(dataDir, "logs");
  mkdirSync(logs, { recursive: true });
  const r = await runFile("/bin/bash", ["-s"], { input: script, timeout: 10 * 60_000, env: { ...env, ENSO_SITE: site, ENSO_NO_OPEN: "1", ENSO_REGISTER_MCP: "0", ENSO_FROM_HELPER: "1" } });
  writeFileSync(path.join(logs, "update.log"), `${new Date().toISOString()} exit ${r.code}\n${r.stdout}\n${r.stderr}`, { mode: 0o600 });
  if (r.code !== 0) {
    const last = `${r.stderr}\n${r.stdout}`.split("\n").map(l => l.replace(/\x1b\[[0-9;]*m/g, "").trim()).filter(Boolean).pop() ?? "";
    throw new Error(`The installer stopped${last ? `: ${last.slice(0, 200)}` : ""}. Details in ${path.join(logs, "update.log")}.`);
  }
  return { log: path.join(logs, "update.log") };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Is T3 Code on this Mac (its CLI, or the app)? */
function t3Installed(env, apps = "/Applications") {
  const home = env.HOME ?? "";
  const cli = [env.T3CODE_CLI_PATH, path.join(env.T3CODE_HOME || path.join(home, ".t3"), "bin", "t3")].filter(Boolean).some(p => existsSync(p));
  if (cli) return true;
  try {
    return readdirSync(apps).some(n => /^T3 Code.*\.app$/.test(n));
  } catch {
    return false;
  }
}

/** Find a program on PATH, or null (the helper adds Homebrew and ~/.local/bin to its PATH). */
function which(name, env) {
  for (const d of String(env.PATH ?? "").split(":").filter(Boolean)) if (existsSync(path.join(d, name))) return path.join(d, name);
  return null;
}

export { defaultRunInstaller as runInstaller };

export function createSetup({
  env = process.env,
  dataDir = defaultDataDir(),
  helperDir = path.resolve(here, ".."),
  site = env.ENSO_SITE || DEFAULT_SITE,
  fetch: fetchImpl = globalThis.fetch,
  run = runFile,
  claude, // () => { found, path?, version?, reason? }
  apiKeys, // { has(), save(key), remove() }
  onApiKeyChange = () => {},
  github, // { status({fresh}), saveToken(token), forget() }
  t3, // createT3() instance
  mcp = mcpinstall,
  rotate = () => rotateTokens(dataDir),
  getSettings = () => readJson(path.join(dataDir, "settings.json")) ?? {},
  servers = () => [],
  mcpListening = () => null,
  mcpPort = 47823,
  applicationsDir = env.ENSO_APPLICATIONS_DIR || "/Applications", // where T3 Code.app is looked for (tests point it elsewhere)
  openInTerminal = defaultOpenInTerminal,
  runInstaller = defaultRunInstaller,
  now = Date.now,
} = {}) {
  let latest = { at: 0, value: null, error: null };

  function helperVersion() {
    const v = (() => {
      try {
        return readFileSync(path.join(helperDir, "VERSION"), "utf8").trim();
      } catch {
        return null;
      }
    })();
    const pkg = readJson(path.join(helperDir, "package.json"));
    // A release has VERSION (install.sh, pack-helper.sh); a checkout (scripts/dev.sh) doesn't.
    return { version: v || pkg?.version || null, dev: !v };
  }

  async function latestRelease(fresh) {
    if (!fresh && latest.at && now() - latest.at < LATEST_TTL_MS) return latest;
    try {
      const res = await fetchImpl(`${site}/api/latest`, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const j = await res.json();
      latest = { at: now(), value: j?.helper?.version ?? null, error: null };
    } catch (err) {
      latest = { at: now(), value: latest.value, error: `Couldn't check for updates (${String(err.message ?? err).slice(0, 80)}).` };
    }
    return latest;
  }

  async function claudeStatus() {
    const c = claude?.() ?? { found: false, reason: "Claude Code wasn't found." };
    if (!c.found) return { found: false, reason: c.reason ?? null, installCommand: CLAUDE_INSTALL_COMMAND };
    const out = { found: true, path: c.path, version: c.version ?? null, loggedIn: null, authMethod: null, subscriptionType: null, email: null };
    // `claude auth status --json` prints JSON whether or not you are signed in. Only these fields are kept.
    const r = await run(c.path, ["auth", "status", "--json"], { timeout: 10_000, env });
    try {
      const j = JSON.parse(r.stdout);
      out.loggedIn = !!j.loggedIn;
      out.authMethod = typeof j.authMethod === "string" ? j.authMethod : null;
      out.subscriptionType = typeof j.subscriptionType === "string" ? j.subscriptionType : null;
      out.email = typeof j.email === "string" ? j.email : null;
    } catch {
      out.loggedIn = null; // an older Claude Code without `auth status`: unknown
    }
    return out;
  }

  function agentsStatus() {
    const detected = mcp.detectClients();
    const reg = mcp.registrations();
    const clients = mcp.CLIENTS.map(id => ({ id, name: mcp.CLIENT_NAMES[id], detected: !!detected[id], registration: reg[id] ?? null }));
    const registered = clients.filter(c => c.registration);
    return {
      launcher: mcp.launcherPath(dataDir),
      clients,
      readOnly: registered.length > 0 && registered.every(c => c.registration === "launcher-read"),
      hook: !!reg.claudeHook,
    };
  }

  async function t3Status() {
    const installed = t3Installed(env, applicationsDir);
    // Not installed: nothing to check (no Keychain read, no network).
    if (!t3 || !installed) return { installed, connected: false, reachable: false, tokenValid: null, error: null };
    const st = await t3.status().catch(err => ({ error: String(err.message ?? err) }));
    return { installed, connected: !!st.connected, reachable: !!st.reachable, tokenValid: st.tokenValid ?? null, serverVersion: st.serverVersion ?? null, error: st.error ?? null };
  }

  async function githubStatus(fresh) {
    const ghPath = which("gh", env);
    const st = github ? await github.status({ fresh }).catch(err => ({ connected: false, error: String(err.message ?? err) })) : { connected: false };
    return { ghInstalled: !!ghPath, connected: !!st.connected, login: st.login ?? null, via: st.via ?? null, error: st.connected ? null : st.error && st.error !== "no token" ? st.error : null };
  }

  function toolsStatus() {
    const list = servers() ?? [];
    const on = list.filter(s => s.enabled !== false);
    return { total: list.length, on: on.length, needsAuth: on.filter(s => s.status === "needs-auth").length };
  }

  async function status({ fresh = false } = {}) {
    const { version, dev } = helperVersion();
    const rel = dev ? { value: null, error: null } : await latestRelease(fresh);
    const install = readJson(path.join(dataDir, "install.json"));
    const runtimeDir = path.join(dataDir, "runtime");
    const settings = getSettings() ?? {};
    const [claudeSt, apiStored, t3St, ghSt] = await Promise.all([
      claudeStatus(),
      apiKeys ? apiKeys.has().catch(() => false) : false,
      t3Status(),
      githubStatus(fresh),
    ]);
    return {
      checkedAt: new Date(now()).toISOString(),
      helper: {
        version,
        dev,
        latest: rel.value,
        updateAvailable: !dev && !!rel.value && !!version && compareVersions(version, rel.value) < 0,
        error: rel.error,
        node: { path: process.execPath, version: process.versions.node, source: process.execPath.startsWith(runtimeDir + path.sep) ? "private" : "system" },
        installedAt: install?.installedAt ?? null,
      },
      engine: {
        selected: settings.engine ?? "subscription",
        subscription: claudeSt,
        api: { stored: !!env.ANTHROPIC_API_KEY || !!apiStored, source: env.ANTHROPIC_API_KEY ? "environment" : apiStored ? "keychain" : null },
      },
      agents: agentsStatus(),
      t3: t3St,
      github: ghSt,
      tools: toolsStatus(),
      mcp: { port: mcpPort, listening: mcpListening() },
    };
  }

  async function terminal(name, title, commandLine) {
    const dir = path.join(dataDir, "run");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${name}.command`);
    const body = [
      "#!/bin/bash",
      `# Written by Ensō (Settings → Setup): ${title}`,
      "clear",
      `printf '\\033[1mEnsō: %s\\033[0m\\n\\n$ %s\\n\\n' ${shellQuote(title)} ${shellQuote(commandLine)}`,
      commandLine,
      "status=$?",
      "echo",
      'if [ "$status" -eq 0 ]; then echo "Done. Go back to Zen: Ensō checks again by itself."; else echo "That did not finish (exit $status). Close this window and try again from Ensō."; fi',
      "",
    ].join("\n");
    writeFileSync(file, body, { mode: 0o700 });
    chmodSync(file, 0o700);
    await openInTerminal(file);
    return file;
  }

  const ok = (step, message, extra = {}) => ({ step, ok: true, message, ...extra });
  const fail = (step, error) => ({ step, ok: false, error });

  /** One action. Never throws; errors come back as { ok: false, error }. */
  async function runStep(step, options = {}) {
    options = options && typeof options === "object" ? options : {};
    try {
      switch (step) {
        case "helper.update": {
          const { version, dev } = helperVersion();
          if (dev) return fail(step, "This helper runs from a checkout (scripts/dev.sh). Update it with git pull, then quit and reopen Zen.");
          await runInstaller({ site, dataDir, fetchImpl, env });
          const after = helperVersion().version;
          return ok(step, after && after !== version ? `Updated to ${after}. Restarting the helper…` : "Reinstalled. Restarting the helper…", { restart: true });
        }
        case "engine.login": {
          const c = claude?.();
          if (!c?.found) return fail(step, "Claude Code isn't installed yet. Install it first.");
          await terminal("claude-login", "sign in to Claude Code", `${shellQuote(c.path)} auth login`);
          return ok(step, "Terminal is open: follow the sign-in there, then come back.");
        }
        case "engine.install":
          await terminal("claude-install", "install Claude Code", `${CLAUDE_INSTALL_COMMAND} && "$HOME/.local/bin/claude" auth login`);
          return ok(step, "Terminal is open: it installs Claude Code, then asks you to sign in.");
        case "engine.apiKey": {
          const key = String(options.key ?? "").trim();
          if (!API_KEY.test(key)) return fail(step, "That doesn't look like an Anthropic API key (it starts with sk-ant-).");
          let checked = false;
          try {
            const res = await fetchImpl("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(10_000) });
            if (res.status === 401 || res.status === 403) return fail(step, "Anthropic didn't accept this key.");
            checked = res.ok;
          } catch {}
          if (!apiKeys) return fail(step, "No Keychain available.");
          await apiKeys.save(key);
          onApiKeyChange();
          return ok(step, checked ? "Saved to your Keychain. The key works." : "Saved to your Keychain. (Couldn't reach Anthropic to check it now.)");
        }
        case "engine.forgetApiKey":
          if (apiKeys) await apiKeys.remove();
          onApiKeyChange();
          return ok(step, "Removed the key from your Keychain.");
        case "agents.register": {
          const client = String(options.client ?? "");
          if (!mcp.CLIENTS.includes(client)) return fail(step, "Unknown client.");
          const readOnly = options.readOnly === undefined ? agentsStatus().readOnly : !!options.readOnly;
          const [r] = mcp.install({ client, readOnly, dir: dataDir });
          return r?.ok ? ok(step, `${mcp.CLIENT_NAMES[client]} can use Zen${readOnly ? " (read only)" : ""}. Start a new session there to pick it up.`) : fail(step, `${mcp.CLIENT_NAMES[client]}: ${r?.note ?? "not changed"}`);
        }
        case "agents.unregister": {
          const client = String(options.client ?? "");
          if (!mcp.CLIENTS.includes(client)) return fail(step, "Unknown client.");
          const [r] = mcp.uninstall({ client });
          return r?.ok ? ok(step, `Removed zen-browser from ${mcp.CLIENT_NAMES[client]}.`) : fail(step, `${mcp.CLIENT_NAMES[client]}: ${r?.note ?? "not changed"}`);
        }
        case "agents.readOnly": {
          const readOnly = !!options.readOnly;
          const registered = agentsStatus().clients.filter(c => c.registration === "launcher" || c.registration === "launcher-read" || c.registration === "http");
          const bad = [];
          for (const c of registered) {
            const [r] = mcp.install({ client: c.id, readOnly, dir: dataDir });
            if (!r?.ok) bad.push(`${c.name}: ${r?.note ?? "not changed"}`);
          }
          if (bad.length) return fail(step, bad.join("; "));
          return ok(step, registered.length ? `${readOnly ? "Read only" : "Full access"} for ${registered.map(c => c.name).join(", ")}.` : `New registrations will be ${readOnly ? "read only" : "full access"}.`, { readOnly });
        }
        case "agents.hook": {
          const r = mcp.setHook(!!options.on, { dir: dataDir });
          return r?.ok ? ok(step, options.on ? "Claude Code gets screenshots and notes with your next message." : "Removed the Claude Code hook.") : fail(step, r?.note ?? "not changed");
        }
        case "t3.connect":
          if (!t3) return fail(step, "T3 Code isn't available.");
          await t3.connect();
          return ok(step, "Connected to T3 Code.");
        case "t3.disconnect": {
          if (!t3) return fail(step, "T3 Code isn't available.");
          // Works even when T3 Code was removed: the stored token still gets deleted.
          const r = await t3.disconnect();
          return ok(step, r?.revoked ? "Revoked Ensō's T3 session." : "Deleted the token (T3 Code wasn't running to revoke it).");
        }
        case "github.login": {
          const gh = which("gh", env);
          if (!gh) return fail(step, "The GitHub CLI (gh) isn't installed. Install it from cli.github.com, or paste a token instead.");
          await terminal("gh-login", "sign in to GitHub", `${shellQuote(gh)} auth login --hostname github.com --git-protocol https --web`);
          return ok(step, "Terminal is open: follow the GitHub sign-in there, then come back.");
        }
        case "github.token": {
          if (!github) return fail(step, "GitHub isn't available.");
          const { login } = await github.saveToken(options.token);
          return ok(step, `Signed in to GitHub as ${login}.`);
        }
        case "github.forget":
          if (github) await github.forget();
          return ok(step, "Removed Ensō's GitHub token from your Keychain.");
        case "mcp.rotate":
          rotate();
          return ok(step, "New tokens written. Agents started with enso mcp keep working.");
        default:
          return fail(step, `Unknown setup step: ${String(step).slice(0, 40)}`);
      }
    } catch (err) {
      // Never echo options (they may hold a key or token).
      const text = String(err?.message ?? err).replace(/sk-ant-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g, "[hidden]");
      return fail(step, text.slice(0, 300));
    }
  }

  return { status, run: runStep, helperVersion };
}
