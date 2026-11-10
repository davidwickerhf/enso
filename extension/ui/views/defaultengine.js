// "Make the address bar Ensō's box": the card that suggests making Ensō Zen's
// default search engine, so a question typed in Zen's address bar (or its ⌘T bar
// with zen.urlbar.replace-newtab) reaches Ensō.
//
// Three places:
//   "newtab"      under the box on the new tab, with "Not now" (30 days) and
//                 "Don't ask again"; only when ./nudge.js shouldShow() says so.
//   "settings"    Settings → General → Address bar, while Ensō isn't the default.
//   "onboarding"  an optional step of the first-run card.
//
// An add-on can't change the default engine itself, and Firefox doesn't let it
// open about:preferences (tabs.create: "Illegal URL"). So the button tries, and
// otherwise shows the three steps with a Copy button for about:preferences#search.
// The card checks again when the page gets focus or becomes visible (and every few
// seconds while the steps are open), and says "Done" once Ensō is the default.

import { h, icon, clear } from "../dom.js";
import { N, ensoIsDefault, getNudge, setNudge, openSearchSettings } from "../addressbar.js";

const POLL_MS = 3000;

// Styles live in addressbar.css (shared with views/addressbar.js).
if (!document.querySelector("link[data-addressbar]")) {
  document.head.append(h("link", { rel: "stylesheet", href: new URL("../addressbar.css", import.meta.url).href, "data-addressbar": "" }));
}

const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") || /Mac OS X/.test(globalThis.navigator?.userAgent ?? "");

export function createDefaultEngineCard({ place = "newtab", onChange = () => {} } = {}) {
  const el = h("section", { class: ["de-card", `de-${place}`], hidden: true, aria: { label: "Address bar" } });
  let isDefault = null;
  let shown = false;      // the card was on screen as "ask" on this page
  let guideOpen = false;
  let dismissal = null;
  let copied = false;
  let poll = 0;
  let checking = null;

  async function check() {
    if (checking) return checking;
    checking = (async () => {
      const [d, saved] = await Promise.all([ensoIsDefault(), place === "newtab" ? getNudge() : null]);
      const changed = d !== isDefault;
      isDefault = d;
      dismissal = saved;
      render();
      if (changed) onChange(d);
    })().finally(() => { checking = null; });
    return checking;
  }

  function state() {
    if (place === "newtab") return N.cardState({ ensoIsDefault: isDefault, shown, dismissal });
    // Settings and onboarding: always while not default; "Done" once it changes here.
    if (isDefault === false) return "ask";
    return isDefault === true && shown ? "done" : "hidden";
  }

  async function dismissWith(kind) {
    await setNudge(N.dismiss(kind));
    shown = false;
    guideOpen = false;
    dismissal = N.dismiss(kind);
    stopPoll();
    el.hidden = true;
    clear(el);
  }

  async function makeDefault() {
    if (await openSearchSettings()) return; // a browser that allows it (Firefox doesn't)
    guideOpen = true;
    render();
    startPoll();
    requestAnimationFrame(() => el.querySelector(".de-copy")?.focus({ preventScroll: true }));
  }

  async function copy() {
    try { await navigator.clipboard.writeText(N.SETTINGS_PATH); copied = true; } catch { copied = false; }
    render();
    if (copied) setTimeout(() => { copied = false; if (el.isConnected) render(); }, 2400);
  }

  function startPoll() {
    stopPoll();
    poll = setInterval(() => { if (!document.hidden && el.isConnected) check(); }, POLL_MS);
  }
  function stopPoll() { clearInterval(poll); poll = 0; }

  function render() {
    const st = state();
    if (st === "hidden") { el.hidden = true; clear(el); stopPoll(); return; }
    el.hidden = false;
    el.classList.toggle("is-done", st === "done");
    if (st === "done") {
      stopPoll();
      clear(el,
        h("div", { class: "de-head" },
          h("span", { class: "de-glyph ok" }, icon("check")),
          h("div", { class: "de-text" },
            h("strong", { class: "de-title" }, "Done: the address bar goes to Ensō"),
            h("p", null, "Type a question there and Ensō answers. Start with ", h("kbd", null, "g"), " to search the web instead.")),
          place === "newtab" ? h("button", { type: "button", class: "icon-btn small de-x", title: "Close", aria: { label: "Close" }, onclick: () => { shown = false; el.hidden = true; clear(el); } }, icon("x")) : null));
      return;
    }
    shown = true;
    const tKey = isMac() ? "⌘T" : "Ctrl+T";
    clear(el,
      h("div", { class: "de-head" },
        h("span", { class: "de-glyph" }, icon("search")),
        h("div", { class: "de-text" },
          h("strong", { class: "de-title" }, "Make the address bar Ensō's box"),
          h("p", null, "Type a question in Zen's address bar or the ", h("kbd", null, tKey), " bar and Ensō answers; addresses still open directly."))),
      guideOpen ? guide() : null,
      h("div", { class: "de-actions" },
        guideOpen ? null : h("button", { type: "button", class: ["btn small de-go", place !== "onboarding" && "primary"], onclick: makeDefault }, "Make Ensō the default"),
        place === "newtab" ? h("button", { type: "button", class: "btn small ghost", onclick: () => dismissWith("later") }, "Not now") : null,
        place === "newtab" ? h("button", { type: "button", class: "link-btn de-never", onclick: () => dismissWith("never") }, "Don't ask again") : null),
      h("p", { class: "de-foot" }, "Or keep your engine: type ", h("code", null, "@enso"), " and a space before a question in the address bar."));
  }

  function guide() {
    return h("div", { class: "de-guide" },
      h("p", { class: "de-why" }, "Zen doesn't let add-ons change this or open its settings, so it's three clicks:"),
      h("ol", { class: "de-steps" },
        h("li", null, "Open Zen Settings: ", h("kbd", null, isMac() ? "⌘," : "Menu → Settings"), ", or paste ", h("code", null, N.SETTINGS_PATH), " into the address bar."),
        h("li", null, "Choose ", h("strong", null, "Search"), "."),
        h("li", null, "Under ", h("strong", null, "Default Search Engine"), ", pick ", h("strong", null, "Ensō"), ".")),
      h("div", { class: "de-copyrow" },
        h("button", { type: "button", class: ["btn small de-copy", copied && "copied"], onclick: copy },
          icon(copied ? "check" : "copy"), copied ? "Copied" : `Copy “${N.SETTINGS_PATH}”`),
        h("span", { class: "muted small" }, "then paste it into the address bar and press Enter.")),
      h("p", { class: "de-wait muted small", role: "status" }, "This card updates by itself once Ensō is the default."));
  }

  const onVisible = () => { if (!document.hidden && el.isConnected) check(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("enso:engines", onVisible); // the mock's __ensoMock.setEnsoDefault()

  check();
  return {
    el,
    check,
    get isDefault() { return isDefault; },
    get visible() { return !el.hidden; },
  };
}
