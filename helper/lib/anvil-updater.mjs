// Anvil laptop runner updater (LAPTOP-RUNNER.md §10.2–10.3):
// polls /api/browser-runners/laptop/manifest, verifies sha256, honours 24h hold
// (from manifest.target/held), pin, disabled/local updates: "off", and the nightly
// local-time window while no remote session is active, and reports hello.update state.

import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeAnvilUrl } from "./anvil-auth.mjs";
import { sha256Hex } from "./anvil-crypto.mjs";
import { dataDir as defaultDataDir } from "./platform.mjs";

export const DEFAULT_MANIFEST_PATH = "/api/browser-runners/laptop/manifest";
export const DEFAULT_CHECK_AFTER_S = 6 * 3600;
const SHA256_RE = /^[0-9a-f]{64}$/i;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeMinutes(hhmm) {
  const m = HHMM_RE.exec(String(hhmm ?? "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Whether local time of `date` falls inside `window` ({ start: "03:00", end: "05:00" }). */
export function inUpdateWindow(window, date = new Date()) {
  const start = parseTimeMinutes(window?.start);
  const end = parseTimeMinutes(window?.end);
  if (start == null || end == null) return false;
  const mins = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  if (start < end) return mins >= start && mins < end;
  // Overnight wrap, e.g. 23:00 -> 01:00
  return mins >= start || mins < end;
}

/** Milliseconds until the window opens next (0 if currently inside). */
export function msUntilWindow(window, date = new Date()) {
  if (inUpdateWindow(window, date)) return 0;
  const start = parseTimeMinutes(window?.start);
  if (start == null) return 60 * 60_000;
  const curMins = date.getHours() * 60 + date.getMinutes();
  const deltaMins = start > curMins ? start - curMins : 1440 - curMins + start;
  const deltaMs = deltaMins * 60_000 - date.getSeconds() * 1000 - date.getMilliseconds();
  return Math.max(1000, deltaMs);
}

function isAllowedDownloadUrl(raw) {
  try {
    const u = new URL(String(raw ?? ""));
    const local = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return u.protocol === "https:" || local;
  } catch {
    return false;
  }
}

function readArchiveVersion(dir) {
  const vf = path.join(dir, "VERSION");
  if (existsSync(vf)) {
    const v = readFileSync(vf, "utf8").trim();
    if (v) return v;
  }
  const pf = path.join(dir, "package.json");
  if (existsSync(pf)) {
    try {
      const v = String(JSON.parse(readFileSync(pf, "utf8"))?.version ?? "").trim();
      if (v) return v;
    } catch {}
  }
  return null;
}

function extractArchive(archivePath, destDir, exec = execFileSync) {
  const head = readFileSync(archivePath).subarray(0, 4);
  const isZip = head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b;
  if (isZip) {
    // Windows & macOS bsdtar unpack .zip natively; Linux prefers unzip with tar fallback.
    if (process.platform === "linux") {
      try {
        exec("unzip", ["-q", "-o", archivePath, "-d", destDir], { stdio: "pipe" });
        return;
      } catch {
        exec("tar", ["-xf", archivePath, "-C", destDir], { stdio: "pipe" });
        return;
      }
    }
    exec("tar", ["-xf", archivePath, "-C", destDir], { stdio: "pipe" });
    return;
  }
  exec("tar", ["-xzf", archivePath, "-C", destDir], { stdio: "pipe" });
}

/**
 * Installs a SHA-256-verified release artifact into `<dataDir>/helper` without
 * hitting the public installer or site URL (so pins and rollbacks install the
 * exact verified archive). Preserves `run.sh` / `run.cmd` and verifies the
 * extracted version matches `item.version`.
 */
export function installVerifiedArtifact(item, { dataDir = defaultDataDir(), helperDir, exec = execFileSync } = {}) {
  if (!item?.filePath || !item?.sha256 || !item?.version) {
    throw new Error("Missing verified artifact metadata.");
  }
  const targetDir = path.resolve(path.join(dataDir, "helper"));
  const runningDir = helperDir ? path.resolve(helperDir) : targetDir;
  if (existsSync(path.join(runningDir, "..", ".git")) || runningDir !== targetDir) {
    throw new Error("This helper runs from a checkout (scripts/dev.sh). Update it with git pull, then reopen Zen.");
  }

  // Re-verify the staged file's SHA-256 immediately before unpacking.
  const actualSha = sha256Hex(readFileSync(item.filePath));
  if (actualSha !== String(item.sha256).toLowerCase()) {
    throw new Error("sha256 mismatch on staged artifact");
  }

  const stageRoot = path.join(dataDir, "updates", `unpack-${process.pid}-${Date.now()}`);
  const helperNew = path.join(dataDir, "helper.new");
  const helperOld = path.join(dataDir, "helper.old");
  mkdirSync(stageRoot, { recursive: true });
  try {
    extractArchive(item.filePath, stageRoot, exec);
    const src = existsSync(path.join(stageRoot, "helper", "host.mjs"))
      ? path.join(stageRoot, "helper")
      : stageRoot;
    if (!existsSync(path.join(src, "host.mjs"))) {
      throw new Error("The release archive does not contain host.mjs.");
    }
    const foundVersion = readArchiveVersion(src);
    if (foundVersion !== item.version) {
      throw new Error(`Archive version mismatch: expected ${item.version}, got ${foundVersion || "unknown"}.`);
    }
    if (!existsSync(path.join(src, "VERSION"))) {
      writeFileSync(path.join(src, "VERSION"), `${item.version}\n`);
    }
    // Preserve native-messaging launcher scripts so Zen keeps using the same Node binary.
    for (const launcher of ["run.sh", "run.cmd"]) {
      const existing = path.join(targetDir, launcher);
      if (existsSync(existing)) {
        const dst = path.join(src, launcher);
        copyFileSync(existing, dst);
        if (launcher === "run.sh") {
          try { chmodSync(dst, 0o755); } catch {}
        }
      }
    }

    rmSync(helperNew, { recursive: true, force: true });
    rmSync(helperOld, { recursive: true, force: true });
    renameSync(src, helperNew);

    const hadOld = existsSync(targetDir);
    if (hadOld) renameSync(targetDir, helperOld);
    try {
      renameSync(helperNew, targetDir);
    } catch (err) {
      if (hadOld && existsSync(helperOld) && !existsSync(targetDir)) {
        try { renameSync(helperOld, targetDir); } catch {}
      }
      throw err;
    }
    rmSync(helperOld, { recursive: true, force: true });

    const installedVersion = readArchiveVersion(targetDir);
    if (installedVersion !== item.version) {
      throw new Error(`Installed version verification failed: expected ${item.version}, got ${installedVersion || "unknown"}.`);
    }
    return { installedVersion };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
    rmSync(helperNew, { recursive: true, force: true });
  }
}

export function createAnvilUpdater({
  dataDir = defaultDataDir(),
  getCredentials,
  getAnvilConfig,
  currentVersion = () => "0.5.8.1",
  hasActiveSessions = () => false,
  installArtifact = null,
  onStateChange = () => {},
  onRevoked = () => {},
  fetchImpl = globalThis.fetch,
  now = Date.now,
  log = () => {},
} = {}) {
  const stateFile = path.join(dataDir, "anvil-update.json");
  const updatesDir = path.join(dataDir, "updates");

  let pollTimer = null;
  let windowTimer = null;
  let running = false;
  let checking = false;
  let lastManifest = null;
  let pending = null; // { version, sha256, filePath, window, bytes }

  let report = loadPersistedState();

  function loadPersistedState() {
    try {
      if (!existsSync(stateFile)) return { state: "idle" };
      const raw = JSON.parse(readFileSync(stateFile, "utf8"));
      if (raw?.state === "installed" && raw.version && raw.version === currentVersion()) {
        return { state: "installed", version: raw.version, from: raw.from ?? null, at: raw.at ?? null };
      }
    } catch {}
    return { state: "idle" };
  }

  function persistState(next) {
    try {
      mkdirSync(dataDir, { recursive: true });
      const tmp = `${stateFile}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      try { chmodSync(tmp, 0o600); } catch {}
      renameSync(tmp, stateFile);
    } catch {}
  }

  function setReport(next) {
    report = next;
    try { onStateChange(status()); } catch {}
  }

  function clearTimers() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (windowTimer) { clearTimeout(windowTimer); windowTimer = null; }
  }

  function schedulePoll(seconds) {
    if (!running) return;
    if (pollTimer) clearTimeout(pollTimer);
    const delayMs = Math.max(60, Math.min(86_400, Number(seconds) || DEFAULT_CHECK_AFTER_S)) * 1000;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (running) void checkNow();
    }, delayMs);
    pollTimer.unref?.();
  }

  function scheduleWindowInstall() {
    if (!running || !pending) return;
    if (windowTimer) clearTimeout(windowTimer);
    const delay = msUntilWindow(pending.window, new Date(now()));
    windowTimer = setTimeout(() => {
      windowTimer = null;
      if (running) void tryInstallPending();
    }, Math.min(delay, 24 * 3600_000));
    windowTimer.unref?.();
  }

  async function tryInstallPending() {
    if (!pending) return { installed: false, reason: "nothing_pending" };
    const cfg = getAnvilConfig?.() ?? { updates: "auto" };
    if (cfg.updates === "off") {
      pending = null;
      setReport({ state: "idle" });
      return { installed: false, reason: "local_off" };
    }
    if (hasActiveSessions()) {
      return { installed: false, reason: "session_active" };
    }
    if (!inUpdateWindow(pending.window, new Date(now()))) {
      scheduleWindowInstall();
      return { installed: false, reason: "outside_window" };
    }
    const item = pending;
    pending = null;
    if (!installArtifact) {
      log("anvil-updater: artifact verified and ready inside window, no installer wired");
      return { installed: false, reason: "no_installer" };
    }
    try {
      const from = currentVersion();
      await installArtifact(item);
      const installed = { state: "installed", version: item.version, from, at: new Date(now()).toISOString() };
      persistState(installed);
      setReport(installed);
      log(`anvil-updater: installed ${item.version} (from ${from})`);
      return { installed: true, version: item.version };
    } catch (err) {
      const msg = String(err?.message ?? err).slice(0, 280);
      setReport({ state: "failed", version: item.version, error: msg });
      log("anvil-updater: install failed:", msg);
      return { installed: false, reason: "install_failed", error: msg };
    }
  }

  async function checkNow() {
    if (checking) return { skipped: true };
    const cfg = getAnvilConfig?.() ?? { updates: "auto" };
    if (cfg.updates === "off") {
      pending = null;
      setReport({ state: "idle" });
      schedulePoll(DEFAULT_CHECK_AFTER_S);
      return { state: "idle", reason: "local_off" };
    }
    const creds = await getCredentials?.();
    if (!creds || creds.error) return { skipped: true };

    checking = true;
    try {
      const base = normalizeAnvilUrl(creds.url);
      const manifestPath = creds.manifest_path || DEFAULT_MANIFEST_PATH;
      const u = new URL(manifestPath, `${base}/`);
      const res = await fetchImpl(u.toString(), {
        method: "GET",
        headers: { authorization: `Bearer ${creds.token}`, accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (res.status === 401) {
        stop();
        await Promise.resolve(onRevoked("Token revoked (401 on manifest)")).catch(() => {});
        return { revoked: true };
      }
      const manifest = await res.json().catch(() => null);
      if (!res.ok || !manifest || manifest.component !== "enso-runner") {
        schedulePoll(DEFAULT_CHECK_AFTER_S);
        return { error: `Bad manifest response (HTTP ${res.status})` };
      }
      lastManifest = manifest;
      schedulePoll(manifest.check_after_s);

      // Held releases wait until arrives_at unless they become manifest.target (owner pinned it).
      if (manifest.disabled || !manifest.target) {
        pending = null;
        if (report.state !== "installed") setReport({ state: "idle" });
        return { state: report.state, held: manifest.held ?? null };
      }

      const target = manifest.target;
      const runningVer = currentVersion();
      if (target.version === runningVer) {
        pending = null;
        if (report.state !== "installed") setReport({ state: "idle" });
        return { state: report.state, upToDate: true };
      }

      if (!isAllowedDownloadUrl(target.url) || !SHA256_RE.test(String(target.sha256 ?? ""))) {
        setReport({ state: "failed", version: String(target.version ?? "").slice(0, 40), error: "invalid manifest target url or sha256" });
        return { state: "failed", error: "invalid manifest target" };
      }

      // Already downloaded and verified this exact target? Just try installing.
      if (pending && pending.version === target.version && pending.sha256 === target.sha256.toLowerCase()) {
        pending.window = manifest.window ?? { start: "03:00", end: "05:00" };
        return await tryInstallPending();
      }

      setReport({ state: "downloading", version: target.version });
      const dl = await fetchImpl(target.url, {
        method: "GET",
        signal: AbortSignal.timeout(120_000),
      });
      if (!dl.ok) {
        setReport({ state: "failed", version: target.version, error: `download failed (HTTP ${dl.status})` });
        return { state: "failed", error: `HTTP ${dl.status}` };
      }
      const bytes = Buffer.from(await dl.arrayBuffer());
      const actualHash = sha256Hex(bytes);
      const expectedHash = target.sha256.toLowerCase();
      if (actualHash !== expectedHash) {
        setReport({ state: "failed", version: target.version, error: "sha256 mismatch" });
        log(`anvil-updater: sha256 mismatch for ${target.version} (expected ${expectedHash}, got ${actualHash})`);
        return { state: "failed", error: "sha256 mismatch" };
      }

      mkdirSync(updatesDir, { recursive: true });
      const safeVer = String(target.version).replace(/[^A-Za-z0-9._+-]/g, "_");
      const filePath = path.join(updatesDir, `enso-${safeVer}.artifact`);
      const tmp = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, bytes, { mode: 0o600 });
      renameSync(tmp, filePath);

      pending = {
        version: target.version,
        sha256: expectedHash,
        filePath,
        bytes,
        window: manifest.window ?? { start: "03:00", end: "05:00" },
      };

      const resInstall = await tryInstallPending();
      if (!resInstall.installed && resInstall.reason !== "install_failed") {
        // Staged & waiting for window or session idle
        setReport({ state: "idle", version: target.version });
      }
      return resInstall;
    } catch (err) {
      const msg = String(err?.message ?? err).slice(0, 280);
      setReport({ state: "failed", ...(lastManifest?.target?.version ? { version: lastManifest.target.version } : {}), error: msg });
      schedulePoll(DEFAULT_CHECK_AFTER_S);
      return { state: "failed", error: msg };
    } finally {
      checking = false;
    }
  }

  function helloUpdate() {
    const cfg = getAnvilConfig?.() ?? { updates: "auto" };
    if (cfg.updates === "off") return { state: "idle" };
    const out = { state: report.state };
    if (report.version != null) out.version = report.version;
    if (report.from != null) out.from = report.from;
    if (report.at != null) out.at = report.at;
    if (report.error != null) out.error = report.error;
    return out;
  }

  function status() {
    return {
      update: helloUpdate(),
      pendingVersion: pending?.version ?? null,
      held: lastManifest?.held ?? null,
      pinned: lastManifest?.pinned ?? null,
      disabled: lastManifest?.disabled ?? false,
      window: lastManifest?.window ?? { start: "03:00", end: "05:00" },
    };
  }

  function stop() {
    running = false;
    clearTimers();
  }

  function clearStaged() {
    if (pending?.filePath) {
      try { rmSync(pending.filePath, { force: true }); } catch {}
    }
    pending = null;
  }

  return {
    start() {
      if (running) return;
      running = true;
      void checkNow();
    },
    stop,
    checkNow,
    tryInstallPending,
    onSessionsIdle() {
      if (running && pending) void tryInstallPending();
    },
    helloUpdate,
    status,
    clearStaged,
  };
}
