// The address-bar setting and the browser calls around it, for Ensō's pages.
// Routing rules live in ./route.js (shared with background.js). The setting is
// storage.local "addressBar": { mode: "enso" | "web" | "choose", engine, lastChoice }.
// Outside the extension (the dev mock) it lives in localStorage and the engines are fake.

import "./route.js";

export const R = globalThis.ensoRoute;
const ext = globalThis.browser?.storage?.local ? globalThis.browser : null;
const LS_KEY = "enso.addressBar";

const MOCK_ENGINES = ["Google", "DuckDuckGo", "Bing", "Wikipedia (en)", R.ENGINE_NAME];

export async function getPrefs() {
  let saved = null;
  if (ext) saved = (await ext.storage.local.get("addressBar").catch(() => ({}))).addressBar;
  else try { saved = JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { /* ignore */ }
  return { mode: R.DEFAULT_MODE, engine: null, lastChoice: null, ...(saved ?? {}) };
}

export async function setPrefs(patch) {
  const next = { ...(await getPrefs()), ...patch };
  if (ext) await ext.storage.local.set({ addressBar: next });
  else try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** browser.search.get(): [{ name, isDefault }]. The mock makes Ensō default unless enso.mockEnsoDefault is "0". */
export async function listEngines() {
  if (ext?.search?.get) return ext.search.get().catch(() => []);
  let ensoDefault = true;
  try { ensoDefault = localStorage.getItem("enso.mockEnsoDefault") !== "0"; } catch { /* ignore */ }
  return MOCK_ENGINES.map(name => ({ name, isDefault: ensoDefault ? name === R.ENGINE_NAME : name === "Google" }));
}

/** { mode, engine (resolved, never Ensō), engines (names, without Ensō), ensoIsDefault, lastChoice } */
export async function addressBarState() {
  const [prefs, all] = await Promise.all([getPrefs(), listEngines()]);
  return {
    ...prefs,
    engine: R.pickEngine(all, prefs.engine),
    engines: all.filter(e => e.name !== R.ENGINE_NAME).map(e => e.name),
    ensoIsDefault: all.find(e => e.isDefault)?.name === R.ENGINE_NAME,
  };
}

/** Search the web in this tab with the chosen engine (never Ensō). */
export async function webSearch(query, engine) {
  if (ext?.search?.search) {
    const self = await ext.tabs.getCurrent?.().catch(() => null);
    return ext.search.search({ query, ...(engine && { engine }), ...(self?.id != null && { tabId: self.id }) });
  }
  (globalThis.__ensoMockNav ??= []).push({ action: "search", query, engine });
  console.info("[mock browser]", { action: "search", engine });
}

/**
 * Call once at boot, before anything rewrites the hash: newtab.html#urlbar means
 * this page was opened for an address-bar query. Strips the hash and returns
 * { raw } (raw: the mock's #urlbar=<query>), or null.
 */
export function readUrlbarHash() {
  const m = location.hash.match(/^#urlbar(?:=(.*))?$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  let raw = "";
  try { raw = decodeURIComponent(m[1] ?? ""); } catch { raw = m[1] ?? ""; }
  return { raw };
}

/**
 * What to do with that query: { query, to: "enso" | "web" | "choose", forced, mode,
 * engine, ensoIsDefault, lastChoice }, or null. In the extension background.js
 * routed it and hands it over; in the mock it is routed here with the saved setting.
 */
export async function takeUrlbarQuery(hash) {
  if (!hash) return null;
  if (ext?.runtime?.sendMessage) return ext.runtime.sendMessage({ ensoUrlbar: "take" }).catch(() => null);
  const st = await addressBarState();
  const r = R.route(hash.raw, st.mode, { ensoIsDefault: st.ensoIsDefault });
  return { query: r.text, to: r.to, forced: r.forced, mode: st.mode, engine: st.engine, ensoIsDefault: st.ensoIsDefault, lastChoice: st.lastChoice };
}
