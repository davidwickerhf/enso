// When to suggest making Ensō Zen's default search engine (views/defaultengine.js).
// Pure functions, no browser APIs, so Node can test them (helper/test/nudge.test.mjs).
//
// Firefox lets an add-on ask to become the default engine only at install
// (manifest search_provider.is_default: Firefox's own Yes/No prompt), never on
// an update and never silently. Everyone who installed before that, or said No,
// gets a small card on the new tab instead. Its dismissal lives in
// storage.local "searchNudge": { until: <ms epoch> } after "Not now" (30 days),
// { never: true } after "Don't ask again".
//
// A classic script like route.js: globalThis.ensoNudge in the UI
// (`import "./nudge.js"`), module.exports under Node.

(function (root) {
  const DAY = 24 * 60 * 60 * 1000;
  const SNOOZE_DAYS = 30;
  const SETTINGS_PATH = "about:preferences#search";

  /** The saved dismissal, cleaned up: { until: number | null, never: boolean }. */
  function normalize(saved) {
    const until = Number(saved?.until);
    return { until: Number.isFinite(until) && until > 0 ? until : null, never: saved?.never === true };
  }

  /**
   * Whether the new-tab card shows: Ensō isn't the default, the user hasn't said
   * "Don't ask again", and a "Not now" has run out. ensoIsDefault null means
   * unknown (search.get failed): don't nag.
   */
  function shouldShow({ ensoIsDefault, dismissal, now = Date.now() } = {}) {
    if (ensoIsDefault !== false) return false;
    const d = normalize(dismissal);
    if (d.never) return false;
    if (d.until && now < d.until) return false;
    return true;
  }

  /** What to store for a dismissal: "later" (30 days) or "never". */
  function dismiss(kind, now = Date.now()) {
    if (kind === "never") return { never: true, at: now };
    if (kind === "later") return { until: now + SNOOZE_DAYS * DAY, at: now };
    throw new Error(`Unknown dismissal ${kind}`);
  }

  /**
   * The card's state on a page: "ask" (not default), "done" (became default while
   * the card was on screen), or "hidden". Once shown, it stays to say "Done";
   * it never appears just to say so.
   */
  function cardState({ ensoIsDefault, shown, dismissal, now = Date.now() } = {}) {
    if (ensoIsDefault === true) return shown ? "done" : "hidden";
    if (shown && ensoIsDefault === false) return "ask"; // a dismissal hides it at once, in the UI
    return shouldShow({ ensoIsDefault, dismissal, now }) ? "ask" : "hidden";
  }

  const api = { DAY, SNOOZE_DAYS, SETTINGS_PATH, normalize, shouldShow, dismiss, cardState };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ensoNudge = api;
})(globalThis);
