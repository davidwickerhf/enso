// Safe Markdown → DOM renderer for answers and memory.
// Builds nodes with createElement/textContent only, never innerHTML, so model
// output can't inject markup. Links are kept only for http(s) URLs and open in
// a new tab without a referrer.
//
// Supports: headings, paragraphs, hard line breaks, bold, italic, strike,
// inline code, fenced code (with a copy button), block quotes, ordered and
// unordered lists (nested by indentation, task boxes), tables with alignment,
// horizontal rules, links and bare URLs.

import { h, icon, isHttpUrl } from "./dom.js";
import { chart, validChart } from "./chart.js";

let headingShift = 1;

/** opts.headingShift: added to heading levels (default 1: "#" renders as h2). */
export function renderMarkdown(src, { headingShift: shift = 1 } = {}) {
  headingShift = shift;
  const frag = document.createDocumentFragment();
  const lines = String(src ?? "").replace(/\r\n?/g, "\n").split("\n");
  blocks(lines, frag);
  return frag;
}

const RE = {
  fence: /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/,
  heading: /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/,
  hr: /^\s{0,3}([-*_])(\s*\1){2,}\s*$/,
  quote: /^\s{0,3}>\s?/,
  list: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/,
  tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

function isTableStart(lines, i) {
  return lines[i]?.includes("|") && RE.tableSep.test(lines[i + 1] ?? "");
}

function startsBlock(lines, i) {
  const line = lines[i];
  return RE.fence.test(line) || RE.heading.test(line) || RE.hr.test(line) || RE.quote.test(line) || RE.list.test(line) || isTableStart(lines, i);
}

function blocks(lines, parent) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = line.match(RE.fence);
    if (fence) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      parent.append(fence[2] === "chart" ? chartBlock(body.join("\n")) : codeBlock(body.join("\n"), fence[2]));
      continue;
    }

    const heading = line.match(RE.heading);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingShift); // h1 in answers is too loud
      parent.append(h(`h${level}`, null, inline(heading[2])));
      i++;
      continue;
    }

    if (RE.hr.test(line)) { parent.append(h("hr")); i++; continue; }

    if (RE.quote.test(line)) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && (RE.quote.test(lines[i]) || !startsBlock(lines, i))) inner.push(lines[i++].replace(RE.quote, ""));
      const bq = h("blockquote");
      blocks(inner, bq);
      parent.append(bq);
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows = [lines[i]];
      const aligns = splitRow(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? "center" : /-:$/.test(c) ? "right" : /^:-/.test(c) ? "left" : ""));
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(lines[i++]);
      parent.append(table(rows, aligns));
      continue;
    }

    if (RE.list.test(line)) {
      i = list(lines, i, parent);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) para.push(lines[i++]);
    const p = h("p");
    para.forEach((l, n) => {
      if (n) p.append(/ {2,}$|\\$/.test(para[n - 1]) ? h("br") : " ");
      p.append(inline(l.replace(/\\$/, "").trim()));
    });
    parent.append(p);
  }
}

function list(lines, i, parent) {
  const first = lines[i].match(RE.list);
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const el = h(ordered ? "ol" : "ul");
  if (ordered && parseInt(first[2], 10) !== 1) el.setAttribute("start", parseInt(first[2], 10));
  while (i < lines.length) {
    const m = lines[i].match(RE.list);
    if (!m || m[1].length < indent) {
      // continuation line of the previous item (indented, not a new block)
      if (lines[i].trim() && /^\s+/.test(lines[i]) && el.lastElementChild && !m) {
        el.lastElementChild.append(" ", inline(lines[i].trim()));
        i++;
        continue;
      }
      break;
    }
    if (m[1].length > indent) {
      i = list(lines, i, el.lastElementChild ?? el);
      continue;
    }
    if (/\d/.test(m[2]) !== ordered) break;
    const li = h("li");
    const task = m[3].match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      li.className = "task";
      li.append(h("span", { class: `task-box${task[1] !== " " ? " done" : ""}`, aria: { hidden: "true" } }, task[1] !== " " ? icon("check") : null), inline(task[2]));
    } else {
      li.append(inline(m[3]));
    }
    el.append(li);
    i++;
    if (i < lines.length && !lines[i].trim() && RE.list.test(lines[i + 1] ?? "") && lines[i + 1].match(RE.list)[1].length >= indent) i++; // loose lists
  }
  parent.append(el);
  return i;
}

function splitRow(row) {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
}

function table(rows, aligns) {
  const [head, ...body] = rows.map(splitRow);
  const cell = (tag, text, n) => h(tag, aligns[n] ? { class: `align-${aligns[n]}` } : null, inline(text));
  return h("div", { class: "table-wrap", tabindex: "0", role: "region", aria: { label: "Table" } },
    h("table", null,
      h("thead", null, h("tr", null, head.map((c, n) => cell("th", c, n)))),
      h("tbody", null, body.map(r => h("tr", null, head.map((_, n) => cell("td", r[n] ?? "", n)))))));
}

function chartBlock(src) {
  try {
    const spec = JSON.parse(src);
    if (validChart(spec)) return chart(spec);
  } catch { /* still streaming, or not JSON */ }
  return codeBlock(src, "chart");
}

export function codeBlock(code, lang = "") {
  const copy = h("button", { type: "button", class: "code-copy", title: "Copy code", aria: { label: "Copy code" } }, icon("copy"), h("span", null, "Copy"));
  copy.addEventListener("click", () => {
    navigator.clipboard?.writeText(code).then(() => {
      copy.lastChild.textContent = "Copied";
      setTimeout(() => (copy.lastChild.textContent = "Copy"), 1400);
    });
  });
  return h("div", { class: "code" },
    h("div", { class: "code-head" }, h("span", { class: "code-lang" }, lang || "code"), copy),
    h("pre", { tabindex: "0" }, h("code", null, code)));
}

// Inline: earliest-match tokenizer. Order matters for ties.
const INLINE = [
  ["code", /(`+)([\s\S]+?)\1/],
  ["link", /\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/],
  ["auto", /<?(https?:\/\/[^\s<>()]+(?:\([^\s<>()]*\)[^\s<>()]*)*[^\s<>().,;:!?'"*_~\]])>?/],
  ["bold", /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|__(?=\S)([\s\S]+?)(?<=\S)__/],
  ["strike", /~~(?=\S)([\s\S]+?)(?<=\S)~~/],
  ["em", /\*(?=[^\s*])([\s\S]*?[^\s*])\*|(?<![\w])_(?=\S)([\s\S]*?\S)_(?![\w])/],
];

export function inline(text) {
  const frag = document.createDocumentFragment();
  let rest = String(text);
  while (rest) {
    let best = null;
    for (const [kind, re] of INLINE) {
      const m = re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { kind, m };
    }
    if (!best) { frag.append(unescape(rest)); break; }
    const { kind, m } = best;
    if (m.index) frag.append(unescape(rest.slice(0, m.index)));
    rest = rest.slice(m.index + m[0].length);
    switch (kind) {
      case "code": frag.append(h("code", null, m[2].replace(/^ (.*) $/, "$1"))); break;
      case "link":
        frag.append(isHttpUrl(m[2])
          ? h("a", { href: m[2], target: "_blank", rel: "noreferrer noopener", title: m[2] }, inline(m[1]))
          : h("span", null, inline(m[1])));
        break;
      case "auto": frag.append(h("a", { href: m[1], target: "_blank", rel: "noreferrer noopener", class: "bare-link" }, m[1])); break;
      case "bold": frag.append(h("strong", null, inline(m[1] ?? m[2]))); break;
      case "strike": frag.append(h("del", null, inline(m[1]))); break;
      case "em": frag.append(h("em", null, inline(m[1] ?? m[2]))); break;
    }
  }
  return frag;
}

function unescape(s) {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!|~>])/g, "$1");
}
