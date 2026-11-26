// Anvil laptop browser runner wire cryptography (anvil-laptop-v1):
// canonical JSON, HMAC-SHA256 message signing & verification, call_hash, and secret scrubbing.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LAPTOP_PROTOCOL = "anvil-laptop-v1";
export const LAPTOP_MESSAGE_KINDS = Object.freeze(["session.start", "session.allow", "session.stop", "browser.call", "step.decided"]);
export const LAPTOP_SKEW_S = 120;

const UUID_RE = /^[0-9a-f-]{36}$/;

export function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Canonical JSON: object keys sorted by UTF-16 code unit, no whitespace,
 * JSON string escaping, safe integers only (no floats/NaN/Infinity), null,
 * booleans, arrays in order.
 */
export function canonicalJson(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error("canonical JSON: only safe integers");
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  throw new Error(`canonical JSON: unsupported ${typeof v}`);
}

export function keyBytes(key) {
  const b = Buffer.from(String(key ?? ""), "base64url");
  if (b.length < 32) throw new Error("signing key must be at least 32 bytes (base64url)");
  return b;
}

/**
 * The 7-line signed text for an anvil-laptop-v1 event:
 *   anvil-laptop-v1
 *   <kind>
 *   <session>
 *   <seq>
 *   <sha256 hex of canonical JSON of body>
 *   <runner_id>
 *   <expires_at>
 */
export function signingMessage({ kind, session, seq, body, runnerId, expiresAt }) {
  if (!LAPTOP_MESSAGE_KINDS.includes(kind)) throw new Error("unknown message kind");
  if (!UUID_RE.test(String(session ?? ""))) throw new Error("session must be a uuid");
  if (!Number.isSafeInteger(seq) || seq < 0 || !Number.isSafeInteger(runnerId) || !Number.isSafeInteger(expiresAt)) {
    throw new Error("seq, runnerId and expiresAt must be safe integers");
  }
  return [
    LAPTOP_PROTOCOL,
    kind,
    session,
    String(seq),
    sha256Hex(canonicalJson(body ?? null)),
    String(runnerId),
    String(expiresAt),
  ].join("\n");
}

export function signLaptopMessage(key, fields) {
  return createHmac("sha256", keyBytes(key)).update(signingMessage(fields)).digest("base64url");
}

/**
 * Verifies an incoming Anvil event using Ensō's own runnerId from enrollment:
 *   1. Rebuilds signed text with runnerId and compares HMAC in constant time (bad_signature)
 *   2. Checks expiry with 120 s clock skew tolerance (expired)
 *   3. Checks seq strictly grows per session (replayed)
 *   4. Checks kind equals the event's name (bad_message)
 */
export function verifyLaptopEvent(key, eventName, msg, { runnerId, now = Date.now(), lastSeq } = {}) {
  try {
    if (
      !msg ||
      typeof msg !== "object" ||
      !LAPTOP_MESSAGE_KINDS.includes(msg.kind) ||
      !UUID_RE.test(String(msg.session ?? "")) ||
      !Number.isSafeInteger(msg.seq) ||
      msg.seq < 0 ||
      !Number.isSafeInteger(msg.expires_at) ||
      typeof msg.sig !== "string"
    ) {
      return { ok: false, error: "bad_message" };
    }
    const want = Buffer.from(
      signLaptopMessage(key, {
        kind: msg.kind,
        session: msg.session,
        seq: msg.seq,
        body: msg.body,
        runnerId,
        expiresAt: msg.expires_at,
      }),
    );
    const got = Buffer.from(msg.sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) {
      return { ok: false, error: "bad_signature" };
    }
    if (msg.expires_at * 1000 + LAPTOP_SKEW_S * 1000 < now) {
      return { ok: false, error: "expired" };
    }
    if (lastSeq !== undefined && msg.seq <= lastSeq) {
      return { ok: false, error: "replayed" };
    }
    if (eventName && msg.kind !== eventName) {
      return { ok: false, error: "bad_message" };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "bad_message" };
  }
}

/** sha256 hex of canonical JSON of { session, tool, args }. */
export function callHash(session, tool, args) {
  return sha256Hex(canonicalJson({ session, tool, args: args ?? {} }));
}

const TOKEN_PATTERNS = [
  /anv[rcto]_[A-Za-z0-9_-]{8,}/g,
  /anvl_[a-z2-7]{16,}/g,
  /anvc_[A-Za-z0-9_-]{8,}/g,
  /(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /(?:gh[pousr]_|github_pat_|glpat-|xox[abpr]-|sk-ant-|sk-|AKIA[0-9A-Z]{8})[A-Za-z0-9_-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g,
];

/** Scrubs known secret strings and credential-shaped tokens from text before logging or returning. */
export function scrubSecrets(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) {
    if (typeof s === "string" && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  for (const re of TOKEN_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}
