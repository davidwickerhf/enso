// Large payloads, page_upload's helper side and page_wait, without a browser:
//   - chunking: a 5 MB message (multi-byte text included) split by
//     lib/native.mjs into frames under native messaging's 1 MB limit, put back
//     together by extension/transfer.js, out of order and with repeats; too
//     large is a clear error, never a silent drop;
//   - the upload store (extension/transfer.js): order, size and SHA-256 checks;
//   - lib/upload.mjs: paths (~, absolute only, no folders, no URLs, never
//     credential folders, also through a symlink), limits,
//     streaming in chunks with the SHA-256 of the bytes on disk;
//   - extension/waits.js: every page_wait condition and its timeout, on a fake clock;
//   - lib/timeouts.mjs: defaults, clamping, and the "may still be running" message.
//
//   node test/transfer.test.mjs

import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { createReassembler, createUploadStore } = require("../../extension/transfer.js");
const { createWaiter, networkState } = require("../../extension/waits.js");
const { encodeFrames, MAX_FRAME, MAX_MESSAGE_BYTES, MessageTooLargeError } = await import("../lib/native.mjs");
const { describeFiles, expandPath, mimeType, maxUploadBytes, stageFiles, UPLOAD_CHUNK_BYTES } = await import("../lib/upload.mjs");
const { BrowserTimeoutError, clampTimeout, requestBudget, MAX_TIMEOUT_MS } = await import("../lib/timeouts.mjs");

const dir = mkdtempSync(path.join(tmpdir(), "enso-transfer-"));
try {
  // ---------- chunking ----------
  {
    const text = "Grüße, 東京 ✦ ".repeat(50_000) + randomBytes(3_300_000).toString("base64"); // ~5 MB of UTF-8, with multi-byte characters
    const msg = { type: "page.request", reqId: "r1", action: "type", args: { ref: 3, text }, tabId: 7 };
    const json = Buffer.byteLength(JSON.stringify(msg));
    assert.ok(json > 5_000_000, `payload is ${json} bytes`);
    const frames = encodeFrames(msg);
    assert.ok(frames.length > 5, `${frames.length} frames`);
    for (const f of frames) assert.ok(f.length < MAX_FRAME - 50_000, `frame of ${f.length} bytes is under 1 MB`);
    const parsed = frames.map(f => JSON.parse(f.toString("utf8")));
    assert.ok(parsed.every(p => p.type === "chunk" && p.total === frames.length));
    const r = createReassembler();
    // Out of order, with a repeat: still one message, exactly as sent.
    const order = [...parsed.keys()].reverse();
    let out = null;
    for (const i of [order[0], ...order]) {
      const got = r.accept(parsed[i]);
      if (got) out = got;
    }
    assert.deepEqual(out, msg);
    assert.equal(r.pending(), 0);
    console.log(`ok - a ${(json / 1048576).toFixed(1)} MB message goes in ${frames.length} frames under 1 MB and comes back identical`);

    // Small messages stay one plain frame.
    const small = encodeFrames({ type: "hello" });
    assert.equal(small.length, 1);
    assert.equal(JSON.parse(small[0]).type, "hello");

    // Too large: a clear error, nothing sent.
    const huge = { type: "page.request", reqId: "r2", action: "eval", args: { expression: "x".repeat(MAX_MESSAGE_BYTES + 10) } };
    assert.throws(() => encodeFrames(huge), err => err instanceof MessageTooLargeError && /too large to send to the browser .* the limit is 64 MB\). Nothing was sent\./.test(err.message));

    // Malformed or stale parts are refused or dropped.
    assert.throws(() => r.accept({ type: "chunk", id: "x", seq: 3, total: 2, data: "" }), /Malformed/);
    let t = 0;
    const stale = createReassembler({ now: () => t });
    assert.equal(stale.accept({ type: "chunk", id: "a", seq: 0, total: 2, data: "e30=" }), null);
    t += 61_000;
    assert.equal(stale.accept({ type: "chunk", id: "b", seq: 0, total: 2, data: "e30=" }), null);
    assert.equal(stale.pending(), 1, "the abandoned message was dropped");
    console.log("ok - too large is a clear error; malformed and abandoned chunks are dropped");
  }

  // ---------- upload store ----------
  {
    const s = createUploadStore();
    const bytes = randomBytes(1_300_000);
    const sha = createHash("sha256").update(bytes).digest("hex");
    s.begin({ uploadId: "u1", files: [{ name: "report.docx", type: "application/x", lastModified: 1, size: bytes.length }] });
    assert.throws(() => s.chunk({ uploadId: "u1", index: 0, offset: 10, data: "" }), /out of order/);
    for (let at = 0; at < bytes.length; at += UPLOAD_CHUNK_BYTES) s.chunk({ uploadId: "u1", index: 0, offset: at, data: bytes.subarray(at, at + UPLOAD_CHUNK_BYTES).toString("base64") });
    const [f] = await s.take("u1", [sha]);
    assert.equal(f.name, "report.docx");
    assert.deepEqual(Buffer.concat(f.parts.map(p => Buffer.from(p))), bytes);
    await assert.rejects(s.take("u1"), /unknown or expired/);

    s.begin({ uploadId: "u2", files: [{ name: "a.txt", size: 3 }] });
    s.chunk({ uploadId: "u2", index: 0, offset: 0, data: Buffer.from("abc").toString("base64") });
    await assert.rejects(s.take("u2", ["0".repeat(64)]), /different contents than on disk \(SHA-256 mismatch\); nothing was attached/);
    s.begin({ uploadId: "u3", files: [{ name: "b.txt", size: 5 }] });
    s.chunk({ uploadId: "u3", index: 0, offset: 0, data: Buffer.from("abc").toString("base64") });
    await assert.rejects(s.take("u3"), /arrived incomplete \(3 of 5 bytes\)/);
    assert.throws(() => s.chunk({ uploadId: "nope", index: 0, offset: 0, data: "" }), /unknown or expired/);
    console.log("ok - the upload store checks order, size and SHA-256 before anything is attached");
  }

  // ---------- lib/upload.mjs ----------
  {
    const home = path.join(dir, "home");
    mkdirSync(path.join(home, "Documents", "folder"), { recursive: true });
    const doc = randomBytes(2 * 1024 * 1024 + 123);
    writeFileSync(path.join(home, "Documents", "Report Q3.docx"), doc);
    writeFileSync(path.join(home, "Documents", "empty.txt"), "");
    assert.equal(expandPath("~/Documents/x.pdf", home), path.join(home, "Documents", "x.pdf"));
    assert.throws(() => expandPath("Documents/x.pdf", home), /not an absolute path/);
    assert.throws(() => expandPath("https://example.com/a.pdf", home), /is a URL\. page_upload only takes files from this computer's disk/);
    await assert.rejects(describeFiles(["~/Documents/folder"], { home }), /is a folder/);
    await assert.rejects(describeFiles(["~/Documents/missing.pdf"], { home }), /No such file/);
    await assert.rejects(describeFiles([], { home }), /at least one file/);
    mkdirSync(path.join(home, ".ssh"));
    writeFileSync(path.join(home, ".ssh", "id_ed25519"), "secret");
    writeFileSync(path.join(home, ".netrc"), "secret");
    let linked = true;
    try {
      symlinkSync(path.join(home, ".ssh", "id_ed25519"), path.join(home, "Documents", "innocent.txt"));
    } catch {
      linked = false; // Windows without the symlink privilege
    }
    for (const p of ["~/.ssh/id_ed25519", "~/.netrc", ...(linked ? ["~/Documents/innocent.txt"] : [])]) await assert.rejects(describeFiles([p], { home }), /holds credentials or browser and Ensō data .* page_upload never sends those/, p);
    await assert.rejects(describeFiles(["~/Documents/Report Q3.docx"], { home, maxBytes: 1024 * 1024 }), /2\.0 MB together; page_upload takes up to 1\.0 MB per call\. Nothing was sent\. .*Never shrink, compress or edit the user's files/);
    assert.equal(maxUploadBytes({}), 100 * 1024 * 1024);
    assert.equal(maxUploadBytes({ ENSO_MAX_UPLOAD_MB: "20" }), 20 * 1024 * 1024);
    assert.equal(mimeType("a.PDF"), "application/pdf");
    assert.equal(mimeType("a.unknownext"), "");
    const files = await describeFiles(["~/Documents/Report Q3.docx", path.join(home, "Documents", "empty.txt")], { home });
    assert.deepEqual(files.map(f => [f.name, f.size, f.type]), [["Report Q3.docx", doc.length, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"], ["empty.txt", 0, "text/plain"]]);

    // Streamed into a real store, the way background.js does it.
    const store = createUploadStore();
    const calls = [];
    const browser = async (action, args) => {
      calls.push(action);
      const frame = encodeFrames({ type: "browser.request", reqId: "r", action, args });
      assert.equal(frame.length, 1, `${action} fits in one native message`);
      if (action === "upload_begin") return store.begin(args);
      if (action === "upload_chunk") return store.chunk(args);
      if (action === "upload_discard") return store.discard(args.uploadId);
    };
    const { uploadId, sha256s } = await stageFiles(browser, files);
    assert.equal(calls.filter(c => c === "upload_chunk").length, Math.ceil(doc.length / UPLOAD_CHUNK_BYTES));
    assert.equal(sha256s[0], createHash("sha256").update(doc).digest("hex"));
    const staged = await store.take(uploadId, sha256s);
    assert.deepEqual(Buffer.concat(staged[0].parts.map(p => Buffer.from(p))), doc, "byte for byte what is on disk");
    assert.equal(staged[1].size, 0);
    assert.deepEqual(readFileSync(path.join(home, "Documents", "Report Q3.docx")), doc, "the file on disk is untouched");

    // A failure part-way discards what was staged.
    const discarded = [];
    let n = 0;
    await assert.rejects(stageFiles(async (action, args) => {
      if (action === "upload_discard") discarded.push(args.uploadId);
      if (action === "upload_chunk" && ++n === 2) throw new Error("browser went away");
    }, files), /browser went away/);
    assert.equal(discarded.length, 1);
    console.log("ok - paths are checked (~, absolute, no folders or URLs, size limit with a clear message) and files stream unchanged in 512 KiB chunks");
  }

  // ---------- extension/waits.js ----------
  {
    let t = 0;
    const tab = { url: "https://app.example.com/upload", title: "Upload", status: "complete" };
    let page = { selector: false, text: "" };
    let reqs = [];
    const waiter = createWaiter({
      getTab: async () => ({ ...tab }),
      isSensitive: url => url.includes("bank"),
      probe: async (_id, a) => (a.for === "text" ? { met: page.text.includes(a.value), detail: "text" } : a.for === "selector" ? { met: page.selector, detail: "sel" } : { met: !page.selector, detail: "gone" }),
      requests: () => reqs,
      now: () => t,
      sleep: async ms => {
        t += ms;
        if (t >= 1000) page.selector = true;
        if (t >= 1400) page.text = "Upload complete";
        if (t >= 2000) tab.url = "https://app.example.com/done";
      },
    });
    let r = await waiter(1, { for: "selector", value: ".done" });
    assert.equal(r.met, true);
    assert.equal(r.ms, 1000);
    r = await waiter(1, { for: "text", value: "complete" });
    assert.equal(r.met, true);
    r = await waiter(1, { for: "url", value: "/\\/done$/" });
    assert.equal(r.met, true);
    assert.equal(r.url, "https://app.example.com/done");
    r = await waiter(1, { for: "gone", value: ".done", timeoutMs: 3000 });
    assert.equal(r.met, false);
    assert.equal(r.timedOut, true);
    assert.ok(r.ms >= 3000 && r.ms < 3300, `stopped at the timeout (${r.ms} ms)`);
    r = await waiter(1, { for: "load" });
    assert.equal(r.met, true);
    await assert.rejects(waiter(1, { for: "selector" }), /needs a value/);
    await assert.rejects(waiter(1, { for: "nope" }), /Unknown wait condition/);
    // timeoutMs is clamped to 120 s.
    const t0 = t;
    r = await waiter(1, { for: "text", value: "never", timeoutMs: 999_999 });
    assert.equal(t - t0 >= 120_000 && t - t0 < 120_400, true);

    // network_idle: an open request keeps it busy; done once quiet for idleMs.
    const start = t;
    reqs = [{ start: start + 10, status: null, type: "xmlhttprequest" }, { start: start, status: null, type: "websocket" }];
    const busy = createWaiter({ getTab: async () => tab, requests: () => reqs, now: () => t, sleep: async ms => { t += ms; if (t - start >= 1000) Object.assign(reqs[0], { status: 200, ms: 990 }); } });
    r = await busy(1, { for: "network_idle", idleMs: 500 });
    assert.equal(r.met, true);
    assert.ok(t - start >= 1500, `waited for the request plus 500 ms of quiet (${t - start} ms)`);
    assert.deepEqual(networkState([{ start: 0, status: null, type: "xmlhttprequest" }], 0, 20_000).inflight, 0, "a request open over 15 s doesn't count");
    // Private pages stop the wait.
    tab.url = "https://mybank.example/";
    await assert.rejects(waiter(1, { for: "load" }), /private page/);
    console.log("ok - page_wait: selector, gone, text, url (regex), load and network_idle, with timeouts and clamping");
  }

  // ---------- lib/timeouts.mjs ----------
  {
    assert.equal(requestBudget("click", {}), 20_000);
    assert.equal(requestBudget("wait", { timeoutMs: 60_000 }), 65_000);
    assert.equal(requestBudget("eval", {}), 35_000);
    assert.equal(requestBudget("eval", { timeoutMs: 10 ** 9 }), MAX_TIMEOUT_MS + 5_000);
    assert.equal(requestBudget("navigate", {}), 50_000);
    assert.equal(clampTimeout(undefined), undefined);
    assert.equal(clampTimeout(5), 1_000);
    const e = new BrowserTimeoutError("upload", 65_000);
    assert.match(e.message, /Timed out after 65 s waiting for the browser \(upload\)\. This does not mean it failed: the action may still be running in Zen and may still take effect\. Check the page before trying again, so nothing is done twice/);
    console.log("ok - timeouts: defaults, clamping to 120 s, and a timeout says the action may still be running");
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
