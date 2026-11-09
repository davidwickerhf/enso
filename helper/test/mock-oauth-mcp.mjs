// A tiny OAuth 2.1 authorization server + protected MCP server, for testing
// Ensō's Connect flow without a real account. Everything is in memory.
//
//   GET  /.well-known/oauth-protected-resource[/mcp]  RFC 9728
//   GET  /.well-known/oauth-authorization-server      RFC 8414
//   POST /register    dynamic client registration (RFC 7591)
//   GET  /authorize   auto-approves (or ?deny) and redirects with code + state
//   POST /token       authorization_code (PKCE S256 checked) and refresh_token
//   POST /revoke      RFC 7009
//   POST /mcp         MCP (one tool: echo), needs a valid Bearer token
//
// Usage: startMockServer({ tokenLifetime: 3600, deny: false }) → { url, port, stats, close }
// Or run directly: node test/mock-oauth-mcp.mjs [port]

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export async function startMockServer({ port = 0, tokenLifetime = 3600, deny = false } = {}) {
  const clients = new Map();
  const codes = new Map();
  const access = new Map(); // token -> { clientId, exp }
  const refresh = new Map(); // token -> clientId
  const stats = { registered: 0, authorized: 0, exchanged: 0, refreshed: 0, revoked: 0, mcpCalls: 0, unauthorized: 0, lastScope: null, lastResource: null };
  let origin = "";

  const json = (res, status, body, headers = {}) => res.writeHead(status, { "Content-Type": "application/json", ...headers }).end(JSON.stringify(body));
  const readBody = async req => {
    let b = "";
    for await (const c of req) b += c;
    return b;
  };
  const issue = clientId => {
    const at = `at_${randomBytes(16).toString("hex")}`;
    const rt = `rt_${randomBytes(16).toString("hex")}`;
    access.set(at, { clientId, exp: Date.now() + tokenLifetime * 1000 });
    refresh.set(rt, clientId);
    return { access_token: at, token_type: "Bearer", expires_in: tokenLifetime, refresh_token: rt, scope: "notes:read" };
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const p = url.pathname;
    if (p.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ["notes:read", "notes:write"], bearer_methods_supported: ["header"] });
    if (p === "/.well-known/oauth-authorization-server")
      return json(res, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["notes:read", "notes:write"],
      });
    if (p === "/register" && req.method === "POST") {
      const meta = JSON.parse(await readBody(req));
      if (!Array.isArray(meta.redirect_uris) || !meta.redirect_uris.length) return json(res, 400, { error: "invalid_redirect_uri" });
      const client_id = `client_${randomBytes(6).toString("hex")}`;
      clients.set(client_id, meta);
      stats.registered++;
      return json(res, 201, { ...meta, client_id, client_id_issued_at: Math.floor(Date.now() / 1000) });
    }
    if (p === "/authorize") {
      const q = url.searchParams;
      const client = clients.get(q.get("client_id"));
      if (!client || !client.redirect_uris.includes(q.get("redirect_uri"))) return res.writeHead(400).end("bad client or redirect_uri");
      if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return res.writeHead(400).end("PKCE required");
      stats.lastScope = q.get("scope");
      stats.lastResource = q.get("resource");
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("state", q.get("state") ?? "");
      if (deny || q.has("deny")) back.searchParams.set("error", "access_denied");
      else {
        const code = `code_${randomBytes(12).toString("hex")}`;
        codes.set(code, { clientId: q.get("client_id"), challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri") });
        back.searchParams.set("code", code);
        stats.authorized++;
      }
      return res.writeHead(302, { Location: back.href }).end();
    }
    if (p === "/token" && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req));
      if (f.get("grant_type") === "authorization_code") {
        const c = codes.get(f.get("code"));
        codes.delete(f.get("code"));
        if (!c || c.clientId !== f.get("client_id") || c.redirectUri !== f.get("redirect_uri")) return json(res, 400, { error: "invalid_grant" });
        const challenge = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url");
        if (challenge !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "PKCE check failed" });
        stats.exchanged++;
        return json(res, 200, issue(c.clientId));
      }
      if (f.get("grant_type") === "refresh_token") {
        const clientId = refresh.get(f.get("refresh_token"));
        if (!clientId || clientId !== f.get("client_id")) return json(res, 400, { error: "invalid_grant" });
        refresh.delete(f.get("refresh_token"));
        stats.refreshed++;
        return json(res, 200, issue(clientId));
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (p === "/revoke" && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req));
      access.delete(f.get("token"));
      refresh.delete(f.get("token"));
      stats.revoked++;
      return res.writeHead(200).end();
    }
    if (p === "/mcp") {
      const token = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const a = access.get(token);
      if (!a || a.exp < Date.now()) {
        stats.unauthorized++;
        return json(res, 401, { error: "invalid_token" }, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
      }
      if (req.method !== "POST") return res.writeHead(405).end();
      stats.mcpCalls++;
      const body = await readBody(req);
      const mcp = new McpServer({ name: "mock-notes", version: "1.0.0" });
      mcp.registerTool("echo", { description: "Echo text back", inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => (transport.close(), mcp.close()));
      await mcp.connect(transport);
      return transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    }
    res.writeHead(404).end();
  });
  await new Promise(r => server.listen(port, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: `${origin}/mcp`,
    stats,
    expireAll: () => access.forEach(v => (v.exp = 0)),
    revokeAll: () => (access.clear(), refresh.clear()),
    close: () => new Promise(r => (server.closeAllConnections?.(), server.close(r))),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startMockServer({ port: Number(process.argv[2] ?? 0) });
  process.stderr.write(`mock OAuth + MCP server: ${m.url}\n`);
}
