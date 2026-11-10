// Which build of Ensō this is (channel.js, written by scripts/build-extension.mjs):
//   listed    Firefox Add-ons build (addons.mozilla.org): no page_eval
//   unlisted  Direct download build from enso.wicker.life: includes page_eval
//   dev       Development build (the source folder): includes page_eval
// The mock can pretend with ?channel=listed | unlisted | dev.

import "../channel.js";

const fromQuery = () => {
  try {
    if (globalThis.browser?.runtime?.id) return null; // the real extension: channel.js decides
    return new URLSearchParams(globalThis.location?.search ?? "").get("channel");
  } catch { return null; }
};

export const CHANNEL = (c => (["listed", "unlisted", "dev"].includes(c) ? c : "dev"))(fromQuery() ?? globalThis.ENSO_CHANNEL);
export const PAGE_EVAL = CHANNEL !== "listed";

export const EDITION = {
  listed: { name: "Firefox Add-ons build", detail: "From addons.mozilla.org, which keeps it up to date. It has no developer tool that runs JavaScript in pages." },
  unlisted: { name: "Direct download build", detail: "Includes developer tools that run JavaScript in pages (page_eval). Updates come from enso.wicker.life." },
  dev: { name: "Development build", detail: "Loaded from the source folder. Includes developer tools that run JavaScript in pages (page_eval)." },
}[CHANNEL];

export const PAGE_EVAL_NOTE = "Running JavaScript in pages (page_eval) isn't available in the Firefox Add-ons build. The direct download from enso.wicker.life has it.";
