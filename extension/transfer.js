// Large messages from the helper, and files staged for page_upload.
//
// Native messaging caps every message from the helper to the extension at
// 1 MB. The helper (helper/lib/native.mjs) splits anything bigger into
// { type: "chunk", id, seq, total, data } frames, each carrying a slice of the
// base64 of the message's UTF-8 JSON; createReassembler() puts them back
// together. Files for page_upload never travel as one message: the helper
// sends them in upload_chunk requests (raw bytes in base64, 512 KiB at a time)
// that createUploadStore() collects as Uint8Arrays, checks against the size
// and SHA-256 the helper declared, and hands to the page agent, which builds
// File objects from them. Nothing here changes a byte of a file.
//
// Loaded as a background script before background.js (globalThis.EnsoTransfer)
// and by the helper's tests under Node (module.exports).

(function (root) {
  const ASSEMBLY_TTL_MS = 60_000; // a chunked message whose parts stop arriving is dropped
  const UPLOAD_TTL_MS = 5 * 60_000; // staged files not used by page_upload within this are dropped
  const MAX_ASSEMBLY_BYTES = 64 * 1024 * 1024; // matches helper/lib/native.mjs MAX_MESSAGE_BYTES
  const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // a hard ceiling; the helper's own limit is lower (100 MB by default)

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** → { accept(frame) → the whole message once its last part arrived, else null; pending() } */
  function createReassembler({ now = () => Date.now() } = {}) {
    const open = new Map(); // id -> { total, parts, got, chars, at }
    const sweep = () => {
      for (const [id, a] of open) if (now() - a.at > ASSEMBLY_TTL_MS) open.delete(id);
    };
    return {
      accept(frame) {
        sweep();
        const { id, seq, total, data } = frame ?? {};
        if (typeof id !== "string" || !Number.isInteger(seq) || !Number.isInteger(total) || total < 1 || seq < 0 || seq >= total || typeof data !== "string") throw new Error("Malformed chunk frame.");
        let a = open.get(id);
        if (!a) open.set(id, (a = { total, parts: new Array(total), got: 0, chars: 0, at: now() }));
        if (a.total !== total) throw new Error("Chunk frames disagree on their count.");
        if (a.parts[seq] === undefined) {
          a.parts[seq] = data;
          a.got++;
          a.chars += data.length;
          a.at = now();
        }
        if (a.chars * 0.75 > MAX_ASSEMBLY_BYTES) {
          open.delete(id);
          throw new Error("Chunked message too large.");
        }
        if (a.got < a.total) return null;
        open.delete(id);
        const bytes = base64ToBytes(a.parts.join(""));
        return JSON.parse(new TextDecoder().decode(bytes));
      },
      pending: () => open.size,
    };
  }

  async function sha256Hex(parts) {
    const subtle = root.crypto?.subtle;
    if (!subtle) return null;
    const total = parts.reduce((n, p) => n + p.byteLength, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.byteLength;
    }
    const digest = new Uint8Array(await subtle.digest("SHA-256", all));
    return Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
  }

  /**
   * Files staged for page_upload, keyed by uploadId.
   *   begin({ uploadId, files: [{ name, type, lastModified, size, sha256 }] })
   *   chunk({ uploadId, index, offset, data })   data: base64 of the raw bytes at offset
   *   take(uploadId, sha256s?) → [{ name, type, lastModified, size, sha256, parts: Uint8Array[] }] (removed from the store);
   *     sha256s: the hex digests the helper computed while reading, checked against the bytes received
   *   discard(uploadId)
   */
  function createUploadStore({ now = () => Date.now() } = {}) {
    const staged = new Map();
    const sweep = () => {
      for (const [id, u] of staged) if (now() - u.at > UPLOAD_TTL_MS) staged.delete(id);
    };
    const get = uploadId => {
      const u = staged.get(uploadId);
      if (!u) throw new Error("This upload is unknown or expired; call page_upload again.");
      return u;
    };
    return {
      begin({ uploadId, files }) {
        sweep();
        if (typeof uploadId !== "string" || !uploadId) throw new Error("upload_begin needs an uploadId.");
        if (!Array.isArray(files) || !files.length) throw new Error("upload_begin needs files.");
        const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
        if (total > MAX_UPLOAD_BYTES) throw new Error("These files are too large to stage in the browser.");
        staged.set(uploadId, {
          at: now(),
          files: files.map(f => ({ name: String(f.name), type: String(f.type ?? ""), lastModified: Number(f.lastModified) || 0, size: Number(f.size) || 0, sha256: f.sha256 ? String(f.sha256) : null, parts: [], received: 0 })),
        });
        return { uploadId, files: files.length, bytes: total };
      },
      chunk({ uploadId, index, offset, data }) {
        const u = get(uploadId);
        const f = u.files[index];
        if (!f) throw new Error(`No file ${index} in this upload.`);
        if (offset !== f.received) throw new Error(`Chunk for ${f.name} out of order (expected byte ${f.received}, got ${offset}).`);
        const bytes = base64ToBytes(String(data ?? ""));
        if (f.received + bytes.byteLength > f.size) throw new Error(`More bytes than declared for ${f.name}.`);
        f.parts.push(bytes);
        f.received += bytes.byteLength;
        u.at = now();
        return { received: f.received };
      },
      async take(uploadId, sha256s) {
        const u = get(uploadId);
        staged.delete(uploadId);
        for (const [i, f] of u.files.entries()) {
          if (f.received !== f.size) throw new Error(`${f.name} arrived incomplete (${f.received} of ${f.size} bytes); nothing was attached.`);
          f.sha256 = (Array.isArray(sha256s) && sha256s[i] ? String(sha256s[i]) : null) ?? f.sha256;
          if (f.sha256) {
            const got = await sha256Hex(f.parts);
            if (got && got !== f.sha256) throw new Error(`${f.name} arrived with different contents than on disk (SHA-256 mismatch); nothing was attached.`);
          }
        }
        return u.files.map(({ received, ...f }) => f);
      },
      discard(uploadId) {
        return staged.delete(uploadId);
      },
      size: () => staged.size,
    };
  }

  const api = { createReassembler, createUploadStore, base64ToBytes, sha256Hex, MAX_ASSEMBLY_BYTES };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EnsoTransfer = api;
})(globalThis);
