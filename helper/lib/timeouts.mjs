// How long the helper waits for the browser, per page or browser action, and
// what an agent is told when that runs out.
//
// Tools that can take long (page_wait, page_eval, page_navigate, page_upload,
// session_fetch) accept `timeoutMs` (up to MAX_TIMEOUT_MS). The extension stops
// waiting at timeoutMs; the helper allows GRACE_MS on top for the answer to
// arrive. Running out never means the action failed: a click, an upload or a
// script may still be running in Zen and may still take effect, so the message
// says so and how to check before trying again.

export const MAX_TIMEOUT_MS = 120_000;
export const GRACE_MS = 5_000;

/** Defaults in ms, by bridge action (the extension's own wait for those that wait). */
export const DEFAULT_TIMEOUTS = {
  default: 20_000, // reading and simple actions (click, type, select…)
  navigate: 45_000,
  back: 30_000,
  wait: 30_000,
  eval: 30_000,
  upload: 60_000, // attaching only; the site's own upload is page_wait's job
  upload_chunk: 20_000,
  session_fetch: 75_000,
};

/** A timeout an agent asked for, clamped to 1 s … MAX_TIMEOUT_MS; undefined when it didn't ask. */
export function clampTimeout(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return undefined;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.round(Number(ms))));
}

/** How long the helper waits for the browser to answer one request. */
export function requestBudget(action, args = {}) {
  const asked = clampTimeout(args?.timeoutMs);
  if (asked != null) return asked + GRACE_MS;
  const base = DEFAULT_TIMEOUTS[action] ?? DEFAULT_TIMEOUTS.default;
  return action in DEFAULT_TIMEOUTS && action !== "default" && action !== "upload_chunk" ? base + GRACE_MS : base;
}

/** The error an agent gets when the browser didn't answer in time. */
export class BrowserTimeoutError extends Error {
  constructor(action, ms) {
    super(timeoutMessage(action, ms));
    this.name = "BrowserTimeoutError";
    this.action = action;
    this.timedOut = true;
  }
}

export function timeoutMessage(action, ms) {
  const s = Math.round(ms / 1000);
  return (
    `Timed out after ${s} s waiting for the browser (${action}). This does not mean it failed: the action may still be running in Zen and may still take effect. ` +
    "Check the page before trying again, so nothing is done twice: page_read, page_wait (for a selector, text, URL or network_idle) or devtools_network. " +
    `For slow steps pass a larger timeoutMs (up to ${MAX_TIMEOUT_MS / 1000} s).`
  );
}
