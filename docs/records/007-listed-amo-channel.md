# 007: Listed on addons.mozilla.org

Status: accepted in 0.5.5 (10 November 2026). Supersedes the signing part of
[004](004-unlisted-amo-signing.md).

## Context

Since 0.5.5 the extension guides people through installing the helper itself
(the first-run guide and Settings → Setup), so an add-on installed from
addons.mozilla.org (AMO) is no longer a dead end. The repository is public, and
a listing makes Ensō findable and lets Firefox update it without our server.

AMO doesn't allow `update_url` in listed versions, version numbers are unique
across the listed and unlisted channels, and listed versions may wait for a
human review before they are signed.

## Decision

- A `v*` tag submits a **listed** version (`web-ext sign --channel listed`,
  no `update_url`), with the licence, reviewer notes and release notes from
  `amo/`. The workflow waits up to 12 minutes for the signature. Signed: it
  publishes the `.xpi` and the helper to enso.wicker.life as before. Pending:
  it ends green ("submitted, awaiting review") and publishes nothing; the
  `publish-approved` mode fetches the signed file from AMO later.
- The listing (summary, description, categories, links, privacy policy, icon,
  screenshots) lives in `amo/` and is set with `amo/amo.mjs listing` from the
  **AMO listing** workflow, so it is versioned with the code.
- Unlisted signing stays available as a manual `submit-unlisted` mode for
  emergencies.

## Consequences

- Self-hosted copies (installed from enso.wicker.life before the listing) keep
  checking `/updates.json`. Their next update is the listed `.xpi`, which has no
  `update_url`, so from then on Firefox updates them from AMO. The site keeps
  serving `/updates.json`, `/api/latest` and `/releases/enso-latest.xpi`; it
  doesn't read the file's manifest, so listed files work there unchanged.
- A release can wait on AMO's review; the helper is published together with
  the extension, so it waits too.
- An unlisted emergency release uses up its version number; the next listed
  release must be higher.
- The privacy policy is shown on AMO, so it has to match the code; changing it
  means re-running the AMO listing workflow.
