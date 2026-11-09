# Ensō

A personal assistant built into the [Zen browser](https://zen-browser.app): a
dashboard on every new tab, a chat in the sidebar that knows you and your
tools, and an agent that can read and act on web pages. It runs Claude on your
own Claude subscription (through Claude Code) or with an Anthropic API key.
Everything it remembers stays on your Mac.

Website and docs: <https://enso.wicker.life>

> **Licence:** MIT, see [LICENSE](LICENSE).

## Install

```sh
curl -fsSL https://enso.wicker.life/install.sh | bash
```

macOS only, for now. You need [Node.js](https://nodejs.org) 18 or newer and, for
the subscription engine, [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup)
signed in once (`claude`). The installer ([`scripts/install.sh`](scripts/install.sh)):

1. downloads the latest helper from `https://enso.wicker.life/api/latest`, checks its SHA-256
   and installs it into `~/Library/Application Support/Enso/helper`;
2. writes the native-messaging manifest `enso.json` (with an absolute path to your
   `node`) into `~/Library/Application Support/Mozilla/NativeMessagingHosts` and
   `~/Library/Application Support/zen/NativeMessagingHosts`;
3. offers to register the `zen-browser` MCP server with Claude Code
   (`claude mcp add-json --scope user …`), so Claude in a terminal can use your tabs;
4. opens the signed extension in Zen.

Run it again to update. On first open Ensō asks your name, a few lines about
you and (optionally) what each Zen space is for; change it later in
**Settings → Profile**.

## What's in this repo

| Path | What it is |
|---|---|
| `extension/` | The Zen/Firefox extension (id `enso@wicker.life`): `background.js`, the page agent, and the UI in `ui/` (one app in the sidebar, new tab and a full page). |
| `helper/` | The local helper Zen starts through native messaging (host name `enso`): conversations, memory, the dashboard, the Claude engines, MCP servers and the local `zen-browser` MCP server. |
| `docs/PROTOCOL.md` | The message contract between the UI, `background.js` and the helper. |
| `scripts/install.sh` | The installer above (also served at enso.wicker.life/install.sh). |
| `scripts/dev.sh` | Run Ensō from a checkout. |
| `scripts/pack-helper.sh` | Builds the helper tarball for a release. |
| `.github/workflows/` | `ci.yml` (checks on every push and PR) and `release.yml` (signs and publishes on a `v*` tag). |

## Where your data lives

`~/Library/Application Support/Enso/`:

| File | |
|---|---|
| `profile.md` | Who you are (`# Name`, then a few lines). Written by onboarding, editable in Settings. |
| `memory.md`, `memory/<space>.md` | What Ensō has learned, everywhere and per Zen space. |
| `settings.json` | Your settings (engine, model, space notes, tool toggles, …). |
| `config.local.json` | Your personal overlay on the shipped [`helper/config.json`](helper/config.json); see below. |
| `conversations/`, `actions.jsonl`, `reports/`, `dashboard.json` | History, the page-action log, reports, the last briefing. |
| `mcp-token` | Bearer token for the local `zen-browser` MCP server (`http://127.0.0.1:47823/mcp`). |
| `helper/` | The installed helper (replaced on update). |

Secrets live in the macOS Keychain: `enso-anthropic` (API key, optional),
`enso-github` (GitHub token when you don't use `gh`), `enso-mcp-<server>` (MCP sign-ins).

Upgrading from the pre-release "Zen Chat" builds: on first start the helper
copies `~/Library/Application Support/zen-chat/` into the new folder (once, when
the new folder has no conversations yet; the old folder is left as it is), and
reads the old Keychain item `zen-chat-anthropic` when `enso-anthropic` is missing.
The MCP token is copied too, so an existing `zen-browser` registration in Claude
Code keeps working.

### `config.local.json`

Personal configuration that shouldn't live in the shipped defaults. Every key is optional:

```json
{
  "servers": { "claude.ai Gmail": { "enabled": false }, "my-notes": { "enabled": true } },
  "extraServers": { "my-notes": { "type": "http", "url": "https://notes.example.com/mcp", "tokenKeychainService": "enso-notes-token" } },
  "oauthServers": { "fieldnotes": { "url": "https://fieldnotes.example.com/mcp", "label": "Fieldnotes" } },
  "catalog": { "my-notes": { "label": "Notes", "about": "My notes app.", "examples": ["What did I write about the launch?"] } },
  "spaceHints": { "Work": "My job at Northwind: Figma, Linear. Use my work accounts." },
  "sensitiveHosts": ["*.mybank.example"],
  "claudePath": "/opt/custom/bin/claude"
}
```

`servers`, `extraServers`, `oauthServers`, `catalog` and `spaceHints` merge by
name over the defaults; `sensitiveHosts` are added to the built-in list (sites
Ensō never reads or acts on). Restart the helper (quit and reopen Zen) after
editing. Space notes written in Settings → Profile take precedence over `spaceHints`.

## Engines

- **Claude subscription** (default): runs through the Claude Agent SDK on your
  installed `claude` CLI, so it uses your plan and brings your claude.ai
  connectors and Claude Code MCP servers. The helper doesn't ship its own Claude
  Code binary; it looks for `claude` on your PATH, in `~/.local/bin`,
  `~/.claude/local` and Homebrew, or at the path in Settings → Engine
  (`claudePath`). Without it, Ensō says so and the API-key engine still works.
- **API key**: `security add-generic-password -s enso-anthropic -a "$USER" -w`,
  then choose **API key** in Settings.

## Development

```sh
scripts/dev.sh --open    # helper deps, enso.json manifests pointing at this checkout, unsigned build/enso-dev.xpi, open in Zen
```

Zen installs unsigned extensions only with signature checks off:
`about:config` → `xpinstall.signatures.required` = `false` (or
`user_pref("xpinstall.signatures.required", false);` in the profile's `user.js`).
Release builds are signed and don't need this. After changing `extension/`, bump
`version` in `extension/manifest.json` and run `scripts/dev.sh --open` again;
after changing `helper/`, quit and reopen Zen. `scripts/dev.sh --mcp` registers
the `zen-browser` MCP server with Claude Code if it isn't yet.

UI without Zen: serve `extension/` (`python3 -m http.server -d extension 8000`)
and open `http://127.0.0.1:8000/full.html`, `sidebar.html` or `newtab.html`. Outside the
extension the UI talks to an in-page mock host (`extension/ui/mock.js`) with a
fictional user; add `?onboarding=1` for the first-run card.

Tests (offline; `connections` and `host-connect` store and delete test items in
the login Keychain, skip them with `ENSO_SKIP_KEYCHAIN=1`):

```sh
cd helper && npm test
ENSO_TEST_SDK=1 npm test   # also one real turn on your Claude plan
```

Useful environment variables for the helper: `ENSO_DATA` (data folder),
`ENSO_LEGACY_DATA` (old folder to migrate from), `ENSO_MCP_PORT`,
`ENSO_CLAUDE_PATH`.

## Releasing

Bump `version` in `extension/manifest.json` and `helper/package.json` (they must
match), commit, then tag:

```sh
git tag -a v0.5.0 -m "Ensō 0.5.0" && git push origin v0.5.0
```

`release.yml` checks, signs the extension on addons.mozilla.org (unlisted, with
`update_url` = `https://enso.wicker.life/updates.json`), builds the helper
tarball and publishes both to enso.wicker.life and a GitHub release. The site's
`EXTENSION_IDS` must include `enso@wicker.life`.
