// Anvil laptop browser runner enrollment, strict keyring credential storage,
// disconnect, and 4401 revocation cleanup (LAPTOP-RUNNER.md §2).
//
// Secrets (token, signing_key) are stored strictly in the OS system keyring
// (macOS Keychain, Linux libsecret, Windows Credential Manager). Plaintext file
// fallback (secrets.json) is always refused.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { backend, DEFAULT_ACCOUNT, deleteItem, getItem, setItem } from "./secrets.mjs";
import { dataDir as defaultDataDir } from "./platform.mjs";
import { keyBytes } from "./anvil-crypto.mjs";

export const ANVIL_TOKEN_SERVICE = "enso-anvil-token";
export const ANVIL_KEY_SERVICE = "enso-anvil-signing-key";
export const DEFAULT_ANVIL_URL = "https://anvil.wicker.life";
export const REVOKED_MESSAGE = "Disconnected from Anvil: enroll again to reconnect";

const DEVICE_CODE_RE = /^anvl_[a-z2-7]{32}$/;

/** Validates the Anvil base URL: https:// only (or http://localhost / 127.0.0.1 for local dev/tests). */
export function normalizeAnvilUrl(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return DEFAULT_ANVIL_URL;
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error("Anvil URL must be a valid https:// address.");
  }
  const local = u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !local) {
    throw new Error("Anvil URL must use https://.");
  }
  return u.origin + u.pathname.replace(/\/+$/, "");
}

/**
 * Default keyring store backed by lib/secrets.mjs, strictly refusing the plaintext
 * `file` backend (LAPTOP-RUNNER.md §2.2).
 */
export function defaultKeyringStore() {
  const requireSecure = () => {
    const b = backend();
    if (b.name === "file") {
      throw new Error(
        "Anvil laptop enrollment requires a system keyring (macOS Keychain, Linux libsecret, or Windows Credential Manager). Refusing plaintext secrets.json fallback.",
      );
    }
    return b;
  };
  return {
    isSecure() {
      return backend().name !== "file";
    },
    backendName() {
      return backend().name;
    },
    location() {
      return backend().location();
    },
    async save({ token, signingKey }) {
      requireSecure();
      await setItem(ANVIL_TOKEN_SERVICE, token, { account: DEFAULT_ACCOUNT, label: "Enso Anvil runner token" });
      await setItem(ANVIL_KEY_SERVICE, signingKey, { account: DEFAULT_ACCOUNT, label: "Enso Anvil runner signing key" });
    },
    async load() {
      requireSecure();
      const [token, signingKey] = await Promise.all([
        getItem(ANVIL_TOKEN_SERVICE, { account: DEFAULT_ACCOUNT }),
        getItem(ANVIL_KEY_SERVICE, { account: DEFAULT_ACCOUNT }),
      ]);
      if (!token || !signingKey) return null;
      return { token, signingKey };
    },
    async clear() {
      if (backend().name === "file") return;
      await deleteItem(ANVIL_TOKEN_SERVICE, { account: DEFAULT_ACCOUNT }).catch(() => {});
      await deleteItem(ANVIL_KEY_SERVICE, { account: DEFAULT_ACCOUNT }).catch(() => {});
    },
  };
}

export function createAnvilAuth({
  dataDir = defaultDataDir(),
  fetchImpl = globalThis.fetch,
  keyring = defaultKeyringStore(),
  defaultUrl = DEFAULT_ANVIL_URL,
  version = "0.5.8.1",
  zenVersion = () => null,
  hostname = () => os.hostname(),
  platform = () => process.platform,
  log = () => {},
} = {}) {
  const metaFile = path.join(dataDir, "anvil.json");

  function loadEnrollment() {
    try {
      if (!existsSync(metaFile)) return null;
      const raw = JSON.parse(readFileSync(metaFile, "utf8"));
      if (!raw || typeof raw !== "object") return null;
      return raw;
    } catch {
      return null;
    }
  }

  function saveEnrollment(meta) {
    mkdirSync(dataDir, { recursive: true });
    const safe = {
      url: meta.url,
      runner: meta.runner ? { id: meta.runner.id, name: meta.runner.name } : null,
      profile: meta.profile ?? null,
      owner: meta.owner ?? null,
      channel: meta.channel ?? { ticket_path: "/api/browser-runners/channel-ticket", path: "/api/browser-runners/channel" },
      manifest_path: meta.manifest_path ?? "/api/browser-runners/laptop/manifest",
      enrolled_at: meta.enrolled_at ?? new Date().toISOString(),
      revoked: !!meta.revoked,
      revoked_message: meta.revoked_message ?? null,
    };
    const tmp = `${metaFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(safe, null, 2), { mode: 0o600 });
    try { chmodSync(tmp, 0o600); } catch {}
    renameSync(tmp, metaFile);
    return safe;
  }

  function clearEnrollmentFile() {
    try { rmSync(metaFile, { force: true }); } catch {}
  }

  function assertSecureKeyring() {
    if (!keyring.isSecure()) {
      throw new Error(
        "Anvil laptop enrollment requires a system keyring (macOS Keychain, Linux libsecret, or Windows Credential Manager). Plaintext file fallback is refused.",
      );
    }
  }

  /** Step 1 (§2.1): request a device code and user code. */
  async function startEnroll({ url = defaultUrl, zen = zenVersion() } = {}) {
    assertSecureKeyring();
    const base = normalizeAnvilUrl(url);
    const body = {
      ...(hostname() ? { hostname: String(hostname()).slice(0, 255) } : {}),
      ...(platform() ? { os: String(platform()).toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20) } : {}),
      ...(version ? { enso: String(version).slice(0, 40) } : {}),
      ...(zen ? { zen: String(zen).slice(0, 40) } : {}),
    };
    const res = await fetchImpl(`${base}/api/browser-runners/laptop/connect`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const data = await res.json().catch(() => null);
    if (res.status === 429) {
      throw new Error(data?.message || "Too many enrollment codes requested recently; try again in a few minutes.");
    }
    if (!res.ok || !data || !DEVICE_CODE_RE.test(String(data.device_code ?? ""))) {
      throw new Error(data?.message || `Anvil did not issue an enrollment code (HTTP ${res.status}).`);
    }
    return {
      url: base,
      device_code: data.device_code, // secret: never log or show to user
      user_code: String(data.user_code),
      verification_uri: String(data.verification_uri),
      verification_uri_complete: String(data.verification_uri_complete),
      expires_in: Number(data.expires_in) || 600,
      expires_at: String(data.expires_at ?? ""),
      interval: Math.max(1, Number(data.interval) || 5),
    };
  }

  /** Step 2 (§2.2): poll once. On approved, persists secrets in system keyring and metadata on disk. */
  async function pollEnrollOnce({ url, deviceCode }) {
    assertSecureKeyring();
    const base = normalizeAnvilUrl(url);
    const res = await fetchImpl(`${base}/api/browser-runners/laptop/connect/poll`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const data = await res.json().catch(() => null);
    if (res.status === 403 || data?.status === "denied") return { status: "denied" };
    if (res.status === 410 || data?.status === "expired") return { status: "expired" };
    if (!res.ok || !data) {
      throw new Error(data?.message || `Anvil poll failed (HTTP ${res.status}).`);
    }
    if (data.status === "pending" || data.status === "slow_down") {
      return { status: data.status, interval: Math.max(1, Number(data.interval) || 5) };
    }
    if (data.status === "approved") {
      const token = String(data.token ?? "");
      const signingKey = String(data.signing_key ?? "");
      if (!token.startsWith("anvr_")) throw new Error("Anvil returned a malformed runner token.");
      keyBytes(signingKey);
      if (!Number.isSafeInteger(data.runner?.id) || !data.runner?.name || !data.owner) {
        throw new Error("Anvil returned incomplete runner metadata.");
      }
      if (data.profile !== `laptop:${data.owner}`) {
        throw new Error(`Unexpected laptop profile ${String(data.profile)}.`);
      }
      await keyring.save({ token, signingKey });
      const enrollment = saveEnrollment({
        url: base,
        runner: { id: data.runner.id, name: String(data.runner.name) },
        profile: String(data.profile),
        owner: String(data.owner),
        channel: data.channel ?? { ticket_path: "/api/browser-runners/channel-ticket", path: "/api/browser-runners/channel" },
        manifest_path: data.manifest_path ?? "/api/browser-runners/laptop/manifest",
        enrolled_at: new Date().toISOString(),
        revoked: false,
        revoked_message: null,
      });
      log("anvil: enrolled runner", enrollment.runner.name, `(${enrollment.profile})`);
      return { status: "approved", enrollment };
    }
    throw new Error(`Unexpected poll status: ${String(data.status)}`);
  }

  /** Loads enrollment metadata + keyring secrets, or null when not enrolled / revoked. */
  async function loadCredentials() {
    const meta = loadEnrollment();
    if (!meta || meta.revoked || !meta.runner?.id || !meta.owner) return null;
    if (!keyring.isSecure()) return { error: "keyring unavailable", meta };
    try {
      const secrets = await keyring.load();
      if (!secrets) return null;
      return {
        url: meta.url,
        runner: meta.runner,
        profile: meta.profile,
        owner: meta.owner,
        channel: meta.channel,
        manifest_path: meta.manifest_path,
        token: secrets.token,
        signingKey: secrets.signingKey,
      };
    } catch (err) {
      return { error: `keyring locked (${String(err?.message ?? err).slice(0, 80)})`, meta };
    }
  }

  /** Disconnect from Ensō (§2.4): calls POST /api/browser-runners/laptop/revoke, then deletes keyring secrets. */
  async function disconnect() {
    const meta = loadEnrollment();
    let revokedOnServer = false;
    try {
      const creds = meta && keyring.isSecure() ? await keyring.load().catch(() => null) : null;
      if (creds?.token && meta?.url) {
        const res = await fetchImpl(`${normalizeAnvilUrl(meta.url)}/api/browser-runners/laptop/revoke`, {
          method: "POST",
          headers: { authorization: `Bearer ${creds.token}`, accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
          redirect: "error",
        }).catch(() => null);
        revokedOnServer = !!res && (res.ok || res.status === 401);
      }
    } finally {
      await keyring.clear();
      clearEnrollmentFile();
    }
    log("anvil: disconnected runner");
    return { ok: true, revokedOnServer };
  }

  /** On 4401 or HTTP 401 (§2.4): deletes keyring secrets and records revoked state so Ensō stops reconnecting. */
  async function handleRevoked(reason = REVOKED_MESSAGE) {
    await keyring.clear();
    const prev = loadEnrollment();
    if (prev) {
      saveEnrollment({ ...prev, revoked: true, revoked_message: reason || REVOKED_MESSAGE });
    }
    log("anvil: credentials revoked:", reason);
    return { revoked: true, message: reason || REVOKED_MESSAGE };
  }

  return {
    keyring,
    metaFile,
    loadEnrollment,
    saveEnrollment,
    loadCredentials,
    startEnroll,
    pollEnrollOnce,
    disconnect,
    handleRevoked,
  };
}
