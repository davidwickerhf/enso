# Ensō site: design notes

The site wears the product. Pages show Ensō working (real UI, or faithful recreations of it) instead of describing it.

## Principles

- **Product first.** The landing page leads with the new-tab box typing a site, a search and a question (`NewTabDemo.svelte`, a recreation built from the extension's own CSS, icons and copy). Every other section is a real screenshot of the extension.
- **No template furniture.** No eyebrow labels above headings, no numbered feature grids, no logo-as-hero, no placeholder art. A heading is a plain sentence.
- **Copy:** short, concrete sentences in the product's own words. No hype words, no em-dash asides.

## Type

- One family: **Schibsted Grotesk** (SIL OFL 1.1, self-hosted in `static/fonts/`, licence in `static/fonts/OFL.txt`), variable 400–900, roman and italic, latin and latin-ext subsets.
- Headings 600, tight tracking (-0.02em to -0.035em); body 17px / 1.6.
- Recreated app UI uses the app's system stack (`--ui`), never the site face, so it matches the screenshots.

## Colour

- Light ground `#f3f2ef`, dark ground `#151413`; ink `#2a2420` / `#eeeae4`. Window chrome `--paper-2`.
- Copper (`#d9643a`) appears only where the app itself uses it (inside screenshots and the demo), plus focus rings and link hover. Buttons are ink.
- `--app-*` tokens mirror `chat/extension/ui/app.css` so the demo matches the real UI in both schemes.
- Light and dark follow the system, with the header toggle overriding (`data-theme`). Screenshots ship in both schemes; `.scheme-light` / `.scheme-dark` show the matching one, and the hidden lazy image is never downloaded.

## Components

- **Window frame:** rounded 14–16px, `--paper-2` chrome, 1px rule, soft offset shadow. Used for the demo and screenshots.
- **Buttons:** 10px radius, ink fill or ghost with a rule border.
- **Install steps:** three columns, each topped by a 2px ink rule; the number sits in the step title.

## Motion

- Only the new-tab demo moves: it types into the box, selects all and types the next intent. It pauses offscreen and in hidden tabs, stops when a visitor picks an intent, and with reduced motion shows a static state. The box keeps a fixed height, so the page does not shift.

## Screenshots

- Captured from the extension UI (`zen-config/chat/extension`) on its mock host at device scale 2, with the demo data replaced by a fictional person ("Maya", "Northwind", "Code Club", `uni.edu`). Never capture real accounts or data.
- Exported as WebP into `static/screenshots/`, listed with alt text and intrinsic sizes in `src/lib/screenshots.ts`.
