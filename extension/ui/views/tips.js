// Dia-style tip card: one feature at a time on a gently tilted card, rotating,
// dismissible; dismissed tips are remembered in localStorage.

import { h, icon, clear } from "../dom.js";

const KEY = "enso.tips.dismissed";

const TIPS = [
  { id: "mention", icon: "at", title: "Mention Tabs", example: ["Compare ", ["Q3 roadmap"], " with ", ["Launch brief"]], caption: "Mention tabs to add context", hint: "Type @ to mention a tab" },
  { id: "page", icon: "page", title: "Ask About This Page", example: ["What are the key points of ", ["this article"], "?"], caption: "The page you're on comes along", hint: "Remove the page chip to ask without it" },
  { id: "act", icon: "cursor", title: "Act on the Page", example: ["Fill this ", ["form"], " for me and stop before submitting"], caption: "It can click, type and navigate", hint: "Anything that changes something asks first" },
  { id: "tools", icon: "sparkle", title: "Your Tools", example: ["What did ", ["Jonas"], " say about ", ["the launch"], "?"], caption: "Gmail, Calendar, Drive and your MCP servers", hint: "It looks things up for you" },
  { id: "skills", icon: "command", title: "Skills", example: [["/summarize"], " the key moments of this talk"], caption: "Reusable prompts, one keystroke away", hint: "Type / at the start for skills" },
];

function dismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]")); } catch { return new Set(); }
}

export function createTips({ onTry } = {}) {
  const el = h("section", { class: "tips", aria: { label: "Tips", roledescription: "carousel" } });
  let index = 0;
  let timer = 0;
  let paused = false;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  function active() {
    const d = dismissed();
    return TIPS.filter(t => !d.has(t.id));
  }

  function dismiss(id) {
    const d = dismissed();
    d.add(id);
    try { localStorage.setItem(KEY, JSON.stringify([...d])); } catch { /* private mode */ }
    render(true);
  }

  function render(animate = false) {
    const tips = active();
    if (!tips.length) { el.hidden = true; return; }
    el.hidden = false;
    index %= tips.length;
    const tip = tips[index];
    const card = h("div", { class: ["tip-card", animate && "enter"], dataset: { tip: tip.id } },
      h("div", { class: "tip-card-head" }, icon(tip.icon), h("span", null, tip.title)),
      h("div", { class: "tip-card-body" }, tip.example.map(part => (Array.isArray(part) ? h("u", null, part[0]) : part))));
    clear(el,
      h("button", { type: "button", class: "icon-btn tip-close", title: "Hide this tip", aria: { label: `Hide the tip “${tip.title}”` }, onclick: () => dismiss(tip.id) }, icon("x")),
      h("button", { type: "button", class: "tip-stage", title: "Try it", aria: { label: `${tip.title}: ${tip.caption}. ${tip.hint}` }, onclick: () => onTry?.(tip.id) }, card),
      h("p", { class: "tip-caption" }, tip.caption),
      h("p", { class: "tip-hint" }, tip.hint),
      tips.length > 1 ? h("div", { class: "tip-dots", role: "tablist", aria: { label: "Choose a tip" } }, tips.map((t, i) => h("button", { type: "button", role: "tab", class: ["tip-dot", i === index && "on"], aria: { label: t.title, selected: String(i === index) }, onclick: () => { index = i; render(true); restart(); } }))) : null);
  }

  function restart() {
    clearInterval(timer);
    if (reduce) return;
    timer = setInterval(() => {
      if (paused || document.hidden || !el.isConnected) return;
      index++;
      render(true);
    }, 8000);
  }

  el.addEventListener("mouseenter", () => (paused = true));
  el.addEventListener("mouseleave", () => (paused = false));
  el.addEventListener("focusin", () => (paused = true));
  el.addEventListener("focusout", () => (paused = false));
  render();
  restart();
  return { el };
}
