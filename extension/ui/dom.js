// Tiny DOM helpers. Everything is built with createElement/textContent, so
// untrusted strings (model output, tool results, page titles) are never parsed
// as HTML.

import { ICONS } from "./icons.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * h("div", { class: "x", onclick: fn, aria: { label: "…" } }, child, [children], "text")
 * Props: class, dataset, aria, on* (event listeners), boolean attributes,
 * and everything else as attributes. Children may be nodes, strings, numbers,
 * arrays, null/false (skipped).
 */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key === "aria") for (const [k, v] of Object.entries(value)) { if (v != null) el.setAttribute(`aria-${k}`, String(v)); }
      else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
      else if (key === "value" && "value" in el) el.value = value;
      else if (key === "checked" || key === "disabled" || key === "selected" || key === "hidden" || key === "open") el[key] = !!value;
      else if (value === true) el.setAttribute(key, "");
      else el.setAttribute(key, String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === true) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function clear(el, ...children) {
  el.replaceChildren();
  return append(el, children);
}

/** Inline SVG icon from ICONS (24×24 viewBox, 1.5px stroke). */
export function icon(name, cls = "") {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of ICONS[name] ?? ICONS.dot) {
    if (d.startsWith("circle:")) {
      const [cx, cy, r] = d.slice(7).split(",");
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r);
      svg.append(c);
    } else {
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
  }
  return svg;
}

/** Icon-only button with an accessible label and a tooltip. */
export function iconButton(name, label, onclick, extra = {}) {
  const { class: cls, aria, ...rest } = extra;
  return h("button", { type: "button", class: ["icon-btn", cls], title: label, aria: { label, ...aria }, onclick, ...rest }, icon(name));
}

/** Safe external link: only http(s), new tab, no referrer. Falls back to text. */
export function extLink(url, ...children) {
  if (!isHttpUrl(url)) return h("span", null, ...children);
  return h("a", { href: url, target: "_blank", rel: "noreferrer noopener" }, ...children);
}

export function isHttpUrl(url) {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SPACE_ICONS = { "grid-2x2": "grid2x2", grid: "grid2x2", briefcase: "briefcase", work: "briefcase", heart: "heart", star: "star", book: "book", home: "home", globe: "globe" };

/** Small icon for a Zen space: a drawn SVG for known Zen icon names, the emoji, or a letter in a circle. */
export function spaceIcon(space, cls = "") {
  const name = String(space?.icon ?? "").trim();
  const key = SPACE_ICONS[name.toLowerCase()];
  if (key) return h("span", { class: `space-icon ${cls}`.trim(), aria: { hidden: "true" } }, icon(key));
  if (name && /\p{Extended_Pictographic}/u.test(name)) return h("span", { class: `space-icon emoji ${cls}`.trim(), aria: { hidden: "true" } }, name);
  const letter = (String(space?.name ?? "?").match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
  return h("span", { class: `space-icon letter ${cls}`.trim(), aria: { hidden: "true" } }, letter);
}

/** Monogram badge for a host (we don't fetch remote favicons: privacy + offline). */
export function hostBadge(host, cls = "") {
  const name = (host || "?").replace(/^www\./, "");
  const letter = (name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h("span", { class: `host-badge hue-${hash % 8} ${cls}`.trim(), title: name, aria: { hidden: "true" } }, letter);
}
