// Which build this is: "dev" in the source, "listed" (addons.mozilla.org) or
// "unlisted" (self-distributed, enso.wicker.life) in a release. Written by
// scripts/build-extension.mjs; the listed build has no page_eval.
(function (root) {
  const CHANNEL = "dev";
  if (typeof module === "object" && module.exports) module.exports = { CHANNEL };
  else root.ENSO_CHANNEL = CHANNEL;
})(globalThis);
