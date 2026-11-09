// Small inline-SVG charts for ```chart blocks:
// { "type": "bar" | "line", "title", "labels": [...], "series": [{ "name", "values": [...] }] }
// Colours come from CSS (--chart-0 … --chart-4) so they follow light/dark mode.

import { h } from "./dom.js";

const NS = "http://www.w3.org/2000/svg";
const W = 640;
const H = 260;
const PAD = { top: 12, right: 12, bottom: 34, left: 44 };

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const fmt = v => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${+v.toFixed(2)}`);

export function validChart(spec) {
  return spec && (spec.type === "bar" || spec.type === "line") && Array.isArray(spec.labels) && Array.isArray(spec.series) && spec.series.every(x => Array.isArray(x?.values));
}

export function chart(spec) {
  const labels = spec.labels.map(String);
  const series = spec.series.slice(0, 5).map(x => ({ name: String(x.name ?? ""), values: labels.map((_, i) => Number(x.values[i]) || 0) }));
  const all = series.flatMap(x => x.values);
  const min = Math.min(0, ...all);
  const max = niceMax(Math.max(...all, 0));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const y = v => PAD.top + ih - ((v - min) / (max - min || 1)) * ih;

  const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg", role: "img", "aria-label": spec.title || "Chart" });
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = min + ((max - min) * i) / ticks;
    svg.append(
      s("line", { x1: PAD.left, x2: W - PAD.right, y1: y(v), y2: y(v), class: i === 0 ? "axis" : "grid" }),
      s("text", { x: PAD.left - 8, y: y(v) + 4, class: "tick", "text-anchor": "end" }, fmt(v)),
    );
  }
  const band = iw / labels.length;
  const every = Math.ceil(labels.length / 10);
  labels.forEach((l, i) => {
    if (i % every) return;
    const text = l.length > 14 ? `${l.slice(0, 13)}…` : l;
    svg.append(s("text", { x: PAD.left + band * (i + 0.5), y: H - PAD.bottom + 20, class: "tick", "text-anchor": "middle" }, text));
  });

  if (spec.type === "bar") {
    const groupW = band * 0.72;
    const barW = groupW / series.length;
    series.forEach((ser, si) => ser.values.forEach((v, i) => {
      const x = PAD.left + band * i + (band - groupW) / 2 + barW * si;
      const top = Math.min(y(v), y(0));
      const height = Math.max(1, Math.abs(y(v) - y(0)));
      svg.append(s("rect", { x: x + 1, y: top, width: Math.max(1, barW - 2), height, rx: Math.min(3, barW / 4), class: `series-${si}` }, s("title", {}, `${ser.name ? `${ser.name} · ` : ""}${labels[i]}: ${v}`)));
    }));
  } else {
    series.forEach((ser, si) => {
      const pts = ser.values.map((v, i) => [PAD.left + band * (i + 0.5), y(v)]);
      svg.append(s("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" "), class: `line series-${si}` }));
      pts.forEach((p, i) => svg.append(s("circle", { cx: p[0], cy: p[1], r: 3, class: `dot series-${si}` }, s("title", {}, `${ser.name ? `${ser.name} · ` : ""}${labels[i]}: ${ser.values[i]}`))));
    });
  }

  return h("figure", { class: "chart" },
    spec.title ? h("figcaption", null, String(spec.title)) : null,
    svg,
    series.length > 1 || series[0]?.name ? h("div", { class: "chart-legend" }, series.map((ser, si) => h("span", null, h("i", { class: `swatch series-${si}` }), ser.name))) : null);
}
