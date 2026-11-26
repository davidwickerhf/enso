// Local ceiling, private-site floor, and step classifier for Anvil laptop browser sessions.
// Enforced locally in Ensō regardless of what Anvil says (defence in depth).

import { isSensitiveHost } from "./safety.mjs";

export const REMOTE_TOOLS = Object.freeze([
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_navigate",
  "browser_screenshot",
]);

export const ACTING_TOOLS = new Set(["browser_click", "browser_type", "browser_navigate"]);

export const TOOL_TO_PAGE = Object.freeze({
  browser_snapshot: "page_read",
  browser_click: "page_click",
  browser_type: "page_type",
  browser_navigate: "page_navigate",
  browser_screenshot: "page_screenshot",
});

/** Exact hostname, or *.example.com for every name under it (not the apex). */
export const SITE_PATTERN = /^(?=.{1,253}$)(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Hard-coded private-site floor matching Anvil's floor (never overridable, combined with
 * Ensō's sensitiveHosts globs from config.json / config.local.json).
 */
export const PRIVATE_SITE_FLOOR = Object.freeze([
  "gov", "gov.uk", "gouv.fr", "overheid.nl", "belastingdienst.nl", "digid.nl", "bund.de", "europa.eu", "irs.gov",
  "bank", "paypal.com", "wise.com", "revolut.com", "bunq.com", "n26.com", "ing.nl", "ing.com", "abnamro.nl", "rabobank.nl",
  "chase.com", "bankofamerica.com", "wellsfargo.com", "hsbc.com", "barclays.co.uk",
  "1password.com", "bitwarden.com", "lastpass.com", "dashlane.com", "keepersecurity.com",
  "health", "mijngezondheid.net", "nhs.uk",
  "myaccount.google.com", "admin.google.com", "passwords.google.com",
]);

const DEFAULT_DENY_TOOLS = ["page_eval", "page_query", "page_inspect", "page_upload"];
const CONTROL_RANK = { off: 0, read: 1, full: 2 };

export function normalizeHost(hostOrUrl) {
  let s = String(hostOrUrl ?? "").trim();
  if (!s) return "";
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = new URL(s).hostname;
  } catch {}
  return s.toLowerCase().replace(/\.+$/, "");
}

/** Exact hostname match, or *.example.com for subdomains only (not example.com itself). */
export function siteMatches(host, pattern) {
  const h = normalizeHost(host);
  const p = String(pattern ?? "").trim().toLowerCase().replace(/\.+$/, "");
  if (!h || !p) return false;
  return p.startsWith("*.") ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p;
}

export function hostAllowed(host, patterns = []) {
  return patterns.some(p => siteMatches(host, p));
}

/** Whether a site pattern (exact or *.domain) is covered by a ceiling list. */
export function withinCeiling(site, ceiling = []) {
  const s = String(site ?? "").trim().toLowerCase().replace(/\.+$/, "");
  if (!SITE_PATTERN.test(s)) return false;
  if (s.startsWith("*.")) {
    const base = s.slice(2);
    return ceiling.some(c => {
      const p = String(c ?? "").trim().toLowerCase().replace(/\.+$/, "");
      if (!p.startsWith("*.")) return false;
      const cBase = p.slice(2);
      return base === cBase || base.endsWith(`.${cBase}`);
    });
  }
  return hostAllowed(s, ceiling);
}

/**
 * Why the private-site floor refuses a host, URL, or *.pattern, or null.
 * Checks both Anvil's PRIVATE_SITE_FLOOR and Ensō's config.sensitiveHosts.
 */
export function floorRefusal(hostOrUrl) {
  const raw = normalizeHost(hostOrUrl).replace(/^\*\./, "");
  if (!raw) return null;
  const hit = PRIVATE_SITE_FLOOR.find(d => raw === d || raw.endsWith(`.${d}`));
  if (hit) return `${raw} is on the private-site floor (${hit}): no browser session may open it`;
  if (isSensitiveHost(raw)) return `${raw} is on Ensō's private-site floor: no browser session may open it`;
  return null;
}

export function isPrivateSite(hostOrUrl) {
  return floorRefusal(hostOrUrl) !== null;
}

/**
 * Computes effective sites = requestedSites ∩ localAllowedSites, minus private-site floor.
 * An empty localAllowedSites always yields [].
 */
export function intersectSites(requestedSites = [], localAllowedSites = []) {
  const ceiling = (Array.isArray(localAllowedSites) ? localAllowedSites : [])
    .map(s => String(s ?? "").trim().toLowerCase().replace(/\.+$/, ""))
    .filter(s => SITE_PATTERN.test(s) && !isPrivateSite(s));
  if (!ceiling.length) return [];

  const out = new Set();
  for (const raw of Array.isArray(requestedSites) ? requestedSites : []) {
    const req = String(raw ?? "").trim().toLowerCase().replace(/\.+$/, "");
    if (!SITE_PATTERN.test(req) || isPrivateSite(req)) continue;
    if (withinCeiling(req, ceiling)) {
      out.add(req);
    } else if (req.startsWith("*.")) {
      for (const c of ceiling) {
        if (!c.startsWith("*.") && siteMatches(c, req)) out.add(c);
        else if (c.startsWith("*.") && siteMatches(c.slice(2), req)) out.add(c);
      }
    }
  }
  return [...out];
}

/** Resolves the local `config.json` / `config.local.json` `anvil` ceiling safely. */
export function resolveAnvilConfig(config = {}, settings = {}) {
  const raw = config?.anvil && typeof config.anvil === "object" ? config.anvil : {};
  const url = typeof raw.url === "string" && raw.url.trim() ? raw.url.trim().replace(/\/+$/, "") : "https://anvil.wicker.life";
  const allowed_sites = (Array.isArray(raw.allowed_sites) ? raw.allowed_sites : [])
    .map(s => String(s ?? "").trim().toLowerCase().replace(/\.+$/, ""))
    .filter(s => SITE_PATTERN.test(s) && !isPrivateSite(s));
  const localControl = ["full", "read", "off"].includes(raw.external_control) ? raw.external_control : "full";
  const userControl = ["full", "read", "off"].includes(settings?.externalControl) ? settings.externalControl : "full";
  const external_control = CONTROL_RANK[localControl] <= CONTROL_RANK[userControl] ? localControl : userControl;
  const denyList = Array.isArray(raw.deny_tools) ? raw.deny_tools.map(String) : DEFAULT_DENY_TOOLS;
  // page_eval is ALWAYS denied remotely, whatever the config says.
  const deny_tools = new Set([...denyList, "page_eval"]);
  const session_fetch = raw.session_fetch === "off" ? "off" : "get_only";
  const max_sessions = Math.max(1, Math.min(10, Math.round(Number(raw.max_sessions) || 2)));
  const updates = raw.updates === "off" ? "off" : "auto";
  return {
    url,
    allowed_sites,
    external_control,
    local_external_control: localControl,
    deny_tools,
    session_fetch,
    max_sessions,
    updates,
  };
}

/** Checks whether a remote tool call is permitted by external_control and deny_tools. */
export function checkCeilingForTool(tool, anvilCfg) {
  if (tool === "page_eval") {
    return { ok: false, code: "denied_by_ceiling", message: "page_eval is always denied for remote sessions." };
  }
  if (!REMOTE_TOOLS.includes(tool)) {
    return { ok: false, code: "tool_not_allowed", message: `${String(tool).slice(0, 40)} is not reachable remotely.` };
  }
  if (anvilCfg.external_control === "off") {
    return { ok: false, code: "control_off", message: "External control is switched off in Ensō." };
  }
  if (anvilCfg.external_control === "read" && ACTING_TOOLS.has(tool)) {
    return { ok: false, code: "control_off", message: "External control is set to read-only in Ensō." };
  }
  const pageTool = TOOL_TO_PAGE[tool];
  if (pageTool && anvilCfg.deny_tools.has(pageTool)) {
    return { ok: false, code: "denied_by_ceiling", message: `${pageTool} is denied by Ensō's local anvil config.` };
  }
  return { ok: true };
}

/** Enforces session_fetch ceiling: get_only refuses non-GET; session access always asks. */
export function checkSessionFetch(method, anvilCfg) {
  const m = String(method ?? "GET").toUpperCase();
  if (anvilCfg.session_fetch === "off") {
    return { action: "refuse", code: "denied_by_ceiling", message: "session_fetch is disabled by Ensō's local config." };
  }
  if (anvilCfg.session_fetch === "get_only" && m !== "GET") {
    return { action: "refuse", code: "tool_not_allowed", message: `Remote session_fetch only allows GET requests (got ${m}).` };
  }
  return { action: "ask", reason: "session_access", description: `Use signed-in session (${m} request)` };
}

// ---------- Step classifier (§7.1) ----------

/** Accessible names that indicate an irreversible action (English + common European equivalents). */
export const IRREVERSIBLE_NAME = /\b(submit|delete|remove|destroy|erase|wipe|purge|pay|payment|purchase|buy|checkout|order|subscribe|unsubscribe|send|publish|deploy|promote|transfer|revoke|reset|rotate|regenerate|disable|deactivate|archive|close account|cancel (plan|subscription)|add member|invite|grant|share|download (key|json|credentials)|create( key| credentials| token)?|confirm|accept|approve|sign|merge|terminate|uninstall|leave|verwijder(en)?|betaal|betalen|verzend(en)?|verstuur|bevestig(en)?|löschen|bezahlen|senden|bestätigen|supprimer|payer|envoyer|confirmer|eliminar|pagar|enviar)\b/i;

/** URLs whose pages change accounts, money, or access. */
export const SENSITIVE_URL = /\/(billing|payment|payments|checkout|subscription|security|iam|iam-admin|credentials|apis\/credentials|tokens|api-keys|keys|secrets|members|team\/members|access|permissions|danger|account\/(delete|close|security)|settings\/(account|security|billing|members|danger))(\/|$|\?|#)/i;

const PAYMENT_FIELD = /card|cc-|cvc|cvv|iban|expir|security code/i;
const CREDENTIAL_FIELD = /secret|token|api[ _-]?key|private key|client secret|\botp\b|one[- ]time|verification code|2fa|recovery/i;
const SEARCH_FIELD = /search|filter|find|query|look ?up/i;
const FILE_LINK = /\.(zip|json|pem|key|p12|pfx|csv|xlsx?|pdf|tar|gz|tgz|env|txt|sql|bak)(\?|#|$)/i;
export const SECRET_TARGET = /secret|token|key|otp|code|card|cvc|cvv|iban|pass(word|code|phrase)?\b|\bpin\b/i;

const hostOf = u => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return null;
  }
};
const pathOf = u => {
  try {
    return new URL(u).pathname;
  } catch {
    return "";
  }
};
const refuse = (code, message) => ({ action: "refuse", code, message });

function decide(asks, granted) {
  if (!asks.length || granted) return { action: "allow" };
  const order = ["off_site", "session_access", "irreversible", "unrequested"];
  const [reason, description] = [...asks].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))[0];
  return { action: "ask", reason, description: description.replace(/\s+/g, " ").trim().slice(0, 200) };
}

/**
 * Classifies one acting call before execution.
 * Returns { action: "allow" } | { action: "ask", reason, description } | { action: "refuse", code, message }.
 * A grant turns "ask" into "allow" for that single call, and NEVER lifts a refusal.
 */
export function classifyStep({ tool, args = {}, url = "", target = null, sites = [], allowedSites = null, granted = false }) {
  const page = hostOf(url);
  if (page && floorRefusal(page)) return refuse("private_site", `${floorRefusal(page)}.`);
  const t = target ?? {};
  const name = String(t.name ?? "").trim();
  const what = `${t.role ?? "element"}${name ? ` "${name.slice(0, 80)}"` : ""}`;
  const on = page ? ` on ${page}` : "";

  if (tool === "browser_navigate") {
    const dest = String(args.url ?? "");
    const host = hostOf(dest);
    if (!host) return refuse("bad_args", "That isn't a valid URL.");
    if (!dest.startsWith("https://")) return refuse("tool_not_allowed", "Remote sessions open https pages only.");
    if (floorRefusal(host)) return refuse("private_site", `${floorRefusal(host)}.`);
    if (Array.isArray(allowedSites) && !hostAllowed(host, allowedSites)) {
      return refuse("denied_by_ceiling", `${host} is outside Ensō's local allowed_sites ceiling.`);
    }
    const asks = [];
    if (!hostAllowed(host, sites)) asks.push(["off_site", `Open ${host} (outside the session's sites)`]);
    if (args.irreversible === true || SENSITIVE_URL.test(pathOf(dest))) {
      asks.push(["irreversible", `Open ${dest.slice(0, 120)} (a page that changes accounts, money or access)`]);
    }
    if (args.requested_by_user === false) asks.push(["unrequested", `Open ${host} (the agent's own initiative, not the task)`]);
    return decide(asks, granted);
  }

  if (tool !== "browser_click" && tool !== "browser_type") return { action: "allow" };
  if (!target) {
    return decide([["irreversible", `${tool === "browser_click" ? "Click" : "Type"} at the cursor${on} (can't tell what it does)`]], granted);
  }
  if (tool === "browser_type" && t.password_field) {
    return refuse("tool_not_allowed", "Remote sessions never type into password fields: the owner signs in themselves.");
  }

  const asks = [];
  const verb = tool === "browser_click" ? "Click" : "Type into";
  if (args.irreversible === true) asks.push(["irreversible", `${verb} ${what}${on} (marked irreversible)`]);
  if (t.destructive) asks.push(["irreversible", `${verb} ${what}${on} (the page marks it destructive)`]);
  if (SENSITIVE_URL.test(pathOf(url))) asks.push(["irreversible", `${verb} ${what}${on} (a page that changes accounts, money or access)`]);

  if (tool === "browser_click") {
    if (!name && !t.href) asks.push(["irreversible", `Click an unnamed ${t.role ?? "element"}${on} (can't tell what it does)`]);
    if (IRREVERSIBLE_NAME.test(name)) asks.push(["irreversible", `Click ${what}${on}`]);
    if (t.submits && (t.form_has_password || t.form_has_payment)) {
      asks.push(["irreversible", `Click ${what}${on} (submits a form with a ${t.form_has_password ? "password" : "payment"} field)`]);
    } else if (t.submits && !SEARCH_FIELD.test(name)) {
      asks.push(["irreversible", `Click ${what}${on} (submits a form)`]);
    }
    if (t.download || (t.href && FILE_LINK.test(t.href))) asks.push(["session_access", `Download from ${what}${on}`]);
    const dest = t.href ? hostOf(t.href) : null;
    if (dest && /^https?:/.test(t.href)) {
      if (floorRefusal(dest)) return refuse("private_site", `${floorRefusal(dest)}.`);
      if (Array.isArray(allowedSites) && !hostAllowed(dest, allowedSites)) {
        return refuse("denied_by_ceiling", `${dest} is outside Ensō's local allowed_sites ceiling.`);
      }
      if (!hostAllowed(dest, sites)) asks.push(["off_site", `Follow ${what} to ${dest} (outside the session's sites)`]);
    }
  } else {
    const field = `${name} ${t.autocomplete ?? ""}`;
    if (t.payment_field || PAYMENT_FIELD.test(field)) asks.push(["irreversible", `Type into ${what}${on} (a payment field)`]);
    if (CREDENTIAL_FIELD.test(field) || /one-time-code|new-password|current-password/.test(String(t.autocomplete ?? ""))) {
      asks.push(["irreversible", `Type into ${what}${on} (a credential field)`]);
    }
    if (args.submit === true) {
      const search = t.role === "searchbox" || t.role === "search" || SEARCH_FIELD.test(field);
      if (t.form_has_password || t.form_has_payment) {
        asks.push(["irreversible", `Type into ${what} and submit${on} (a form with a ${t.form_has_password ? "password" : "payment"} field)`]);
      } else if (!search) {
        asks.push(["irreversible", `Type into ${what} and press Enter${on} (may submit a form)`]);
      }
    }
  }
  if (args.requested_by_user === false) asks.push(["unrequested", `${verb} ${what}${on} (the agent's own initiative, not the task)`]);
  return decide(asks, granted);
}

export function textShape(text) {
  const t = String(text ?? "");
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return "email";
  if (/^https?:\/\/\S+$/i.test(t)) return "url";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "number";
  return "text";
}

export function stepTarget(tool, args, target, entry, scrub = x => x) {
  if (tool === "browser_navigate") return null;
  const name = String(target?.name ?? entry?.name ?? "").slice(0, 200);
  const clean = scrub(name) === name ? name : null;
  const out = target || entry
    ? { role: String(target?.role ?? entry?.role ?? "").slice(0, 40) || null, name: clean || null, nth: Number.isSafeInteger(entry?.nth) ? Math.max(0, Math.min(1000, entry.nth)) : 0 }
    : { role: null, name: null, nth: 0 };
  if (tool === "browser_type") {
    const text = String(args?.text ?? "");
    out.typed = { shape: textShape(text), chars: Math.min(4000, text.length) };
    if (SECRET_TARGET.test(`${name} ${target?.autocomplete ?? ""}`) || target?.password_field) out.secret = true;
  }
  return out;
}
