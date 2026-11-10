# Ensō

Ensō is a personal assistant built into the [Zen browser](https://zen-browser.app).
It puts a chat in the sidebar, a search-or-ask box and widgets on every new tab,
and an agent that can read and act on web pages. It runs Claude on your own
Claude subscription (through Claude Code) or on an Anthropic API key, uses the
tools you connect (mail, calendar, GitHub, any MCP server), and keeps what it
remembers in files on your computer. Other agents on the same computer (Claude
Code, Codex, Cursor) can use Zen through it too. It runs on macOS, Linux and
Windows.

Website and user docs: <https://enso.wicker.life>. Licence: the extension, helper and scripts are MIT ([LICENSE](LICENSE)); the website and sync server in `site/` are all rights reserved ([site/LICENSE](site/LICENSE)).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://enso.wicker.life/screenshots/act-dark-1600.webp">
  <img src="https://enso.wicker.life/screenshots/act-light-1600.webp" width="800" alt="A registration form with the student number just typed in and outlined. Beside it, the Ensō sidebar lists its steps and asks before clicking Register, with Allow, Always allow and Deny.">
</picture>

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Features](#features)
- [How it is built](#how-it-is-built)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Documentation](#documentation)

## Install

The helper runs on macOS, Linux (x86_64, arm64) and Windows 10 or 11 (x64,
arm64). Two steps, in Zen or Firefox 139 or newer:

1. **Add the extension** from <https://enso.wicker.life> (signed by Mozilla, updates itself):
   the Firefox Add-ons build, or the direct download build with `page_eval`
   ([two builds](#two-builds)).
2. **Run one command.** Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and
   Windows): Ensō shows the command for your system with a Copy button, and
   moves on by itself once it has run. On macOS and Linux, in a terminal:

   ```sh
   curl -fsSL https://enso.wicker.life/install.sh | bash
   ```

   On Windows, in PowerShell (5.1 or 7):

   ```powershell
   irm https://enso.wicker.life/install.ps1 | iex
   ```

The installers ([`scripts/install.sh`](scripts/install.sh) and
[`site/static/install.ps1`](site/static/install.ps1)) download the helper
listed at `https://enso.wicker.life/api/latest`, check its SHA-256, install it
in Ensō's data folder (`~/Library/Application Support/Enso` on macOS,
`~/.local/share/enso` on Linux, `%APPDATA%\Enso` on Windows), register it with
Zen and Firefox and write the `enso` command. Without Node.js 18+, they fetch
Ensō's own Node 24.22.2 (pinned SHA-256; on Linux this needs `xz`) into the
data folder's `runtime`, so nothing has to be installed first. They ask no
questions, need no `sudo` or administrator rights and never touch your data.

A WebExtension can't install or start a native program (native messaging needs
the host's manifest on disk first), so that one command is the only manual step.
Everything after it is a button in **Settings** (Setup, Connections, Agents &
screenshots), run by the helper:
updating the helper, installing and signing in to Claude Code or storing an API
key in the system's secret store (Keychain, Credential Manager or the Linux
keyring), letting Claude Code, Codex, Cursor or OpenCode use Zen,
connecting T3 Code and GitHub, and rotating the agent token. The same checks and
actions stay available as `enso setup`, `enso update`, `enso mcp install`,
`enso t3 connect` and `enso mcp rotate`.

### Two builds

| | Firefox Add-ons build | Direct download build |
|---|---|---|
| From | addons.mozilla.org ("Get it for Firefox", recommended) | `https://enso.wicker.life/releases/enso-latest.xpi` |
| Versions | three parts (0.5.7) | four parts (0.5.7.1) |
| Updates from | addons.mozilla.org | enso.wicker.life |
| `page_eval` | not included | included |

The listed build is made by [`scripts/build-extension.mjs`](scripts/build-extension.mjs),
which removes the code between `// <unlisted-only>` markers (the page_eval
path in `extension/pageagent.js`) and fails if `eval(` or `new Function` is
left. The extension tells the helper which build it is, and the helper hides
`page_eval` from agents when it can't run. Settings → Setup shows which build
you have. To switch, remove Ensō in Zen and install the other one: settings,
conversations and memory live in the helper's data folder, so they are kept.

Step by step, with what each permission is for: [site/content/docs/install.md](site/content/docs/install.md).

## Quick start

1. Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd>) in Zen to open the sidebar. The first time, Ensō asks
   your name, a few lines about you and, optionally, what each Zen space is for,
   then opens Setup.
2. Ask something about the page you are on: "summarise this", "fill in this
   form with my address". The page is attached by default (the page chip).
3. Open a new tab. Type a site, a search or a question in the box; choose
   **Add widgets** for your calendar, tasks, mail or GitHub at a glance.
4. Optional: let other agents use Zen, in **Settings → Agents & screenshots**
   (or `enso mcp install`).

## Features

| Area | What it does | More |
|---|---|---|
| Sidebar chat | Claude next to the page, with the page, mentioned tabs (`@`), files (up to 25 MB) and screenshots as context; slash commands (`/summarize`, `/reply`, your own). | [help](site/content/docs/sidebar.md) |
| New tab | One box that opens sites, searches with your default engine, or asks Ensō; widgets you add and arrange. | [help](site/content/docs/new-tab.md) |
| Address bar | Ensō is also a search engine: make it Zen's default and what you type in the address bar (or Zen's floating bar) goes to Ensō, to your web search engine, or to a two-button chooser, as you set it. `e` asks Ensō, `g` searches the web. | [help](site/content/docs/new-tab.md#the-address-bar) |
| Widgets | Next up, Due soon, Tasks (from task apps such as Commonfold), Mail, Practice, GitHub, Clock, Recent chats, Quick links, Note, Ask. | [help](site/content/docs/widgets.md) |
| Acting on pages | Read, click, type, select, press keys, scroll, navigate, go back, screenshot. What you ask for runs; steps Claude proposes and anything irreversible ask first. | [help](site/content/docs/acting-on-pages.md) |
| Tools | claude.ai connectors and Claude Code's MCP servers (subscription engine), MCP servers Ensō signs in to itself (OAuth), and built-in GitHub across all your orgs. | [help](site/content/docs/tools.md) |
| Zen spaces | Conversations, memory, tab tools and notes per Zen space, detected from each space's container. | [help](site/content/docs/spaces.md) |
| Developer tools | Console, network log, JavaScript and storage keys of a tab; requests with your signed-in session on sites you allow; a separate headless Zen for testing. | [help](site/content/docs/session-access.md) |
| Other agents | A local MCP server, `zen-browser`, that Claude Code, Codex, Cursor and others reach through the `enso mcp` launcher. 44 tools; a read-only scope. | [docs/mcp.md](docs/mcp.md) |
| Memory and history | `profile.md` and `memory.md` you can edit, per-space memory, every conversation with its tool calls, a per-site activity log, reports with charts. | [data model](docs/data-model.md) |
| Safety | Banking, payment, password-manager, health, tax and government sites are never read or acted on; cookie values and tokens are never returned to Claude; every action is logged. | [security](docs/security.md) |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://enso.wicker.life/screenshots/sidebar-tools-dark.webp">
  <img src="https://enso.wicker.life/screenshots/sidebar-tools-light.webp" width="300" alt="The sidebar answering “What matters today?”: it searched Gmail and listed today’s events, then shows a table of the day and the mail that needs you.">
</picture>

## How it is built

Two parts, installed together:

- **The extension** (`extension/`, id `enso@wicker.life`, Manifest V2 for
  Firefox/Zen) is the interface: one app (`ui/`) shown in the sidebar, the new
  tab, a full page and report tabs. `background.js` connects to the helper and
  carries out page and browser actions; `pageagent.js` is injected into a tab
  to read it and act on it.
- **The helper** (`helper/`, Node.js 18+) is a native-messaging host (`enso`)
  that Zen starts when the extension connects. It owns all state, runs each
  chat turn on the subscription engine (Claude Agent SDK on your `claude` CLI)
  or the API engine (Messages API), signs in to MCP servers, and serves the
  `zen-browser` MCP server on `127.0.0.1:47823`.

```mermaid
flowchart LR
  UI["Extension UI<br/>sidebar · new tab · full page"] <-->|runtime port| BG[background.js]
  BG <-->|native messaging| H[helper host.mjs]
  BG -->|actions| PA[pageagent.js in the tab]
  H -->|Agent SDK| CC[claude CLI] --> A[(Anthropic)]
  H -->|API key| A
  H <-->|MCP| T[(Your tools)]
  X[Claude Code · Codex · Cursor] -->|stdio| L[enso mcp] -->|HTTP 127.0.0.1:47823| H
```

Details: [docs/architecture.md](docs/architecture.md).

## Repository layout

| Path | What it is |
|---|---|
| `extension/` | The extension: `manifest.json`, `background.js`, `pageagent.js`, the HTML entry points (`sidebar.html`, `newtab.html`, `full.html`, `report.html`, `app.html`) and the UI in `ui/` (`ui/mock.js` is an in-page mock helper for working on the UI without Zen). |
| `helper/` | The helper: `host.mjs` (message handling), `lib/` (engines, tools, MCP server, connections, storage), `bin/enso.mjs` (the `enso` command), `config.json` (shipped defaults), `test/`. |
| `docs/` | Developer documentation, decision records and plans. Start at [docs/README.md](docs/README.md). |
| `site/` | enso.wicker.life: website, help centre (`site/content/docs/`, the user guides), update feed, release downloads and sync server. SvelteKit; see [site/README.md](site/README.md). |
| `scripts/install.sh` | The macOS and Linux installer: a symlink to `site/static/install.sh`, served at `enso.wicker.life/install.sh`. The Windows installer is `site/static/install.ps1`, served at `enso.wicker.life/install.ps1`. |
| `scripts/dev.sh` | Run Ensō from this checkout. |
| `scripts/pack-helper.sh` | Build the helper tarball for a release. |
| `.github/workflows/` | `ci.yml` (checks on pushes to `main` and on pull requests) and `release.yml` (signs and publishes on a `v*` tag). |

## Development

```sh
scripts/dev.sh --open            # helper deps, manifests pointing at this checkout, unsigned build/enso-dev.xpi, open in Zen
cd helper && npm test            # offline tests
python3 -m http.server -d extension 8000   # UI on a mock helper: http://127.0.0.1:8000/full.html
```

Unsigned builds need `xpinstall.signatures.required = false` in `about:config`.
Everything else, including debugging the helper and Marionette: [docs/development.md](docs/development.md).
Releases: [docs/releasing.md](docs/releasing.md).

## Documentation

| Page | What it covers |
|---|---|
| [docs/README.md](docs/README.md) | Index of everything below. |
| [Architecture](docs/architecture.md) | The extension's pages, background.js, the page agent, native messaging, the helper's modules, data flow. |
| [Data model](docs/data-model.md) | Every file in the data folder, secret store items, extension storage, the Zen Chat migration. |
| [Security](docs/security.md) | Threat model, approvals, session access, private sites, the MCP server's defences, secrets, OAuth. |
| [Privacy](docs/privacy.md) | What stays on your computer and what leaves it, matched to the site's privacy policy. |
| [MCP](docs/mcp.md) | Using Zen from Claude Code, Codex, Cursor and others; the tool reference. |
| [Development](docs/development.md) | Setup, tests, mock UI, debugging. |
| [Releasing](docs/releasing.md) | Versions, tags, signing, the update feed. |
| [Protocol](docs/PROTOCOL.md) | The message contract between the UI, background.js and the helper. |
| [User help](site/content/docs/) | Guides for people using Ensō. |
| [CHANGELOG.md](CHANGELOG.md) | What changed in each release. |
