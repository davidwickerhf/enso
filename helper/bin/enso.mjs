#!/usr/bin/env node
// The `enso` command (installed as ~/Library/Application Support/Enso/bin/enso).
//
//   enso mcp [--read-only] [--client <label>]   stdio MCP server for clients to spawn (forwards to Zen)
//   enso mcp install [--client claude|codex|cursor|all] [--read-only]
//   enso mcp uninstall [--client …]
//   enso mcp status
//   enso mcp rotate                              new tokens (launcher clients keep working)
//
// Nothing here prints a token or a config value.

import { existsSync } from "node:fs";
import { readToken, rotateTokens } from "../lib/mcpauth.mjs";

const USAGE = `Usage:
  enso mcp [--read-only] [--client <label>]    run the zen-browser MCP server over stdio (what MCP clients start)
  enso mcp install [--client claude|codex|cursor|all] [--read-only]
                                               register it with Claude Code, Codex and/or Cursor (default: all found)
  enso mcp uninstall [--client claude|codex|cursor|all]
  enso mcp status                              is Zen's helper reachable, and which clients are registered
  enso mcp rotate                              replace the tokens (clients using \`enso mcp\` keep working)`;

function parseFlags(argv) {
  const flags = { readOnly: false, client: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--read-only") flags.readOnly = true;
    else if (a === "--client") flags.client = argv[++i];
    else if (a.startsWith("--client=")) flags.client = a.slice(9);
    else if (a === "-h" || a === "--help") flags.help = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return flags;
}

function printResults(results, verb) {
  if (!results.length) console.log(`No MCP clients found to ${verb} (looked for Claude Code, ~/.codex and ~/.cursor). Pass --client to choose one.`);
  for (const r of results) {
    const name = { claude: "Claude Code", codex: "Codex", cursor: "Cursor" }[r.client];
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

async function main(argv) {
  const [cmd, sub, ...rest] = argv;
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
      const results = m.install({ client: flags.client ?? "all", readOnly: flags.readOnly, log: s => console.log(s) });
      const ok = printResults(results, "register with");
      if (results.some(r => r.ok && r.changes.length)) console.log("Restart those clients (or start a new session) to pick it up.");
      return ok ? 0 : 1;
    }
    case "uninstall":
      return printResults(m.uninstall({ client: flags.client ?? "all" }), "remove from") ? 0 : 1;
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
