#!/usr/bin/env node
// The `enso` command (installed as <data>/bin/enso, or <data>\bin\enso.cmd on
// Windows; the data folder per OS is in lib/platform.mjs).
//
//   enso mcp [--read-only] [--client <label>]   stdio MCP server for clients to spawn (forwards to Zen)
//   enso mcp install [--client claude|codex|cursor|all] [--read-only]
//   enso mcp uninstall [--client …]
//   enso mcp status
//   enso mcp rotate                              new tokens (launcher clients keep working)
//   enso mcp install --hooks                     also add Claude Code's UserPromptSubmit hook (below)
//   enso inbox --session-env                     the hook: prints what the user sent this agent
//   enso t3 connect | status | disconnect        Ensō's scoped token for T3 Code (Keychain)
//   enso setup [--json]                          the Setup checklist (what Settings → Setup shows)
//   enso update                                  run the installer again (Setup → Update helper)
//   enso doctor                                  why the helper doesn't start: manifests, Node, hello, port, log
//
// Nothing here prints a token or a config value.

import { existsSync } from "node:fs";
import { readToken, rotateTokens } from "../lib/mcpauth.mjs";

const USAGE = `Usage:
  enso mcp [--read-only] [--client <label>]    run the zen-browser MCP server over stdio (what MCP clients start)
  enso mcp install [--client claude|codex|cursor|opencode|all] [--read-only] [--hooks]
                                               register it with Claude Code, Codex, Cursor and/or OpenCode (default: all found)
  enso mcp uninstall [--client claude|codex|cursor|opencode|all]
  enso mcp status                              is Zen's helper reachable, and which clients are registered
  enso mcp rotate                              replace the tokens (clients using \`enso mcp\` keep working)
  enso mcp install --hooks                     also add a Claude Code hook: screenshots sent to an idle session
                                               arrive with your next message
  enso inbox --session-env                     (run by that hook) print what the user sent this agent
  enso t3 connect                              give Ensō a T3 Code token (orchestration read + operate, 30 days)
  enso t3 status                               is T3 Code reachable, and does Ensō's token work
  enso t3 disconnect                           revoke the token and delete it from the Keychain
  enso runner enroll [--url <anvil-url>]       enroll this laptop as an Anvil browser runner (keyring required)
  enso runner status                           show Anvil laptop runner enrollment and ceiling status
  enso runner allow <site> [<site>...]         add a site (or *.domain) to Anvil's local allowed_sites ceiling
  enso runner disallow <site> [<site>...]      remove a site from Anvil's local allowed_sites ceiling
  enso runner allow-approved <on|off>          accept any non-private site passkey-approved in Anvil
  enso runner disconnect                       revoke the Anvil runner token and delete it from the keyring
  enso setup [--json]                          what's set up and what isn't (the same checks as Ensō → Settings → Setup)
  enso update                                  download and run the installer again (updates the helper; quit and reopen Zen after)
  enso doctor                                  check why Ensō's helper doesn't start (manifests, Node, a test start, the MCP port,
                                               and the end of ~/Library/Logs/Enso/helper.log)`;

function parseFlags(argv) {
  const flags = { readOnly: false, client: undefined, help: false, hooks: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--read-only") flags.readOnly = true;
    else if (a === "--hooks") flags.hooks = true;
    else if (a === "--client") flags.client = argv[++i];
    else if (a.startsWith("--client=")) flags.client = a.slice(9);
    else if (a === "-h" || a === "--help") flags.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return flags;
}

function printResults(results, verb) {
  if (!results.length) console.log(`No MCP clients found to ${verb} (looked for Claude Code, ~/.codex, ~/.cursor and ~/.config/opencode). Pass --client to choose one.`);
  for (const r of results) {
    const name = { claude: "Claude Code", codex: "Codex", cursor: "Cursor", opencode: "OpenCode", "claude-hooks": "Claude Code hook" }[r.client];
    if (!r.ok) console.log(`${name}: not changed (${r.note})`);
    else if (!r.changes.length) console.log(`${name}: nothing to change${r.note ? ` (${r.note})` : ""}`);
    else {
      console.log(`${name}:${r.file ? ` ${r.file}` : ""}`);
      for (const c of r.changes) console.log(`  - ${c}`);
      if (r.backup) console.log(`  backup: ${r.backup}`);
    }
  }
  return results.every(r => r.ok);
}

/** `enso t3 …`: never prints the token. */
async function t3Command(sub) {
  const { createT3 } = await import("../lib/t3.mjs");
  const t3 = createT3();
  const show = st => {
    console.log(`T3 Code:   ${st.reachable ? `running at ${st.origin}${st.serverVersion ? ` (${st.serverVersion})` : ""}` : `not reachable at ${st.origin}`}`);
    console.log(`CLI:       ${st.cli ? "found" : "not found (open T3 Code once to install ~/.t3/bin/t3)"}`);
    console.log(`Token:     ${!st.connected ? "none (run `enso t3 connect`)" : st.tokenValid === true ? `works${st.expiresAt ? `, expires ${st.expiresAt}` : ""}` : st.tokenValid === false ? "rejected (expired or revoked: run `enso t3 connect`)" : "stored (couldn't check)"}`);
    if (st.connected) console.log(`Route:     ${st.route === "attachment" ? "image attachments" : "PNG saved on disk, path sent as text"}`);
  };
  switch (sub) {
    case "connect":
      show(await t3.connect());
      return 0;
    case "disconnect": {
      const st = await t3.disconnect();
      console.log(st.revoked ? "Revoked Ensō's T3 session and deleted the token." : "Deleted the token (T3 Code wasn't reachable to revoke it; revoke it in T3 Code → Settings → Access, or with `t3 auth session list`).");
      return 0;
    }
    case "status":
    case undefined: {
      const st = await t3.status();
      show(st);
      return st.connected && st.tokenValid === false ? 1 : 0;
    }
    default:
      console.log(USAGE);
      return 2;
  }
}

/** The Claude Code UserPromptSubmit hook. Never fails the prompt: any error prints nothing. */
async function inboxCommand() {
  const { parentPid } = await import("../lib/platform.mjs");
  const { launcherUrl, t3ThreadFromEnv } = await import("../lib/mcplauncher.mjs");
  // Claude Code runs the hook through a shell: our ancestors include the Claude Code
  // process that also started `enso mcp`, whose launcher told Ensō its parent pid.
  const pids = [];
  let pid = process.ppid;
  for (let i = 0; i < 6 && pid > 1; i++) {
    pids.push(pid);
    pid = parentPid(pid);
    if (!Number.isFinite(pid)) break;
  }
  try {
    const res = await fetch(launcherUrl().replace(/\/mcp$/, "/inbox"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${readToken("full")}` },
      body: JSON.stringify({ pids, t3Thread: t3ThreadFromEnv() }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return 0;
    const { items } = await res.json();
    if (Array.isArray(items) && items.length) {
      const additionalContext = `The user sent you this from Ensō (their browser) since your last turn:\n${items.join("\n")}`;
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
    }
  } catch {}
  return 0;
}

/** The setup lib with the CLI's own dependencies (no helper state, nothing printed that is secret). */
async function cliSetup() {
  const { createSetup, keychainApiKeyStore } = await import("../lib/setup.mjs");
  const { findClaude } = await import("../lib/claude-cli.mjs");
  const { createT3 } = await import("../lib/t3.mjs");
  const { dataDir } = await import("../lib/mcpauth.mjs");
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const read = f => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      return {};
    }
  };
  const settings = read(path.join(dataDir(), "settings.json"));
  const local = read(path.join(dataDir(), "config.local.json"));
  return createSetup({
    claude: () => findClaude([process.env.ENSO_CLAUDE_PATH, settings.claudePath, local.claudePath]),
    apiKeys: keychainApiKeyStore({ service: local.keychainService || "enso-anthropic", legacy: ["zen-chat-anthropic"] }),
    t3: createT3(),
    getSettings: () => settings,
  });
}

async function setupCommand(flags) {
  const st = await (await cliSetup()).status({ fresh: true });
  if (flags.includes("--json")) {
    console.log(JSON.stringify(st, null, 2));
    return 0;
  }
  const mark = v => (v === true ? "✓" : v === false ? "·" : "!");
  const h = st.helper;
  console.log(`${mark(!h.updateAvailable)} Helper       ${h.version ?? "unknown"}${h.dev ? " (checkout)" : h.updateAvailable ? ` → ${h.latest} available: enso update` : h.latest ? " (up to date)" : ""}, Node ${h.node.version}${h.node.source === "private" ? " (Ensō's own)" : ""}`);
  const sub = st.engine.subscription;
  const engineOk = st.engine.selected === "api" ? st.engine.api.stored : sub.found && sub.loggedIn !== false;
  const engineText = st.engine.selected === "api"
    ? st.engine.api.stored ? `API key in ${st.secrets?.location ?? "the Keychain"}` : `API key: none stored (Settings → Setup, or ${(await import("../lib/secrets.mjs")).addItemHint("enso-anthropic")})`
    : !sub.found ? `Claude Code not found: ${sub.installCommand}` : sub.loggedIn === false ? "Claude Code found, not signed in: claude auth login" : `Claude Code ${sub.version ?? ""}${sub.subscriptionType ? ` (${sub.subscriptionType})` : ""}`;
  console.log(`${mark(engineOk)} Engine       ${engineText}`);
  for (const c of st.agents.clients) {
    if (!c.detected && !c.registration) continue;
    console.log(`${mark(!!c.registration)} ${c.name.padEnd(12)} ${c.registration ? `uses Zen (${c.registration === "launcher-read" ? "read only" : c.registration === "http" ? "old http entry: enso mcp install" : "full"})` : `not registered: enso mcp install --client ${c.id}`}`);
  }
  if (st.agents.clients.some(c => c.id === "claude" && c.registration)) console.log(`${mark(st.agents.hook)} Prompt hook  ${st.agents.hook ? "on" : "off (enso mcp install --hooks)"}`);
  if (st.t3.installed || st.t3.connected) console.log(`${mark(st.t3.connected && st.t3.tokenValid !== false)} T3 Code      ${st.t3.connected ? (st.t3.tokenValid === false ? "token rejected: enso t3 connect" : "connected") : "not connected: enso t3 connect"}`);
  console.log(`${mark(st.github.connected)} GitHub       ${st.github.connected ? `${st.github.login} (${st.github.via})` : st.github.ghInstalled ? "not signed in: gh auth login" : "not connected (install gh, or paste a token in Ensō)"}`);
  return 0;
}

async function updateCommand() {
  const r = await (await cliSetup()).run("helper.update");
  console.log(r.ok ? `${r.message.replace(" Restarting the helper…", "")} Quit and reopen Zen (or press Reconnect in Ensō) to use it.` : r.error);
  return r.ok ? 0 : 1;
}

/** `enso runner enroll | status | allow | disallow | allow-approved | disconnect`: never prints device_code, token or signing_key. */
async function runnerCommand(sub, rest = []) {
  const { readFileSync } = await import("node:fs");
  const { config, reloadConfig } = await import("../lib/config.mjs");
  const { getSettings } = await import("../lib/store.mjs");
  const { resolveAnvilConfig, updateAnvilLocalCeiling } = await import("../lib/anvil-policy.mjs");
  const { createAnvilAuth } = await import("../lib/anvil-auth.mjs");
  const { openUrl } = await import("../lib/platform.mjs");

  const cfg = resolveAnvilConfig(config, getSettings());
  let url = cfg.url;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--url" && rest[i + 1]) url = rest[++i];
    else if (rest[i].startsWith("--url=")) url = rest[i].slice(6);
  }
  const version = (() => {
    for (const f of ["../VERSION", "../package.json"]) {
      try {
        const raw = readFileSync(new URL(f, import.meta.url), "utf8");
        return f.endsWith("VERSION") ? raw.trim() : JSON.parse(raw).version;
      } catch {}
    }
    return "0.5.8.1";
  })();

  switch (sub) {
    case "allow": {
      const sites = rest.filter(a => a && !a.startsWith("-"));
      if (!sites.length) {
        console.error("Usage: enso runner allow <site> [<site>...] (e.g. enso runner allow vercel.com '*.vercel.com')");
        return 2;
      }
      const res = updateAnvilLocalCeiling({ addSites: sites });
      if (res.added.length) console.log(`Allowed:   ${res.added.join(", ")}`);
      if (res.alreadyPresent.length) console.log(`Already:   ${res.alreadyPresent.join(", ")}`);
      console.log(`Sites:     ${res.allowed_sites.length ? res.allowed_sites.join(", ") : "(none)"}`);
      console.log("Saved to config.local.json (applies without restarting Zen).");
      return 0;
    }
    case "disallow": {
      const sites = rest.filter(a => a && !a.startsWith("-"));
      if (!sites.length) {
        console.error("Usage: enso runner disallow <site> [<site>...]");
        return 2;
      }
      const res = updateAnvilLocalCeiling({ removeSites: sites });
      if (res.removed.length) console.log(`Removed:   ${res.removed.join(", ")}`);
      if (res.notFound.length) console.log(`Not found: ${res.notFound.join(", ")}`);
      console.log(`Sites:     ${res.allowed_sites.length ? res.allowed_sites.join(", ") : "(none)"}`);
      console.log("Saved to config.local.json (applies without restarting Zen).");
      return 0;
    }
    case "allow-approved": {
      const arg = String(rest[0] ?? "").trim().toLowerCase();
      if (!arg) {
        console.log(`Approved:  ${cfg.allow_approved_sites ? "on" : "off"}`);
        return 0;
      }
      const on = ["on", "true", "1", "yes"].includes(arg);
      const off = ["off", "false", "0", "no"].includes(arg);
      if (!on && !off) {
        console.error("Usage: enso runner allow-approved <on|off>");
        return 2;
      }
      updateAnvilLocalCeiling({ allowApprovedSites: on });
      const next = resolveAnvilConfig(reloadConfig(), getSettings());
      console.log(`Approved:  ${next.allow_approved_sites ? "on (accepting any non-private site passkey-approved in Anvil)" : "off (limited to allowed_sites)"}`);
      console.log("Private sites and page_eval are always refused. Saved to config.local.json (applies without restarting Zen).");
      return 0;
    }
    case "enroll": {
      const auth = createAnvilAuth({ defaultUrl: url, version });
      const started = await auth.startEnroll({ url });
      console.log("");
      console.log("  Anvil laptop browser runner enrollment");
      console.log(`  Code:  ${started.user_code}`);
      console.log(`  Link:  ${started.verification_uri_complete}`);
      console.log("");
      console.log("Open the link signed in to Anvil, confirm the code matches, and approve with your passkey.");
      if (process.env.ENSO_NO_OPEN !== "1") {
        try { openUrl(started.verification_uri_complete); } catch {}
      }
      let interval = started.interval;
      const deadline = Date.now() + (started.expires_in || 600) * 1000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, interval * 1000));
        const res = await auth.pollEnrollOnce({ url: started.url, deviceCode: started.device_code });
        if (res.status === "pending" || res.status === "slow_down") {
          interval = res.interval;
          continue;
        }
        if (res.status === "approved") {
          console.log(`Enrolled as ${res.enrollment.runner.name} (profile ${res.enrollment.profile}).`);
          console.log(`Credentials stored in ${auth.keyring.location()}.`);
          console.log("Keep Zen open with Ensō running to stay online for Anvil.");
          return 0;
        }
        if (res.status === "denied") {
          console.error("Enrollment was denied in Anvil.");
          return 1;
        }
        console.error("Enrollment code expired. Run `enso runner enroll` to start again.");
        return 1;
      }
      console.error("Enrollment timed out. Run `enso runner enroll` to start again.");
      return 1;
    }
    case "disconnect": {
      const auth = createAnvilAuth({ defaultUrl: url, version });
      const r = await auth.disconnect();
      console.log(r.revokedOnServer ? "Disconnected from Anvil and removed runner credentials from the keyring." : "Removed runner credentials from the keyring (Anvil was not reachable to revoke on the server).");
      return 0;
    }
    case "status":
    case undefined: {
      const auth = createAnvilAuth({ defaultUrl: url, version });
      const meta = auth.loadEnrollment();
      const secure = auth.keyring.isSecure();
      console.log(`Keyring:   ${secure ? `${auth.keyring.backendName()} (${auth.keyring.location()})` : "unavailable (plaintext fallback refused for Anvil)"}`);
      if (!meta || meta.revoked) {
        console.log(`Status:    ${meta?.revoked ? meta.revoked_message || "Disconnected (revoked)" : "not enrolled (run `enso runner enroll`)"}`);
      } else {
        console.log(`Status:    enrolled`);
        console.log(`Runner:    ${meta.runner?.name ?? "?"} (id ${meta.runner?.id ?? "?"})`);
        console.log(`Profile:   ${meta.profile ?? "?"}`);
        console.log(`Anvil:     ${meta.url}`);
      }
      console.log(`Control:   ${cfg.external_control}`);
      console.log(`Approved:  ${cfg.allow_approved_sites ? "on (any non-private site approved in Anvil)" : "off (limited to Sites below)"}`);
      console.log(`Sites:     ${cfg.allowed_sites.length ? cfg.allowed_sites.join(", ") : cfg.allow_approved_sites ? "(none listed; allow_approved_sites is on)" : "(none — run `enso runner allow <site>` or `enso runner allow-approved on`)"}`);
      console.log(`Updates:   ${cfg.updates}`);
      return 0;
    }
    default:
      console.log(USAGE);
      return 2;
  }
}

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "t3") return t3Command(sub);
  if (cmd === "runner") return runnerCommand(sub, rest);
  if (cmd === "setup") return setupCommand([sub, ...rest].filter(Boolean));
  if (cmd === "update") return updateCommand();
  if (cmd === "doctor") {
    const { runDoctor } = await import("../lib/doctor.mjs");
    return (await runDoctor()).ok ? 0 : 1;
  }
  if (cmd === "inbox") return inboxCommand();
  if (cmd !== "mcp") {
    console.log(USAGE);
    return cmd === undefined || cmd === "-h" || cmd === "--help" || cmd === "help" ? 0 : 2;
  }
  const isSub = sub && !sub.startsWith("-");
  const flags = parseFlags(isSub ? rest : [sub, ...rest].filter(Boolean));
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  if (!isSub) {
    const { runLauncher } = await import("../lib/mcplauncher.mjs");
    await runLauncher({ scope: flags.readOnly ? "read" : "full", clientLabel: flags.client ?? process.env.ENSO_MCP_CLIENT ?? "" });
    return 0;
  }

  const m = await import("../lib/mcpinstall.mjs");
  switch (sub) {
    case "install": {
      const results = m.install({ client: flags.client ?? "all", readOnly: flags.readOnly, hooks: flags.hooks, log: s => console.log(s) });
      const ok = printResults(results, "register with");
      if (results.some(r => r.ok && r.changes.length)) console.log("Restart those clients (or start a new session) to pick it up.");
      return ok ? 0 : 1;
    }
    case "uninstall":
      return printResults(m.uninstall({ client: flags.client ?? "all", hooks: flags.hooks }), "remove from") ? 0 : 1;
    case "status": {
      const { launcherUrl } = await import("../lib/mcplauncher.mjs");
      const url = launcherUrl();
      const h = await m.helperStatus({ url, token: readToken("full") });
      console.log(`Helper:      ${h.ok ? `reachable at ${url}` : h.note}`);
      console.log(`Launcher:    ${m.launcherPath()}${existsSync(m.launcherPath()) ? "" : " (missing: `enso mcp install` writes it)"}`);
      const reg = m.registrations();
      const describe = k =>
        ({
          launcher: "registered (launcher, full access)",
          "launcher-read": "registered (launcher, read-only)",
          http: "registered over http with the token in its config (run `enso mcp install` to switch to the launcher)",
          other: "registered (unrecognised entry)",
        })[k] ?? "not registered";
      for (const c of m.CLIENTS) console.log(`${m.CLIENT_NAMES[c].padEnd(13)}${describe(reg[c])}`);
      console.log(`${"Prompt hook".padEnd(13)}${reg.claudeHook ? "on (Claude Code gets screenshots with your next message)" : "off (`enso mcp install --hooks` adds it)"}`);
      return 0;
    }
    case "rotate": {
      const files = rotateTokens();
      console.log(`New tokens written to ${files.join(" and ")} (0600).`);
      console.log("Clients started with `enso mcp` keep working. Clients registered over http with a token header need `enso mcp install` (or the new token).");
      console.log("A helper started before this version keeps the old token until you quit and reopen Zen.");
      return 0;
    }
    default:
      console.log(USAGE);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  err => {
    console.error(`enso: ${err.message}`);
    process.exitCode = 1;
  },
);
