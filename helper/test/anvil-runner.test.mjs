// Tests for Anvil's laptop browser runner contract (v1, anvil-laptop-v1):
//   - §5.4 signing test vector verbatim + all signed protocol examples + replay/expiry/tamper checks
//   - §2 RFC 8628 device-code enrollment, strict keyring enforcement (refuses plaintext fallback),
//     disconnect revocation, and 4401 revocation cleanup
//   - §3–4 outbound WebSocket channel, ticket fetch, backoff, 4401/4409 close codes, hello presence
//   - §6.2 local ceiling (allowed_sites intersection, page_eval always denied, external_control,
//     session_fetch get_only, max_sessions) and private-site floor
//   - §6–9 sessions, stable @eN compact snapshots, step classifier & approval relay, single-use
//     call_hash grants, sidebar step.answer, reconnect step.status, session.allow bounded by ceiling,
//     pause/stop/note, password refusal, screenshot capture/upload & sensitive-field pausing
//   - §10.2 updater: manifest polling, sha256 check, 24h hold, pin/rollback, local off, nightly window
//
//   node test/anvil-runner.test.mjs

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataDirFor, isolatedEnv, stopAndRemove } from "./env.mjs";

const root = mkdtempSync(path.join(tmpdir(), "enso-anvil-"));
process.env.ENSO_DATA = path.join(root, "data");
delete process.env.ENSO_LEGACY_DATA;

const {
  canonicalJson,
  callHash,
  sha256Hex,
  signingMessage,
  signLaptopMessage,
  verifyLaptopEvent,
  scrubSecrets,
} = await import("../lib/anvil-crypto.mjs");
const {
  checkCeilingForTool,
  checkSessionFetch,
  classifyStep,
  floorRefusal,
  intersectSites,
  resolveAnvilConfig,
  siteMatches,
  updateAnvilLocalCeiling,
  validateSitePattern,
} = await import("../lib/anvil-policy.mjs");
const { config, LOCAL_CONFIG, reloadConfigIfChanged } = await import("../lib/config.mjs");
const { createAnvilAuth, REVOKED_MESSAGE } = await import("../lib/anvil-auth.mjs");
const { backoffDelayMs, channelWsUrl, createAnvilChannel } = await import("../lib/anvil-channel.mjs");
const { createAnvilSessionManager, createSessionRefTable } = await import("../lib/anvil-sessions.mjs");
const { createAnvilUpdater, inUpdateWindow, installVerifiedArtifact, msUntilWindow } = await import("../lib/anvil-updater.mjs");
const { createAnvilRunner } = await import("../lib/anvil-runner.mjs");
const { resetBackend } = await import("../lib/secrets.mjs");

function memoryKeyring({ secure = true } = {}) {
  const store = new Map();
  return {
    store,
    isSecure: () => secure,
    backendName: () => (secure ? "test-keyring" : "file"),
    location: () => (secure ? "test system keyring" : "/tmp/secrets.json"),
    async save({ token, signingKey }) {
      if (!secure) throw new Error("plaintext refused");
      store.set("token", token);
      store.set("signingKey", signingKey);
    },
    async load() {
      if (!secure) throw new Error("plaintext refused");
      const token = store.get("token");
      const signingKey = store.get("signingKey");
      return token && signingKey ? { token, signingKey } : null;
    },
    async clear() {
      store.clear();
    },
  };
}

try {
  // =========================================================================
  // 1. §5.4 Signing test vector (verbatim) & verification checks
  // =========================================================================
  {
    const TEST_KEY = "dGVzdC1rZXktZm9yLXRoZS1sYXB0b3AtY29udHJhY3QtMDAwMDAwMDA";
    const TEST_RUNNER_ID = 42;
    const msg = {
      kind: "browser.call",
      session: "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34",
      seq: 7,
      body: {
        call_id: "b3e1f0c2-7d4a-4e9b-9c1f-2a6d8e0f5b17",
        tool: "browser_click",
        args: { ref: "@e12", irreversible: true },
        call_hash: "c8a116bbdded0938b27386f171682fc581cf158332962ba5a657cdb0f4a6b3f8",
      },
      expires_at: 1795132920,
      sig: "WH-mKq8Tg2YnGHeCmn_9xrvORydhD2juvbVE1SfrOYQ",
    };

    assert.equal(callHash(msg.session, msg.body.tool, msg.body.args), msg.body.call_hash);
    const expectedText = [
      "anvil-laptop-v1",
      "browser.call",
      "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34",
      "7",
      "1a191d4a7008199b52693a376cab4c27c54349b3547e5e0db7524fe0bffe540d",
      "42",
      "1795132920",
    ].join("\n");
    assert.equal(
      signingMessage({ kind: msg.kind, session: msg.session, seq: msg.seq, body: msg.body, runnerId: TEST_RUNNER_ID, expiresAt: msg.expires_at }),
      expectedText,
    );
    assert.equal(
      signLaptopMessage(TEST_KEY, { kind: msg.kind, session: msg.session, seq: msg.seq, body: msg.body, runnerId: TEST_RUNNER_ID, expiresAt: msg.expires_at }),
      msg.sig,
    );
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", msg, { runnerId: TEST_RUNNER_ID, now: msg.expires_at * 1000 }), { ok: true });

    // Other signed examples from LAPTOP-RUNNER.md (§6.3, §7.3, §7.5)
    const startEx = {
      kind: "session.start",
      session: "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34",
      seq: 1,
      body: {
        profile: "laptop:alice",
        principal: "user:alice",
        on_behalf_of: "alice",
        task: "Add https://beamline.app/auth/callback as a redirect URI in Vercel",
        sites: ["vercel.com", "*.vercel.com"],
        step_budget: 30,
        ttl_s: 1800,
        approval: { request_id: 812, approved_by: "alice" },
      },
      expires_at: 1795132800,
      sig: "nzs3jUFU0qkfzUYlEZgV0yFwzHxyrYdAcrc8W8MC06o",
    };
    const decidedEx = {
      kind: "step.decided",
      session: "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34",
      seq: 9,
      body: { step_id: 813, decision: "approved", decided_by: "alice", reason: null, call_hash: "c8a116bbdded0938b27386f171682fc581cf158332962ba5a657cdb0f4a6b3f8" },
      expires_at: 1795133100,
      sig: "D7656cHQK6Bwqkul3E3tZkisvwQpG1FXW1lo8SSOkKw",
    };
    const allowEx = {
      kind: "session.allow",
      session: "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34",
      seq: 10,
      body: { sites: ["github.com"], step_id: 814 },
      expires_at: 1795133160,
      sig: "kcm3b6dDkodZPzd6vlE2YLwd2NeGnizUQ4vTHvHw4GQ",
    };
    for (const ex of [startEx, decidedEx, allowEx]) {
      assert.deepEqual(verifyLaptopEvent(TEST_KEY, ex.kind, ex, { runnerId: TEST_RUNNER_ID, now: ex.expires_at * 1000 }), { ok: true }, ex.kind);
    }

    // Refusals: wrong runnerId, tampered body, tampered kind, expired, replayed, mismatched event name
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", msg, { runnerId: 99, now: msg.expires_at * 1000 }), { ok: false, error: "bad_signature" });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", { ...msg, body: { ...msg.body, tool: "browser_snapshot" } }, { runnerId: TEST_RUNNER_ID, now: msg.expires_at * 1000 }), { ok: false, error: "bad_signature" });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "session.stop", { ...msg, kind: "session.stop" }, { runnerId: TEST_RUNNER_ID, now: msg.expires_at * 1000 }), { ok: false, error: "bad_signature" });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", msg, { runnerId: TEST_RUNNER_ID, now: (msg.expires_at + 121) * 1000 }), { ok: false, error: "expired" });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", msg, { runnerId: TEST_RUNNER_ID, now: (msg.expires_at + 119) * 1000 }), { ok: true });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "browser.call", msg, { runnerId: TEST_RUNNER_ID, now: msg.expires_at * 1000, lastSeq: 7 }), { ok: false, error: "replayed" });
    assert.deepEqual(verifyLaptopEvent(TEST_KEY, "session.stop", msg, { runnerId: TEST_RUNNER_ID, now: msg.expires_at * 1000 }), { ok: false, error: "bad_message" });
    assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
    assert.throws(() => canonicalJson(1.5), /safe integers/);
    assert.equal(scrubSecrets("err anvr_secret1234567890", ["my-super-secret"]), "err [redacted]");
    console.log("ok - §5.4 signing test vector, all contract examples, and verification refusals");
  }

  // =========================================================================
  // 2. §6.2 Local ceiling & private-site floor
  // =========================================================================
  {
    assert.equal(siteMatches("app.vercel.com", "*.vercel.com"), true);
    assert.equal(siteMatches("vercel.com", "*.vercel.com"), false, "*.domain must not match apex");
    assert.equal(siteMatches("vercel.com", "vercel.com"), true);
    assert.deepEqual(intersectSites(["vercel.com", "*.vercel.com", "paypal.com", "github.com"], ["vercel.com", "*.vercel.com"]), ["vercel.com", "*.vercel.com"]);
    assert.deepEqual(intersectSites(["vercel.com"], []), [], "empty allowed_sites refuses everything");
    assert.deepEqual(intersectSites(["*.vercel.com"], ["app.vercel.com"]), ["app.vercel.com"]);
    assert.ok(floorRefusal("paypal.com"));
    assert.ok(floorRefusal("ing.nl"));
    assert.ok(floorRefusal("myaccount.google.com"));
    assert.ok(floorRefusal("mijn.belastingdienst.nl"));
    assert.ok(floorRefusal("mybank.example.com"));
    assert.equal(floorRefusal("vercel.com"), null);

    const cfg = resolveAnvilConfig(
      { anvil: { allowed_sites: ["vercel.com", "*.vercel.com", "paypal.com"], external_control: "full", deny_tools: [], max_sessions: 2, updates: "auto" } },
      { externalControl: "read" },
    );
    assert.deepEqual(cfg.allowed_sites, ["vercel.com", "*.vercel.com"], "private sites stripped from allowed_sites");
    assert.ok(cfg.deny_tools.has("page_eval"), "page_eval is always denied even when config leaves deny_tools empty");
    assert.equal(cfg.external_control, "read", "more restrictive setting wins");
    assert.equal(checkCeilingForTool("page_eval", cfg).code, "denied_by_ceiling");
    assert.equal(checkCeilingForTool("browser_snapshot", cfg).ok, true);
    assert.equal(checkCeilingForTool("browser_click", cfg).code, "control_off");
    assert.equal(checkCeilingForTool("page_query", cfg).code, "tool_not_allowed");
    assert.equal(checkSessionFetch("POST", cfg).code, "tool_not_allowed");
    assert.equal(checkSessionFetch("GET", cfg).action, "ask");
    assert.equal(checkSessionFetch("GET", cfg).reason, "session_access");
    console.log("ok - §6.2 local ceiling, page_eval always denied, and private-site floor");
  }

  // =========================================================================
  // 3. §2 Enrollment, strict keyring refusal, disconnect & 4401 revocation
  // =========================================================================
  {
    // Refuse plaintext file backend
    process.env.ENSO_SECRETS = "file";
    resetBackend();
    const authFile = createAnvilAuth({ dataDir: path.join(root, "auth-file") });
    await assert.rejects(() => authFile.startEnroll({ url: "https://anvil.test" }), /system keyring/i);
    delete process.env.ENSO_SECRETS;
    resetBackend();

    // Full RFC 8628 flow with secure keyring
    const kr = memoryKeyring({ secure: true });
    const calls = [];
    let pollStep = 0;
    const TEST_KEY = "dGVzdC1rZXktZm9yLXRoZS1sYXB0b3AtY29udHJhY3QtMDAwMDAwMDA";
    const fakeFetch = async (url, init) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      if (String(url).endsWith("/laptop/connect")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            device_code: "anvl_abcdefghijklmnopqrstuvwxyz234567",
            user_code: "WDJB-MJHT",
            verification_uri: "https://anvil.test/agents/ops/runners/laptop",
            verification_uri_complete: "https://anvil.test/agents/ops/runners/laptop?code=WDJB-MJHT",
            expires_in: 600,
            expires_at: "2026-11-26T20:00:00.000Z",
            interval: 5,
          }),
        };
      }
      if (String(url).endsWith("/laptop/connect/poll")) {
        pollStep++;
        if (pollStep === 1) return { ok: true, status: 200, json: async () => ({ status: "pending", interval: 5 }) };
        if (pollStep === 2) return { ok: true, status: 200, json: async () => ({ status: "slow_down", interval: 10 }) };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "approved",
            token: "anvr_testtoken123456789012345678901234567890",
            signing_key: TEST_KEY,
            runner: { id: 42, name: "laptop-alice" },
            profile: "laptop:alice",
            owner: "alice",
            channel: { ticket_path: "/api/browser-runners/channel-ticket", path: "/api/browser-runners/channel" },
            manifest_path: "/api/browser-runners/laptop/manifest",
          }),
        };
      }
      if (String(url).endsWith("/laptop/revoke")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const auth = createAnvilAuth({ dataDir: path.join(root, "auth-ok"), fetchImpl: fakeFetch, keyring: kr, defaultUrl: "https://anvil.test" });
    const started = await auth.startEnroll({ url: "https://anvil.test" });
    assert.equal(started.user_code, "WDJB-MJHT");
    assert.deepEqual(await auth.pollEnrollOnce({ url: started.url, deviceCode: started.device_code }), { status: "pending", interval: 5 });
    assert.deepEqual(await auth.pollEnrollOnce({ url: started.url, deviceCode: started.device_code }), { status: "slow_down", interval: 10 });
    const approved = await auth.pollEnrollOnce({ url: started.url, deviceCode: started.device_code });
    assert.equal(approved.status, "approved");
    assert.equal(approved.enrollment.runner.id, 42);
    assert.equal(kr.store.get("token"), "anvr_testtoken123456789012345678901234567890");
    assert.equal(kr.store.get("signingKey"), TEST_KEY);

    // Ensure disk file never contains secrets
    const diskText = readFileSync(auth.metaFile, "utf8");
    assert.ok(!diskText.includes("anvr_"), "token must never be on disk");
    assert.ok(!diskText.includes(TEST_KEY), "signing_key must never be on disk");

    // Revocation cleanup
    await auth.handleRevoked();
    assert.equal(kr.store.size, 0, "keyring cleared on revocation");
    assert.equal(auth.loadEnrollment().revoked, true);
    assert.equal(auth.loadEnrollment().revoked_message, REVOKED_MESSAGE);
    assert.equal(await auth.loadCredentials(), null);

    // Re-enroll & explicit Disconnect
    pollStep = 2;
    await auth.pollEnrollOnce({ url: started.url, deviceCode: started.device_code });
    const disc = await auth.disconnect();
    assert.equal(disc.ok, true);
    assert.equal(disc.revokedOnServer, true);
    assert.equal(kr.store.size, 0);
    assert.equal(auth.loadEnrollment(), null);
    assert.ok(calls.some(c => c.url.endsWith("/laptop/revoke") && c.headers.authorization === "Bearer anvr_testtoken123456789012345678901234567890"));
    console.log("ok - §2 enrollment, strict keyring refusal, disconnect, and revocation cleanup");
  }

  // =========================================================================
  // 4. §3–4 Channel: ticket, WS URL, hello, backoff, 4401 & 4409 close codes
  // =========================================================================
  {
    assert.equal(channelWsUrl("https://anvil.wicker.life", "/api/browser-runners/channel", "anvc_123"), "wss://anvil.wicker.life/api/browser-runners/channel?ticket=anvc_123");
    assert.equal(backoffDelayMs(0, () => 0.5), 1000);
    assert.equal(backoffDelayMs(1, () => 0.5), 2000);
    assert.equal(backoffDelayMs(10, () => 0.5), 60_000);
    assert.equal(backoffDelayMs(0, () => 0), 800);
    assert.equal(backoffDelayMs(0, () => 1), 1200);

    const sockets = [];
    class FakeWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(data) {
        this.sent.push(JSON.parse(data));
      }
      close(code = 1000, reason = "") {
        this.readyState = 3;
        this.onclose?.({ code, reason });
      }
      emitMessage(obj) {
        this.onmessage?.({ data: JSON.stringify(obj) });
      }
    }

    let ticketCount = 0;
    let revoked = false;
    let replaced = false;
    const events = [];
    const ch = createAnvilChannel({
      getCredentials: async () => ({
        url: "https://anvil.test",
        token: "anvr_tok1234567890",
        signingKey: "dGVzdC1rZXktZm9yLXRoZS1sYXB0b3AtY29udHJhY3QtMDAwMDAwMDA",
        runner: { id: 42, name: "laptop-alice" },
        owner: "alice",
        profile: "laptop:alice",
        channel: { ticket_path: "/api/browser-runners/channel-ticket", path: "/api/browser-runners/channel" },
      }),
      buildHello: () => ({
        version: "0.6.0",
        zen: "1.17.3b",
        external_control: "full",
        tools: ["browser_snapshot", "browser_click", "browser_type", "browser_navigate", "browser_screenshot"],
        max_sessions: 2,
        problems: [],
        update: { state: "idle" },
      }),
      onEvent: (name, body) => events.push({ name, body }),
      onRevoked: () => { revoked = true; },
      onReplaced: () => { replaced = true; },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ ticket: `anvc_t${++ticketCount}`, path: "/api/browser-runners/channel" }),
      }),
      WebSocketImpl: FakeWS,
    });

    ch.start();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0].url, "wss://anvil.test/api/browser-runners/channel?ticket=anvc_t1");
    assert.ok(!sockets[0].url.includes("anvr_"), "runner token never in WS URL");
    assert.equal(sockets[0].sent[0].method, "hello");
    assert.equal(sockets[0].sent[0].body.zen, "1.17.3b");
    sockets[0].emitMessage({ t: "reply", id: sockets[0].sent[0].id, status: 200, body: { ok: true, hello_every_s: 30, active_sessions: [] } });
    sockets[0].emitMessage({ t: "event", name: "session.stop", body: { test: 1 } });
    assert.equal(events.length, 1);

    // 4409 replaced stops reconnecting
    sockets[0].close(4409, "replaced");
    assert.equal(replaced, true);
    assert.equal(ch.state().status, "replaced");

    // Restart and test 4401 revoked
    ch.start();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(sockets.length, 2);
    sockets[1].close(4401, "revoked");
    await new Promise(r => setTimeout(r, 10));
    assert.equal(revoked, true);
    assert.equal(ch.state().status, "revoked");
    ch.stop();
    console.log("ok - §3–4 channel ticket, WSS, hello presence, backoff, 4401 & 4409");
  }

  // =========================================================================
  // 5. §6–9 Sessions, @eN snapshots, step classifier, approval relay, grants, shots
  // =========================================================================
  {
    const KEY = "dGVzdC1rZXktZm9yLXRoZS1sYXB0b3AtY29udHJhY3QtMDAwMDAwMDA";
    const RUNNER_ID = 42;
    const SESSION = "4f6c2a7e-9b1d-4c3e-8a5f-0d2e7b9c1a34";
    const NOW = 1_800_000_000_000;
    let seq = 0;

    const signEv = (kind, body, session = SESSION) => {
      seq++;
      const expires_at = Math.floor(NOW / 1000) + 120;
      const fields = { kind, session, seq, body, runnerId: RUNNER_ID, expiresAt: expires_at };
      return { kind, session, seq, body, expires_at, sig: signLaptopMessage(KEY, fields) };
    };

    // Test stable @eN snapshot format & redaction directly
    const refTable = createSessionRefTable();
    const rendered = refTable.render(
      [
        { role: "heading", name: "Domains", interactive: false, depth: 0 },
        { ref: 1, role: "link", name: "Overview", interactive: true, depth: 0 },
        { ref: 2, role: "textbox", name: "Add a domain", value: "", interactive: true, depth: 1 },
        { ref: 3, role: "textbox", name: "API Token", value: "ghp_secret1234567890", interactive: true, depth: 1 },
        { ref: 4, role: "textbox", name: "Password", value: "hunter2", password: true, interactive: true, depth: 1 },
        { ref: 5, role: "button", name: "Delete project", interactive: true, depth: 0 },
      ],
      { passwords: ["hunter2"] },
    );
    assert.ok(rendered.includes('heading "Domains"'));
    assert.ok(rendered.includes('@e1 link "Overview"'));
    assert.ok(rendered.includes('  @e2 textbox "Add a domain" value=""'));
    assert.ok(rendered.includes('  @e3 textbox "API Token" value="(hidden)"'), "credential field redacted");
    assert.ok(!rendered.includes("hunter2"), "password value never included");
    assert.ok(!rendered.includes("ghp_secret"), "token value never included");
    assert.ok(rendered.includes('@e5 button "Delete project"'));
    // Stable refs across a second snapshot with an inserted element before Delete project
    const rendered2 = refTable.render([
      { ref: 10, role: "link", name: "New Link", interactive: true, depth: 0 },
      { ref: 11, role: "button", name: "Delete project", interactive: true, depth: 0 },
    ]);
    assert.ok(rendered2.includes('@e5 button "Delete project"'), "existing element keeps @e5");
    assert.ok(rendered2.includes('@e6 link "New Link"'), "new element gets @e6");
    assert.equal(refTable.lookup("@e5").pageRef, 11);

    // End-to-end session manager test
    const channelCalls = [];
    const uploadedShots = [];
    const outlined = [];
    let nextShotId = 5520;
    let tabClosed = [];
    let currentTabUrl = "about:blank";
    let sensitiveOnPage = false;

    const fakeBrowserReq = async (type, action, args) => {
      if (type === "browser.request" && action === "tabs_open_session") return { tabId: 77, groupId: 9 };
      if (type === "browser.request" && action === "tabs_close") { tabClosed.push(...args.tabIds); return {}; }
      if (type === "page.request" && action === "navigate") {
        currentTabUrl = args.url;
        return { url: args.url, title: "Settings – Vercel" };
      }
      if (type === "page.request" && action === "anvil_snapshot") {
        return {
          url: currentTabUrl,
          title: "Settings – Vercel",
          passwords: ["secretpass"],
          nodes: [
            { role: "heading", name: "Domains", interactive: false, depth: 0 },
            { ref: 1, role: "button", name: "View logs", interactive: true, depth: 0 },
            { ref: 2, role: "button", name: "Delete project", interactive: true, depth: 0 },
            { ref: 3, role: "textbox", name: "Domain", value: "", interactive: true, depth: 1 },
            { ref: 4, role: "textbox", name: "Password", password: true, interactive: true, depth: 1 },
            { ref: 5, role: "textbox", name: "API Secret", value: "", interactive: true, depth: 1 },
          ],
        };
      }
      if (type === "page.request" && action === "describe_ref") {
        if (args.ref === 1) return { gone: false, role: "button", name: "View logs", tag: "button", type: "button", submits: false };
        if (args.ref === 2) return { gone: false, role: "button", name: "Delete project", tag: "button", type: "button", destructive: true };
        if (args.ref === 3) return { gone: false, role: "textbox", name: "Domain", tag: "input", type: "text" };
        if (args.ref === 4) return { gone: false, role: "textbox", name: "Password", tag: "input", type: "password", password_field: true };
        if (args.ref === 5) return { gone: false, role: "textbox", name: "API Secret", tag: "input", type: "text", autocomplete: "off" };
        return { gone: true };
      }
      if (type === "page.request" && action === "outline_ref") {
        outlined.push(args);
        return { ok: true };
      }
      if (type === "page.request" && action === "has_sensitive_field") {
        return { sensitive: sensitiveOnPage };
      }
      if (type === "page.request" && action === "screenshot") {
        // Minimal valid 1x1 PNG
        return { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
      }
      if (type === "page.request" && action === "click") return { url: currentTabUrl, title: "Settings – Vercel", description: "clicked" };
      if (type === "page.request" && action === "type") return { url: currentTabUrl, title: "Settings – Vercel", description: "typed" };
      throw new Error(`unexpected ${type} ${action}`);
    };

    const mgr = createAnvilSessionManager({
      getCredentials: async () => ({
        url: "https://anvil.test",
        token: "anvr_tok1234567890",
        signingKey: KEY,
        runner: { id: RUNNER_ID, name: "laptop-alice" },
        owner: "alice",
        profile: "laptop:alice",
      }),
      getAnvilConfig: () => resolveAnvilConfig({
        anvil: { allowed_sites: ["vercel.com", "*.vercel.com", "github.com"], external_control: "full", max_sessions: 2, updates: "auto" },
      }),
      callChannel: async (method, body) => {
        channelCalls.push({ method, body });
        if (method === "step.request") return { status: 200, body: { step_id: 813, deadline: "2026-11-26T20:10:00.000Z" } };
        if (method === "step.answer") return { status: 200, body: { outcome: body.approve ? "approved" : "denied" } };
        if (method === "step.status") return { status: 200, body: { step_id: body.step_id, decision: "approved", decided_by: "alice", reason: null } };
        return { status: 200, body: { ok: true } };
      },
      browserRequest: fakeBrowserReq,
      fetchImpl: async (url, init) => {
        if (String(url).includes("/laptop/shots")) {
          uploadedShots.push({ url: String(url), bytes: init.body.byteLength, auth: init.headers.authorization });
          return { ok: true, status: 200, json: async () => ({ id: nextShotId++ }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
      now: () => NOW,
      settleMs: 0,
    });

    // 1. Start session
    const startRes = await mgr.handleEvent("session.start", signEv("session.start", {
      profile: "laptop:alice",
      principal: "user:alice",
      on_behalf_of: "alice",
      task: "Configure Vercel domain",
      sites: ["vercel.com", "*.vercel.com"],
      step_budget: 5,
      ttl_s: 1800,
      approval: { request_id: 812, approved_by: "alice" },
    }));
    assert.equal(startRes.started, true);
    assert.equal(startRes.tabId, 77);

    // 2. Navigate to allowed site -> succeeds + uploads screenshot
    const navArgs = { url: "https://vercel.com/acme/beamline" };
    const navRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "11111111-1111-4111-8111-111111111111",
      tool: "browser_navigate",
      args: navArgs,
      call_hash: callHash(SESSION, "browser_navigate", navArgs),
    }));
    assert.equal(navRes.ok, true);
    assert.equal(navRes.shot_id, 5520);
    assert.equal(mgr.peek(SESSION).stepsUsed, 1);

    // 3. Snapshot -> compact @eN format
    const snapRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "22222222-2222-4222-8222-222222222222",
      tool: "browser_snapshot",
      args: {},
      call_hash: callHash(SESSION, "browser_snapshot", {}),
    }));
    assert.equal(snapRes.ok, true);
    assert.ok(snapRes.result.snapshot.includes('@e2 button "Delete project"'));
    assert.equal(mgr.peek(SESSION).stepsUsed, 1, "snapshot does not spend acting budget");

    // 4. Click safe button -> executes immediately
    const safeClickArgs = { ref: "@e1" };
    const safeClickRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "33333333-3333-4333-8333-333333333333",
      tool: "browser_click",
      args: safeClickArgs,
      call_hash: callHash(SESSION, "browser_click", safeClickArgs),
    }));
    assert.equal(safeClickRes.ok, true);
    assert.equal(mgr.peek(SESSION).stepsUsed, 2);

    // 5. Click destructive button -> outlines target, uploads shot, calls step.request, returns step_approval_pending without spending budget
    const delArgs = { ref: "@e2", irreversible: true };
    const delHash = callHash(SESSION, "browser_click", delArgs);
    const delRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "44444444-4444-4444-8444-444444444444",
      tool: "browser_click",
      args: delArgs,
      call_hash: delHash,
    }));
    assert.equal(delRes.ok, false);
    assert.equal(delRes.error.code, "step_approval_pending");
    assert.equal(delRes.error.step_id, 813);
    assert.equal(mgr.peek(SESSION).stepsUsed, 2, "pending approval does not spend step budget");
    assert.ok(outlined.some(o => o.ref === 2 && o.on === true) && outlined.some(o => o.ref === 2 && o.on === false), "outlined before shot and cleared after");
    assert.ok(channelCalls.some(c => c.method === "step.request" && c.body.shot_id && c.body.reason === "irreversible"));
    assert.equal(mgr.uiPendingSteps().length, 1);

    // 6. step.decided (approved) -> retry with grant runs ONCE, second retry asks again
    await mgr.handleEvent("step.decided", signEv("step.decided", {
      step_id: 813,
      decision: "approved",
      decided_by: "alice",
      reason: null,
      call_hash: delHash,
    }));
    const retryRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "55555555-5555-4555-8555-555555555555",
      tool: "browser_click",
      args: delArgs,
      call_hash: delHash,
      grant: { step_id: 813 },
    }));
    assert.equal(retryRes.ok, true);
    assert.equal(mgr.peek(SESSION).stepsUsed, 3);

    // Reusing grant 813 must NOT work a second time
    const reuseRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "55555555-5555-4555-8555-555555555556",
      tool: "browser_click",
      args: delArgs,
      call_hash: delHash,
      grant: { step_id: 813 },
    }));
    assert.equal(reuseRes.ok, false);
    assert.equal(reuseRes.error.code, "step_approval_pending", "grants are strictly single-use");

    // 7. Reconnect reconciliation via step.status
    const reconciled = await mgr.reconcileSteps();
    assert.equal(reconciled.length, 1);
    assert.equal(reconciled[0].decision, "approved");

    // 8. Password field typing is ALWAYS refused even with a grant
    const pwArgs = { ref: "@e4", text: "mysecret", submit: false };
    const pwRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "66666666-6666-4666-8666-666666666666",
      tool: "browser_type",
      args: pwArgs,
      call_hash: callHash(SESSION, "browser_type", pwArgs),
    }));
    assert.equal(pwRes.ok, false);
    assert.equal(pwRes.error.code, "tool_not_allowed");

    // 9. Typing into regular field never echoes text in summary
    const typeArgs = { ref: "@e3", text: "beamline.app", submit: false };
    const typeRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "77777777-7777-4777-8777-777777777777",
      tool: "browser_type",
      args: typeArgs,
      call_hash: callHash(SESSION, "browser_type", typeArgs),
    }));
    assert.equal(typeRes.ok, true);
    assert.ok(!typeRes.result.summary.includes("beamline.app"), "summary never includes typed text");
    assert.ok(typeRes.result.summary.includes("12 characters"));

    // 10. Sensitive field on page suppresses screenshots
    sensitiveOnPage = true;
    const shotsBefore = uploadedShots.length;
    const shotBlocked = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "77777777-7777-4777-8777-777777777778",
      tool: "browser_screenshot",
      args: {},
      call_hash: callHash(SESSION, "browser_screenshot", {}),
    }));
    assert.equal(shotBlocked.ok, false);
    assert.equal(uploadedShots.length, shotsBefore, "no screenshot uploaded when sensitive field has value");
    sensitiveOnPage = false;

    // 11. session.allow bounded by local allowed_sites ceiling
    await mgr.handleEvent("session.allow", signEv("session.allow", { sites: ["github.com", "evil.example.com", "paypal.com"], step_id: 814 }));
    assert.ok(mgr.peek(SESSION).sites.includes("github.com"), "within ceiling added");
    assert.ok(!mgr.peek(SESSION).sites.includes("evil.example.com"), "outside ceiling ignored");
    assert.ok(!mgr.peek(SESSION).sites.includes("paypal.com"), "private site ignored");

    // 12. Pause -> calls return paused; Note -> calls session.note; Stop -> closes tabs & sends session.ended
    mgr.pause(SESSION);
    const pausedRes = await mgr.handleEvent("browser.call", signEv("browser.call", {
      call_id: "88888888-8888-4888-8888-888888888888",
      tool: "browser_snapshot",
      args: {},
      call_hash: callHash(SESSION, "browser_snapshot", {}),
    }));
    assert.equal(pausedRes.error.code, "paused");
    mgr.resume(SESSION);

    await mgr.noteLocal(SESSION, "Use staging project");
    assert.ok(channelCalls.some(c => c.method === "session.note" && c.body.text === "Use staging project"));

    await mgr.stopLocal(SESSION, "Stopped from the pill");
    assert.deepEqual(tabClosed, [77]);
    assert.ok(channelCalls.some(c => c.method === "session.ended" && c.body.reason === "Stopped from the pill" && c.body.error === false));

    // 13. Bad signature on browser.call still answers browser.result with bad_signature
    const badRes = await mgr.handleEvent("browser.call", {
      kind: "browser.call",
      session: SESSION,
      seq: 999,
      body: { call_id: "99999999-9999-4999-8999-999999999999", tool: "browser_snapshot", args: {}, call_hash: "a".repeat(64) },
      expires_at: Math.floor(NOW / 1000) + 120,
      sig: "A".repeat(43),
    });
    assert.equal(badRes.ok, false);
    assert.equal(badRes.error.code, "bad_signature");
    console.log("ok - §6–9 sessions, stable @eN snapshots, step approvals, grants, screenshots, pause/stop/note");
  }

  // =========================================================================
  // 6. §10.2 Updater: manifest, sha256, 24h hold, pin/rollback, off, nightly window
  // =========================================================================
  {
    assert.equal(inUpdateWindow({ start: "03:00", end: "05:00" }, new Date(2026, 10, 26, 3, 30)), true);
    assert.equal(inUpdateWindow({ start: "03:00", end: "05:00" }, new Date(2026, 10, 26, 14, 0)), false);
    assert.equal(inUpdateWindow({ start: "23:00", end: "01:00" }, new Date(2026, 10, 26, 23, 30)), true);
    assert.equal(inUpdateWindow({ start: "23:00", end: "01:00" }, new Date(2026, 10, 27, 0, 30)), true);
    assert.equal(msUntilWindow({ start: "03:00", end: "05:00" }, new Date(2026, 10, 26, 4, 0)), 0);

    const payloadBytes = Buffer.from("fake-enso-release-zip-bytes");
    const goodHash = sha256Hex(payloadBytes);
    const badHash = "0".repeat(64);
    let manifestResp = null;
    let installedVersions = [];
    let currentTime = new Date(2026, 10, 26, 4, 0).getTime(); // 04:00 local (inside 03:00-05:00)
    let activeSessions = false;
    let updatesMode = "auto";

    const updater = createAnvilUpdater({
      dataDir: path.join(root, "upd"),
      getCredentials: async () => ({ url: "https://anvil.test", token: "anvr_tok1234567890", manifest_path: "/api/browser-runners/laptop/manifest" }),
      getAnvilConfig: () => ({ updates: updatesMode }),
      currentVersion: () => "0.6.0",
      hasActiveSessions: () => activeSessions,
      installArtifact: async item => { installedVersions.push(item.version); },
      fetchImpl: async url => {
        if (String(url).includes("/manifest")) return { ok: true, status: 200, json: async () => manifestResp };
        return { ok: true, status: 200, arrayBuffer: async () => payloadBytes };
      },
      now: () => currentTime,
    });

    // SHA-256 mismatch -> refused & reports failed
    manifestResp = {
      component: "enso-runner",
      latest: { version: "0.6.1", url: "https://github.com/davidwickerhf/enso/releases/download/v0.6.1/enso.zip", sha256: badHash, notes: null, published_at: "2026-11-20T00:00:00Z" },
      target: { version: "0.6.1", url: "https://github.com/davidwickerhf/enso/releases/download/v0.6.1/enso.zip", sha256: badHash, notes: null, published_at: "2026-11-20T00:00:00Z" },
      pinned: null,
      disabled: false,
      held: null,
      update_available: true,
      window: { start: "03:00", end: "05:00" },
      check_after_s: 21600,
    };
    const badRes = await updater.checkNow();
    assert.equal(badRes.state, "failed");
    assert.equal(updater.helloUpdate().state, "failed");
    assert.equal(updater.helloUpdate().error, "sha256 mismatch");
    assert.equal(installedVersions.length, 0);

    // Held release (target == current 0.6.0, held == 0.7.0) -> not installed
    manifestResp = {
      component: "enso-runner",
      latest: { version: "0.7.0", url: "https://github.com/davidwickerhf/enso/releases/download/v0.7.0/enso.zip", sha256: goodHash, notes: null, published_at: "2026-11-26T00:00:00Z" },
      target: { version: "0.6.0", url: "https://github.com/davidwickerhf/enso/releases/download/v0.6.0/enso.zip", sha256: goodHash, notes: null, published_at: "2026-11-20T00:00:00Z" },
      pinned: null,
      disabled: false,
      held: { version: "0.7.0", arrives_at: "2026-11-27T00:00:00.000Z" },
      update_available: false,
      window: { start: "03:00", end: "05:00" },
      check_after_s: 21600,
    };
    await updater.checkNow();
    assert.equal(installedVersions.length, 0);
    assert.equal(updater.status().held.version, "0.7.0");

    // Good target outside window -> staged, not installed yet
    currentTime = new Date(2026, 10, 26, 14, 0).getTime(); // 14:00 local
    manifestResp = {
      ...manifestResp,
      target: { version: "0.6.1", url: "https://github.com/davidwickerhf/enso/releases/download/v0.6.1/enso.zip", sha256: goodHash, notes: null, published_at: "2026-11-20T00:00:00Z" },
      held: null,
      update_available: true,
    };
    const outsideRes = await updater.checkNow();
    assert.equal(outsideRes.installed, false);
    assert.equal(outsideRes.reason, "outside_window");
    assert.equal(installedVersions.length, 0);

    // Inside window, but active session -> still deferred
    currentTime = new Date(2026, 10, 26, 3, 30).getTime();
    activeSessions = true;
    const busyRes = await updater.tryInstallPending();
    assert.equal(busyRes.installed, false);
    assert.equal(busyRes.reason, "session_active");

    // Session ends -> installs and reports installed
    activeSessions = false;
    const okRes = await updater.tryInstallPending();
    assert.equal(okRes.installed, true);
    assert.deepEqual(installedVersions, ["0.6.1"]);
    assert.equal(updater.helloUpdate().state, "installed");
    assert.equal(updater.helloUpdate().version, "0.6.1");
    assert.equal(updater.helloUpdate().from, "0.6.0");

    // Local updates: "off" overrides everything -> always reports idle
    updatesMode = "off";
    assert.deepEqual(updater.helloUpdate(), { state: "idle" });
    updater.stop();
    console.log("ok - §10.2 updater: sha256 verification, 24h hold, window, active-session defer, local off");
  }

  // =========================================================================
  // 7. Coordinator sanity check (createAnvilRunner uiState)
  // =========================================================================
  {
    const kr = memoryKeyring({ secure: true });
    const runner = createAnvilRunner({
      dataDir: path.join(root, "coord"),
      getConfig: () => ({ anvil: { url: "https://anvil.test", allowed_sites: ["vercel.com"], updates: "auto" } }),
      getSettings: () => ({ externalControl: "full" }),
      helperVersion: () => "0.6.0",
      zenVersion: () => "1.17.3b",
      keyring: kr,
      browserRequest: async () => ({}),
    });
    const st = runner.uiState();
    assert.equal(st.enrolled, false);
    assert.equal(st.keyring.secure, true);
    assert.deepEqual(st.ceiling.allowedSites, ["vercel.com"]);
    assert.ok(st.ceiling.denyTools.includes("page_eval"));
    runner.stop();
    console.log("ok - anvil runner coordinator state");
  }

  // =========================================================================
  // 8. Regression checks: verified artifact install, redirected-page ceiling,
  //    and concurrent session.start capacity reservation
  // =========================================================================
  {
    // 8a. Verified artifact install (supports pins & rollbacks without hitting site installer)
    const instData = path.join(root, "install-data");
    const installedHelper = path.join(instData, "helper");
    mkdirSync(installedHelper, { recursive: true });
    writeFileSync(path.join(installedHelper, "host.mjs"), "// old 0.6.0\n");
    writeFileSync(path.join(installedHelper, "VERSION"), "0.6.0\n");
    writeFileSync(path.join(installedHelper, "run.sh"), "#!/bin/sh\necho keep-me\n");

    const buildArchive = (ver, outFile) => {
      const srcRoot = path.join(root, `pkg-${ver}-${Date.now()}`);
      mkdirSync(path.join(srcRoot, "helper"), { recursive: true });
      writeFileSync(path.join(srcRoot, "helper", "host.mjs"), `// version ${ver}\n`);
      writeFileSync(path.join(srcRoot, "helper", "VERSION"), `${ver}\n`);
      execFileSync("tar", ["-czf", outFile, "-C", srcRoot, "helper"]);
      rmSync(srcRoot, { recursive: true, force: true });
      return sha256Hex(readFileSync(outFile));
    };

    const tarPath = path.join(root, "enso-0.6.1.tar.gz");
    const tarSha = buildArchive("0.6.1", tarPath);

    // Refuses dev checkout (helperDir != <dataDir>/helper)
    assert.throws(
      () => installVerifiedArtifact({ version: "0.6.1", sha256: tarSha, filePath: tarPath }, { dataDir: instData, helperDir: path.join(root, "checkout", "helper") }),
      /checkout/i,
    );
    // Refuses SHA-256 mismatch
    assert.throws(
      () => installVerifiedArtifact({ version: "0.6.1", sha256: "0".repeat(64), filePath: tarPath }, { dataDir: instData, helperDir: installedHelper }),
      /sha256 mismatch/i,
    );
    // Refuses archive whose embedded version does not match manifest target.version
    assert.throws(
      () => installVerifiedArtifact({ version: "0.6.2", sha256: tarSha, filePath: tarPath }, { dataDir: instData, helperDir: installedHelper }),
      /version mismatch/i,
    );
    // Installs exact verified artifact and preserves run.sh
    const instRes = installVerifiedArtifact({ version: "0.6.1", sha256: tarSha, filePath: tarPath }, { dataDir: instData, helperDir: installedHelper });
    assert.equal(instRes.installedVersion, "0.6.1");
    assert.equal(readFileSync(path.join(installedHelper, "VERSION"), "utf8").trim(), "0.6.1");
    assert.match(readFileSync(path.join(installedHelper, "host.mjs"), "utf8"), /0\.6\.1/);
    assert.match(readFileSync(path.join(installedHelper, "run.sh"), "utf8"), /keep-me/);

    // 8b. Redirect to outside.test (outside allowed_sites) or off-site (outside s.sites)
    const testKey = Buffer.alloc(32, 0x55).toString("base64url");
    const redirectCreds = {
      url: "https://anvil.test",
      token: "anvr_testtoken",
      signingKey: testKey,
      runner: { id: 17, name: "laptop-alice" },
      profile: "laptop:alice",
      owner: "alice",
    };
    const nowMs = 1795130000_000;
    const exp = Math.floor(nowMs / 1000) + 300;
    const mkSigned = (session, seq, kind, body) => ({
      kind,
      session,
      seq,
      body,
      expires_at: exp,
      sig: signLaptopMessage(testKey, { kind, session, seq, body, runnerId: 17, expiresAt: exp }),
    });

    const redirectResults = [];
    let currentRedirectUrl = "about:blank";
    let snapshotCalls = 0;
    let openResolvers = [];
    const mgr2 = createAnvilSessionManager({
      getCredentials: async () => redirectCreds,
      getAnvilConfig: () => resolveAnvilConfig({ anvil: { allowed_sites: ["allowed.test", "second.test"], max_sessions: 1 } }, { externalControl: "full" }),
      callChannel: async (method, body) => {
        redirectResults.push({ method, body });
        return { status: 200, body: { ok: true } };
      },
      browserRequest: async (_kind, action, args) => {
        if (action === "tabs_open_session") {
          return new Promise(resolve => openResolvers.push(() => resolve({ tabId: 800 + openResolvers.length, groupId: 20 })));
        }
        if (action === "navigate") {
          if (args.url === "https://allowed.test/go-outside") {
            currentRedirectUrl = "https://outside.test/secret";
            return { url: currentRedirectUrl, title: "Outside" };
          }
          if (args.url === "https://allowed.test/go-second") {
            currentRedirectUrl = "https://second.test/page";
            return { url: currentRedirectUrl, title: "Second" };
          }
          currentRedirectUrl = args.url;
          return { url: currentRedirectUrl, title: "Allowed" };
        }
        if (action === "anvil_snapshot") {
          snapshotCalls++;
          return { url: currentRedirectUrl, title: "Leaked", nodes: [{ role: "button", name: "Steal", interactive: true, ref: 1 }], passwords: [] };
        }
        return {};
      },
      now: () => nowMs,
      settleMs: 0,
    });

    // 8c. Concurrent session.start capacity check (max_sessions: 1)
    const sidA = "aaaa1111-1111-4111-8111-111111111111";
    const sidB = "bbbb2222-2222-4222-8222-222222222222";
    const startBody = {
      profile: "laptop:alice",
      principal: "user:alice",
      on_behalf_of: "alice",
      task: "Check",
      sites: ["allowed.test"],
      step_budget: 10,
      ttl_s: 600,
      approval: { request_id: 1, approved_by: "alice" },
    };
    const pA = mgr2.handleEvent("session.start", mkSigned(sidA, 1, "session.start", startBody));
    const pB = mgr2.handleEvent("session.start", mkSigned(sidB, 1, "session.start", startBody));
    // Wait a tick so both enter handleStart before tabs_open_session resolves
    await new Promise(r => setTimeout(r, 10));
    assert.equal(openResolvers.length, 1, "only one tabs_open_session should be invoked when max_sessions=1");
    openResolvers[0]();
    const [rA, rB] = await Promise.all([pA, pB]);
    assert.equal(rA.started, true);
    assert.equal(rB.started, false);
    assert.equal(rB.code, "busy");
    assert.equal(mgr2.activeCount(), 1);

    // Redirect outside local allowed_sites ceiling -> denied_by_ceiling and bounced to about:blank
    const navOutArgs = { url: "https://allowed.test/go-outside" };
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 2, "browser.call", {
      call_id: "11111111-1111-4111-8111-111111111111",
      tool: "browser_navigate",
      args: navOutArgs,
      call_hash: callHash(sidA, "browser_navigate", navOutArgs),
    }));
    const navOutRes = redirectResults.filter(r => r.method === "browser.result").at(-1).body;
    assert.equal(navOutRes.ok, false);
    assert.equal(navOutRes.error.code, "denied_by_ceiling");
    assert.equal(currentRedirectUrl, "about:blank");

    // Redirect to host inside ceiling but outside session sites -> off_site, and subsequent snapshot & click refused
    const navOffArgs = { url: "https://allowed.test/go-second" };
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 3, "browser.call", {
      call_id: "22222222-2222-4222-8222-222222222222",
      tool: "browser_navigate",
      args: navOffArgs,
      call_hash: callHash(sidA, "browser_navigate", navOffArgs),
    }));
    const navOffRes = redirectResults.filter(r => r.method === "browser.result").at(-1).body;
    assert.equal(navOffRes.ok, false);
    assert.equal(navOffRes.error.code, "off_site");

    const beforeSnaps = snapshotCalls;
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 4, "browser.call", {
      call_id: "33333333-3333-4333-8333-333333333333",
      tool: "browser_snapshot",
      args: {},
      call_hash: callHash(sidA, "browser_snapshot", {}),
    }));
    const snapOffRes = redirectResults.filter(r => r.method === "browser.result").at(-1).body;
    assert.equal(snapOffRes.ok, false);
    assert.equal(snapOffRes.error.code, "off_site");
    assert.equal(snapshotCalls, beforeSnaps, "must not snapshot an off-site page");

    const clickOffArgs = { ref: "@e1" };
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 5, "browser.call", {
      call_id: "44444444-4444-4444-8444-444444444444",
      tool: "browser_click",
      args: clickOffArgs,
      call_hash: callHash(sidA, "browser_click", clickOffArgs),
    }));
    const clickOffRes = redirectResults.filter(r => r.method === "browser.result").at(-1).body;
    assert.equal(clickOffRes.ok, false);
    assert.equal(clickOffRes.error.code, "off_site");

    // Client-side JS navigation to outside.test discovered during snapshot -> denied_by_ceiling & no content leaked
    const navAllowedArgs = { url: "https://allowed.test/ok" };
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 6, "browser.call", {
      call_id: "55555555-5555-4555-8555-555555555555",
      tool: "browser_navigate",
      args: navAllowedArgs,
      call_hash: callHash(sidA, "browser_navigate", navAllowedArgs),
    }));
    currentRedirectUrl = "https://outside.test/hijack";
    await mgr2.handleEvent("browser.call", mkSigned(sidA, 7, "browser.call", {
      call_id: "66666666-6666-4666-8666-666666666666",
      tool: "browser_snapshot",
      args: {},
      call_hash: callHash(sidA, "browser_snapshot", {}),
    }));
    const snapHijackRes = redirectResults.filter(r => r.method === "browser.result").at(-1).body;
    assert.equal(snapHijackRes.ok, false);
    assert.equal(snapHijackRes.error.code, "denied_by_ceiling");
    assert.equal(currentRedirectUrl, "about:blank");

    await mgr2.closeAll("test end");
    console.log("ok - regressions: verified artifact install, redirected-page authorization, concurrent max_sessions");
  }

  // =========================================================================
  // 9. allow_approved_sites: accepts non-private session sites, STILL blocks
  //    private-site floor, page_eval, and off-session redirects/navigations
  // =========================================================================
  {
    assert.equal(resolveAnvilConfig({}).allow_approved_sites, false, "allow_approved_sites defaults to false");
    assert.equal(resolveAnvilConfig({ anvil: { allow_approved_sites: "true" } }).allow_approved_sites, false, "non-boolean is rejected");
    const approvedCfg = resolveAnvilConfig({ anvil: { allowed_sites: [], allow_approved_sites: true, deny_tools: [] } });
    assert.equal(approvedCfg.allow_approved_sites, true);
    assert.ok(approvedCfg.deny_tools.has("page_eval"), "page_eval is ALWAYS denied even when allow_approved_sites is true");
    assert.equal(checkCeilingForTool("page_eval", approvedCfg).code, "denied_by_ceiling");

    assert.deepEqual(
      intersectSites(["vercel.com", "*.vercel.com", "paypal.com", "ing.nl", "myaccount.google.com"], [], { allowApprovedSites: true }),
      ["vercel.com", "*.vercel.com"],
      "allow_approved_sites accepts non-private sites and strips private-site floor hosts",
    );
    assert.deepEqual(
      intersectSites(["paypal.com", "mijn.belastingdienst.nl"], [], { allowApprovedSites: true }),
      [],
      "allow_approved_sites refuses sessions with only private sites",
    );

    const testKey = Buffer.alloc(32, 0x66).toString("base64url");
    const creds = {
      url: "https://anvil.test",
      token: "anvr_approved_tok",
      signingKey: testKey,
      runner: { id: 18, name: "laptop-alice" },
      profile: "laptop:alice",
      owner: "alice",
    };
    const nowMs = 1795140000_000;
    const exp = Math.floor(nowMs / 1000) + 300;
    const mkSigned = (session, seq, kind, body) => ({
      kind,
      session,
      seq,
      body,
      expires_at: exp,
      sig: signLaptopMessage(testKey, { kind, session, seq, body, runnerId: 18, expiresAt: exp }),
    });

    const calls = [];
    let tabUrl = "about:blank";
    let snapCount = 0;
    const mgr = createAnvilSessionManager({
      getCredentials: async () => creds,
      getAnvilConfig: () => resolveAnvilConfig({ anvil: { allowed_sites: [], allow_approved_sites: true, max_sessions: 2 } }, { externalControl: "full" }),
      callChannel: async (method, body) => {
        calls.push({ method, body });
        if (method === "step.request") return { status: 200, body: { step_id: 901, deadline: "2026-11-26T22:00:00.000Z" } };
        return { status: 200, body: { ok: true } };
      },
      browserRequest: async (_kind, action, args) => {
        if (action === "tabs_open_session") return { tabId: 910, groupId: 30 };
        if (action === "tabs_close") return {};
        if (action === "navigate") {
          if (args.url === "https://docs.example.test/to-offsite") {
            tabUrl = "https://unapproved.example.test/page";
            return { url: tabUrl, title: "Unapproved" };
          }
          if (args.url === "https://docs.example.test/to-bank") {
            tabUrl = "https://ing.nl/login";
            return { url: tabUrl, title: "ING" };
          }
          tabUrl = args.url;
          return { url: tabUrl, title: "Docs" };
        }
        if (action === "anvil_snapshot") {
          snapCount++;
          return { url: tabUrl, title: "Docs", nodes: [{ role: "button", name: "Next", interactive: true, ref: 1 }], passwords: [] };
        }
        if (action === "has_sensitive_field") return { sensitive: false };
        if (action === "screenshot") return { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
        return {};
      },
      now: () => nowMs,
      settleMs: 0,
    });

    // 9a. Session with only private sites is refused even with allow_approved_sites: true
    const privSid = "cccc1111-1111-4111-8111-111111111111";
    const privStart = await mgr.handleEvent("session.start", mkSigned(privSid, 1, "session.start", {
      profile: "laptop:alice",
      principal: "user:alice",
      on_behalf_of: "alice",
      task: "Bank",
      sites: ["paypal.com", "ing.nl"],
      step_budget: 5,
      ttl_s: 600,
    }));
    assert.equal(privStart.started, false);
    assert.equal(privStart.code, "private_site");

    // 9b. Session with mixed non-private + private sites starts with ONLY non-private sites
    const sid = "dddd2222-2222-4222-8222-222222222222";
    const startRes = await mgr.handleEvent("session.start", mkSigned(sid, 1, "session.start", {
      profile: "laptop:alice",
      principal: "user:alice",
      on_behalf_of: "alice",
      task: "Check docs",
      sites: ["docs.example.test", "paypal.com", "myaccount.google.com"],
      step_budget: 10,
      ttl_s: 600,
    }));
    assert.equal(startRes.started, true);
    assert.deepEqual(startRes.sites, ["docs.example.test"]);

    // 9c. Navigating to approved non-private session site succeeds
    const okNav = { url: "https://docs.example.test/start" };
    const okRes = await mgr.handleEvent("browser.call", mkSigned(sid, 2, "browser.call", {
      call_id: "a1111111-1111-4111-8111-111111111111",
      tool: "browser_navigate",
      args: okNav,
      call_hash: callHash(sid, "browser_navigate", okNav),
    }));
    assert.equal(okRes.ok, true);

    // 9d. Direct navigation to private-site floor host is ALWAYS refused (private_site)
    const bankNav = { url: "https://paypal.com/myaccount" };
    const bankRes = await mgr.handleEvent("browser.call", mkSigned(sid, 3, "browser.call", {
      call_id: "a2222222-2222-4222-8222-222222222222",
      tool: "browser_navigate",
      args: bankNav,
      call_hash: callHash(sid, "browser_navigate", bankNav),
    }));
    assert.equal(bankRes.ok, false);
    assert.equal(bankRes.error.code, "private_site");

    // 9e. Direct navigation to unapproved non-private host is NOT allowed (asks off_site)
    const offNav = { url: "https://unapproved.example.test/home" };
    const offNavRes = await mgr.handleEvent("browser.call", mkSigned(sid, 4, "browser.call", {
      call_id: "a3333333-3333-4333-8333-333333333333",
      tool: "browser_navigate",
      args: offNav,
      call_hash: callHash(sid, "browser_navigate", offNav),
    }));
    assert.equal(offNavRes.ok, false);
    assert.equal(offNavRes.error.code, "step_approval_pending");
    assert.equal(calls.filter(c => c.method === "step.request").at(-1).body.reason, "off_site");

    // 9f. Redirect to off-session site -> off_site & subsequent snapshot blocked
    const redirOff = { url: "https://docs.example.test/to-offsite" };
    const redirOffRes = await mgr.handleEvent("browser.call", mkSigned(sid, 5, "browser.call", {
      call_id: "a4444444-4444-4444-8444-444444444444",
      tool: "browser_navigate",
      args: redirOff,
      call_hash: callHash(sid, "browser_navigate", redirOff),
    }));
    assert.equal(redirOffRes.ok, false);
    assert.equal(redirOffRes.error.code, "off_site");

    const snapsBefore = snapCount;
    const snapBlocked = await mgr.handleEvent("browser.call", mkSigned(sid, 6, "browser.call", {
      call_id: "a5555555-5555-4555-8555-555555555555",
      tool: "browser_snapshot",
      args: {},
      call_hash: callHash(sid, "browser_snapshot", {}),
    }));
    assert.equal(snapBlocked.ok, false);
    assert.equal(snapBlocked.error.code, "off_site");
    assert.equal(snapCount, snapsBefore);

    // 9g. Redirect to private-site floor host -> private_site & bounced to about:blank
    const redirBank = { url: "https://docs.example.test/to-bank" };
    const redirBankRes = await mgr.handleEvent("browser.call", mkSigned(sid, 7, "browser.call", {
      call_id: "a6666666-6666-4666-8666-666666666666",
      tool: "browser_navigate",
      args: redirBank,
      call_hash: callHash(sid, "browser_navigate", redirBank),
    }));
    assert.equal(redirBankRes.ok, false);
    assert.equal(redirBankRes.error.code, "private_site");
    assert.equal(tabUrl, "about:blank");

    // 9h. session.allow accepts non-private host without allowed_sites, STILL refuses private sites
    const allowRes = await mgr.handleEvent("session.allow", mkSigned(sid, 8, "session.allow", {
      sites: ["extra.example.test", "digid.nl", "ing.nl"],
      step_id: 902,
    }));
    assert.deepEqual(allowRes.allowed, ["extra.example.test"]);
    assert.ok(mgr.peek(sid).sites.includes("extra.example.test"));
    assert.ok(!mgr.peek(sid).sites.includes("digid.nl"));

    await mgr.closeAll("test end");
    console.log("ok - allow_approved_sites: accepts non-private session sites, still enforces private-site floor, page_eval, and off_site");
  }

  // =========================================================================
  // 10. Live allowed_sites add/remove, allow_approved_sites toggle, config.local.json
  //     hot-reload, updated hello emission, and CLI subcommands
  // =========================================================================
  {
    // Validation rules
    assert.deepEqual(validateSitePattern("  Vercel.COM. "), { ok: true, site: "vercel.com" });
    assert.deepEqual(validateSitePattern("*.Vercel.COM"), { ok: true, site: "*.vercel.com" });
    assert.deepEqual(validateSitePattern("https://app.vercel.com/projects"), { ok: true, site: "app.vercel.com" });
    assert.equal(validateSitePattern("*.com").ok, false);
    assert.equal(validateSitePattern("localhost").ok, false);
    assert.equal(validateSitePattern("127.0.0.1").ok, false);
    assert.equal(validateSitePattern("ftp://example.com").ok, false);
    assert.equal(validateSitePattern("paypal.com").code, "private_site");
    assert.equal(validateSitePattern("*.ing.nl").code, "private_site");
    assert.equal(validateSitePattern("myaccount.google.com").code, "private_site");
    assert.equal(validateSitePattern("mybank.example.com").code, "private_site");

    // Seed config.local.json with unrelated keys to verify they are preserved
    mkdirSync(path.dirname(LOCAL_CONFIG), { recursive: true });
    writeFileSync(LOCAL_CONFIG, `${JSON.stringify({ defaults: { effort: "high" }, spaceHints: { Work: "Keep me" } }, null, 2)}\n`);
    reloadConfigIfChanged();

    const sockets = [];
    class LiveFakeWS {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        sockets.push(this);
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      send(data) {
        const frame = JSON.parse(data);
        this.sent.push(frame);
        if (frame.t === "call") {
          const body = frame.method === "hello" ? { ok: true, hello_every_s: 30, active_sessions: [] } : { ok: true };
          queueMicrotask(() => {
            this.onmessage?.({ data: JSON.stringify({ t: "reply", id: frame.id, status: 200, body }) });
          });
        }
      }
      close(code = 1000, reason = "") {
        this.readyState = 3;
        this.onclose?.({ code, reason });
      }
    }

    const kr = memoryKeyring({ secure: true });
    const liveKey = Buffer.alloc(32, 0x77).toString("base64url");
    await kr.save({ token: "anvr_livetok1234567890", signingKey: liveKey });
    const liveDataDir = path.join(root, "live-runner");
    mkdirSync(liveDataDir, { recursive: true });
    writeFileSync(
      path.join(liveDataDir, "anvil.json"),
      JSON.stringify({
        url: "https://anvil.test",
        runner: { id: 55, name: "laptop-live" },
        profile: "laptop:alice",
        owner: "alice",
        channel: { ticket_path: "/api/browser-runners/channel-ticket", path: "/api/browser-runners/channel" },
      }),
    );

    const states = [];
    const runner = createAnvilRunner({
      dataDir: liveDataDir,
      getConfig: () => {
        reloadConfigIfChanged();
        return config;
      },
      getSettings: () => ({ externalControl: "full" }),
      helperVersion: () => "0.5.9.2",
      zenVersion: () => "1.17.3b",
      extensionConnected: () => true,
      keyring: kr,
      browserRequest: async (_kind, action) => (action === "tabs_open_session" ? { tabId: 950, groupId: 40 } : {}),
      fetchImpl: async url => {
        if (String(url).includes("channel-ticket")) return { ok: true, status: 200, json: async () => ({ ticket: "anvc_live1", path: "/api/browser-runners/channel" }) };
        return { ok: false, status: 404, json: async () => ({}) };
      },
      WebSocketImpl: LiveFakeWS,
      onStateChange: st => states.push(st),
    });

    runner.start();
    await new Promise(r => setTimeout(r, 30));
    assert.equal(sockets.length, 1);
    const hellos = () => sockets[0].sent.filter(f => f.method === "hello").map(f => f.body);
    assert.ok(hellos().at(-1).problems.includes("no allowed_sites in config"), "initial hello reports missing allowed_sites");

    // Helper signs a session.start against the live runner
    let liveSeq = 0;
    const signLive = (session, kind, body) => {
      liveSeq++;
      const expires_at = Math.floor(Date.now() / 1000) + 120;
      return { kind, session, seq: liveSeq, body, expires_at, sig: signLaptopMessage(liveKey, { kind, session, seq: liveSeq, body, runnerId: 55, expiresAt: expires_at }) };
    };
    const startReq = (session, sites) => runner.sessions.handleEvent("session.start", signLive(session, "session.start", {
      profile: "laptop:alice",
      principal: "user:alice",
      on_behalf_of: "alice",
      task: "Live config test",
      sites,
      step_budget: 5,
      ttl_s: 600,
    }));

    // Before adding any site, session.start is denied_by_ceiling
    const deniedBefore = await startReq("e1111111-1111-4111-8111-111111111111", ["vercel.com"]);
    assert.equal(deniedBefore.started, false);
    assert.equal(deniedBefore.code, "denied_by_ceiling");

    // Refuses adding private-site floor host without modifying config.local.json
    assert.throws(() => updateAnvilLocalCeiling({ addSite: "paypal.com" }), /private-site floor/i);

    // Live add site -> writes config.local.json, preserves other keys, emits updated hello without problem, session now succeeds!
    const addRes = updateAnvilLocalCeiling({ addSite: "vercel.com" });
    assert.deepEqual(addRes.allowed_sites, ["vercel.com"]);
    runner.notifyConfigChanged();
    await new Promise(r => setTimeout(r, 15));

    const disk1 = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8"));
    assert.deepEqual(disk1.anvil.allowed_sites, ["vercel.com"]);
    assert.equal(disk1.defaults.effort, "high", "unrelated keys preserved");
    assert.equal(disk1.spaceHints.Work, "Keep me", "unrelated keys preserved");
    assert.ok(!hellos().at(-1).problems.includes("no allowed_sites in config"), "hello cleared problem without restart");
    assert.deepEqual(runner.uiState().ceiling.allowedSites, ["vercel.com"]);

    const okAfterAdd = await startReq("e2222222-2222-4222-8222-222222222222", ["vercel.com"]);
    assert.equal(okAfterAdd.started, true);
    await runner.sessions.closeAll("cleanup");

    // Live remove site -> problem returns and session is denied again
    updateAnvilLocalCeiling({ removeSite: "vercel.com" });
    runner.notifyConfigChanged();
    await new Promise(r => setTimeout(r, 15));
    assert.deepEqual(runner.uiState().ceiling.allowedSites, []);
    assert.ok(hellos().at(-1).problems.includes("no allowed_sites in config"));
    const deniedAfterRemove = await startReq("e3333333-3333-4333-8333-333333333333", ["vercel.com"]);
    assert.equal(deniedAfterRemove.started, false);
    assert.equal(deniedAfterRemove.code, "denied_by_ceiling");

    // Live toggle allow_approved_sites: true -> writes config.local.json, clears hello problem even with empty allowed_sites, accepts non-private site!
    updateAnvilLocalCeiling({ allowApprovedSites: true });
    runner.notifyConfigChanged();
    await new Promise(r => setTimeout(r, 15));
    const disk2 = JSON.parse(readFileSync(LOCAL_CONFIG, "utf8"));
    assert.equal(disk2.anvil.allow_approved_sites, true);
    assert.equal(runner.uiState().ceiling.allowApprovedSites, true);
    assert.ok(!hellos().at(-1).problems.includes("no allowed_sites in config"), "allow_approved_sites clears no allowed_sites problem");

    const okAfterToggle = await startReq("e4444444-4444-4444-8444-444444444444", ["any-non-private.example.test"]);
    assert.equal(okAfterToggle.started, true);
    await runner.sessions.closeAll("cleanup");

    // CLI subcommands: enso runner allow / disallow / allow-approved / status
    const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bin/enso.mjs");
    const runCli = args => execFileSync(process.execPath, [cli, ...args], { env: { ...process.env, ENSO_DATA: process.env.ENSO_DATA }, encoding: "utf8", stdio: "pipe" });

    // Disable allow_approved_sites via CLI, then allow & disallow sites via CLI
    const offOut = runCli(["runner", "allow-approved", "off"]);
    assert.match(offOut, /Approved:\s+off/);
    const allowOut = runCli(["runner", "allow", "github.com", "*.github.com"]);
    assert.match(allowOut, /Allowed:\s+github\.com, \*\.github\.com/);
    const statusOut = runCli(["runner", "status"]);
    assert.match(statusOut, /Sites:\s+github\.com, \*\.github\.com/);
    assert.match(statusOut, /Approved:\s+off/);

    // Running helper picks up external CLI edit on disk without restart!
    assert.deepEqual(runner.uiState().ceiling.allowedSites, ["github.com", "*.github.com"]);
    assert.equal(runner.uiState().ceiling.allowApprovedSites, false);
    const okFromCli = await startReq("e5555555-5555-4555-8555-555555555555", ["github.com"]);
    assert.equal(okFromCli.started, true);
    await runner.sessions.closeAll("cleanup");

    // CLI refuses private-site floor host
    assert.throws(() => runCli(["runner", "allow", "ing.nl"]), err => /private-site floor/i.test(String(err.stderr || err.message)));

    // CLI disallow removes site
    const disallowOut = runCli(["runner", "disallow", "github.com"]);
    assert.match(disallowOut, /Removed:\s+github\.com/);
    assert.deepEqual(runner.uiState().ceiling.allowedSites, ["*.github.com"]);

    runner.stop();
    console.log("ok - live allowed_sites & allow_approved_sites updates, hot-reload, hello update, and CLI subcommands");
  }

  // =========================================================================
  // 11. End-to-end host.mjs native-messaging round-trip for anvil.ceiling.update
  // =========================================================================
  {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const home = realpathSync(mkdtempSync(path.join(tmpdir(), "enso-anvil-host-")));
    const data = dataDirFor(home);
    const port = 48100 + Math.floor(Math.random() * 800);
    const env = isolatedEnv(home, { ENSO_MCP_PORT: String(port), ENSO_DOCTOR: "1" });
    const host = spawn(process.execPath, [path.join(here, "../host.mjs")], { env, cwd: home, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    host.stderr.on("data", d => (stderr += d));
    const inbox = [];
    let waiters = [];
    let buf = Buffer.alloc(0);
    host.stdout.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) break;
        const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8"));
        buf = buf.subarray(4 + len);
        inbox.push(msg);
        waiters = waiters.filter(w => !(w.test(msg) && (w.resolve(msg), true)));
      }
    });
    const post = msg => {
      const body = Buffer.from(JSON.stringify(msg));
      const head = Buffer.alloc(4);
      head.writeUInt32LE(body.length, 0);
      host.stdin.write(Buffer.concat([head, body]));
    };
    const waitFor = (test, fromIndex = 0, ms = 15_000) => {
      const hit = inbox.slice(fromIndex).find(test);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out; stderr:\n${stderr}`)), ms);
        waiters.push({ test, resolve: m => { clearTimeout(t); resolve(m); } });
      });
    };

    try {
      post({ type: "hello" });
      const st = await waitFor(m => m.type === "state");
      assert.deepEqual(st.anvil.ceiling.allowedSites, []);
      assert.equal(st.anvil.ceiling.allowApprovedSites, false);
      assert.ok(Array.isArray(st.anvil.ceiling.privateSiteFloor) && st.anvil.ceiling.privateSiteFloor.includes("paypal.com"));

      // Add a site via anvil.ceiling.update -> saved to config.local.json immediately
      let idx = inbox.length;
      post({ type: "anvil.ceiling.update", addSite: "vercel.com" });
      const addedMsg = await waitFor(m => m.type === "anvil" && m.done?.action === "ceiling", idx);
      assert.equal(addedMsg.done.ok, true);
      assert.deepEqual(addedMsg.status.ceiling.allowedSites, ["vercel.com"]);
      assert.deepEqual(JSON.parse(readFileSync(path.join(data, "config.local.json"), "utf8")).anvil.allowed_sites, ["vercel.com"]);

      // Reject private-site floor host
      idx = inbox.length;
      post({ type: "anvil.ceiling.update", addSite: "paypal.com" });
      const rejectedMsg = await waitFor(m => m.type === "anvil" && m.done?.action === "ceiling", idx);
      assert.equal(rejectedMsg.done.ok, false);
      assert.match(rejectedMsg.done.error, /private-site floor/i);
      assert.deepEqual(rejectedMsg.status.ceiling.allowedSites, ["vercel.com"]);

      // Toggle allow_approved_sites on
      idx = inbox.length;
      post({ type: "anvil.ceiling.update", allowApprovedSites: true });
      const toggledMsg = await waitFor(m => m.type === "anvil" && m.done?.action === "ceiling", idx);
      assert.equal(toggledMsg.done.ok, true);
      assert.equal(toggledMsg.status.ceiling.allowApprovedSites, true);
      assert.equal(JSON.parse(readFileSync(path.join(data, "config.local.json"), "utf8")).anvil.allow_approved_sites, true);

      // Remove site
      idx = inbox.length;
      post({ type: "anvil.ceiling.update", removeSite: "vercel.com" });
      const removedMsg = await waitFor(m => m.type === "anvil" && m.done?.action === "ceiling", idx);
      assert.equal(removedMsg.done.ok, true);
      assert.deepEqual(removedMsg.status.ceiling.allowedSites, []);
      assert.equal(removedMsg.status.ceiling.allowApprovedSites, true);

      console.log("ok - host.mjs anvil.ceiling.update live add/reject/toggle/remove");
    } finally {
      host.stdin.end();
      await stopAndRemove(host, home);
    }
  }

  console.log("\nall anvil-runner tests passed");
} finally {
  rmSync(root, { recursive: true, force: true });
}
