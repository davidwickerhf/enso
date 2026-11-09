// Report page (report.html?id=…): a clean, printable document rendered from
// the report's Markdown, with charts, "Copy as Markdown" and "Print / PDF".

import { h, icon, clear } from "../dom.js";
import { renderMarkdown } from "../markdown.js";
import { openConversation } from "../transport.js";

export function createReport(store) {
  const { state: s, actions } = store;
  const id = new URLSearchParams(location.search).get("id");
  const toolbar = h("div", { class: "report-toolbar" });
  const doc = h("article", { class: "report-doc md", aria: { busy: "true" } });
  const el = h("main", { class: "report-page" }, toolbar, doc);
  let requested = false;

  function render() {
    const r = s.report && s.report.id === id ? s.report : null;
    if (!id) { clear(doc, h("div", { class: "empty-state" }, icon("report"), h("p", null, "No report id in the address."))); clear(toolbar); return; }
    if (!r) {
      clear(toolbar);
      clear(doc, s.ready && requested && s.report === null && store.state.reportMissing ? h("div", { class: "empty-state" }, icon("report"), h("p", null, "This report doesn't exist any more.")) : h("div", { class: "transcript-loading" }, h("div", { class: "skel w60 tall" }), h("div", { class: "skel w40" }), h("div", { class: "skel w90" }), h("div", { class: "skel w90" }), h("div", { class: "skel w75" })));
      return;
    }
    document.title = `${r.title} · Ensō report`;
    const copy = h("button", { type: "button", class: "btn ghost" }, icon("copy"), h("span", null, "Copy as Markdown"));
    copy.addEventListener("click", () => navigator.clipboard?.writeText(r.markdown).then(() => { copy.lastChild.textContent = "Copied"; setTimeout(() => (copy.lastChild.textContent = "Copy as Markdown"), 1400); }));
    clear(toolbar,
      h("span", { class: "report-brand" }, h("span", { class: "brand-mark", aria: { hidden: "true" } }), "Ensō report"),
      h("span", { class: "spacer" }),
      r.conversationId ? h("button", { type: "button", class: "btn ghost", onclick: () => openConversation(r.conversationId) }, icon("chat"), h("span", null, "Conversation")) : null,
      copy,
      h("button", { type: "button", class: "btn primary", onclick: () => window.print() }, icon("page"), h("span", null, "Print / PDF")));
    // Use the Markdown's own H1 as the title when it has one.
    const md = r.markdown ?? "";
    const m = md.match(/^\s*#\s+(.+)\n/);
    const title = m ? m[1].trim() : r.title;
    const rest = m ? md.slice(m[0].length) : md;
    clear(doc,
      h("header", { class: "report-head" },
        h("p", { class: "report-kicker" }, "Report"),
        h("h1", null, title),
        h("p", { class: "report-date" }, new Date(r.createdAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))),
      renderMarkdown(rest, { headingShift: 0 }));
    doc.setAttribute("aria-busy", "false");
  }

  return {
    el,
    update(topics) {
      if (topics.has("state") && !requested && id) { requested = true; actions.getReport(id); }
      if (topics.has("report") || topics.has("state")) render();
    },
    show: render,
  };
}
