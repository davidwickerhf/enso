# 004: Unlisted signing on addons.mozilla.org, updates served by enso.wicker.life

Status: accepted in 0.5.0 (9 November 2026).

## Context

Zen, like Firefox release builds, installs only extensions signed by Mozilla,
unless the user switches signature checks off. Ensō's extension needs a native
helper that only the installer can set up, so a listing on addons.mozilla.org
(AMO) would bring people to an extension that doesn't work on its own, and
listed add-ons go through AMO's review queue for every release.

## Decision

- The release workflow signs the extension with `web-ext sign --channel
  unlisted`: AMO signs it for self-distribution without listing it.
- The workflow injects `update_url = https://enso.wicker.life/updates.json` into
  the signed build. The site generates that Firefox update manifest from its
  `releases` table, with the SHA-256 of each `.xpi`.
- The site serves the `.xpi`, the helper tarball and `/api/latest` (versions,
  URLs and checksums for the installer). CI publishes both files with a bearer
  token.

## Consequences

- People install with the signature check on; the installer opens the signed
  `.xpi` in Zen.
- Releases are not held up by listing review; unlisted submissions are still
  checked automatically by AMO.
- The update feed depends on enso.wicker.life being up and listing the add-on id
  in `EXTENSION_IDS`; the workflow checks that before signing.
- Ensō is not discoverable on AMO; the website is the only entry point.
- The same version can't be signed twice; a broken release needs a new version.
