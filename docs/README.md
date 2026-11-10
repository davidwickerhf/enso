# Ensō documentation

Start with the [project README](../README.md) for what Ensō is and how to
install it. New to the code: read [architecture.md](architecture.md), then
[development.md](development.md). Cutting a release: [releasing.md](releasing.md).
Using Ensō rather than working on it: the [help guides](../site/content/docs/) or
<https://enso.wicker.life/docs>.

## Names

Ensō was called **Zen Chat** until 0.5.0 (9 November 2026), when it moved out of
a personal configuration repository into this one. Some old names remain on
purpose:

| Still called zen-chat | Why |
|---|---|
| `~/Library/Application Support/zen-chat/` (macOS) | Read once by the migration on first start ([data-model.md](data-model.md#the-zen-chat-migration)). |
| Secret store item `zen-chat-anthropic` | Read when `enso-anthropic` is missing. |
| `ZEN_CHAT_DATA`, `ZEN_CHAT_MCP_PORT` | Still read, after `ENSO_DATA` and `ENSO_MCP_PORT`. |
| Add-on id `zen-chat@wicker.life` in the site's `EXTENSION_IDS` | Pre-release builds; can be dropped. |

## For developers and maintainers

| Page | What it covers |
|---|---|
| [Architecture](architecture.md) | The extension's pages, background.js, the page agent, native messaging, the helper's modules, both engines and warm sessions, the tool set, OAuth connections, the MCP server and launcher, dashboard, tasks, GitHub, headless Zen and Marionette, Zen spaces, data flow, ports and environment variables. With Mermaid diagrams. |
| [Data model](data-model.md) | Every file in the data folder (per OS), conversation events, the activity log, settings keys, the `config.local.json` overlay, secret store items, files outside the data folder (including Claude Code's transcripts), extension `localStorage`, the Zen Chat migration, deleting data. |
| [Security](security.md) | Threat model, trust boundaries, the permissions model (`requested_by_user`, `irreversible`, approvals per caller), private sites, session access, external control, the MCP server's defences, secrets, OAuth, what is never returned, known limits. |
| [Privacy](privacy.md) | What is stored, what leaves the computer and when, and open points against the published privacy policy. |
| [MCP](mcp.md) | Using Zen from Claude Code, Codex, Cursor and others: `enso mcp install/status/rotate/uninstall`, `--read-only`, `--client`, other clients, the 44-tool reference, etiquette, troubleshooting. |
| [Development](development.md) | Requirements, `scripts/dev.sh`, unsigned installs, the mock UI, tests and CI, debugging the helper, Marionette, conventions, recipes. |
| [Releasing](releasing.md) | Versions, tags, the release workflow, unlisted AMO signing, the site's `/updates.json` and `/api/latest`, how copies update, the installer copy on the site. |
| [Protocol](PROTOCOL.md) | The message contract between the UI, background.js and the helper, the page and browser actions, the MCP server's tokens and client identity. |

## For people using Ensō

User guides, one per topic. They are the source for the site's help pages.

| Guide | What it covers |
|---|---|
| [Getting started](../site/content/docs/install.md) | Requirements, install, permissions, first run, engines, updating, uninstalling. |
| [The sidebar and the new tab](../site/content/docs/sidebar.md) | Where Ensō shows up, what goes with a message, skills, approvals, the new-tab box, history, the brief, memory, shortcuts. |
| [Widgets](../site/content/docs/widgets.md) | Every widget, editing the layout, Tasks and GitHub. |
| [Connecting tools](../site/content/docs/tools.md) | claude.ai connectors, the Connect button and OAuth, Claude Code's servers, GitHub across orgs, API-key servers. |
| [Spaces and containers](../site/content/docs/spaces.md) | What follows the Zen space and how detection works; DRM and logins after migrating. |
| [Session access and developer tools](../site/content/docs/session-access.md) | Console, network, JavaScript, storage, requests with your session, the headless Zen. |
| [Using Ensō from other agents](../site/content/docs/other-agents.md) | Claude Code, Codex and Cursor through `enso mcp`. |
| [Troubleshooting](../site/content/docs/troubleshooting.md) | The helper, Claude Code, keys, updates, tools, pages, streaming sites. |

## Decisions and plans

Records say why something was built the way it is; the pages above say how it
works now. Plans (in `plans/`, when there are any) describe work that isn't built yet.

| Page | What it covers |
|---|---|
| [CHANGELOG.md](../CHANGELOG.md) | What changed in each release, and the Zen Chat history before 0.5.0. |
| [001: Local MCP server](records/001-local-mcp-server.md) | Why `zen-browser` runs inside the helper on loopback instead of a hosted server. |
| [002: Stdio launcher](records/002-stdio-launcher.md) | Why clients start `enso mcp` instead of calling HTTP with a token. |
| [003: Subscription engine](records/003-subscription-engine-agent-sdk.md) | Why the default engine runs the Agent SDK on the user's own `claude`. |
| [004: Unlisted AMO signing](records/004-unlisted-amo-signing.md) | Why the extension was signed unlisted and updated from enso.wicker.life (0.5.0–0.5.4; the site still serves that update feed). |
| [007: Listed on AMO](records/007-listed-amo-channel.md) | Why releases are listed on addons.mozilla.org from 0.5.5, and how self-hosted copies move over. |
| [005: MIT licence](records/005-mit-licence.md) | Why MIT. |
| [006: Agent presence and steering](records/006-agent-presence-and-steering.md) | Why external agents get sessions, why steering rides on tool results, what Pause holds, and how Zen's tab list shows an acting agent. |
