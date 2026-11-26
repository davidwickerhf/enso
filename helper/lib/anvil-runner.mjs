// Anvil laptop browser runner coordinator: wires enrollment (anvil-auth),
// outbound WebSocket channel (anvil-channel), supervised sessions (anvil-sessions),
// and the manifest updater (anvil-updater) into one lifecycle for host.mjs and UI.

import { createAnvilAuth, REVOKED_MESSAGE } from "./anvil-auth.mjs";
import { createAnvilChannel } from "./anvil-channel.mjs";
import { PRIVATE_SITE_FLOOR, REMOTE_TOOLS, resolveAnvilConfig } from "./anvil-policy.mjs";
import { createAnvilSessionManager } from "./anvil-sessions.mjs";
import { createAnvilUpdater } from "./anvil-updater.mjs";
import { dataDir as defaultDataDir } from "./platform.mjs";

export function createAnvilRunner({
  dataDir = defaultDataDir(),
  getConfig = () => ({}),
  getSettings = () => ({}),
  helperVersion = () => "0.5.8.1",
  zenVersion = () => null,
  extensionConnected = () => true,
  browserRequest,
  agentSessions = null,
  installArtifact = null,
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  keyring,
  onStateChange = () => {},
  onSessionsChange = () => {},
  onAction = () => {},
  now = Date.now,
  log = () => {},
} = {}) {
  const getAnvilConfig = () => resolveAnvilConfig(getConfig(), getSettings());

  const auth = createAnvilAuth({
    dataDir,
    fetchImpl,
    ...(keyring ? { keyring } : {}),
    defaultUrl: getAnvilConfig().url,
    version: helperVersion() || "0.5.8.1",
    zenVersion,
    log,
  });

  // In-memory UI enrollment flow (device_code stays strictly in helper memory)
  let enrollFlow = null; // { url, device_code, user_code, verification_uri, verification_uri_complete, expires_at, interval, status, error, timer }

  function emitState() {
    try { onStateChange(uiState()); } catch {}
  }

  let channel = null;
  let updater = null;
  let sessions = null;

  async function handleRevoked(reason = REVOKED_MESSAGE) {
    channel?.stop("revoked");
    updater?.stop();
    await sessions?.closeAll("revoked");
    await auth.handleRevoked(reason);
    emitState();
    try { onSessionsChange(); } catch {}
  }

  function buildHello() {
    const cfg = getAnvilConfig();
    const problems = [];
    if (!auth.keyring.isSecure()) problems.push("no system keyring");
    if (!extensionConnected()) problems.push("extension not connected");
    if (!cfg.allow_approved_sites && !cfg.allowed_sites.length) problems.push("no allowed_sites in config");
    const zen = zenVersion();
    return {
      version: String(helperVersion() || "0.5.8.1").slice(0, 40),
      ...(zen ? { zen: String(zen).slice(0, 40) } : {}),
      external_control: cfg.external_control,
      tools: [...REMOTE_TOOLS],
      max_sessions: cfg.max_sessions,
      problems: problems.slice(0, 5),
      update: updater ? updater.helloUpdate() : { state: "idle" },
    };
  }

  sessions = createAnvilSessionManager({
    getCredentials: () => auth.loadCredentials(),
    getAnvilConfig,
    callChannel: (method, body) => channel.call(method, body),
    browserRequest,
    agentSessions,
    fetchImpl,
    onChange: () => {
      try { onSessionsChange(); } catch {}
      emitState();
    },
    onRevoked: handleRevoked,
    onSessionsIdle: () => updater?.onSessionsIdle(),
    onAction,
    now,
    log,
  });

  updater = createAnvilUpdater({
    dataDir,
    getCredentials: () => auth.loadCredentials(),
    getAnvilConfig,
    currentVersion: () => helperVersion() || "0.5.8.1",
    hasActiveSessions: () => sessions.activeCount() > 0,
    installArtifact,
    onStateChange: () => {
      emitState();
      if (channel?.isConnected()) channel.sendHelloNow().catch(() => {});
    },
    onRevoked: handleRevoked,
    fetchImpl,
    now,
    log,
  });

  channel = createAnvilChannel({
    getCredentials: () => auth.loadCredentials(),
    buildHello,
    onEvent: (name, body) => {
      void sessions.handleEvent(name, body);
    },
    onHelloReply: () => {
      void sessions.reconcileSteps();
    },
    onRevoked: handleRevoked,
    onReplaced: () => emitState(),
    onStateChange: () => emitState(),
    fetchImpl,
    WebSocketImpl,
    log,
  });

  function cancelEnroll() {
    if (enrollFlow?.timer) clearTimeout(enrollFlow.timer);
    enrollFlow = null;
    emitState();
  }

  async function startEnroll({ url } = {}) {
    cancelEnroll();
    const targetUrl = url || getAnvilConfig().url;
    const started = await auth.startEnroll({ url: targetUrl });
    enrollFlow = {
      url: started.url,
      device_code: started.device_code,
      user_code: started.user_code,
      verification_uri: started.verification_uri,
      verification_uri_complete: started.verification_uri_complete,
      expires_at: started.expires_at,
      interval: started.interval,
      status: "pending",
      error: null,
      timer: null,
    };
    scheduleEnrollPoll(enrollFlow);
    emitState();
    return sanitizedEnrollFlow();
  }

  function scheduleEnrollPoll(flow) {
    if (enrollFlow !== flow) return;
    flow.timer = setTimeout(() => {
      flow.timer = null;
      void pollEnrollTick(flow);
    }, flow.interval * 1000);
    flow.timer.unref?.();
  }

  async function pollEnrollTick(flow) {
    if (enrollFlow !== flow) return;
    try {
      const r = await auth.pollEnrollOnce({ url: flow.url, deviceCode: flow.device_code });
      if (enrollFlow !== flow) return;
      if (r.status === "pending" || r.status === "slow_down") {
        flow.interval = r.interval;
        scheduleEnrollPoll(flow);
        return;
      }
      if (r.status === "approved") {
        enrollFlow = null;
        emitState();
        start();
        return;
      }
      flow.status = r.status; // denied | expired
      flow.error = r.status === "denied" ? "Enrollment was denied in Anvil." : "The enrollment code expired. Start again for a new code.";
      flow.device_code = null;
      emitState();
    } catch (err) {
      if (enrollFlow !== flow) return;
      flow.status = "error";
      flow.error = String(err?.message ?? err).slice(0, 200);
      flow.device_code = null;
      emitState();
    }
  }

  function sanitizedEnrollFlow() {
    if (!enrollFlow) return null;
    return {
      url: enrollFlow.url,
      user_code: enrollFlow.user_code,
      verification_uri: enrollFlow.verification_uri,
      verification_uri_complete: enrollFlow.verification_uri_complete,
      expires_at: enrollFlow.expires_at,
      status: enrollFlow.status,
      error: enrollFlow.error,
    };
  }

  async function disconnect() {
    cancelEnroll();
    channel.stop("disconnected by user");
    updater.stop();
    await sessions.closeAll("disconnected by user");
    const r = await auth.disconnect();
    emitState();
    try { onSessionsChange(); } catch {}
    return r;
  }

  function start() {
    const meta = auth.loadEnrollment();
    if (!meta || meta.revoked) {
      emitState();
      return;
    }
    channel.start();
    updater.start();
    emitState();
  }

  function stop() {
    cancelEnroll();
    channel.stop("helper stopping");
    updater.stop();
  }

  function notifyConfigChanged() {
    if (channel.isConnected()) channel.sendHelloNow().catch(() => {});
    emitState();
  }

  function uiState() {
    const meta = auth.loadEnrollment();
    const cfg = getAnvilConfig();
    const ch = channel.state();
    const up = updater.status();
    const enrolled = !!meta && !meta.revoked && !!meta.runner?.id;
    return {
      enrolled,
      revoked: !!meta?.revoked,
      revokedMessage: meta?.revoked ? (meta.revoked_message || REVOKED_MESSAGE) : null,
      url: meta?.url || cfg.url,
      runner: enrolled ? meta.runner : null,
      profile: enrolled ? meta.profile : null,
      owner: enrolled ? meta.owner : null,
      keyring: {
        secure: auth.keyring.isSecure(),
        backend: auth.keyring.backendName(),
        location: auth.keyring.location(),
      },
      channel: ch,
      update: up,
      ceiling: {
        allowedSites: cfg.allowed_sites,
        allowApprovedSites: cfg.allow_approved_sites,
        privateSiteFloor: [...PRIVATE_SITE_FLOOR],
        externalControl: cfg.external_control,
        denyTools: [...cfg.deny_tools],
        sessionFetch: cfg.session_fetch,
        maxSessions: cfg.max_sessions,
        updates: cfg.updates,
      },
      activeSessions: sessions.activeCount(),
      enroll: sanitizedEnrollFlow(),
    };
  }

  return {
    auth,
    channel,
    sessions,
    updater,
    start,
    stop,
    startEnroll,
    cancelEnroll,
    disconnect,
    notifyConfigChanged,
    buildHello,
    uiState,
  };
}
