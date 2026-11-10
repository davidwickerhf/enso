// Finds the user's installed Claude Code CLI. The subscription engine runs on
// it through the Agent SDK's pathToClaudeCodeExecutable, so the helper doesn't
// have to ship the SDK's own ~200 MB platform binary (the release tarball is
// built with --omit=optional).
//
// Order: ENSO_CLAUDE_PATH, the claudePath setting (settings.json, then
// config.local.json), PATH, then the usual install locations.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { claudeCandidates, currentPlatform, isExecutable } from "./platform.mjs";

const home = homedir();
const WIN = currentPlatform() === "win32";
export const INSTALL_URL = "https://docs.anthropic.com/en/docs/claude-code/setup";
const KNOWN = claudeCandidates();
const NAMES = WIN ? ["claude.exe", "claude.cmd"] : ["claude"];

const executable = file => isExecutable(file);

/** npm's claude.cmd shim on Windows can't be started without a shell: use the cli.js it points at. */
function npmShimTarget(file) {
  if (!/\.cmd$/i.test(file)) return null;
  const js = path.join(path.dirname(file), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  return existsSync(js) ? js : null;
}

function version(file) {
  try {
    const js = npmShimTarget(file);
    const [cmd, args] = js ? [process.execPath, [js, "--version"]] : [file, ["--version"]];
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000, windowsHide: true }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

/** Candidate paths in order, without duplicates. */
export function candidates(configured = []) {
  const fromPath = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean).flatMap(d => NAMES.map(n => path.join(d, n)));
  return [...new Set([...configured.filter(Boolean).map(p => p.replace(/^~(?=[\\/])/, home)), ...fromPath, ...KNOWN])];
}

let cached = null;

/**
 * { found: true, path, version } or { found: false, reason }.
 * A miss is re-checked on the next call (the user may have just installed it);
 * a hit is kept until the path stops working.
 */
export function findClaude(configured = []) {
  const key = JSON.stringify(configured);
  if (cached?.found && cached.key === key && executable(cached.path)) return cached;
  for (const file of candidates(configured)) {
    if (!executable(file)) continue;
    const v = version(file);
    if (!v) continue;
    // npm installs link `claude` to cli.js, which the SDK runs with node when given the .js path.
    // The native installer links to a versioned binary that auto-updates replace, so keep the link.
    let real = npmShimTarget(file) ?? file;
    if (real === file) try {
      const target = realpathSync(file);
      if (/\.[cm]?js$/.test(target)) real = target;
    } catch {}
    cached = { found: true, path: real, version: v, key };
    return cached;
  }
  const explicit = configured.find(Boolean);
  cached = {
    found: false,
    key,
    reason: explicit
      ? `Claude Code was not found at ${explicit} (the claudePath setting). Fix the path, or remove it to search the usual places.`
      : `Claude Code isn't installed (looked on your PATH, in ~/.local/bin, ~/.claude/local${WIN ? " and npm" : " and Homebrew"}). Install it from ${INSTALL_URL}, run \`claude\` once to sign in, then reopen Ensō. Or switch to an API key in Settings.`,
  };
  return cached;
}
