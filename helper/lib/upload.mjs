// page_upload: files from the user's disk, attached to a file input or dropped
// on a drop zone in a Zen tab, exactly as they are on disk.
//
//   helper                             extension (background.js)          page agent
//   validate paths, read in 512 KiB  → upload_begin / upload_chunk …  →   (staged, transfer.js)
//   SHA-256 while reading            → upload { sha256s, ref|selector } → size + SHA-256 checked
//                                                                       → upload_part (≤ 8 MB) … → File objects
//                                                                       → upload → input.files / drop
//
// Each upload_chunk is one native message well under the 1 MB limit. Files
// come only from local paths (never URLs) and are never transformed: the
// extension refuses to attach anything whose size or SHA-256 differs from what
// was read. Too big is a clear error, never a reason to change a file.

import { createHash, randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { browserProfileRoots, dataDir } from "./platform.mjs";

export const UPLOAD_CHUNK_BYTES = 512 * 1024; // raw bytes per upload_chunk (~700 KB of base64)
export const MAX_UPLOAD_FILES = 20;
const MB = 1024 * 1024;

/** Total bytes one page_upload may carry: 100 MB, or ENSO_MAX_UPLOAD_MB (1–500). */
export function maxUploadBytes(env = process.env) {
  const n = Number(env.ENSO_MAX_UPLOAD_MB);
  return Number.isFinite(n) && n >= 1 ? Math.min(500, n) * MB : 100 * MB;
}

const TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  heic: "image/heic",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  ico: "image/vnd.microsoft.icon",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  "7z": "application/x-7z-compressed",
  epub: "application/epub+zip",
  ics: "text/calendar",
  vcf: "text/vcard",
};

/** The MIME type a browser's file picker would give, from the extension ("" when unknown, like the picker). */
export const mimeType = name => TYPES[path.extname(name).slice(1).toLowerCase()] ?? "";

export const formatBytes = n => (n >= MB ? `${(n / MB).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`);

/** Expand ~ and require an absolute path. */
export function expandPath(p, home = homedir()) {
  const s = String(p ?? "").trim();
  if (!s) throw new Error("An empty path was given.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) throw new Error(`${s} is a URL. page_upload only takes files from this computer's disk (absolute paths or ~/…); download it yourself first if the user wants that.`);
  const full = s === "~" ? home : s.startsWith("~/") || s.startsWith("~\\") ? path.join(home, s.slice(2)) : s;
  if (!path.isAbsolute(full)) throw new Error(`${s} is not an absolute path. Give the full path (or ~/…).`);
  return path.normalize(full);
}

// Places that hold credentials, not documents: never attached to a page, even
// when asked (a page's text can't talk an agent into sending them).
const SECRET_DIRS = [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", ".config/gcloud", ".config/gh", ".password-store", "Library/Keychains"];
const SECRET_FILES = [".netrc", ".npmrc", ".pypirc", ".git-credentials"];

/** Is this (real) path inside a credentials folder, Ensō's own data folder or a browser profile? */
export function isSecretPath(full, home = homedir(), extraDirs = []) {
  const inside = dir => {
    const rel = path.relative(dir, full);
    return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
  };
  if (SECRET_DIRS.some(d => inside(path.join(home, d)))) return true;
  if (SECRET_FILES.some(f => full === path.join(home, f))) return true;
  return extraDirs.filter(Boolean).some(inside);
}

function protectedDirs(home) {
  const dirs = [];
  try {
    dirs.push(dataDir({ home }));
  } catch {}
  try {
    dirs.push(...browserProfileRoots({ home }).map(r => r.dir));
  } catch {}
  return dirs;
}

/** Check the paths and describe the files: [{ path, name, size, type, lastModified }]. Throws a clear error. */
export async function describeFiles(paths, { home = homedir(), maxBytes = maxUploadBytes() } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error("Give at least one file path.");
  if (paths.length > MAX_UPLOAD_FILES) throw new Error(`At most ${MAX_UPLOAD_FILES} files per page_upload; you gave ${paths.length}.`);
  const files = [];
  for (const p of paths) {
    const full = expandPath(p, home);
    let st;
    try {
      st = await stat(full);
    } catch (err) {
      throw new Error(err.code === "ENOENT" ? `No such file: ${full}` : `Can't read ${full} (${err.code ?? err.message}).`);
    }
    if (st.isDirectory()) throw new Error(`${full} is a folder. page_upload takes files; give the files inside it (or ask the user whether to zip it).`);
    if (!st.isFile()) throw new Error(`${full} is not a regular file.`);
    const real = await realpath(full).catch(() => full);
    const realHome = await realpath(home).catch(() => home);
    if ([[full, home], [real, home], [real, realHome]].some(([f, h]) => isSecretPath(f, h, protectedDirs(h)))) throw new Error(`${full} is in a folder that holds credentials or browser and Ensō data (keys, tokens, profiles); page_upload never sends those. If the user really wants it uploaded, they can do it themselves.`);
    files.push({ path: full, name: path.basename(full), size: st.size, type: mimeType(full), lastModified: Math.round(st.mtimeMs) });
  }
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > maxBytes)
    throw new Error(
      `These files are ${formatBytes(total)} together; page_upload takes up to ${formatBytes(maxBytes)} per call. Nothing was sent. ` +
        "Upload fewer files per call if each fits. Never shrink, compress or edit the user's files to fit: if a file is too big on its own, stop and tell the user.",
    );
  return files;
}

/**
 * Stream the files to the extension: upload_begin, then upload_chunk for every
 * 512 KiB. → { uploadId, sha256s }. Throws if a file changes while it is read.
 */
export async function stageFiles(browser, files, { uploadId = randomUUID(), chunkBytes = UPLOAD_CHUNK_BYTES } = {}) {
  await browser("upload_begin", { uploadId, files: files.map(({ name, type, lastModified, size }) => ({ name, type, lastModified, size })) });
  const sha256s = [];
  try {
    for (const [index, f] of files.entries()) {
      const hash = createHash("sha256");
      const fh = await open(f.path, "r");
      try {
        const buf = Buffer.alloc(Math.min(chunkBytes, Math.max(1, f.size)));
        let offset = 0;
        while (offset < f.size) {
          const { bytesRead } = await fh.read(buf, 0, Math.min(buf.length, f.size - offset), offset);
          if (!bytesRead) throw new Error(`${f.path} got shorter while it was being read; nothing was attached. Try again once it stopped changing.`);
          const bytes = buf.subarray(0, bytesRead);
          hash.update(bytes);
          await browser("upload_chunk", { uploadId, index, offset, data: bytes.toString("base64") });
          offset += bytesRead;
        }
        const after = await fh.stat();
        if (after.size !== f.size || Math.round(after.mtimeMs) !== f.lastModified) throw new Error(`${f.path} changed while it was being read; nothing was attached. Try again once it stopped changing.`);
      } finally {
        await fh.close();
      }
      sha256s.push(hash.digest("hex"));
    }
  } catch (err) {
    await browser("upload_discard", { uploadId }).catch(() => {});
    throw err;
  }
  return { uploadId, sha256s };
}
