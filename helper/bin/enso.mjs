#!/usr/bin/env node
// The `enso` command (installed as ~/Library/Application Support/Enso/bin/enso).
//
//   enso mcp [--read-only] [--client <label>]   stdio MCP server for clients to spawn (forwards to Zen)
//   enso mcp install [--client claude|codex|cursor|all] [--read-only]
//   enso mcp uninstall [--client …]
//   enso mcp status
//   enso mcp rotate                              new tokens (launcher clients keep working)
//   enso mcp install --hooks                     also add Claude Code's UserPromptSubmit hook (below)
//   enso inbox --session-env                     the hook: prints what the user sent this agent
//   enso t3 connect | status | disconnect        Ensō's scoped token for T3 Code (Keychain)
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
  enso t3 disconnect                           revoke the token and delete it from the Keychain`;

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
  const { execFileSync } = await import("node:child_process");
  const { launcherUrl, t3ThreadFromEnv } = await import("../lib/mcplauncher.mjs");
  // Claude Code runs the hook through a shell: our ancestors include the Claude Code
  // process that also started `enso mcp`, whose launcher told Ensō its parent pid.
  const pids = [];
  let pid = process.ppid;
  for (let i = 0; i < 6 && pid > 1; i++) {
    pids.push(pid);
    try {
      pid = Number.parseInt(execFileSync("/bin/ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8", timeout: 1000 }).trim(), 10);
    } catch {
      break;
    }
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

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "t3") return t3Command(sub);
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
