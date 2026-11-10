// What a page shows while Ensō's native helper isn't running, or doesn't answer.
//
// helperDownCard: "Ensō's helper isn't running", why (not found / failed to
// start / exited, with the browser's error text), and Try again, Copy
// diagnostics, Open the install guide. Shown in the banner slot and, compact,
// in every place that waits for helper data.
//
// loadingOr(store, key, label): what a section shows while it waits for the
// helper's answer to the request registered under `key` (store.js wait()):
// the helper-not-running card, "Couldn't load: …" with Retry after WAIT_MS, or
// the spinner. One component, so no view shows "Loading…" forever.
//
// Copy diagnostics copies a short text: extension version, the helper status
// from background.js and its last error, the browser and platform, and either
// the end of helper.log (when the helper answers; it redacts the lines) or the
// path of the log to send. Nothing from conversations or pages is included.

import { h, icon, clear } from "../dom.js";
import { WAIT_MS } from "../store.js";

const SITE = "https://enso.wicker.life";
export const INSTALL_GUIDE = `${SITE}/docs/install`;
export const TROUBLESHOOTING = `${SITE}/docs/troubleshooting#if-ens-says-the-helper-stopped`;
export const LOG_PATH = "~/Library/Logs/Enso/helper.log";
export const PLATFORM_DOCS = `${SITE}/docs/install#requirements`;
export const REPO = "https://github.com/davidwickerhf/enso";
export const UNSUPPORTED_TEXT = "Ensō's helper runs on macOS only for now. Windows and Linux support is planned.";

/** { kind, title, explain } for a helper status (missing | failed | stopped). */
export function describeHelper(hp) {
  const raw = String(hp?.reason ?? hp?.lastError?.message ?? "").trim();
  // background.js's own fallbacks say the same as the explanation; only show the browser's text.
  const reason = /^the helper (stopped|exited as soon as it started)$/.test(raw) ? "" : raw;
  switch (hp?.state) {
    case "missing":
      return { kind: "not found", title: "Not found", explain: "Zen can't find the helper: it isn't installed, or the file that registers it is missing.", reason };
    case "failed":
      return { kind: "failed to start", title: "Failed to start", explain: "The helper is installed, but it exited as soon as Zen started it.", reason };
    case "stopped":
      return { kind: "exited", title: "Exited", explain: "The helper was running, then stopped. Ensō keeps trying to reconnect.", reason };
    default:
      return { kind: hp?.state ?? "unknown", title: hp?.state ?? "Unknown", explain: "", reason };
  }
}

const time = at => (at ? new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

/** The text Copy diagnostics puts on the clipboard (pure, for tests). */
export function diagnosticsText({ extVersion, browserName, platform, helper, helperLog, now = Date.now() }) {
  const d = describeHelper(helper);
  const lines = [`Ensō diagnostics (${new Date(now).toISOString()})`];
  lines.push(`Extension: ${extVersion ?? "unknown"}`);
  lines.push(`Browser: ${browserName ?? "unknown"}`);
  lines.push(`Platform: ${platform ?? "unknown"}`);
  const since = helper?.at ? ` since ${new Date(helper.at).toISOString()}` : "";
  const failures = helper?.failures ? `, ${helper.failures} failed attempt${helper.failures === 1 ? "" : "s"} in a row` : "";
  lines.push(`Helper status: ${helper?.state ?? "unknown"}${["missing", "failed", "stopped"].includes(helper?.state) ? ` (${d.kind})` : ""}${since}${failures}`);
  const le = helper?.lastError;
  if (le) {
    const ran = le.ranMs ? `, after running ${Math.round(le.ranMs / 1000)} s` : le.state === "failed" ? ", before it said anything" : "";
    lines.push(`Last error: ${le.message ? JSON.stringify(le.message) : "(no reason given by the browser)"} (${le.state ?? "?"}, ${le.at ? new Date(le.at).toISOString() : "?"}${ran})`);
  } else {
    lines.push("Last error: none");
  }
  if (helperLog) {
    lines.push(`Helper: ${helperLog.version ?? "unknown"}, Node ${helperLog.node?.version ?? "?"} at ${helperLog.node?.path ?? "?"}${helperLog.platform ? `, ${helperLog.platform}` : ""}`);
    lines.push("", `Last ${helperLog.lines.length} lines of ${LOG_PATH} (secrets removed):`, ...helperLog.lines);
  } else {
    lines.push("", `Also send ${LOG_PATH} (in Finder: Go → Go to Folder…, paste the path).`);
  }
  return lines.join("\n");
}

async function browserFacts() {
  const rt = globalThis.browser?.runtime;
  let extVersion = null;
  let browserName = null;
  let platform = null;
  try { extVersion = rt?.getManifest?.().version ?? null; } catch {}
  try {
    const b = await rt?.getBrowserInfo?.();
    if (b) browserName = `${b.name} ${b.version}${b.vendor && b.vendor !== b.name ? ` (${b.vendor})` : ""}`;
  } catch {}
  try {
    const p = await rt?.getPlatformInfo?.();
    if (p) platform = `${p.os} ${p.arch}`;
  } catch {}
  const ua = globalThis.navigator?.userAgent ?? "";
  if (!browserName) browserName = ua.match(/(Zen|Firefox)\/[\d.]+[a-z\d]*/g)?.join(" ") || ua || null;
  if (!platform) platform = globalThis.navigator?.platform ?? null;
  return { extVersion: extVersion ?? (rt ? null : "development page (no extension)"), browserName, platform };
}

/** Builds the diagnostics text: asks the helper for its log when it's connected. */
export async function buildDiagnostics(store) {
  const [facts, helperLog] = await Promise.all([browserFacts(), store.actions.requestHelperLog()]);
  return diagnosticsText({ ...facts, helper: store.state.helper, helperLog });
}

function copyDiagnosticsButton(store, cls = "btn small") {
  const label = () => [icon("copy"), "Copy diagnostics"];
  const btn = h("button", { type: "button", class: cls }, label());
  let timer = null;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const text = await buildDiagnostics(store);
      await navigator.clipboard.writeText(text);
      clear(btn, icon("check"), "Copied");
    } catch {
      clear(btn, icon("alert"), "Couldn't copy");
    }
    btn.disabled = false;
    clearTimeout(timer);
    timer = setTimeout(() => clear(btn, label()), 2400);
  });
  return btn;
}
export { copyDiagnosticsButton };

/**
 * Linux and Windows: the helper can't run there yet. No install command, no
 * waiting, no Try again: just what works and where to follow the work.
 */
function unsupportedCard({ compact }) {
  return h("div", { class: ["helper-down", "unsupported", compact && "compact"], role: "status" },
    icon("info"),
    h("div", { class: "hd-body" },
      h("strong", null, UNSUPPORTED_TEXT),
      compact ? null : h("p", { class: "hd-reason" }, "Chat, memory, history, settings and your tools all run in the helper, so they're unavailable on this computer. The new tab's search box, clock, quick links and note still work."),
      h("div", { class: "hd-actions" },
        h("a", { class: "btn small", href: PLATFORM_DOCS, target: "_blank", rel: "noopener" }, "Requirements", icon("arrowUpRight")),
        h("a", { class: "btn small ghost", href: REPO, target: "_blank", rel: "noopener" }, "Ensō on GitHub", icon("arrowUpRight")))));
}

/** "Ensō's helper isn't running" with the reason and the three actions. compact: for inside a section. */
export function helperDownCard(store, { compact = false } = {}) {
  if (store.unsupported()) return unsupportedCard({ compact });
  const hp = store.state.helper;
  const d = describeHelper(hp);
  const retry = h("button", { type: "button", class: ["btn", "small", !compact && "primary"], onclick: () => { store.actions.helperRetry(); } }, icon("refresh"), "Try again");
  return h("div", { class: ["helper-down", compact && "compact"], role: "alert" },
    icon("alert"),
    h("div", { class: "hd-body" },
      h("strong", null, "Ensō's helper isn't running"),
      h("p", { class: "hd-reason" },
        h("span", { class: "hd-kind" }, d.title), compact ? null : `: ${d.explain}`,
        d.reason ? h("span", { class: "hd-error" }, compact ? ` (${d.reason})` : ` The browser said: “${d.reason}”.`) : null,
        hp.at && !compact ? h("span", { class: "muted" }, ` ${time(hp.at)}`) : null),
      h("div", { class: "hd-actions" },
        retry,
        copyDiagnosticsButton(store),
        compact ? null : h("a", { class: "btn small ghost", href: INSTALL_GUIDE, target: "_blank", rel: "noopener" }, "Open the install guide", icon("arrowUpRight"))),
      compact ? null : h("p", { class: "hd-hint muted" }, "Copy diagnostics and send it with ", h("code", null, LOG_PATH), ". In Terminal, ", h("code", null, "enso doctor"), " checks the install. ", h("a", { href: TROUBLESHOOTING, target: "_blank", rel: "noopener" }, "Troubleshooting"))));
}

/** "Couldn't load: <reason>" with Retry. */
export function loadFailed(store, key, reason = `Ensō's helper didn't answer within ${Math.round(WAIT_MS / 1000)} seconds.`) {
  return h("div", { class: "load-failed", role: "alert" },
    icon("alert"),
    h("span", null, "Couldn't load: ", reason),
    h("button", { type: "button", class: "btn small", onclick: () => store.actions.retryLoad(key) }, icon("refresh"), "Retry"));
}

/**
 * What to show while waiting for the helper's answer to `key`:
 * the helper-not-running card, "Couldn't load" + Retry, or the placeholder
 * (default: a spinner with `label`).
 */
export function loadingOr(store, key, label = "Loading…", { placeholder, tiny = false } = {}) {
  const st = store.loadState(key);
  if (tiny && st === "down" && store.unsupported()) {
    return h("p", { class: "load-tiny", role: "status" }, icon("info"), "Needs Ensō's helper, which runs on macOS only for now. ", h("a", { class: "b-link", href: PLATFORM_DOCS, target: "_blank", rel: "noopener" }, "Why"));
  }
  if (tiny && st !== "loading") {
    // Small tiles (new-tab widgets, the context panel): one line and a link-style button.
    return h("p", { class: "load-tiny", role: "status" }, icon("alert"),
      st === "down" ? "Ensō's helper isn't running." : "Couldn't load.", " ",
      h("button", { type: "button", class: "b-link", onclick: () => store.actions.retryLoad(key) }, st === "down" ? "Try again" : "Retry"));
  }
  if (st === "down") return helperDownCard(store, { compact: true });
  if (st === "timeout") return loadFailed(store, key);
  return placeholder ?? h("div", { class: "list-loading" }, h("span", { class: "spinner" }), label);
}
