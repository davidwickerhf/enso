// The helper's own log file: helper.log in the log folder (lib/platform.mjs:
// ~/Library/Logs/Enso on macOS, ~/.local/state/enso on Linux,
// %LOCALAPPDATA%\Enso\Logs on Windows), rotated at ~1 MB
// (helper.log and helper.log.1, so at most ~2 MB on disk). Zen shows the
// helper's stderr only in the Browser Console, which nobody has open when it
// crashes; this file is what `enso doctor` and Copy diagnostics point at.
//
// What goes in: startup lines (helper and Node version, Node's path, platform),
// errors the helper handled, and uncaught exceptions / unhandled rejections with
// their stack, written synchronously before the process exits. What never goes
// in: message contents, page text, tokens, keys. Every line passes redact()
// as a second line of defence; callers log error messages, not payloads.
//
// run.sh (written by install.sh and dev.sh) also appends the helper's stderr
// to the same file, so a crash before this module runs (Node missing, a syntax
// error on an old Node) is there too. It sets ENSO_STDERR_LOG to the file; then
// log lines are written once (to the file), not echoed to stderr as well.
//
// Location: ENSO_LOG_DIR, else the folder of run.sh's ENSO_STDERR_LOG, else
// <ENSO_DATA>/logs when ENSO_DATA is set (tests), else the OS's log folder.

import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeSync } from "node:fs";
import path from "node:path";
import { logDir as platformLogDir } from "./platform.mjs";

export const MAX_BYTES = 1_000_000;
const MAX_ENTRY = 8_000;

export function logDir(env = process.env) {
  if (env.ENSO_LOG_DIR) return env.ENSO_LOG_DIR;
  if (env.ENSO_STDERR_LOG) return path.dirname(env.ENSO_STDERR_LOG); // run.sh's choice
  return platformLogDir({ env });
}

export const logFile = (env = process.env) => path.join(logDir(env), "helper.log");

// Secrets that could end up inside an error message (an OAuth error body, a
// failed request's URL, a misconfigured server entry).
const REDACTIONS = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[redacted]"],
  [/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted GitHub token]"],
  [/\b(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]{12,}/gi, "$1 [redacted]"],
  [/([?&#](?:access_token|refresh_token|id_token|token|code|client_secret|password|api[_-]?key|key|secret|sig|signature)=)[^&#\s"']+/gi, "$1[redacted]"],
  [/("(?:access_token|refresh_token|id_token|token|client_secret|password|api[_-]?key|apiKey|secret|authorization)"\s*:\s*")[^"]*"/gi, '$1[redacted]"'],
  [/(\b(?:authorization|x-api-key|private-token|cookie)\s*[:=]\s*)[^\s,;"']+/gi, "$1[redacted]"],
  [/(\b(?:access_token|refresh_token|id_token|token|client_secret|password|passwd|api[_-]?key|secret)=)[^\s&,;"']+/gi, "$1[redacted]"],
  [/(\b(?:client_secret|password|passwd|api[_-]?key|secret)\s*:\s*)[^\s,;"']+/gi, "$1[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted JWT]"],
  [/\b[A-Fa-f0-9]{40,}\b/g, "[redacted hex]"],
  // Long random-looking runs (mixed case and digits, no separators): keys and tokens, not paths or words.
  [/[A-Za-z0-9+_-]{32,}={0,2}/g, m => (/\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m) ? "[redacted]" : m)],
];

export function redact(text) {
  let s = String(text);
  for (const [re, to] of REDACTIONS) s = s.replace(re, to);
  return s;
}

const stamp = () => new Date().toISOString();

/**
 * createLog({ file, maxBytes }) → { file, write(level, text), tail(n), close() }.
 * Writes are synchronous (so the last line before process.exit lands) and
 * never throw: a log that can't be written must not take the helper down.
 */
export function createLog({ file = logFile(), maxBytes = MAX_BYTES, pid = process.pid } = {}) {
  let fd = null;
  let size = 0;
  let broken = false;

  function open() {
    if (fd != null || broken) return fd;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      fd = openSync(file, "a", 0o644);
      size = fstatSync(fd).size;
    } catch {
      broken = true;
      fd = null;
    }
    return fd;
  }

  function rotate() {
    try {
      if (fd != null) closeSync(fd);
    } catch {}
    fd = null;
    try {
      renameSync(file, `${file}.1`); // replaces the older .1: two files at most
    } catch {}
    open();
  }

  function write(level, text) {
    let body = redact(text).replace(/\r/g, "");
    if (body.length > MAX_ENTRY) body = `${body.slice(0, MAX_ENTRY)} …[truncated]`;
    const line = `${stamp()} [${pid}] ${String(level).toUpperCase().padEnd(5)} ${body.replace(/\n/g, "\n    ")}\n`;
    const buf = Buffer.from(line);
    if (open() == null) return false;
    // Another writer (run.sh's stderr redirect) appends to the same file: look at its real size.
    try {
      size = fstatSync(fd).size;
    } catch {}
    if (size > 0 && size + buf.length > maxBytes) rotate();
    if (fd == null) return false;
    try {
      writeSync(fd, buf);
      size += buf.length;
      return true;
    } catch {
      return false;
    }
  }

  function close() {
    try {
      if (fd != null) closeSync(fd);
    } catch {}
    fd = null;
  }

  return { file, write, tail: n => tailLines(file, n), close };
}

/** The last n lines of the log (helper.log.1 first when helper.log is short), redacted again. */
export function tailLines(file = logFile(), n = 30) {
  const read = f => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return "";
    }
  };
  let lines = read(file).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length < n && existsSync(`${file}.1`)) {
    const older = read(`${file}.1`).split("\n");
    if (older.at(-1) === "") older.pop();
    lines = [...older, ...lines];
  }
  return lines.slice(-n).map(redact);
}

/** True when fd 2 is the log file itself (run.sh's `2>>helper.log`). */
export function stderrIsFile(file) {
  try {
    const a = fstatSync(2);
    const b = statSync(file);
    return a.dev === b.dev && a.ino === b.ino;
  } catch {
    return false;
  }
}

// ---------- the helper process's log ----------

let current = null;
let echo = true;

/** The helper's log, once startHelperLog() ran (host.mjs only: libraries and tests don't write it). */
export const helperLog = () => current;

/** Writes a line to the helper's log (when started) and to stderr (unless stderr is the log). */
export function logLine(level, text) {
  current?.write(level, text);
  if (echo || !current) {
    try {
      process.stderr.write(`[enso] ${text}\n`);
    } catch {}
  }
}

function readVersion(helperDir) {
  for (const f of ["VERSION", "package.json"]) {
    try {
      const raw = readFileSync(path.join(helperDir, f), "utf8");
      return f === "VERSION" ? raw.trim() : JSON.parse(raw).version;
    } catch {}
  }
  return "unknown";
}

/**
 * Opens the log, writes the startup line and installs the crash handlers.
 * host.mjs calls this first thing. Returns the log.
 */
export function startHelperLog({ helperDir, env = process.env, exit = code => process.exit(code) } = {}) {
  if (current) return current;
  current = createLog({ file: logFile(env) });
  echo = !(env.ENSO_STDERR_LOG && (env.ENSO_STDERR_LOG === current.file || stderrIsFile(current.file)));
  const version = readVersion(helperDir);
  let osRelease = "";
  try {
    osRelease = readFileSync("/System/Library/CoreServices/SystemVersion.plist", "utf8").match(/ProductVersion<\/key>\s*<string>([^<]+)/)?.[1] ?? "";
  } catch {}
  const by = env.ENSO_DOCTOR === "1" ? " (started by enso doctor)" : env.ENSO_STDERR_LOG ? " (started by run.sh)" : "";
  current.write("info", `Ensō helper ${version} starting${by}: Node ${process.version} at ${process.execPath}, ${process.platform} ${process.arch}${osRelease ? `, macOS ${osRelease}` : ""}, helper in ${helperDir}`);

  let dying = false;
  process.on("uncaughtException", (err, origin) => {
    const what = origin === "unhandledRejection" ? "Unhandled promise rejection" : "Uncaught exception";
    const text = `${what}: ${err?.stack ?? err}`;
    current.write("fatal", text);
    if (echo) {
      try {
        process.stderr.write(`[enso] ${redact(text)}\n`);
      } catch {}
    }
    if (!dying) {
      dying = true;
      exit(1);
    }
  });
  process.on("exit", code => current.write("info", `exiting (code ${code})`));
  return current;
}
