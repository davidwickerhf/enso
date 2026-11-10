# 005: MIT licence

Status: accepted in 0.5.0 (commit 2d9c2b6, 9 November 2026).

## Context

Ensō runs with broad access on people's Macs: their browser, signed-in
sessions, mail and calendar through their tools. The extension and helper ship
as plain, unminified JavaScript (the signed `.xpi` and the helper tarball contain
the source), so anyone who installs them can read what they do; the licence
should say what they may do with it. The website's promise that "Ensō has no
server in the conversation path" is easier to trust when the code can be
checked. Ensō also has no paid tier that a restrictive licence would protect.

## Decision

The extension, helper and scripts are released under the MIT licence
([LICENSE](../../LICENSE)), copyright David Wicker.

## Consequences

- Anyone may read, change, fork and redistribute the code, including in
  commercial products, with the copyright notice kept.
- No warranty; the licence says so.
- Contributions come in under the same licence.
- The licence covers the code as distributed. At the time of writing the GitHub
  repository itself is private; making it public is a separate decision.
- The website and sync server live in `site/` since the repositories were
  merged (10 November 2026). They were never released under MIT and the licence
  file doesn't cover them: `site/` stays all rights reserved unless that is
  decided separately.
