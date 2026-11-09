// Sign-in to remote MCP servers from Ensō, without Claude Code's /mcp.
//
// OAuth 2.1 as MCP servers expect it (via @modelcontextprotocol/sdk's client
// auth): protected-resource and authorization-server discovery, dynamic client
// registration, PKCE, code exchange and refresh. The authorization page opens
// in a new Zen tab; the server redirects back to the helper's loopback
// callback (http://127.0.0.1:47823/oauth/callback, or an ephemeral port when
// another helper holds 47823), which checks `state`, exchanges the code and
// closes the tab.
//
// Secrets (client registration, access and refresh tokens) live in the macOS
// Keychain, one record per server (service "enso-mcp-<name>"). Nothing secret
// is logged or written to disk. Public bits (discovery metadata, expiry,
// custom servers) go to <data>/connections.json.

import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { auth, discoverOAuthServerInfo, refreshAuthorization } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import * as keychain from "./keychain.mjs";

const FLOW_TTL = 10 * 60_000;
const REFRESH_EARLY = 5 * 60_000;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$/;

class NeedsSignIn extends Error {}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function callbackPage(ok, text) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${ok ? "Connected" : "Not connected"} · Ensō</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:Canvas;color:CanvasText}
main{max-width:420px;padding:32px;text-align:center}h1{font-size:20px;font-weight:600;margin:0 0 8px}p{margin:0;opacity:.7}.mark{font-size:28px;margin-bottom:12px;color:${ok ? "#3d8b5a" : "#c0473a"}}</style></head>
<body><main><div class="mark">${ok ? "&#10003;" : "&#10005;"}</div><h1>${ok ? "Connected" : "Not connected"}</h1><p>${esc(text)}</p></main></body></html>`;
}

function validUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loopback)) throw new Error("Use an https:// URL (http only for localhost).");
  return u.href;
}

/**
 * builtIn: { name: { url, scope?, label? } } from config.json oauthServers.
 * openUrl(url) → tabId | undefined; closeTab(tabId); callbackBase() → "http://127.0.0.1:47823" | null
 * onChange({ server, ok, error }?) after any state change.
 */
export function createConnections({ dataDir, builtIn = {}, keychainPrefix = "enso-mcp-", openUrl, closeTab, callbackBase, onChange = () => {}, log = () => {}, fetchFn }) {
  const FILE = path.join(dataDir, "connections.json");
  let file;
  try {
    file = JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    file = {};
  }
  file.custom ??= {};
  file.servers ??= {};
  const save = () => {
    writeFileSync(`${FILE}.tmp`, JSON.stringify(file, null, 2));
    renameSync(`${FILE}.tmp`, FILE);
  };

  const flows = new Map(); // state -> flow
  const records = new Map(); // name -> keychain record (cache)
  const refreshing = new Map(); // name -> promise
  const transient = new Map(); // name -> { connecting?: flow, error?: string }
  let ephemeral = null; // { server, base }

  const defs = () => {
    const out = {};
    for (const [name, d] of Object.entries(builtIn)) out[name] = { ...d, custom: false };
    for (const [name, d] of Object.entries(file.custom)) if (!out[name]) out[name] = { ...d, custom: true };
    return out;
  };
  const def = name => {
    const d = defs()[name];
    if (!d) throw new Error(`Unknown server ${name}.`);
    return d;
  };
  const service = name => `${keychainPrefix}${name.toLowerCase().replace(/[^a-z0-9._-]/g, "_")}`;
  const meta = name => (file.servers[name] ??= {});

  async function load(name) {
    if (records.has(name)) return records.get(name);
    let rec = null;
    try {
      const raw = await keychain.readSecret(service(name));
      rec = raw ? JSON.parse(raw) : null;
    } catch (err) {
      log(`${name}: could not read its Keychain item (${err.message})`);
    }
    records.set(name, rec);
    return rec;
  }
  async function store(name, rec) {
    await keychain.writeSecret(service(name), JSON.stringify(rec));
    records.set(name, rec);
  }

  const expiresAt = rec => (rec?.tokens?.expires_in && rec.obtainedAt ? rec.obtainedAt + rec.tokens.expires_in * 1000 : null);

  async function base() {
    const main = callbackBase?.();
    if (main) return main;
    if (ephemeral) return ephemeral.base;
    // Another helper holds the main port: serve the callback on a port of our own.
    // Reuse the last port when it is free, so client registrations stay valid.
    const listen = port =>
      new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => route(req, res));
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server));
      });
    const server = await (file.callbackPort ? listen(file.callbackPort).catch(() => listen(0)) : listen(0));
    server.unref();
    if (file.callbackPort !== server.address().port) {
      file.callbackPort = server.address().port;
      save();
    }
    ephemeral = { server, base: `http://127.0.0.1:${server.address().port}` };
    return ephemeral.base;
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback") return void res.writeHead(404).end();
    const { status, html } = await handleCallback(url);
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }).end(html);
  }

  /** The SDK's view of one server's credentials; `rec` is mutated in place. */
  function provider({ rec, flow, redirectUrl, scope }) {
    return {
      get redirectUrl() {
        return redirectUrl;
      },
      get clientMetadata() {
        return {
          client_name: "Ensō (Zen browser)",
          redirect_uris: [redirectUrl],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(scope ? { scope } : {}),
        };
      },
      state: () => flow.state,
      // A registration made for another callback URL can't be reused: register again.
      clientInformation: () => (rec.client?.redirect_uris && !rec.client.redirect_uris.includes(redirectUrl) ? undefined : rec.client),
      saveClientInformation: info => void (rec.client = info),
      tokens: () => rec.tokens,
      saveTokens: tokens => {
        rec.tokens = tokens;
        rec.obtainedAt = Date.now();
      },
      redirectToAuthorization: url => {
        if (!flow.interactive) throw new NeedsSignIn("Sign-in needed.");
        flow.authUrl = url.href;
      },
      saveCodeVerifier: v => void (flow.verifier = v),
      codeVerifier: () => flow.verifier,
      invalidateCredentials: what => {
        if (what === "all" || what === "client") delete rec.client;
        if (what === "all" || what === "tokens") delete rec.tokens;
        if (what === "all" || what === "discovery") delete flow.discovery;
      },
      saveDiscoveryState: s => void (flow.discovery = s),
      discoveryState: () => flow.discovery,
    };
  }

  function sweep() {
    const now = Date.now();
    for (const [state, f] of flows) {
      if (now - f.createdAt > FLOW_TTL) {
        flows.delete(state);
        if (transient.get(f.name)?.connecting === f) transient.delete(f.name);
      }
    }
  }

  // ---------- public ----------

  function list() {
    sweep();
    return Object.entries(defs()).map(([name, d]) => {
      const m = file.servers[name] ?? {};
      const t = transient.get(name) ?? {};
      const state = t.connecting ? "connecting" : t.error ? "error" : m.expired ? "expired" : m.connected ? "connected" : "disconnected";
      return {
        server: name,
        label: d.label ?? name,
        url: d.url,
        custom: d.custom,
        state,
        ...(t.error ? { error: t.error } : {}),
        ...(t.connecting ? { authUrl: t.connecting.authUrl } : {}),
        ...(m.expiresAt ? { expiresAt: new Date(m.expiresAt).toISOString() } : {}),
        ...(m.connectedAt ? { connectedAt: m.connectedAt } : {}),
      };
    });
  }

  const has = name => !!defs()[name];

  /** Begin sign-in: register if needed, build the authorization URL, open it in a tab. */
  async function start(name) {
    const d = def(name);
    sweep();
    const redirectUrl = `${await base()}/oauth/callback`;
    const old = (await load(name)) ?? {};
    const rec = { client: old.client }; // no tokens: always ask for a fresh authorization
    const flow = { name, state: randomBytes(24).toString("base64url"), createdAt: Date.now(), interactive: true, redirectUrl, rec, discovery: meta(name).discovery };
    transient.set(name, { connecting: flow });
    onChange();
    try {
      await auth(provider({ rec, flow, redirectUrl, scope: d.scope }), { serverUrl: d.url, scope: d.scope, fetchFn });
      if (!flow.authUrl) throw new Error("The server did not ask for a sign-in.");
      meta(name).discovery = flow.discovery;
      save();
      // Keep the registration even if the sign-in is abandoned, so the next try reuses it.
      if (rec.client && rec.client !== old.client) await store(name, { ...old, client: rec.client });
      flows.set(flow.state, flow);
      onChange();
      flow.tab = Promise.resolve()
        .then(() => openUrl?.(flow.authUrl))
        .catch(err => log(`${name}: could not open the sign-in tab (${err.message})`));
      await flow.tab;
      return { authUrl: flow.authUrl };
    } catch (err) {
      transient.set(name, { error: friendly(err) });
      onChange({ server: name, ok: false, error: friendly(err) });
      throw err;
    }
  }

  async function handleCallback(url) {
    sweep();
    const flow = flows.get(url.searchParams.get("state") ?? "");
    if (!flow) return { status: 400, html: callbackPage(false, "This sign-in link has expired or was already used. Start again from Ensō's Tools page.") };
    flows.delete(flow.state);
    const { name } = flow;
    const later = () => flow.tab?.then(id => id != null && setTimeout(() => closeTab?.(id), 1500));
    const err = url.searchParams.get("error");
    if (err) {
      const text = url.searchParams.get("error_description") || (err === "access_denied" ? "You declined the sign-in." : `The server said: ${err}.`);
      transient.set(name, { error: text });
      onChange({ server: name, ok: false, error: text });
      return { status: 200, html: callbackPage(false, `${text} You can close this tab.`) };
    }
    try {
      const d = def(name);
      flow.interactive = false;
      await auth(provider({ rec: flow.rec, flow, redirectUrl: flow.redirectUrl, scope: d.scope }), { serverUrl: d.url, authorizationCode: url.searchParams.get("code") ?? "", scope: d.scope, fetchFn });
      if (!flow.rec.tokens?.access_token) throw new Error("No access token came back.");
      await store(name, flow.rec);
      Object.assign(meta(name), { connected: true, expired: false, connectedAt: new Date().toISOString(), expiresAt: expiresAt(flow.rec), discovery: flow.discovery });
      save();
      transient.delete(name);
      onChange({ server: name, ok: true });
      later();
      return { status: 200, html: callbackPage(true, `${d.label ?? name} is connected to Ensō. You can close this tab.`) };
    } catch (e) {
      const text = friendly(e);
      log(`${name}: sign-in failed (${text})`);
      transient.set(name, { error: text });
      onChange({ server: name, ok: false, error: text });
      return { status: 200, html: callbackPage(false, `${text} Try again from Ensō's Tools page.`) };
    }
  }

  async function discovery(name) {
    const m = meta(name);
    if (!m.discovery?.authorizationServerUrl) {
      m.discovery = await discoverOAuthServerInfo(def(name).url, { fetchFn });
      save();
    }
    return m.discovery;
  }

  /** Swap the refresh token for a new access token. Returns true when it worked. */
  function refresh(name) {
    if (refreshing.has(name)) return refreshing.get(name);
    const p = (async () => {
      const rec = await load(name);
      if (!rec?.tokens?.refresh_token || !rec.client) return markExpired(name);
      try {
        const d = await discovery(name);
        const resource = d.resourceMetadata?.resource;
        const tokens = await refreshAuthorization(d.authorizationServerUrl, { metadata: d.authorizationServerMetadata, clientInformation: rec.client, refreshToken: rec.tokens.refresh_token, resource, fetchFn });
        const next = { ...rec, tokens: { ...tokens, issuer: rec.tokens.issuer }, obtainedAt: Date.now() };
        await store(name, next);
        Object.assign(meta(name), { connected: true, expired: false, expiresAt: expiresAt(next) });
        save();
        onChange();
        return true;
      } catch (err) {
        if (err instanceof OAuthError && !(err instanceof ServerError)) return markExpired(name);
        log(`${name}: refresh failed for now (${friendly(err)})`);
        return false;
      }
    })().finally(() => refreshing.delete(name));
    refreshing.set(name, p);
    return p;
  }

  function markExpired(name) {
    if (file.servers[name]?.connected) {
      Object.assign(meta(name), { expired: true });
      save();
      onChange();
    }
    return false;
  }

  /** Authorization header for a connected server (refreshed when close to expiry), or null. */
  async function headersFor(name, { force = false } = {}) {
    const m = file.servers[name];
    if (!m?.connected || m.expired) return null;
    let rec = await load(name);
    if (!rec?.tokens?.access_token) return null;
    const exp = expiresAt(rec);
    if (force || (exp && exp - Date.now() < REFRESH_EARLY)) {
      await refresh(name);
      rec = await load(name);
      if (file.servers[name]?.expired || (exp && !force && expiresAt(rec) <= Date.now())) return null;
    }
    return { Authorization: `Bearer ${rec.tokens.access_token}` };
  }

  /** { name: { type: "http", url, headers } } for every connected server, with fresh tokens. */
  async function sessionServers() {
    const out = {};
    await Promise.all(
      Object.entries(defs()).map(async ([name, d]) => {
        const headers = await headersFor(name).catch(() => null);
        if (headers) out[name] = { type: "http", url: d.url, headers };
      }),
    );
    return out;
  }

  /** A session reported the server as failed: try a refresh so the next turn gets a working token. */
  async function recover(name) {
    if (!file.servers[name]?.connected || file.servers[name]?.expired) return false;
    return refresh(name);
  }

  /** List the server's tools with the stored token (refreshing once on 401). */
  async function probe(name) {
    const d = def(name);
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = await headersFor(name, { force: attempt > 0 });
      if (!headers) return { ok: false, status: "needs-auth" };
      const client = new Client({ name: "enso", version: "1.0.0" });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(d.url), { requestInit: { headers }, ...(fetchFn ? { fetch: fetchFn } : {}) }));
        const { tools } = await client.listTools();
        return { ok: true, status: "connected", toolNames: tools.map(t => t.name) };
      } catch (err) {
        if (!/401|unauthori[sz]ed|invalid_token/i.test(String(err.message)) || attempt) return { ok: false, status: /401|unauthori/i.test(String(err.message)) ? "needs-auth" : "failed", error: friendly(err) };
      } finally {
        client.close().catch(() => {});
      }
    }
    return { ok: false, status: "failed" };
  }

  /** Revoke at the server when it supports it, then forget everything local. */
  async function disconnect(name) {
    def(name);
    const rec = await load(name);
    if (rec?.tokens && rec.client) {
      try {
        const d = await discovery(name);
        const endpoint = d.authorizationServerMetadata?.revocation_endpoint;
        if (endpoint) {
          for (const [token, hint] of [[rec.tokens.refresh_token, "refresh_token"], [rec.tokens.access_token, "access_token"]]) {
            if (!token) continue;
            const body = new URLSearchParams({ token, token_type_hint: hint, client_id: rec.client.client_id });
            const headers = { "Content-Type": "application/x-www-form-urlencoded" };
            if (rec.client.client_secret) headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(rec.client.client_id)}:${encodeURIComponent(rec.client.client_secret)}`).toString("base64")}`;
            await (fetchFn ?? fetch)(endpoint, { method: "POST", headers, body }).catch(() => {});
          }
        }
      } catch (err) {
        log(`${name}: revoke skipped (${friendly(err)})`);
      }
    }
    await keychain.deleteSecret(service(name));
    records.set(name, null);
    delete file.servers[name];
    save();
    transient.delete(name);
    onChange();
  }

  function addCustom({ name, url, label }) {
    name = String(name ?? "").trim();
    if (!NAME_RE.test(name)) throw new Error("Use a short name: letters, digits, - or _.");
    if (defs()[name] || name.startsWith("claude.ai")) throw new Error(`There is already a server called ${name}.`);
    file.custom[name] = { url: validUrl(url), label: String(label ?? "").trim() || name, addedAt: new Date().toISOString() };
    save();
    onChange();
    return name;
  }

  async function removeCustom(name) {
    if (!file.custom[name]) throw new Error(`${name} isn't a server you added.`);
    await disconnect(name);
    delete file.custom[name];
    save();
    onChange();
  }

  function close() {
    ephemeral?.server.close();
  }

  return { list, has, start, handleCallback, route, headersFor, sessionServers, recover, refresh, probe, disconnect, addCustom, removeCustom, defs, close };
}

function friendly(err) {
  const msg = String(err?.message ?? err ?? "Something went wrong.");
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(msg)) return "Couldn't reach the server.";
  return msg.replace(/Bearer\s+\S+/gi, "Bearer …").slice(0, 300);
}
