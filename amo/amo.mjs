#!/usr/bin/env node
// addons.mozilla.org (AMO) API v5 for Ensō's listing and releases.
// Used by .github/workflows/amo-listing.yml and release.yml; needs Node 20+.
//
//   node amo/amo.mjs listing [--previews | --replace-previews] [--icon] [--dry-run]
//       Sets the listing from amo/listing.json, amo/description.md and the
//       site's privacy policy (site/content/privacy.md): name, slug, summary,
//       description, categories, links, flags, privacy policy; with --icon the
//       icon, with --previews the screenshots that aren't there yet, with
//       --replace-previews all screenshots again.
//   node amo/amo.mjs metadata <version> <out.json>
//       Writes web-ext's --amo-metadata file for a listed version: licence,
//       reviewer notes (amo/approval-notes.md) and release notes (CHANGELOG.md).
//   node amo/amo.mjs wait <version> [--minutes N] [--out file.xpi]
//       Polls the version until it is signed (then downloads it to --out),
//       rejected or the time is up. Writes status=signed|pending|rejected and
//       channel=… to $GITHUB_OUTPUT. Exit 0 for signed and pending, 1 for rejected.
//   node amo/amo.mjs status [<version>]
//       Prints the add-on's (and a version's) status.
//
// Credentials: AMO_JWT_ISSUER and AMO_JWT_SECRET in the environment (repository
// secrets). They are only used to sign short-lived JWTs and are never printed.
// AMO_BASE (default https://addons.mozilla.org/api/v5/) can point at a test server.

import { createHmac, randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const BASE = (process.env.AMO_BASE || "https://addons.mozilla.org/api/v5/").replace(/\/?$/, "/");
const listing = JSON.parse(readFileSync(path.join(here, "listing.json"), "utf8"));
const GUID = listing.guid;
const LOCALE = listing.default_locale || "en-US";
const tr = text => ({ [LOCALE]: text });

// ---------- auth and requests ----------

const b64url = b => Buffer.from(b).toString("base64url");
function jwt() {
  const iss = process.env.AMO_JWT_ISSUER;
  const secret = process.env.AMO_JWT_SECRET;
  if (!iss || !secret) throw new Error("AMO_JWT_ISSUER and AMO_JWT_SECRET must be set.");
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss, jti: randomUUID(), iat: now, exp: now + 60 }));
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/** AMO throttles writes ("Expected available in 57 seconds"); wait and retry a few times. */
async function api(method, pathname, opts = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await request(method, pathname, opts);
    } catch (err) {
      if (err.status !== 429 || attempt >= 6) throw err;
      const wait = Number(/(\d+) seconds?/.exec(JSON.stringify(err.data))?.[1] ?? 30) + 2;
      // AMO also has hourly limits; don't sit in a CI job for an hour.
      if (wait > 180) throw new Error(`AMO throttled ${method} ${pathname} for ${wait} s; run it again later. ${err.message}`);
      console.log(`AMO throttled ${method} ${pathname}; retrying in ${wait} s.`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
}

async function request(method, pathname, { json, form, auth = true, raw = false } = {}) {
  const url = /^https?:/.test(pathname) ? pathname : BASE + pathname;
  const headers = {};
  if (auth) headers.Authorization = `JWT ${jwt()}`;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(url, { method, headers, body, redirect: "follow" });
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { body: text.slice(0, 500) };
  }
  if (!res.ok) {
    const err = new Error(`${method} ${pathname}: ${res.status} ${JSON.stringify(data).slice(0, 1500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const addonPath = `addons/addon/${encodeURIComponent(GUID)}/`;
const fileBlob = (p, type) => new Blob([readFileSync(path.join(here, p))], { type });

// ---------- content ----------

/** The site's privacy policy (Markdown with front matter and a little HTML) as plain text for AMO. */
export function privacyPolicyText(md) {
  let s = md.replace(/^---\n[\s\S]*?\n---\n/, "");
  s = s.replace(/<[^>]+>/g, "");
  const out = [];
  let header = null;
  for (const line of s.split("\n")) {
    if (/^\|.*\|$/.test(line.trim())) {
      const cells = line.trim().slice(1, -1).split("|").map(c => c.trim());
      if (cells.every(c => /^:?-+:?$/.test(c))) continue;
      if (!header) {
        header = cells;
        continue;
      }
      out.push(`- ${cells[0]}. ${cells.slice(1).map((c, i) => `${header[i + 1]}: ${c.replace(/^./, x => x.toLowerCase())}`).join(". ")}.`);
      continue;
    }
    header = null;
    out.push(line);
  }
  return out
    .join("\n")
    .replace(/^#+\s*(.*)$/gm, (_, t) => t.toUpperCase())
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((mailto:)?([^)]+)\)/g, (_, t, mail, href) => {
      const abs = href.startsWith("/") ? `https://enso.wicker.life${href}` : href;
      return t === href || t === abs ? abs : `${t} (${abs})`;
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The CHANGELOG section for a version (or Unreleased), as plain text. */
function releaseNotes(version) {
  const log = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  const start = log.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
  if (start < 0) return null;
  const rest = log.slice(start).split("\n").slice(1).join("\n");
  const end = rest.search(/^## /m);
  const text = (end < 0 ? rest : rest.slice(0, end)).replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").replace(/\n {2}(?=\S)/g, " ").replace(/([^\n])\n(?=[^\n-])/g, "$1 ").trim();
  return (text.length > 3000 ? `${text.slice(0, text.lastIndexOf("\n", 2900))}\n…` : text) || null;
}

const read = p => readFileSync(path.join(here, p), "utf8").trim();

// ---------- commands ----------

async function setListing({ previews, replacePreviews, icon, dryRun }) {
  const fields = {
    name: tr(listing.name),
    summary: tr(listing.summary),
    description: tr(read(listing.description_file)),
    categories: listing.categories,
    homepage: tr(listing.homepage),
    support_url: tr(listing.support_url),
    support_email: tr(listing.support_email),
    requires_payment: listing.requires_payment,
    is_experimental: listing.is_experimental,
    default_locale: LOCALE,
    tags: listing.tags ?? []
  };
  const privacy = privacyPolicyText(readFileSync(path.join(here, listing.privacy_policy_source), "utf8"));
  if (listing.summary.length > 250) throw new Error(`summary is ${listing.summary.length} characters; AMO allows 250`);
  if (dryRun) {
    console.log(JSON.stringify({ ...fields, slug: listing.slug }, null, 2));
    console.log("\n--- privacy policy ---\n" + privacy);
    return;
  }

  const before = await api("GET", addonPath);
  console.log(`Add-on ${before.guid}: status ${before.status}, slug ${before.slug}`);

  await api("PATCH", addonPath, { json: fields });
  console.log("Listing fields set.");

  if (listing.slug && before.slug !== listing.slug) {
    try {
      await api("PATCH", addonPath, { json: { slug: listing.slug } });
      console.log(`Slug set to ${listing.slug}.`);
    } catch (err) {
      console.log(`::warning::Slug "${listing.slug}" not set (${err.status}): ${JSON.stringify(err.data)}`);
    }
  }

  await api("PATCH", `${addonPath}eula_policy/`, { json: { privacy_policy: tr(privacy) } });
  console.log(`Privacy policy set (${privacy.length} characters).`);

  if (icon && listing.icon) {
    const form = new FormData();
    form.set("icon", fileBlob(listing.icon, "image/png"), path.basename(listing.icon));
    await api("PATCH", addonPath, { form });
    console.log("Icon uploaded.");
  }

  if ((previews || replacePreviews) && listing.previews?.length) {
    // AMO doesn't keep file names, so previews are matched by position: by
    // default only the missing ones (from the end of the list) are uploaded,
    // which makes a run that was throttled halfway safe to repeat.
    let current = ((await api("GET", addonPath)).previews ?? []).sort((a, b) => a.position - b.position);
    if (replacePreviews) {
      for (const p of current) await api("DELETE", `${addonPath}previews/${p.id}/`);
      if (current.length) console.log(`Removed ${current.length} old previews.`);
      current = [];
    }
    const missing = listing.previews.slice(current.length);
    if (!missing.length) console.log(`Previews: all ${current.length} already there (use --replace-previews to upload them again).`);
    let position = current.length;
    for (const file of missing) {
      const form = new FormData();
      form.set("image", fileBlob(file, "image/png"), path.basename(file));
      form.set("position", String(position++));
      await api("POST", `${addonPath}previews/`, { form });
      console.log(`Preview uploaded: ${file}`);
    }
  }

  const after = await api("GET", addonPath);
  console.log(`Now: slug ${after.slug}, status ${after.status}, categories ${JSON.stringify(after.categories)}, previews ${after.previews?.length ?? 0}, url ${after.url}`);
  output({ slug: after.slug, url: after.url, status: after.status });
}

function writeMetadata(version, out) {
  const notes = releaseNotes(version);
  const approval = read(listing.approval_notes_file);
  if (approval.length > 3000) throw new Error(`${listing.approval_notes_file} is ${approval.length} characters; AMO allows 3000`);
  const meta = {
    version: {
      license: listing.license,
      approval_notes: approval,
      ...(notes ? { release_notes: tr(notes) } : {})
    }
  };
  writeFileSync(out, JSON.stringify(meta, null, 2) + "\n");
  console.log(`Wrote ${out} (licence ${listing.license}, ${meta.version.approval_notes.length} characters of reviewer notes, release notes: ${notes ? "yes" : "none"}).`);
}

function output(values) {
  for (const [k, v] of Object.entries(values)) {
    console.log(`${k}=${v}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
  }
}

const versionPath = v => `${addonPath}versions/${encodeURIComponent(v)}/`;

/** signed | pending | rejected, from a v5 version object. */
function versionState(v) {
  const s = v.file?.status;
  if (s === "public") return "signed";
  if (s === "disabled" || v.is_disabled) return "rejected";
  return "pending";
}

async function download(v, out) {
  const res = await api("GET", v.file.url, { raw: true });
  if (!res.ok) throw new Error(`Downloading the signed file: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(out, buf);
  console.log(`Downloaded ${v.file.url.split("?")[0]} to ${out} (${buf.length} bytes).`);
}

async function wait(version, { minutes = 10, out }) {
  const deadline = Date.now() + minutes * 60_000;
  let v;
  for (;;) {
    v = await api("GET", versionPath(version));
    const state = versionState(v);
    if (state !== "pending" || Date.now() > deadline) break;
    await new Promise(r => setTimeout(r, 20_000));
  }
  const state = versionState(v);
  console.log(`Version ${version} (${v.channel}): file status ${v.file?.status}, ${state}.`);
  if (state === "signed" && out) await download(v, out);
  output({ status: state, channel: v.channel });
  if (state === "rejected") process.exitCode = 1;
}

async function status(version) {
  const a = await api("GET", addonPath);
  console.log(`Add-on ${a.guid}: status ${a.status}, slug ${a.slug}, url ${a.url}, listed version ${a.current_version?.version ?? "none"}`);
  if (version) {
    const v = await api("GET", versionPath(version));
    console.log(`Version ${version}: channel ${v.channel}, file status ${v.file?.status}, ${versionState(v)}`);
    output({ status: versionState(v), channel: v.channel });
  }
}

// ---------- main ----------

const [cmd, ...args] = process.argv.slice(2);
const flag = f => args.includes(f);
const opt = (f, d) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : d;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--minutes", "--out"].includes(args[i - 1])));

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    if (cmd === "listing") await setListing({ previews: flag("--previews"), replacePreviews: flag("--replace-previews"), icon: flag("--icon"), dryRun: flag("--dry-run") });
    else if (cmd === "metadata") writeMetadata(positional[0], positional[1]);
    else if (cmd === "wait") await wait(positional[0], { minutes: Number(opt("--minutes", 10)), out: opt("--out") });
    else if (cmd === "status") await status(positional[0]);
    else {
      console.error("Usage: amo.mjs listing [--previews | --replace-previews] [--icon] [--dry-run] | metadata <version> <out> | wait <version> [--minutes N] [--out file] | status [<version>]");
      process.exitCode = 2;
    }
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exitCode = 1;
  }
}
