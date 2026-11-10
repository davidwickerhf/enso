// Turns any attached file into content Claude can read:
//   images (incl. HEIC/TIFF, converted with sips on macOS) → image blocks
//   PDF → document blocks
//   Word/RTF/ODT/HTML/Pages-exported docs → text (macOS textutil; on Linux and
//     Windows .docx/.odt from their XML, other formats get a note)
//   Excel/ODS → CSV-like text per sheet, PowerPoint/ODP → text per slide (unzip + XML)
//   archives → a listing; code, CSV, JSON, Markdown, logs… → text
//   anything else → a short note with name, type and size, so Claude can say so.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WORKSPACE } from "./store.mjs";

const MAX_TEXT = 200_000;
const IMAGE_OK = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|cfg|conf|log|xml|svg|html?|css|scss|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|zsh|bash|sql|r|m|tex|bib|srt|vtt|ipynb|env\.example|gitignore|dockerfile)$/i;
const DOC_EXT = /\.(docx?|rtf|rtfd|odt|wordml|webarchive)$/i;
const SHEET_EXT = /\.(xlsx|xlsm|ods)$/i;
const SLIDES_EXT = /\.(pptx|odp)$/i;
const ARCHIVE_EXT = /\.(zip|jar|epub)$/i;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, ...opts });
const cut = t => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n[cut at ${MAX_TEXT} characters]` : t);
const decodeXml = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const sizeLabel = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} kB`);

// unzip (macOS, most Linux); Windows' built-in tar (bsdtar) reads zip files too.
function unzipEntries(file) {
  try {
    return run("unzip", ["-Z1", file]).split("\n").filter(Boolean);
  } catch (err) {
    if (process.platform !== "win32" && err.code !== "ENOENT") throw err;
    return run("tar", ["-tf", file]).split(/\r?\n/).filter(Boolean);
  }
}
function unzipText(file, entry) {
  try {
    return run("unzip", ["-p", file, entry]);
  } catch (err) {
    if (process.platform !== "win32" && err.code !== "ENOENT") throw err;
    return run("tar", ["-xOf", file, entry]);
  }
}

/** .docx / .odt text without textutil (Linux, Windows). */
function docText(file, name) {
  const entries = unzipEntries(file);
  if (entries.includes("word/document.xml")) return decodeXml(unzipText(file, "word/document.xml").replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, ""));
  if (entries.includes("content.xml")) return decodeXml(unzipText(file, "content.xml").replace(/<\/text:p>/g, "\n").replace(/<[^>]+>/g, ""));
  throw new Error(`${path.extname(name) || "this format"} can only be converted on macOS`);
}

function sheetText(file) {
  const entries = unzipEntries(file);
  if (entries.includes("content.xml")) return decodeXml(unzipText(file, "content.xml").replace(/<\/table:table-row>/g, "\n").replace(/<\/table:table-cell>/g, "\t").replace(/<[^>]+>/g, ""));
  const shared = entries.includes("xl/sharedStrings.xml")
    ? [...unzipText(file, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => decodeXml(m[1].replace(/<[^>]+>/g, "")))
    : [];
  const sheets = entries.filter(e => /^xl\/worksheets\/sheet\d+\.xml$/.test(e)).sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));
  return sheets
    .map((entry, i) => {
      const xml = unzipText(file, entry);
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map(r =>
        [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
          .map(c => {
            const attrs = c[1] ?? "";
            const v = (c[2] ?? "").match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? (c[2] ?? "").match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
            return /t="s"/.test(attrs) ? shared[Number(v)] ?? "" : decodeXml(v);
          })
          .join("\t"),
      );
      return `## Sheet ${i + 1}\n${rows.join("\n")}`;
    })
    .join("\n\n");
}

function slidesText(file) {
  const entries = unzipEntries(file);
  if (entries.includes("content.xml")) return decodeXml(unzipText(file, "content.xml").replace(/<\/text:p>/g, "\n").replace(/<[^>]+>/g, ""));
  return entries
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e))
    .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]))
    .map((entry, i) => `## Slide ${i + 1}\n${[...unzipText(file, entry).matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => decodeXml(m[1])).join(" ")}`)
    .join("\n\n");
}

/** → { blocks: [content blocks], notes: [text parts] } for one attachment. */
export function convertAttachment({ name = "file", mimeType = "", dataBase64 }) {
  const data = Buffer.from(dataBase64 ?? "", "base64");
  const label = `${name} (${mimeType || "unknown type"}, ${sizeLabel(data.length)})`;
  const asText = text => ({ blocks: [], notes: [`<file name="${name.replace(/"/g, "'")}">\n${cut(text)}\n</file>`] });

  if (IMAGE_OK.has(mimeType)) return { blocks: [{ type: "image", source: { type: "base64", media_type: mimeType, data: dataBase64 } }], notes: [] };
  if (mimeType === "application/pdf" || /\.pdf$/i.test(name)) {
    return { blocks: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: dataBase64 }, title: name }], notes: [] };
  }

  const dir = mkdtempSync(path.join(WORKSPACE, "attach-"));
  const file = path.join(dir, path.basename(name).replace(/[^\w.\- ]/g, "_") || "file");
  try {
    writeFileSync(file, data);
    if (mimeType.startsWith("image/") || /\.(heic|heif|tiff?|bmp|avif)$/i.test(name)) {
      if (process.platform !== "darwin") throw new Error("only PNG, JPEG, GIF and WebP images can be read here");
      const out = path.join(dir, "converted.jpg");
      run("sips", ["-s", "format", "jpeg", "-Z", "2400", file, "--out", out]);
      return { blocks: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: readFileSync(out).toString("base64") } }], notes: [] };
    }
    if (DOC_EXT.test(name) || /officedocument\.wordprocessingml|msword|rtf|opendocument\.text/.test(mimeType)) return asText(process.platform === "darwin" ? run("textutil", ["-convert", "txt", "-stdout", file]) : docText(file, name));
    if (SHEET_EXT.test(name) || /spreadsheetml|opendocument\.spreadsheet/.test(mimeType)) return asText(sheetText(file));
    if (SLIDES_EXT.test(name) || /presentationml|opendocument\.presentation/.test(mimeType)) return asText(slidesText(file));
    if (ARCHIVE_EXT.test(name) || /zip/.test(mimeType)) return asText(`Archive contents:\n${unzipEntries(file).slice(0, 500).join("\n")}`);
    if (mimeType.startsWith("text/") || TEXT_EXT.test(name) || /json|xml|javascript|yaml|csv|x-sh|sql/.test(mimeType)) return asText(data.toString("utf8"));
    // Unknown: try it as text if it decodes cleanly, otherwise describe it.
    const text = data.toString("utf8");
    if (!text.includes("�") && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 4000))) return asText(text);
    return { blocks: [], notes: [`[Attached ${label}: this kind of file can't be read here (for audio or video, ask the user for a transcript or description).]`] };
  } catch (err) {
    return { blocks: [], notes: [`[Attached ${label}: couldn't convert it (${String(err.message).split("\n")[0].slice(0, 120)}).]`] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
