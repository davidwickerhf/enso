// End-to-end check of the Connect flow against the local mock server:
// discovery, registration, PKCE, code exchange, Keychain storage, probe,
// refresh (early and on 401), expiry, decline, reconnect, disconnect + revoke.
// Uses a throwaway data dir and Keychain prefix "enso-mcp-test-", deleted at the end.
//
//   node test/connections.test.mjs

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createConnections } from "../lib/connections.mjs";
import { readSecret } from "../lib/keychain.mjs";
import { startMockServer } from "./mock-oauth-mcp.mjs";

const dataDir = mkdtempSync(path.join(tmpdir(), "enso-conn-"));
const PREFIX = "enso-mcp-test-";
const mock = await startMockServer();
const shortMock = await startMockServer({ tokenLifetime: 60 }); // inside the early-refresh window
const events = [];
const closed = [];

/** Plays the browser: follow the authorization URL, then load the callback it redirects to. */
async function browse(url) {
  const r = await fetch(url, { redirect: "manual" });
  const back = r.headers.get("location");
  assert.ok(back, `authorize did not redirect (${r.status})`);
  const page = await fetch(back);
  browse.last = { status: page.status, html: await page.text(), callback: back };
  return 7; // a fake tab id
}

const make = () =>
  createConnections({
    dataDir,
    keychainPrefix: PREFIX,
    builtIn: { notes: { url: mock.url, label: "Mock Notes", scope: "notes:read notes:write" }, short: { url: shortMock.url, label: "Short" } },
    openUrl: url => browse(url),
    closeTab: id => closed.push(id),
    callbackBase: () => null, // forces the ephemeral callback server
    onChange: e => e && events.push(e),
  });

let c = make();
const state = name => c.list().find(x => x.server === name);
const step = (msg, fn) => fn().then(() => console.log(`ok - ${msg}`));

try {
  await step("starts disconnected", async () => {
    assert.equal(state("notes").state, "disconnected");
    assert.equal(await c.headersFor("notes"), null);
  });

  await step("connects: discovery, DCR, PKCE, exchange", async () => {
    const { authUrl } = await c.start("notes");
    const u = new URL(authUrl);
    assert.equal(u.searchParams.get("code_challenge_method"), "S256");
    assert.match(u.searchParams.get("redirect_uri"), /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    assert.equal(browse.last.status, 200);
    assert.match(browse.last.html, /Connected/);
    assert.equal(state("notes").state, "connected");
    assert.deepEqual(mock.stats, { ...mock.stats, registered: 1, authorized: 1, exchanged: 1 });
    assert.equal(mock.stats.lastScope, "notes:read notes:write");
    assert.equal(mock.stats.lastResource, mock.url);
    assert.ok(events.some(e => e.server === "notes" && e.ok));
  });

  await step("token is in the Keychain, not on disk", async () => {
    const raw = await readSecret(`${PREFIX}notes`);
    assert.ok(raw && JSON.parse(raw).tokens.access_token.startsWith("at_"));
    const { readFileSync } = await import("node:fs");
    assert.doesNotMatch(readFileSync(path.join(dataDir, "connections.json"), "utf8"), /at_|rt_|client_secret/);
  });

  await step("callback state is single-use", async () => {
    const again = await fetch(browse.last.callback);
    assert.equal(again.status, 400);
    const forged = new URL(browse.last.callback);
    forged.searchParams.set("state", "nope");
    assert.equal((await fetch(forged)).status, 400);
  });

  await step("session servers carry a Bearer header; probe lists the tool", async () => {
    const servers = await c.sessionServers();
    assert.equal(servers.notes.type, "http");
    assert.match(servers.notes.headers.Authorization, /^Bearer at_/);
    const p = await c.probe("notes");
    assert.deepEqual(p.toolNames, ["echo"]);
  });

  await step("refresh on 401", async () => {
    const before = (await c.sessionServers()).notes.headers.Authorization;
    mock.expireAll();
    const p = await c.probe("notes");
    assert.equal(p.ok, true);
    assert.equal(mock.stats.refreshed, 1);
    assert.notEqual((await c.sessionServers()).notes.headers.Authorization, before);
  });

  await step("survives a helper restart (reads the Keychain)", async () => {
    c.close();
    c = make();
    assert.equal(state("notes").state, "connected");
    assert.ok((await c.probe("notes")).ok);
  });

  await step("refreshes early when the token is about to expire", async () => {
    await c.start("short");
    const first = (await c.sessionServers()).short; // 60 s lifetime < 5 min window: refreshes
    assert.ok(first);
    assert.ok(shortMock.stats.refreshed >= 1);
  });

  await step("revoked refresh token → expired; reconnect reuses the registration", async () => {
    mock.revokeAll();
    const p = await c.probe("notes");
    assert.equal(p.ok, false);
    assert.equal(state("notes").state, "expired");
    assert.equal((await c.sessionServers()).notes, undefined);
    await c.start("notes");
    assert.equal(state("notes").state, "connected");
    assert.equal(mock.stats.registered, 1);
  });

  await step("declining shows an error", async () => {
    const declining = await startMockServer({ deny: true });
    c.addCustom({ name: "declines", url: declining.url, label: "Declines" });
    await c.start("declines");
    assert.match(browse.last.html, /declined/);
    assert.equal(state("declines").state, "error");
    await c.removeCustom("declines");
    assert.equal(state("declines"), undefined);
    await declining.close();
  });

  await step("custom server validation", async () => {
    assert.throws(() => c.addCustom({ name: "bad name!", url: mock.url }), /short name/);
    assert.throws(() => c.addCustom({ name: "plain", url: "http://example.com/mcp" }), /https/);
    assert.throws(() => c.addCustom({ name: "notes", url: mock.url }), /already/);
  });

  await step("disconnect revokes and deletes the Keychain item", async () => {
    await c.disconnect("notes");
    assert.ok(mock.stats.revoked >= 2);
    assert.equal(await readSecret(`${PREFIX}notes`), null);
    assert.equal(state("notes").state, "disconnected");
  });

  await step("the sign-in tab is closed afterwards", async () => {
    await new Promise(r => setTimeout(r, 1700));
    assert.ok(closed.includes(7));
  });
} finally {
  for (const n of ["notes", "short", "declines"]) await c.disconnect(n).catch(() => {});
  c.close();
  await mock.close();
  await shortMock.close();
  rmSync(dataDir, { recursive: true, force: true });
}
console.log("all connection checks passed");
