// Outbound WebSocket channel from Ensō to Anvil (LAPTOP-RUNNER.md §3 & §4):
// one-time ticket fetch, WSS connection, call/reply/event JSON framing (<= 1 MB),
// 60 s call timeouts, hello on connect + every 30 s, exponential backoff (1 s..60 s ±20%),
// and close-code handling (4401 revoked, 4409 replaced).

import { normalizeAnvilUrl } from "./anvil-auth.mjs";

export const DEFAULT_TICKET_PATH = "/api/browser-runners/channel-ticket";
export const DEFAULT_CHANNEL_PATH = "/api/browser-runners/channel";
export const MAX_FRAME_BYTES = 1024 * 1024;
export const DEFAULT_CALL_TIMEOUT_MS = 60_000;
export const DEFAULT_HELLO_EVERY_S = 30;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

export function channelWsUrl(anvilUrl, channelPath, ticket) {
  const base = normalizeAnvilUrl(anvilUrl);
  const u = new URL(channelPath || DEFAULT_CHANNEL_PATH, `${base}/`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("ticket", ticket);
  return u.toString();
}

/** Exponential backoff: 1 s doubling up to 60 s, with ±20% jitter. */
export function backoffDelayMs(attempt, random = Math.random) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt));
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}

export function createAnvilChannel({
  getCredentials,
  buildHello,
  onEvent = () => {},
  onHelloReply = () => {},
  onRevoked = () => {},
  onReplaced = () => {},
  onStateChange = () => {},
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  random = Math.random,
  log = () => {},
} = {}) {
  let ws = null;
  let running = false;
  let connecting = false;
  let seq = 0;
  let attempt = 0;
  let reconnectTimer = null;
  let helloTimer = null;
  let helloIntervalMs = DEFAULT_HELLO_EVERY_S * 1000;
  const waiting = new Map();

  let status = "disconnected"; // disconnected | connecting | connected | reconnecting | revoked | replaced
  let connectedAt = null;
  let lastHelloAt = null;
  let lastError = null;

  function setStatus(next, error = null) {
    status = next;
    lastError = error;
    try { onStateChange(state()); } catch {}
  }

  function state() {
    return { status, connectedAt, lastHelloAt, lastError, attempt };
  }

  function clearTimers() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (helloTimer) { clearInterval(helloTimer); helloTimer = null; }
  }

  function rejectAll(reason) {
    for (const [, w] of waiting) {
      clearTimeout(w.timer);
      w.reject(new Error(`anvil channel closed: ${reason}`));
    }
    waiting.clear();
  }

  async function fetchTicket(creds) {
    const base = normalizeAnvilUrl(creds.url);
    const ticketPath = creds.channel?.ticket_path || DEFAULT_TICKET_PATH;
    const u = new URL(ticketPath, `${base}/`);
    const res = await fetchImpl(u.toString(), {
      method: "POST",
      headers: {
        authorization: `Bearer ${creds.token}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401) {
      const err = new Error("Anvil rejected the runner token (401).");
      err.revoked = true;
      throw err;
    }
    if (!res.ok || !body?.ticket) {
      throw new Error(body?.message || `Channel ticket request failed (HTTP ${res.status}).`);
    }
    return { ticket: String(body.ticket), path: String(body.path || creds.channel?.path || DEFAULT_CHANNEL_PATH) };
  }

  function call(method, body = {}, { timeoutMs = callTimeoutMs } = {}) {
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("anvil channel is not open"));
    const id = ++seq;
    const payload = JSON.stringify({ t: "call", id, method, body });
    if (Buffer.byteLength(payload, "utf8") > MAX_FRAME_BYTES) {
      return Promise.reject(new Error(`anvil channel frame exceeds ${MAX_FRAME_BYTES} bytes`));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`anvil channel: ${method} timed out`));
      }, timeoutMs);
      timer.unref?.();
      waiting.set(id, { resolve, reject, timer });
      try {
        ws.send(payload);
      } catch (err) {
        clearTimeout(timer);
        waiting.delete(id);
        reject(err);
      }
    });
  }

  async function sendHello() {
    if (!ws || ws.readyState !== 1) return null;
    const payload = await buildHello();
    const reply = await call("hello", payload);
    if (reply.status === 401) {
      await triggerRevoked("Token revoked (401 on hello)");
      return reply;
    }
    if (reply.status === 200) {
      lastHelloAt = new Date().toISOString();
      const everyS = Number(reply.body?.hello_every_s);
      if (Number.isFinite(everyS) && everyS >= 5 && everyS <= 300) {
        const nextMs = Math.round(everyS * 1000);
        if (nextMs !== helloIntervalMs) {
          helloIntervalMs = nextMs;
          armHelloTimer();
        }
      }
      try { onHelloReply(reply.body ?? {}); } catch {}
      try { onStateChange(state()); } catch {}
    }
    return reply;
  }

  function armHelloTimer() {
    if (helloTimer) clearInterval(helloTimer);
    helloTimer = setInterval(() => {
      sendHello().catch(err => log("anvil: hello failed:", err?.message ?? err));
    }, helloIntervalMs);
    helloTimer.unref?.();
  }

  async function triggerRevoked(reason) {
    running = false;
    clearTimers();
    const sock = ws;
    ws = null;
    if (sock) {
      try { sock.close(1000, "revoked"); } catch {}
    }
    rejectAll("revoked");
    setStatus("revoked", reason);
    await Promise.resolve(onRevoked(reason)).catch(() => {});
  }

  function handleMessage(raw) {
    if (typeof raw !== "string") return; // Binary frames are not used by v1
    if (Buffer.byteLength(raw, "utf8") > MAX_FRAME_BYTES) {
      log("anvil: dropped oversized frame");
      return;
    }
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      log("anvil: dropped non-JSON frame");
      return;
    }
    if (m?.t === "reply" && Number.isSafeInteger(m.id)) {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      clearTimeout(w.timer);
      const reply = { status: Number(m.status) || 500, body: m.body ?? null };
      if (reply.status === 401) {
        w.resolve(reply);
        void triggerRevoked("Token revoked (401 on channel call)");
        return;
      }
      w.resolve(reply);
      return;
    }
    if (m?.t === "event" && typeof m.name === "string") {
      try {
        onEvent(m.name, m.body ?? null);
      } catch (err) {
        log("anvil: event handler error:", err?.message ?? err);
      }
    }
  }

  function scheduleReconnect(reason) {
    if (!running) return;
    clearTimers();
    const delay = backoffDelayMs(attempt, random);
    attempt++;
    setStatus("reconnecting", reason);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (running) void connectOnce();
    }, delay);
    reconnectTimer.unref?.();
  }

  async function connectOnce() {
    if (!running || connecting) return;
    connecting = true;
    try {
      const creds = await getCredentials();
      if (!creds || creds.error) {
        running = false;
        setStatus("disconnected", creds?.error || null);
        return;
      }
      if (typeof WebSocketImpl !== "function") {
        running = false;
        setStatus("disconnected", "WebSocket is not available in this Node runtime.");
        return;
      }
      setStatus(attempt === 0 ? "connecting" : "reconnecting", lastError);
      let ticketInfo;
      try {
        ticketInfo = await fetchTicket(creds);
      } catch (err) {
        if (err?.revoked) {
          await triggerRevoked("Disconnected from Anvil: enroll again to reconnect");
          return;
        }
        scheduleReconnect(String(err?.message ?? err));
        return;
      }
      if (!running) return;
      const url = channelWsUrl(creds.url, ticketInfo.path, ticketInfo.ticket);
      const sock = new WebSocketImpl(url);
      ws = sock;
      let opened = false;
      let handledClose = false;

      sock.onopen = () => {
        if (ws !== sock) return;
        opened = true;
        attempt = 0;
        connectedAt = new Date().toISOString();
        setStatus("connected", null);
        armHelloTimer();
        sendHello().catch(err => log("anvil: initial hello failed:", err?.message ?? err));
      };

      sock.onmessage = ev => {
        if (ws !== sock) return;
        handleMessage(typeof ev.data === "string" ? ev.data : null);
      };

      sock.onerror = () => {
        if (ws !== sock) return;
        if (!opened && !handledClose) {
          handledClose = true;
          ws = null;
          scheduleReconnect("Could not connect to Anvil channel.");
        }
      };

      sock.onclose = ev => {
        if (handledClose) return;
        handledClose = true;
        if (ws === sock) ws = null;
        clearTimers();
        const code = Number(ev?.code) || 1006;
        const reason = String(ev?.reason || `closed (${code})`).trim();
        rejectAll(reason);
        if (code === 4401) {
          void triggerRevoked("Disconnected from Anvil: enroll again to reconnect");
          return;
        }
        if (code === 4409) {
          running = false;
          setStatus("replaced", "Another Ensō instance took over this runner connection.");
          try { onReplaced(reason); } catch {}
          return;
        }
        if (!running) {
          setStatus("disconnected", null);
          return;
        }
        scheduleReconnect(reason);
      };
    } finally {
      connecting = false;
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      void connectOnce();
    },
    stop(reason = "runner stopping") {
      running = false;
      clearTimers();
      const sock = ws;
      ws = null;
      if (sock) {
        try { sock.close(1000, reason); } catch {}
      }
      rejectAll(reason);
      setStatus("disconnected", null);
    },
    call,
    sendHelloNow: () => sendHello(),
    isConnected: () => !!ws && ws.readyState === 1,
    state,
  };
}
