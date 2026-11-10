// Everything that differs between macOS, Linux and Windows, in one place.
// Every other module asks here for folders, the browser's files, how to open
// a URL or a terminal, and where agent clients keep their config. No side
// effects on import (the `enso` CLI and the stdio launcher load it too).
//
// Each function takes an optional { platform, env, home } so tests can ask
// "what would this be on Windows?" from any machine. ENSO_PLATFORM overrides
// the detected platform for a whole process (tests only).
//
//                macOS                                 Linux                                   Windows
//   data         ~/Library/Application Support/Enso    $XDG_DATA_HOME/enso (~/.local/share)    %APPDATA%\Enso
//   logs         ~/Library/Logs/Enso                   $XDG_STATE_HOME/enso (~/.local/state)   %LOCALAPPDATA%\Enso\Logs
//   host files   …/Mozilla/NativeMessagingHosts,       ~/.mozilla/native-messaging-hosts,      HKCU\Software\Mozilla\
//                …/zen/NativeMessagingHosts            ~/.zen/native-messaging-hosts           NativeMessagingHosts\enso
//   Zen profile  ~/Library/Application Support/zen     ~/.zen (Flatpak: ~/.var/app/…/.zen)     %APPDATA%\zen
//   secrets      login Keychain (security)             libsecret (secret-tool), else a 0600    Credential Manager
//                                                      file in the data folder                 (PowerShell + CredRead/CredWrite)
//   open a URL   open                                  xdg-open                                rundll32 url.dll,FileProtocolHandler
//   terminal     Terminal (.command file)              x-terminal-emulator, gnome-terminal,    PowerShell in a new console (.ps1)
//                                                      konsole… (else: the command to copy)

import { execFileSync, spawn } from "node:child_process";
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SUPPORTED_PLATFORMS = ["darwin", "linux", "win32"];
export const PLATFORM_NAMES = { darwin: "macOS", linux: "Linux", win32: "Windows" };

/** "darwin" | "linux" | "win32" (or whatever Node reports on anything else). */
export function currentPlatform(env = process.env) {
  return env.ENSO_PLATFORM || process.platform;
}
export const isSupported = (platform = currentPlatform()) => SUPPORTED_PLATFORMS.includes(platform);

/** path.join or path.win32.join, so Windows paths come out right when computed elsewhere (tests). */
const pathFor = platform => (platform === "win32" ? path.win32 : path.posix);

function ctx(o = {}) {
  const env = o.env ?? process.env;
  const platform = o.platform ?? currentPlatform(env);
  // os.homedir() reads HOME on macOS/Linux and USERPROFILE on Windows.
  const home = o.home ?? (platform === "win32" ? env.USERPROFILE || os.homedir() : env.HOME || os.homedir());
  return { env, platform, home, p: pathFor(platform) };
}

// ---------- folders ----------

/** Where Ensō keeps everything it remembers (and the installed helper). ENSO_DATA overrides. */
export function dataDir(o) {
  const { env, platform, home, p } = ctx(o);
  if (env.ENSO_DATA || env.ZEN_CHAT_DATA) return env.ENSO_DATA || env.ZEN_CHAT_DATA;
  if (platform === "darwin") return p.join(home, "Library", "Application Support", "Enso");
  if (platform === "win32") return p.join(env.APPDATA || p.join(home, "AppData", "Roaming"), "Enso");
  return p.join(env.XDG_DATA_HOME || p.join(home, ".local", "share"), "enso");
}

/** The pre-rename data folder (macOS only; Ensō never shipped elsewhere under that name). */
export function legacyDataDir(o) {
  const { platform, home, p } = ctx(o);
  return platform === "darwin" ? p.join(home, "Library", "Application Support", "zen-chat") : "";
}

/** The helper's log folder. ENSO_LOG_DIR overrides; with ENSO_DATA set it is <data>/logs. */
export function logDir(o) {
  const { env, platform, home, p } = ctx(o);
  if (env.ENSO_LOG_DIR) return env.ENSO_LOG_DIR;
  if (env.ENSO_DATA || env.ZEN_CHAT_DATA) return p.join(env.ENSO_DATA || env.ZEN_CHAT_DATA, "logs");
  if (platform === "darwin") return p.join(home, "Library", "Logs", "Enso");
  if (platform === "win32") return p.join(env.LOCALAPPDATA || p.join(home, "AppData", "Local"), "Enso", "Logs");
  return p.join(env.XDG_STATE_HOME || p.join(home, ".local", "state"), "enso");
}

/** The `enso` command inside the data folder: bin/enso, or bin\enso.cmd on Windows. */
export function launcherFile(dir, o) {
  const { platform, p } = ctx(o);
  return p.join(dir, "bin", platform === "win32" ? "enso.cmd" : "enso");
}

/** Where install.sh links `enso` onto the user's PATH (Windows adds <data>\bin to the user PATH instead). */
export function userBinDir(o) {
  const { platform, home, p } = ctx(o);
  return platform === "win32" ? null : p.join(home, ".local", "bin");
}

/** Extra folders the helper puts in front of PATH (Zen starts it with a minimal environment). */
export function extraPath(o) {
  const { env, platform, home, p } = ctx(o);
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    const appdata = env.APPDATA || p.join(home, "AppData", "Roaming");
    return [p.join(home, ".local", "bin"), p.join(appdata, "npm"), p.join(local, "Volta", "bin"), p.join(env.ProgramFiles || "C:\\Program Files", "nodejs"), p.join(env.ProgramFiles || "C:\\Program Files", "GitHub CLI")];
  }
  const common = [p.join(home, ".volta", "bin"), p.join(home, ".local", "bin")];
  if (platform === "darwin") return [...common, "/opt/homebrew/bin", "/usr/local/bin"];
  return [...common, p.join(home, ".npm-global", "bin"), "/home/linuxbrew/.linuxbrew/bin", "/usr/local/bin", "/snap/bin"];
}

/** process.env.PATH with extraPath() in front, without duplicates. */
export function augmentedPath(o) {
  const { env, platform } = ctx(o);
  const sep = platform === "win32" ? ";" : ":";
  const current = (env.PATH ?? env.Path ?? (platform === "win32" ? "" : "/usr/bin:/bin")).split(sep).filter(Boolean);
  return [...new Set([...extraPath(o), ...current])].join(sep);
}

/** Look a program up on PATH (with PATHEXT on Windows). Returns the full path or null. */
export function which(name, o) {
  const { env, platform, p } = ctx(o);
  const sep = platform === "win32" ? ";" : ":";
  const exts = platform === "win32" ? ["", ...String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map(e => e.toLowerCase())] : [""];
  for (const dir of String(env.PATH ?? env.Path ?? "").split(sep).filter(Boolean)) {
    for (const ext of exts) {
      const file = p.join(dir, name + ext);
      if (isExecutable(file, platform)) return file;
    }
  }
  return null;
}

export function isExecutable(file, platform = currentPlatform()) {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------- the browser ----------

/** Folders the browser reads native-messaging host manifests from (empty on Windows: the registry). */
export function nativeHostDirs(o) {
  const { platform, home, p } = ctx(o);
  if (platform === "darwin") {
    const support = p.join(home, "Library", "Application Support");
    // Zen reads Mozilla's folder (zen-browser/desktop#13214); its own is written too, for when it does.
    return [p.join(support, "Mozilla", "NativeMessagingHosts"), p.join(support, "zen", "NativeMessagingHosts")];
  }
  if (platform === "win32") return [];
  // Zen on Linux reads ~/.mozilla (zen-browser/desktop#10622); ~/.zen is written too, for when it does.
  return [p.join(home, ".mozilla", "native-messaging-hosts"), p.join(home, ".zen", "native-messaging-hosts")];
}

/** Registry keys (HKCU) whose default value points at the manifest. Zen uses Mozilla's key too. */
export function nativeHostRegistryKeys(name = "enso") {
  return [`HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${name}`];
}

/** Profile roots (folders holding installs.ini / profiles.ini), Zen first. */
export function browserProfileRoots(o) {
  const { env, platform, home, p } = ctx(o);
  if (platform === "darwin") {
    const support = p.join(home, "Library", "Application Support");
    return [{ browser: "zen", dir: p.join(support, "zen") }, { browser: "firefox", dir: p.join(support, "Firefox") }];
  }
  if (platform === "win32") {
    const appdata = env.APPDATA || p.join(home, "AppData", "Roaming");
    return [{ browser: "zen", dir: p.join(appdata, "zen") }, { browser: "firefox", dir: p.join(appdata, "Mozilla", "Firefox") }];
  }
  return [
    { browser: "zen", dir: p.join(home, ".zen") },
    { browser: "zen", dir: p.join(home, ".var", "app", "app.zen_browser.zen", ".zen"), flatpak: true },
    { browser: "firefox", dir: p.join(home, ".mozilla", "firefox") },
    { browser: "firefox", dir: p.join(home, ".var", "app", "org.mozilla.firefox", ".mozilla", "firefox"), flatpak: true },
    { browser: "firefox", dir: p.join(home, "snap", "firefox", "common", ".mozilla", "firefox"), snap: true },
  ];
}

/** The default profile folder in a profile root: installs.ini's Default=, else profiles.ini's Default=1 profile. */
export function defaultProfileIn(root, o) {
  const { p } = ctx(o);
  const resolve = rel => (p.isAbsolute(rel) ? rel : p.join(root, ...rel.split(/[\\/]/)));
  try {
    const rel = /^Default=(.+)$/m.exec(readFileSync(p.join(root, "installs.ini"), "utf8"))?.[1]?.trim();
    if (rel) return resolve(rel);
  } catch {}
  try {
    const ini = readFileSync(p.join(root, "profiles.ini"), "utf8");
    const sections = ini.split(/^\[/m).map(s => Object.fromEntries(s.split(/\r?\n/).map(l => l.split("=")).filter(kv => kv.length >= 2).map(([k, ...v]) => [k.trim(), v.join("=").trim()])));
    const pick = sections.find(s => s.Path && s.Default === "1") ?? sections.find(s => s.Path);
    if (pick) return pick.IsRelative === "0" ? pick.Path : resolve(pick.Path);
  } catch {}
  return null;
}

/** The default profile folder of "zen" or "firefox" (first install found), or null. */
export function browserProfileDir(browser, o) {
  for (const r of browserProfileRoots(o).filter(r => r.browser === browser)) {
    const dir = defaultProfileIn(r.dir, o);
    if (dir && existsSync(dir)) return dir;
  }
  return null;
}

/** Zen's live profile folder (where zen-sessions.jsonlz4 and cookies.sqlite are), or null. */
export const zenProfileDir = o => browserProfileDir("zen", o);

/** Candidate browser executables for headless runs, Zen first. ENSO_BROWSER_BIN overrides. */
export function browserBinaries(o) {
  const { env, platform, home, p } = ctx(o);
  const out = [];
  if (env.ENSO_BROWSER_BIN) out.push({ browser: /firefox/i.test(env.ENSO_BROWSER_BIN) ? "firefox" : "zen", bin: env.ENSO_BROWSER_BIN });
  if (platform === "darwin") {
    for (const apps of ["/Applications", p.join(home, "Applications")]) out.push({ browser: "zen", bin: p.join(apps, "Zen.app", "Contents", "MacOS", "zen") });
    out.push({ browser: "firefox", bin: "/Applications/Firefox.app/Contents/MacOS/firefox" });
  } else if (platform === "win32") {
    const pf = [env.ProgramFiles || "C:\\Program Files", env["ProgramFiles(x86)"], env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, "Programs")].filter(Boolean);
    for (const d of pf) out.push({ browser: "zen", bin: p.join(d, "Zen Browser", "zen.exe") });
    for (const d of pf) out.push({ browser: "firefox", bin: p.join(d, "Mozilla Firefox", "firefox.exe") });
  } else {
    for (const name of ["zen", "zen-browser"]) {
      const found = which(name, o);
      if (found) out.push({ browser: "zen", bin: found });
    }
    // zen-browser.app's install script, the tarball in /opt, distro packages.
    for (const bin of [p.join(home, ".tarball-installations", "zen", "zen"), "/opt/zen/zen", "/opt/zen-browser/zen", "/usr/lib/zen-browser/zen", "/usr/lib/zen/zen"]) out.push({ browser: "zen", bin });
    const ff = which("firefox", o);
    if (ff) out.push({ browser: "firefox", bin: ff });
    out.push({ browser: "firefox", bin: "/usr/lib/firefox/firefox" }, { browser: "firefox", bin: "/usr/lib64/firefox/firefox" });
  }
  return out;
}

/** The first browser binary that exists, or null. */
export function findBrowserBinary(o) {
  const { platform } = ctx(o);
  return browserBinaries(o).find(c => isExecutable(c.bin, platform)) ?? null;
}

/** Is Ensō's add-on in some Zen or Firefox profile? (install scripts: don't open the .xpi again) */
export function extensionInstalled(id = "enso@wicker.life", o) {
  const { p } = ctx(o);
  for (const r of browserProfileRoots(o)) {
    for (const sub of ["", "Profiles"]) {
      let names = [];
      try {
        names = readdirSync(p.join(r.dir, sub));
      } catch {
        continue;
      }
      for (const n of names) {
        try {
          if (readFileSync(p.join(r.dir, sub, n, "extensions.json"), "utf8").includes(`"${id}"`)) return true;
        } catch {}
      }
    }
  }
  return false;
}

// ---------- agent clients ----------

/**
 * Config files of the MCP clients `enso mcp install` edits. They are the same
 * on every OS, relative to the home folder: Claude Code ~/.claude.json, Codex
 * ~/.codex (CODEX_HOME), Cursor ~/.cursor/mcp.json (also on Windows: Cursor's
 * own settings live in %APPDATA%\Cursor, its MCP list doesn't), OpenCode
 * $XDG_CONFIG_HOME/opencode, else ~/.config/opencode (also on Windows).
 */
export function clientConfigPaths(o) {
  const { env, home, p } = ctx(o);
  return {
    claudeJson: p.join(home, ".claude.json"),
    claudeSettings: p.join(env.CLAUDE_CONFIG_DIR || p.join(home, ".claude"), "settings.json"),
    codexConfig: p.join(env.CODEX_HOME || p.join(home, ".codex"), "config.toml"),
    cursorConfig: p.join(home, ".cursor", "mcp.json"),
    opencodeDir: p.join(env.XDG_CONFIG_HOME || p.join(home, ".config"), "opencode"),
  };
}

/** Where Claude Code's CLI usually is, after PATH. */
export function claudeCandidates(o) {
  const { env, platform, home, p } = ctx(o);
  if (platform === "win32") {
    const appdata = env.APPDATA || p.join(home, "AppData", "Roaming");
    return [p.join(home, ".local", "bin", "claude.exe"), p.join(appdata, "npm", "claude.cmd"), p.join(home, ".claude", "local", "claude.exe"), p.join(env.LOCALAPPDATA || p.join(home, "AppData", "Local"), "Volta", "bin", "claude.exe")];
  }
  return [
    p.join(home, ".local", "bin", "claude"), // native installer
    p.join(home, ".claude", "local", "claude"), // older "migrate-installer" location
    ...(platform === "darwin" ? ["/opt/homebrew/bin/claude"] : ["/home/linuxbrew/.linuxbrew/bin/claude"]),
    "/usr/local/bin/claude",
    p.join(home, ".volta", "bin", "claude"),
    p.join(home, ".npm-global", "bin", "claude"),
    p.join(home, ".bun", "bin", "claude"),
  ];
}

/** The commands Setup runs for Claude Code's installer (per shell). */
export function claudeInstallCommand(o) {
  const { platform } = ctx(o);
  return platform === "win32" ? "irm https://claude.ai/install.ps1 | iex" : "curl -fsSL https://claude.ai/install.sh | bash";
}

/** The one-line Ensō installer for this OS. */
export function installCommand(site = "https://enso.wicker.life", o) {
  const { platform } = ctx(o);
  return platform === "win32" ? `irm ${site}/install.ps1 | iex` : `curl -fsSL ${site}/install.sh | bash`;
}

/** T3 Code's app, when there is no CLI: macOS app bundles; elsewhere its usual install folders. */
export function t3AppInstalled(o, applicationsDir) {
  const { env, platform, home, p } = ctx(o);
  try {
    if (platform === "darwin") return readdirSync(applicationsDir || "/Applications").some(n => /^T3 Code.*\.app$/.test(n));
    if (applicationsDir) return readdirSync(applicationsDir).some(n => /^t3[ -]?code/i.test(n));
    if (platform === "win32") return existsSync(p.join(env.LOCALAPPDATA || p.join(home, "AppData", "Local"), "Programs", "T3 Code"));
    return ["/opt/T3 Code", p.join(home, "Applications")].some(d => existsSync(d) && (d.endsWith("T3 Code") || readdirSync(d).some(n => /^t3[ -]?code/i.test(n))));
  } catch {
    return false;
  }
}

// ---------- processes ----------

/** Open a URL (or a custom scheme like t3code://) with the system's handler. `app`: macOS only (open -a). */
export function openUrl(url, { app, platform = currentPlatform(), spawnImpl = spawn } = {}) {
  const [cmd, args] =
    platform === "darwin" ? ["/usr/bin/open", app ? ["-a", app, url] : [url]]
    // rundll32 hands the URL to its handler without going through cmd.exe (no & or ^ parsing).
    : platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
    : ["xdg-open", [url]];
  try {
    const child = spawnImpl(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on?.("error", () => {});
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

/** The command line of a process, or "" (used to make sure a pid is still ours before killing it). */
export function processCommandLine(pid, { platform = currentPlatform() } = {}) {
  try {
    if (platform === "win32") return powershellSync(`(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`).trim();
    return execFileSync("ps", ["-o", "command=", "-p", String(Number(pid))], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
  } catch {
    return "";
  }
}

/** A process's parent pid, or NaN. */
export function parentPid(pid, { platform = currentPlatform() } = {}) {
  try {
    if (platform === "win32") return Number.parseInt(powershellSync(`(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").ParentProcessId`).trim(), 10);
    return Number.parseInt(execFileSync("ps", ["-o", "ppid=", "-p", String(Number(pid))], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1000 }).trim(), 10);
  } catch {
    return Number.NaN;
  }
}

/** Run a short PowerShell script (no user data in it) and return stdout. */
export function powershellSync(script, { input, timeout = 15_000 } = {}) {
  return execFileSync(powershellExe(), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    encoding: "utf8",
    input,
    stdio: [input == null ? "ignore" : "pipe", "pipe", "ignore"],
    timeout,
    windowsHide: true,
  });
}

/** Windows PowerShell 5.1 ships with every Windows 10/11; its full path works without PATH. */
export function powershellExe(env = process.env) {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  const full = path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return process.platform === "win32" && existsSync(full) ? full : "powershell.exe";
}

// ---------- terminals ----------

/** Quote for bash (single quotes). */
export const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
/** Quote for PowerShell (single quotes, doubled inside). */
export const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

/**
 * The script Setup writes for a terminal step, for this OS:
 * { ext, body } (.command on macOS, .sh on Linux, .ps1 on Windows).
 * `command` is { sh, ps }: the same step for bash and for PowerShell.
 */
export function terminalScript({ title, command }, o) {
  const { platform } = ctx(o);
  if (platform === "win32") {
    return {
      ext: ".ps1",
      body: [
        `# Written by Ensō (Settings → Setup): ${title}`,
        "Clear-Host",
        `Write-Host ${psQuote(`Ensō: ${title}`)}`,
        `Write-Host ${psQuote(`> ${command.ps}`)}`,
        "Write-Host ''",
        command.ps,
        "$ok = $?",
        "Write-Host ''",
        "if ($ok) { Write-Host 'Done. Go back to Zen: Ensō checks again by itself.' } else { Write-Host 'That did not finish. Close this window and try again from Ensō.' }",
        "",
      ].join("\r\n"),
    };
  }
  return {
    ext: platform === "darwin" ? ".command" : ".sh",
    body: [
      "#!/bin/bash",
      `# Written by Ensō (Settings → Setup): ${title}`,
      "clear",
      `printf '\\033[1mEnsō: %s\\033[0m\\n\\n$ %s\\n\\n' ${shellQuote(title)} ${shellQuote(command.sh)}`,
      command.sh,
      "status=$?",
      "echo",
      'if [ "$status" -eq 0 ]; then echo "Done. Go back to Zen: Ensō checks again by itself."; else echo "That did not finish (exit $status). Close this window and try again from Ensō."; fi',
      // macOS Terminal keeps the window; Linux terminals close it when the script ends.
      ...(platform === "darwin" ? [] : ['read -r -p "Press Enter to close this window. " _']),
      "",
    ].join("\n"),
  };
}

/** Linux terminal emulators, tried in order: [program, ...args before the script]. */
export const LINUX_TERMINALS = [
  ["x-terminal-emulator", "-e"],
  ["gnome-terminal", "--"],
  ["konsole", "-e"],
  ["xfce4-terminal", "-x"],
  ["kgx", "--"],
  ["ptyxis", "--"],
  ["kitty"],
  ["alacritty", "-e"],
  ["wezterm", "start", "--"],
  ["foot"],
  ["tilix", "-e"],
  ["xterm", "-e"],
];

export class NoTerminalError extends Error {
  constructor(command) {
    super(`No terminal app found to open. Run this in a terminal yourself: ${command}`);
    this.code = "no_terminal";
    this.command = command;
  }
}

/**
 * Open `file` (from terminalScript) in a visible terminal window. Resolves when
 * the terminal started; throws NoTerminalError on Linux when none is installed
 * (the message carries the command to copy).
 */
export async function openTerminal(file, { platform = currentPlatform(), env = process.env, spawnImpl = spawn, command = "" } = {}) {
  const started = (cmd, args) =>
    new Promise(resolve => {
      let child;
      try {
        child = spawnImpl(cmd, args, { stdio: "ignore", detached: true, env });
      } catch {
        return resolve(false);
      }
      let settled = false;
      const done = v => {
        if (!settled) (settled = true), resolve(v);
      };
      child.on("error", () => done(false));
      // `open` exits at once with its status; terminals keep running (spawned = success).
      child.on("exit", code => done(cmd === "/usr/bin/open" ? code === 0 : code === 0 || code === null));
      child.on("spawn", () => cmd !== "/usr/bin/open" && setTimeout(() => done(true), 300));
      child.unref?.();
    });
  if (platform === "darwin") {
    if (!(await started("/usr/bin/open", ["-a", "Terminal", file]))) throw new Error("Couldn't open Terminal.");
    return;
  }
  if (platform === "win32") {
    // A detached console program gets a console window of its own.
    if (!(await started(powershellExe(env), ["-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file]))) throw new Error("Couldn't open PowerShell.");
    return;
  }
  const preferred = env.TERMINAL ? [[env.TERMINAL, "-e"]] : [];
  for (const [prog, ...pre] of [...preferred, ...LINUX_TERMINALS]) {
    const bin = which(prog, { platform, env });
    if (!bin) continue;
    if (await started(bin, [...pre, "/bin/bash", file])) return;
  }
  throw new NoTerminalError(command || `bash ${shellQuote(file)}`);
}
