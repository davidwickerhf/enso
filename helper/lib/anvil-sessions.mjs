// Supervised remote browser sessions for Anvil's laptop runner (LAPTOP-RUNNER.md §5–§9):
// signed event verification, local ceiling & floor enforcement, tab lifecycle & leases,
// compact @eN snapshots, step classifier & approval relay, single-use call_hash grants,
// and screenshot capture & upload with sensitive-field/private-site redaction.

import { normalizeAnvilUrl } from "./anvil-auth.mjs";
import { callHash, LAPTOP_MESSAGE_KINDS, scrubSecrets, verifyLaptopEvent } from "./anvil-crypto.mjs";
import {
  ACTING_TOOLS,
  checkCeilingForTool,
  checkPageAuthorized,
  classifyStep,
  floorRefusal,
  hostAllowed,
  intersectSites,
  isPrivateSite,
  REMOTE_TOOLS,
  SECRET_TARGET,
  stepTarget,
  withinCeiling,
} from "./anvil-policy.mjs";

export const MAX_SNAPSHOT_CHARS = 120_000;
export const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const UUID_RE = /^[0-9a-f-]{36}$/;
const REF_RE = /^@e([1-9]\d{0,5})$/;
const HIDDEN = "(hidden)";

const INTERACTIVE_ROLES = new Set([
  "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
  "listbox", "option", "menuitem", "menuitemcheckbox", "menuitemradio",
  "tab", "switch", "slider", "spinbutton", "treeitem", "select", "search", "email", "submit",
]);
const VALUED_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "select", "search", "email"]);

const SECRET_FIELD_RE = /pass(word|code|phrase)?\b|secret|token|api[ _-]?key|private key|client secret|\bpin\b|\botp\b|one[- ]time|verification code|2fa|cvc|cvv|security code|card number|iban/i;
const SECRET_VALUE_RE = /(anv[rcto]_|gh[pousr]_|github_pat_|glpat-|xox[abpr]-|sk-[A-Za-z0-9]|AKIA[0-9A-Z]{8}|AIza[0-9A-Za-z_-]{20}|ya29\.|GOCSPX-|-----BEGIN)|^[A-Za-z0-9+/_=-]{32,}$|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./;

const q = s => JSON.stringify(String(s ?? ""));

/** Redacts password values and credential-looking values from snapshot fields. */
export function redactSnapshotValue(name, value, passwords = []) {
  const v = String(value ?? "");
  if (!v) return "";
  if (SECRET_FIELD_RE.test(String(name ?? ""))) return HIDDEN;
  if (passwords.some(p => p && p.length >= 4 && v.includes(p))) return HIDDEN;
  if (SECRET_VALUE_RE.test(v.trim())) return HIDDEN;
  return v;
}

function hidePasswords(text, passwords = []) {
  let out = String(text ?? "");
  for (const p of passwords) {
    if (p && p.length >= 4) out = out.split(p).join(HIDDEN);
  }
  return out;
}

/**
 * Stable @eN ref table for one remote session: maps (role, name, nth) -> persistent integer ref
 * across snapshots, while tracking the latest snapshot's live mapping to pageagent.js integer refs.
 */
export function createSessionRefTable() {
  const persistent = new Map(); // "role\0name\0nth" -> stable @eN integer
  let nextId = 1;
  let current = new Map(); // stable @eN integer -> { pageRef, role, name, nth }

  return {
    /**
     * Renders structured nodes from pageagent.js `anvil_snapshot` into the §8.2 compact
     * accessibility snapshot format:
     *   heading "Domains"
     *   @e1 link "Overview"
     *     @e3 textbox "Add a domain" value=""
     */
    render(nodes = [], { passwords = [], max = MAX_SNAPSHOT_CHARS } = {}) {
      const out = [];
      const nthByKey = new Map();
      const live = new Map();

      for (const node of Array.isArray(nodes) ? nodes : []) {
        const depth = Math.max(0, Math.min(16, Number(node.depth) || 0));
        const pad = "  ".repeat(depth);
        const role = String(node.role ?? "text").trim() || "text";
        const name = String(node.name ?? "").trim();
        const interactive = !!node.interactive || (node.ref != null && INTERACTIVE_ROLES.has(role));

        if (!interactive) {
          const label = name || (node.text ? String(node.text).trim() : "");
          if (!label) continue;
          out.push(`${pad}${role} ${q(hidePasswords(label, passwords))}`);
          continue;
        }

        const nk = `${role}\u0000${name}`;
        const nth = nthByKey.get(nk) ?? 0;
        nthByKey.set(nk, nth + 1);
        const key = `${nk}\u0000${nth}`;

        let stable = persistent.get(key);
        if (!stable) {
          stable = nextId++;
          persistent.set(key, stable);
        }
        live.set(stable, { pageRef: Number(node.ref), role, name, nth });

        let line = `${pad}@e${stable} ${role}${name ? ` ${q(hidePasswords(name, passwords))}` : ""}`;
        if (VALUED_ROLES.has(role) && !node.password) {
          line += ` value=${q(redactSnapshotValue(name, node.value ?? "", passwords))}`;
        } else if (node.password) {
          // Password values are never included
          line += ` value=""`;
        }
        if (node.checked === true) line += " checked";
        else if (node.checked === "mixed") line += " checked=mixed";
        if (node.disabled === true) line += " disabled";
        if (node.expanded === true) line += " expanded";
        out.push(line);
      }

      current = live;
      let text = out.join("\n");
      if (text.length > max) {
        text = `${text.slice(0, max - 80)}\n… (cut: the page is long; navigate to the part you need)`;
      }
      return text;
    },

    lookup(ref) {
      const m = REF_RE.exec(String(ref ?? ""));
      if (!m) return null;
      return current.get(Number(m[1])) ?? null;
    },

    get size() {
      return current.size;
    },
  };
}

function decodeDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new Error("Invalid screenshot data URL");
  return { mime: m[1], bytes: Buffer.from(m[2], "base64") };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const errBody = (code, message, extra = {}) => ({
  ok: false,
  error: { code, message: String(message).slice(0, 500), ...extra },
});

export function createAnvilSessionManager({
  getCredentials,
  getAnvilConfig,
  callChannel,
  browserRequest,
  agentSessions = null,
  fetchImpl = globalThis.fetch,
  onChange = () => {},
  onRevoked = () => {},
  onSessionsIdle = () => {},
  onAction = () => {},
  now = Date.now,
  settleMs = 400,
  log = () => {},
} = {}) {
  const sessions = new Map(); // sessionId -> session object
  const startingSessions = new Set(); // reserved capacity slots while opening dedicated tabs
  const lastSeq = new Map(); // sessionId -> last accepted seq
  const chains = new Map(); // sessionId -> serialized promise tail
  const pendingSteps = new Map(); // stepId -> { stepId, sessionId, tabId, tool, reason, description, url, deadline, status, decidedBy, at, callHash }

  function changed() {
    try { onChange(); } catch {}
  }

  function serial(sessionId, fn) {
    const key = sessionId || "?";
    const next = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = next.catch(() => {});
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return next;
  }

  function currentSecrets(creds) {
    return creds ? [creds.token, creds.signingKey].filter(Boolean) : [];
  }

  function agentClientFor(s) {
    return { label: "Anvil", name: "anvil", session: `anvil:${s.id}`, via: "anvil" };
  }

  async function sendResult(body) {
    const out = { ...body };
    if (typeof out.url === "string") out.url = out.url.slice(0, 2000);
    try {
      await callChannel("browser.result", out);
    } catch (err) {
      log("anvil: browser.result delivery failed:", err?.message ?? err);
    }
    return out;
  }

  async function sendEnded(sessionId, reason, error = false) {
    try {
      await callChannel("session.ended", {
        session: sessionId,
        reason: String(reason ?? "ended").slice(0, 200),
        error: !!error,
      });
    } catch (err) {
      log("anvil: session.ended delivery failed:", err?.message ?? err);
    }
  }

  async function uploadShot(creds, sessionId, seq, bytes, mime = "image/png") {
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_SHOT_BYTES) return null;
    const base = normalizeAnvilUrl(creds.url);
    const u = new URL("/api/browser-runners/laptop/shots", `${base}/`);
    u.searchParams.set("session", sessionId);
    if (Number.isSafeInteger(seq)) u.searchParams.set("seq", String(seq));
    const res = await fetchImpl(u.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        "content-type": mime,
        accept: "application/json",
      },
      body: bytes,
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (res.status === 401) {
      await Promise.resolve(onRevoked("Token revoked (401 on shot upload)")).catch(() => {});
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || !Number.isSafeInteger(body?.id)) return null;
    return body.id;
  }

  /**
   * Captures and uploads a screenshot of the session's tab, enforcing the sensitive-field
   * and private-site rules (§9). When `outlinePageRef` is given, outlines the target first.
   */
  async function captureAndUploadShot(s, creds, seq, { outlinePageRef = null } = {}) {
    if (s.quiet || s.tabId == null) return null;
    if (!s.url || !/^https?:/i.test(s.url)) return null;
    const cfg = getAnvilConfig();
    if (!checkPageAuthorized(s.url, s.sites, cfg.allow_approved_sites ? null : cfg.allowed_sites).ok) return null;
    try {
      // Never capture a tab showing a filled password or credential field.
      const sensitive = await browserRequest("page.request", "has_sensitive_field", {}, s.tabId, "Anvil", s.uiId).catch(() => null);
      if (sensitive?.sensitive) return null;

      if (outlinePageRef != null) {
        await browserRequest("page.request", "outline_ref", { ref: outlinePageRef, on: true }, s.tabId, "Anvil", s.uiId).catch(() => {});
      }
      let shotRes;
      try {
        shotRes = await browserRequest("page.request", "screenshot", {}, s.tabId, "Anvil", s.uiId);
      } finally {
        if (outlinePageRef != null) {
          await browserRequest("page.request", "outline_ref", { ref: outlinePageRef, on: false }, s.tabId, "Anvil", s.uiId).catch(() => {});
        }
      }
      if (!shotRes?.dataUrl) return null;
      const { mime, bytes } = decodeDataUrl(shotRes.dataUrl);
      if (bytes.byteLength > MAX_SHOT_BYTES) return null;
      return await uploadShot(creds, s.id, seq, bytes, mime);
    } catch (err) {
      log("anvil: screenshot skipped:", scrubSecrets(err?.message ?? err, currentSecrets(creds)));
      return null;
    }
  }

  async function closeSession(sessionId, reason) {
    const s = sessions.get(sessionId);
    if (!s) return false;
    sessions.delete(sessionId);
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    for (const [stepId, st] of pendingSteps) {
      if (st.sessionId === sessionId) pendingSteps.delete(stepId);
    }
    if (agentSessions) {
      try { agentSessions.endClient(agentClientFor(s)); } catch {}
    }
    const tabIds = [...s.tabIds];
    if (tabIds.length) {
      await browserRequest("browser.request", "tabs_close", { tabIds }, null).catch(() => {});
    }
    log("anvil: session closed", sessionId, reason);
    changed();
    if (sessions.size === 0) {
      try { onSessionsIdle(); } catch {}
    }
    return true;
  }

  async function handleStart(m, creds) {
    const id = m.session;
    const b = m.body ?? {};
    const cfg = getAnvilConfig();

    const refuseStart = async (code, reason) => {
      log("anvil: session refused", id, code, reason);
      await sendEnded(id, `${code}: ${reason}`, true);
      return { started: false, code, reason };
    };

    if (sessions.has(id) || startingSessions.has(id)) return { started: true, duplicate: true };
    if (b.principal !== `user:${creds.owner}` || b.profile !== `laptop:${creds.owner}`) {
      return refuseStart("denied_by_ceiling", `Laptop runner only serves laptop:${creds.owner} for user:${creds.owner}.`);
    }
    if (cfg.external_control === "off") {
      return refuseStart("control_off", "External control is switched off in Ensō.");
    }
    const effectiveSites = intersectSites(b.sites, cfg.allowed_sites, { allowApprovedSites: cfg.allow_approved_sites });
    if (!effectiveSites.length) {
      const requested = Array.isArray(b.sites) ? b.sites : [];
      if (cfg.allow_approved_sites && requested.length && requested.every(site => isPrivateSite(site))) {
        return refuseStart("private_site", "All requested sites are on the private-site floor and cannot be opened.");
      }
      return refuseStart(
        "denied_by_ceiling",
        cfg.allow_approved_sites
          ? "None of the requested sites are valid non-private sites."
          : "None of the requested sites are allowed by Ensō's local allowed_sites ceiling.",
      );
    }
    if (sessions.size + startingSessions.size >= cfg.max_sessions) {
      return refuseStart("busy", `Ensō already runs the maximum ${cfg.max_sessions} concurrent remote sessions.`);
    }

    const task = String(b.task ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const stepBudget = Math.max(1, Math.min(200, Math.round(Number(b.step_budget) || 30)));
    const ttlS = Math.max(60, Math.min(7200, Math.round(Number(b.ttl_s) || 1800)));

    // Reserve a session slot synchronously before awaiting tab creation so concurrent starts
    // for distinct session IDs cannot both pass the max_sessions capacity check.
    startingSessions.add(id);
    let opened;
    try {
      try {
        opened = await browserRequest("browser.request", "tabs_open_session", {
          task,
          groupTitle: task ? `Anvil · ${task.slice(0, 40)}` : "Anvil session",
        }, null);
      } catch (err) {
        return refuseStart("page_error", `Could not open a dedicated session tab: ${String(err?.message ?? err).slice(0, 120)}`);
      }

      const tabId = Number(opened?.tabId);
      if (!Number.isInteger(tabId)) {
        return refuseStart("page_error", "Extension did not return a tab id for the session.");
      }

      const startedAt = new Date(now()).toISOString();
      const s = {
        id,
        uiId: `anvil:${id}`,
        profile: b.profile,
        owner: creds.owner,
        onBehalfOf: String(b.on_behalf_of ?? creds.owner),
        task,
        sites: effectiveSites,
        stepBudget,
        stepsUsed: 0,
        ttlS,
        startedAt,
        endsAt: now() + ttlS * 1000,
        tabId,
        tabIds: new Set([tabId]),
        groupId: Number.isInteger(opened?.groupId) ? opened.groupId : null,
        url: "about:blank",
        title: "",
        paused: false,
        running: 0,
        quiet: false,
        refs: createSessionRefTable(),
        approvedGrants: new Map(), // stepId -> callHash
        usedGrants: new Set(), // stepId
        actions: [],
        notes: [],
        timer: null,
      };

      s.timer = setTimeout(() => {
        void (async () => {
          if (await closeSession(id, "time_limit")) {
            await sendEnded(id, "Session reached its time limit", false);
          }
        })();
      }, ttlS * 1000);
      s.timer.unref?.();

      sessions.set(id, s);
      if (agentSessions) {
        try {
          agentSessions.claim(agentClientFor(s), [tabId]);
        } catch {}
      }
      changed();
      return { started: true, tabId, sites: effectiveSites };
    } finally {
      startingSessions.delete(id);
    }
  }

  async function handleStop(m) {
    const reason = String(m.body?.reason ?? "stopped");
    await closeSession(m.session, reason);
    return { stopped: true, reason };
  }

  function handleAllow(m) {
    const s = sessions.get(m.session);
    if (!s) return { allowed: [] };
    const cfg = getAnvilConfig();
    const added = [];
    for (const raw of Array.isArray(m.body?.sites) ? m.body.sites : []) {
      const site = String(raw ?? "").trim().toLowerCase().replace(/\.+$/, "");
      if (!site || isPrivateSite(site)) continue;
      if (!withinCeiling(site, cfg.allowed_sites, { allowApprovedSites: cfg.allow_approved_sites })) continue;
      if (!s.sites.includes(site)) {
        s.sites.push(site);
        added.push(site);
      }
    }
    if (added.length) changed();
    return { allowed: added };
  }

  function handleDecided(m) {
    const s = sessions.get(m.session);
    const b = m.body ?? {};
    const stepId = Number(b.step_id);
    if (s && b.decision === "approved" && Number.isSafeInteger(stepId) && typeof b.call_hash === "string") {
      s.approvedGrants.set(stepId, b.call_hash);
    }
    const p = pendingSteps.get(stepId);
    if (p) {
      p.status = b.decision; // approved | denied | expired
      p.decidedBy = b.decided_by ?? null;
      p.reasonDetail = b.reason ?? null;
      p.resolvedAt = new Date(now()).toISOString();
      // Keep briefly for UI feedback, then clear
      setTimeout(() => {
        if (pendingSteps.get(stepId) === p) {
          pendingSteps.delete(stepId);
          changed();
        }
      }, 15_000).unref?.();
    }
    changed();
    return { stepId, decision: b.decision };
  }

  function recordStep(s, { tool, target, ok, error, irreversible }) {
    const entry = {
      id: `${s.id}-${Date.now().toString(36)}-${s.actions.length + 1}`,
      at: new Date(now()).toISOString(),
      tool,
      title: tool,
      target: String(target ?? "").slice(0, 160),
      ok: ok !== false,
      irreversible: !!irreversible,
      ...(ok === false && error ? { error: String(error).slice(0, 200) } : {}),
    };
    s.actions.push(entry);
    if (s.actions.length > 30) s.actions.splice(0, s.actions.length - 30);
    try {
      onAction({
        id: entry.id,
        at: entry.at,
        conversationId: null,
        source: "Anvil",
        url: s.url || "",
        title: s.title || "",
        host: hostOf(s.url) || "",
        action: tool,
        target: entry.target,
        ok: entry.ok,
      });
    } catch {}
  }

  async function handleBrowserCall(m, creds) {
    const b = m.body ?? {};
    const callId = String(b.call_id ?? "");
    const secrets = currentSecrets(creds);
    const scrub = txt => scrubSecrets(txt, secrets);

    const answer = async payload => {
      const out = { call_id: callId, ...payload };
      await sendResult(out);
      return out;
    };

    const s = sessions.get(m.session);
    if (!s) return answer(errBody("no_session", "No active laptop session with that id."));
    if (s.paused) return answer(errBody("paused", "The owner paused this session in Ensō."));

    const tool = String(b.tool ?? "");
    const args = b.args && typeof b.args === "object" ? b.args : {};
    const cfg = getAnvilConfig();

    const ceilingCheck = checkCeilingForTool(tool, cfg);
    if (!ceilingCheck.ok) return answer(errBody(ceilingCheck.code, ceilingCheck.message));

    const computedHash = callHash(s.id, tool, args);
    if (b.call_hash !== computedHash) {
      return answer(errBody("bad_message", "The call_hash does not match the session, tool, and arguments."));
    }

    if (now() >= s.endsAt) {
      return answer(errBody("budget_exhausted", "The session reached its time limit."));
    }

    const acting = ACTING_TOOLS.has(tool);
    if (acting && s.stepsUsed >= s.stepBudget) {
      return answer(errBody("budget_exhausted", `The session used all ${s.stepBudget} acting steps.`));
    }

    // Tab leases: verify no other local agent holds an exclusive lease on our tab.
    if (acting && agentSessions) {
      const lease = agentSessions.lease?.(s.tabId);
      const myKey = agentSessions.keyOf?.(agentClientFor(s));
      if (lease && !lease.shared && lease.holderId && lease.client !== "Anvil") {
        // Double-check via before() if another agent holds it
        const check = agentSessions.before?.(agentClientFor(s), { tool: "page_click", kind: "act", tabId: s.tabId });
        if (check?.lease) {
          return answer(errBody("busy", check.refuse || "The session tab is leased by another agent."));
        }
      } else if (myKey) {
        agentSessions.claim?.(agentClientFor(s), [s.tabId]);
      }
    }

    const enforcePageUrl = async (url, label) => {
      const auth = checkPageAuthorized(url, s.sites, cfg.allow_approved_sites ? null : cfg.allowed_sites);
      if (auth.ok) return null;
      s.refs = createSessionRefTable();
      if (auth.code === "private_site" || auth.code === "denied_by_ceiling") {
        s.url = "about:blank";
        await browserRequest("page.request", "navigate", { url: "about:blank" }, s.tabId, "Anvil", s.uiId).catch(() => {});
      } else {
        s.url = String(url || s.url);
      }
      return answer(errBody(auth.code, label ? `${label}: ${auth.message}` : auth.message));
    };

    s.running++;
    changed();
    try {
      // ---- browser_snapshot ----
      if (tool === "browser_snapshot") {
        if (!s.url || s.url === "about:blank") {
          return answer({ ok: true, result: { url: "about:blank", title: "", snapshot: "" }, url: "about:blank" });
        }
        const pre = await enforcePageUrl(s.url);
        if (pre) return pre;
        const snap = await browserRequest("page.request", "anvil_snapshot", {}, s.tabId, "Anvil", s.uiId);
        const pageUrl = String(snap?.url ?? s.url);
        const post = await enforcePageUrl(pageUrl);
        if (post) return post;
        s.url = pageUrl;
        s.title = String(snap?.title ?? "");
        const rendered = s.refs.render(snap?.nodes ?? [], { passwords: snap?.passwords ?? [] });
        recordStep(s, { tool: "page_read", target: s.title || pageUrl, ok: true });
        return answer({
          ok: true,
          result: {
            url: scrub(pageUrl).slice(0, 2000),
            title: scrub(s.title).slice(0, 300),
            snapshot: scrub(rendered),
          },
          url: scrub(pageUrl),
        });
      }

      // ---- browser_screenshot ----
      if (tool === "browser_screenshot") {
        const pre = await enforcePageUrl(s.url);
        if (pre) return pre;
        const shotId = await captureAndUploadShot(s, creds, m.seq);
        if (!shotId) {
          return answer(errBody("page_error", s.quiet ? "Screenshots are paused while a credential field holds a value." : "Could not capture or upload a screenshot."));
        }
        recordStep(s, { tool: "page_screenshot", target: s.url, ok: true });
        return answer({
          ok: true,
          result: { summary: "Took a screenshot" },
          url: scrub(s.url),
          shot_id: shotId,
        });
      }

      // ---- Acting tools: browser_navigate, browser_click, browser_type ----
      if (tool === "browser_click" || tool === "browser_type") {
        const pre = await enforcePageUrl(s.url);
        if (pre) return pre;
      }

      const grantId = b.grant?.step_id;
      const granted = Number.isSafeInteger(grantId) && !s.usedGrants.has(grantId) && s.approvedGrants.get(grantId) === computedHash;

      let refEntry = null;
      let targetFacts = null;

      if (tool === "browser_click" || (tool === "browser_type" && args.ref !== undefined)) {
        refEntry = s.refs.lookup(args.ref);
        if (!refEntry) {
          return answer(errBody("ref_not_found", `${String(args.ref ?? "").slice(0, 12)} is not on the page: call browser_snapshot again.`));
        }
        const described = await browserRequest("page.request", "describe_ref", { ref: refEntry.pageRef }, s.tabId, "Anvil", s.uiId).catch(() => null);
        if (!described || described.gone) {
          return answer(errBody("ref_not_found", `${String(args.ref)} is no longer on the page: call browser_snapshot again.`));
        }
        targetFacts = { role: described.role || refEntry.role, name: described.name ?? refEntry.name, ...described };
      } else if (tool === "browser_type") {
        // Typing at cursor without ref: fail closed on iframes, missing focus, or password fields.
        const focused = await browserRequest("page.request", "focused_field", {}, s.tabId, "Anvil", s.uiId).catch(() => null);
        if (!focused || focused.frame || focused.none) {
          return answer(errBody("tool_not_allowed", "Cannot tell what field has focus: pass the field's @eN ref from browser_snapshot."));
        }
        if (focused.password) {
          return answer(errBody("tool_not_allowed", "Remote sessions never type into password fields: the owner signs in themselves."));
        }
        targetFacts = null; // classifier will ask because cursor target is unnamed
      }

      const verdict = classifyStep({
        tool,
        args,
        url: s.url,
        target: targetFacts,
        sites: s.sites,
        allowedSites: cfg.allow_approved_sites ? null : cfg.allowed_sites,
        granted,
      });

      if (verdict.action === "refuse") {
        return answer(errBody(verdict.code, verdict.message));
      }

      if (verdict.action === "ask") {
        const outlinePageRef = refEntry?.pageRef ?? null;
        const shotId = await captureAndUploadShot(s, creds, m.seq, { outlinePageRef });
        const stepReqBody = {
          session: s.id,
          call_id: callId,
          tool,
          args,
          reason: verdict.reason,
          description: verdict.description,
          ...(s.url && /^https?:/.test(s.url) ? { url: s.url.slice(0, 2000) } : {}),
          ...(shotId ? { shot_id: shotId } : {}),
        };
        const r = await callChannel("step.request", stepReqBody);
        if (r?.status !== 200 || !Number.isSafeInteger(r.body?.step_id)) {
          const code = r?.body?.code === "too_many_steps" ? "busy" : "page_error";
          return answer(errBody(code, r?.body?.message || "Anvil could not file the step approval."));
        }
        const stepId = r.body.step_id;
        pendingSteps.set(stepId, {
          stepId,
          sessionId: s.id,
          tabId: s.tabId,
          tool,
          reason: verdict.reason,
          description: verdict.description,
          url: s.url || "",
          deadline: r.body.deadline ?? null,
          status: "pending",
          decidedBy: null,
          at: new Date(now()).toISOString(),
          callHash: computedHash,
        });
        changed();
        // Return immediately without acting and without spending a budget step.
        return answer(errBody("step_approval_pending", `${verdict.description}, so ${s.owner} was asked first (step ${stepId}).`, { step_id: stepId }));
      }

      // Approved / allowed to execute
      if (granted) s.usedGrants.add(grantId);
      s.stepsUsed++;

      let summary = "";
      let pageTool = "";
      if (tool === "browser_navigate") {
        pageTool = "page_navigate";
        s.quiet = false;
        const navRes = await browserRequest("page.request", "navigate", { url: args.url }, s.tabId, "Anvil", s.uiId);
        const landedUrl = String(navRes?.url ?? args.url);
        const bad = await enforcePageUrl(landedUrl, "Navigation redirected");
        if (bad) return bad;
        s.url = landedUrl;
        s.title = String(navRes?.title ?? "");
        summary = `Opened ${hostOf(landedUrl) || hostOf(args.url)}`;
      } else if (tool === "browser_click") {
        pageTool = "page_click";
        const clickRes = await browserRequest("page.request", "click", { ref: refEntry.pageRef }, s.tabId, "Anvil", s.uiId);
        if (settleMs > 0) await new Promise(r => setTimeout(r, settleMs));
        const afterUrl = String(clickRes?.url ?? s.url);
        const bad = await enforcePageUrl(afterUrl, "Click navigated");
        if (bad) return bad;
        s.url = afterUrl;
        s.title = String(clickRes?.title ?? s.title);
        const what = `${targetFacts?.role ?? "element"}${targetFacts?.name ? ` "${targetFacts.name.slice(0, 60)}"` : ""}`;
        summary = `Clicked ${what}`;
      } else if (tool === "browser_type") {
        pageTool = "page_type";
        const text = String(args.text ?? "");
        const typeArgs = { ...(refEntry ? { ref: refEntry.pageRef } : {}), text, submit: args.submit === true };
        const typeRes = await browserRequest("page.request", "type", typeArgs, s.tabId, "Anvil", s.uiId);
        if (targetFacts && SECRET_TARGET.test(`${targetFacts.name ?? ""} ${targetFacts.autocomplete ?? ""}`)) {
          s.quiet = true;
        }
        if (settleMs > 0) await new Promise(r => setTimeout(r, settleMs));
        const afterUrl = String(typeRes?.url ?? s.url);
        const bad = await enforcePageUrl(afterUrl, "Typing navigated");
        if (bad) return bad;
        s.url = afterUrl;
        s.title = String(typeRes?.title ?? s.title);
        const what = `${targetFacts?.role ?? "element"}${targetFacts?.name ? ` "${targetFacts.name.slice(0, 60)}"` : ""}`;
        summary = `Typed ${text.length} characters into ${what}${args.submit ? " and pressed Enter" : ""}`;
      }

      const shotId = await captureAndUploadShot(s, creds, m.seq);
      const t = stepTarget(tool, args, targetFacts, refEntry, scrub);
      recordStep(s, { tool: pageTool, target: summary, ok: true, irreversible: args.irreversible === true || granted });

      return answer({
        ok: true,
        result: { summary: scrub(summary).slice(0, 300) },
        url: scrub(s.url),
        ...(shotId ? { shot_id: shotId } : {}),
        ...(t ? { target: t } : {}),
      });
    } catch (err) {
      const msg = scrub(String(err?.message ?? err).split("\n")[0]).slice(0, 300);
      recordStep(s, { tool, target: msg, ok: false, error: msg });
      return answer(errBody("page_error", msg));
    } finally {
      s.running = Math.max(0, s.running - 1);
      changed();
    }
  }

  /** Entry point for every event received over the WebSocket channel. */
  function handleEvent(name, msg) {
    if (!LAPTOP_MESSAGE_KINDS.includes(name)) return Promise.resolve(null);
    const sessionId = String(msg?.session ?? "");
    return serial(sessionId, async () => {
      const creds = await getCredentials();
      if (!creds || creds.error) return null;
      const v = verifyLaptopEvent(creds.signingKey, name, msg, {
        runnerId: creds.runner.id,
        now: now(),
        lastSeq: lastSeq.get(sessionId),
      });
      if (!v.ok) {
        // Log locally: kind, session, error — NEVER log the body.
        log("anvil: refused event", { kind: String(msg?.kind ?? name).slice(0, 20), session: sessionId.slice(0, 36), error: v.error });
        if (name === "browser.call" && UUID_RE.test(String(msg?.body?.call_id ?? ""))) {
          return sendResult({ call_id: msg.body.call_id, ...errBody(v.error, `Ensō refused the event: ${v.error}.`) });
        }
        return null;
      }
      lastSeq.set(sessionId, msg.seq);
      if (name === "session.start") return handleStart(msg, creds);
      if (name === "session.stop") return handleStop(msg);
      if (name === "session.allow") return handleAllow(msg);
      if (name === "step.decided") return handleDecided(msg);
      if (name === "browser.call") return handleBrowserCall(msg, creds);
      return null;
    });
  }

  // ---------- Local owner controls (trusted UI & pill) ----------

  function findByAnyId(id) {
    const raw = String(id ?? "");
    const clean = raw.startsWith("anvil:") ? raw.slice(6) : raw;
    return sessions.get(clean) ?? null;
  }

  function pause(id) {
    const s = findByAnyId(id);
    if (!s || s.paused) return !!s;
    s.paused = true;
    changed();
    return true;
  }

  function resume(id) {
    const s = findByAnyId(id);
    if (!s || !s.paused) return !!s;
    s.paused = false;
    changed();
    return true;
  }

  async function stopLocal(id, reason = "Stopped from the pill") {
    const s = findByAnyId(id);
    if (!s) return false;
    const sid = s.id;
    await closeSession(sid, reason);
    await sendEnded(sid, reason, false);
    return true;
  }

  async function noteLocal(id, text) {
    const s = findByAnyId(id);
    const cleaned = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!s || !cleaned) return null;
    const note = { id: `an-${Date.now().toString(36)}`, text: cleaned, at: new Date(now()).toISOString(), deliveredAt: null };
    s.notes.push(note);
    if (s.notes.length > 20) s.notes.splice(0, s.notes.length - 20);
    changed();
    const r = await callChannel("session.note", { session: s.id, text: cleaned }).catch(() => null);
    if (r?.status === 200) {
      note.deliveredAt = new Date(now()).toISOString();
      changed();
    }
    return note;
  }

  /** Owner answered a step approval from Ensō's sidebar (§7.4). */
  async function answerStep(stepId, approve) {
    const id = Number(stepId);
    if (!Number.isSafeInteger(id)) return { ok: false, error: "invalid step_id" };
    const r = await callChannel("step.answer", { step_id: id, approve: !!approve });
    if (r?.status !== 200) {
      return { ok: false, error: r?.body?.message || "Could not answer step." };
    }
    const outcome = String(r.body?.outcome ?? "");
    const p = pendingSteps.get(id);
    if (p) {
      if (outcome === "approved" || outcome === "denied") {
        p.status = outcome;
        p.resolvedAt = new Date(now()).toISOString();
        if (outcome === "approved") {
          const s = sessions.get(p.sessionId);
          if (s && p.callHash) s.approvedGrants.set(id, p.callHash);
        }
      } else if (outcome === "already_decided") {
        p.status = "already_decided";
        p.resolvedAt = new Date(now()).toISOString();
      }
      setTimeout(() => {
        if (pendingSteps.get(id) === p) {
          pendingSteps.delete(id);
          changed();
        }
      }, 15_000).unref?.();
      changed();
    }
    return { ok: true, outcome };
  }

  /** After a channel reconnect (§7.4), reconcile any pending steps via `step.status`. */
  async function reconcileSteps() {
    const results = [];
    for (const [stepId, p] of [...pendingSteps]) {
      if (p.status !== "pending") continue;
      const r = await callChannel("step.status", { step_id: stepId }).catch(() => null);
      if (!r || r.status !== 200 || !r.body) continue;
      const d = r.body.decision;
      results.push({ stepId, decision: d });
      if (d && d !== "pending") {
        p.status = d;
        p.decidedBy = r.body.decided_by ?? null;
        p.reasonDetail = r.body.reason ?? null;
        p.resolvedAt = new Date(now()).toISOString();
        if (d === "approved") {
          const s = sessions.get(p.sessionId);
          if (s && p.callHash) s.approvedGrants.set(stepId, p.callHash);
        }
        setTimeout(() => {
          if (pendingSteps.get(stepId) === p) {
            pendingSteps.delete(stepId);
            changed();
          }
        }, 15_000).unref?.();
        changed();
      }
    }
    return results;
  }

  async function closeAll(reason = "runner disconnected") {
    for (const id of [...sessions.keys()]) {
      await closeSession(id, reason);
    }
  }

  /** UI representation compatible with Ensō's `agents` list & page pill. */
  function uiSessions() {
    return [...sessions.values()].map(s => ({
      id: s.uiId,
      sessionId: s.id,
      remote: true,
      source: "anvil",
      client: "Anvil",
      clientName: s.profile,
      task: s.task,
      tabId: s.tabId,
      url: s.url,
      title: s.title,
      startedAt: s.startedAt,
      running: s.running > 0,
      paused: s.paused,
      stopped: false,
      control: "holder",
      stepsUsed: s.stepsUsed,
      stepBudget: s.stepBudget,
      sites: [...s.sites],
      actions: s.actions,
      notes: s.notes,
    }));
  }

  function uiPendingSteps() {
    return [...pendingSteps.values()].map(p => ({
      stepId: p.stepId,
      sessionId: `anvil:${p.sessionId}`,
      rawSessionId: p.sessionId,
      tabId: p.tabId,
      tool: p.tool,
      reason: p.reason,
      description: p.description,
      url: p.url,
      deadline: p.deadline,
      status: p.status,
      decidedBy: p.decidedBy,
      at: p.at,
    }));
  }

  return {
    handleEvent,
    pause,
    resume,
    stopLocal,
    noteLocal,
    answerStep,
    reconcileSteps,
    closeAll,
    hasSession: id => !!findByAnyId(id),
    activeCount: () => sessions.size + startingSessions.size,
    uiSessions,
    uiPendingSteps,
    peek: id => findByAnyId(id),
    pendingStep: stepId => pendingSteps.get(Number(stepId)) ?? null,
  };
}
