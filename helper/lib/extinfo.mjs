// What the connected extension says about itself (`extension.hello`, sent by
// background.js each time it connects): its version, build channel and
// capabilities. The build listed on addons.mozilla.org ("listed") can't run
// page_eval (scripts/build-extension.mjs strips it), so the tool is hidden from
// agents and refused with a clear error when that build is connected.
// Until an extension has said anything (an older extension, or none yet),
// page_eval stays available, as before.

let info = null;

export const PAGE_EVAL_UNAVAILABLE =
  "page_eval is not available in the Firefox Add-ons build of Ensō: that build doesn't evaluate JavaScript. Use page_read, devtools_console, devtools_network or page_storage instead; page_eval exists only in the self-distributed build from enso.wicker.life.";

/** From an `extension.hello` message: { version, channel, capabilities: { pageEval } }. */
export function setExtensionInfo(msg = {}) {
  const channel = ["listed", "unlisted", "dev"].includes(msg.channel) ? msg.channel : "unknown";
  const caps = msg.capabilities && typeof msg.capabilities === "object" ? msg.capabilities : {};
  info = { version: String(msg.version ?? "").slice(0, 40), channel, capabilities: { pageEval: channel !== "listed" && caps.pageEval !== false } };
  return info;
}

export const extensionInfo = () => info;
export const resetExtensionInfo = () => void (info = null);

/** Whether the connected extension can run page_eval. */
export const pageEvalAvailable = () => info?.capabilities.pageEval !== false;

/** Tools the connected extension can't run (names), for tools/list and the chat engines. */
export const unavailableTools = () => (pageEvalAvailable() ? [] : ["page_eval"]);

export function requirePageEval() {
  if (!pageEvalAvailable()) throw new Error(PAGE_EVAL_UNAVAILABLE);
}
