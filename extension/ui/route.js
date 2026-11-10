// Address-bar routing: where a query typed in Zen's address bar goes once it
// reaches Ensō as a search engine (manifest chrome_settings_overrides.search_provider).
// Pure functions, no browser APIs. No guessing: the user's setting decides, and a
// prefix overrides it for one query.
//
//   setting (addressBar.mode)   plain query        "e …"         "g …"
//   "enso"   (default)          Ensō chat          Ensō chat     web search
//   "web"                       web search         Ensō chat     web search
//   "choose"                    chooser on page    Ensō chat     web search
//
// "?" and "@enso " also force Ensō, and "/" forces a search, but Firefox/Zen use
// those in the address bar before the query reaches an engine ("?" enters search
// mode and is stripped, "@enso" is Ensō's keyword and is stripped, "/…" opens a
// file path), so the address bar needs "e " and "g ". They work in Ensō's box.
//
// A classic script, so background.js (manifest background.scripts) and the UI
// (`import "./route.js"`, an ES module) share one copy: it sets
// globalThis.ensoRoute, or module.exports under Node (helper/test/route.test.mjs).

(function (root) {
  const ENGINE_NAME = "Ensō";
  const MODES = ["enso", "web", "choose"];
  const DEFAULT_MODE = "enso";

  /** Strip a forcing prefix: "e ", "?" or "@enso " → enso; "g " or "/" → web. */
  function parsePrefix(raw) {
    const text = String(raw ?? "").trim();
    let m;
    if ((m = text.match(/^e\s+([\s\S]*)$/i))) return { text: m[1].trim(), force: "enso" };
    if ((m = text.match(/^\?\s*([\s\S]*)$/))) return { text: m[1].trim(), force: "enso" };
    if ((m = text.match(/^@enso(?:\s+([\s\S]*))?$/i))) return { text: (m[1] ?? "").trim(), force: "enso" };
    if ((m = text.match(/^g\s+([\s\S]*)$/i))) return { text: m[1].trim(), force: "web" };
    if ((m = text.match(/^\/\s*([\s\S]*)$/))) return { text: m[1].trim(), force: "web" };
    return { text, force: null };
  }

  /**
   * route(query, mode, { ensoIsDefault }) → { to: "enso" | "web" | "choose", text, forced }
   * When Ensō isn't the default engine, the query only got here because the user
   * picked Ensō on purpose (its @enso keyword or its one-off button), so it asks Ensō.
   */
  function route(raw, mode, { ensoIsDefault = true } = {}) {
    const { text, force } = parsePrefix(raw);
    if (force) return { to: force, text, forced: true };
    if (!ensoIsDefault) return { to: "enso", text, forced: false };
    const m = MODES.includes(mode) ? mode : DEFAULT_MODE;
    return { to: m, text, forced: false };
  }

  /**
   * The web search engine to use: the saved one if it still exists, else Google,
   * else the first engine. Never Ensō itself (that would loop back here).
   * engines: browser.search.get() → [{ name, isDefault }].
   */
  function pickEngine(engines, saved) {
    const list = (engines ?? []).filter(e => e && e.name && e.name !== ENGINE_NAME);
    return (list.find(e => e.name === saved) ?? list.find(e => /^google$/i.test(e.name)) ?? list[0])?.name ?? null;
  }

  /** The query from Ensō's search URL (https://enso.wicker.life/ask#q=…, or ?q=…). */
  function queryFromUrl(url) {
    try {
      const u = new URL(url);
      const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
      return hash.get("q") ?? u.searchParams.get("q") ?? "";
    } catch { return ""; }
  }

  /** The one-line rule shown on Ensō's page. */
  function ruleLine(mode, engine, { ensoIsDefault = true } = {}) {
    const name = engine || "the web";
    if (!ensoIsDefault) return `Ensō isn't your default search engine, so only @enso searches come here`;
    if (mode === "web") return `Address bar → ${name} · start with e to ask Ensō`;
    if (mode === "choose") return `Address bar → choose each time · start with e to ask, g to search`;
    return `Address bar → Ensō · start with g to search ${name}`;
  }

  const api = { ENGINE_NAME, MODES, DEFAULT_MODE, parsePrefix, route, pickEngine, queryFromUrl, ruleLine };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ensoRoute = api;
})(globalThis);
