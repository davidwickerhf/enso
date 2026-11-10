---
title: Install
description: Add the extension, run one command, and finish setup with buttons in Ensō. Updating and removing it.
order: 1
group: Start
---

# Install in two steps

Ensō has two parts: the **browser extension** and a small **helper** program that runs on your computer. You install the extension, run one command, and do everything else with buttons in Ensō.

The helper runs on macOS, Linux and Windows. On other systems the extension installs, but chat, memory, history, settings and tools don't work without the helper (the new tab's search box, clock, quick links and note do).

## Requirements

| | |
|---|---|
| System | macOS; Linux (x86_64, arm64); Windows 10 or 11 (x64, arm64). |
| Browser | [Zen](https://zen-browser.app). Firefox 139 or newer works too, without Zen's spaces. |
| Engine | Your Claude subscription (through Claude Code) **or** an Anthropic API key. Both are set up from Ensō afterwards; see [Engines](/docs/engines). |

Nothing else has to be installed first. If there is no Node.js 18 or newer, the installer fetches Ensō's own copy (Node.js 24.22.2). On Linux, unpacking that copy needs `xz` (the `xz-utils` package on most systems); with Node 18+ already installed it isn't needed.

Zen and Firefox installed as a Flatpak or Snap are untested. They run in a sandbox and may only reach the helper through the browser's native-messaging portal; the regular download or your distribution's package works.

## 1. Add the extension

Pick one of the [two builds](#two-builds): **Get it for Firefox** on the [home page](/#install) (recommended), or the [direct download](/releases/enso-latest.xpi) if you want `page_eval` for debugging. Zen asks whether to add Ensō and lists the permissions it needs ([what each one is for](#why-it-asks-for-these-permissions)); click **Add**.

Both are signed by Mozilla, so they install with signature checks on, and both update themselves.

## Two builds

The same Ensō, built two ways. Everything else (chat, the new tab, memory, agents, the helper) is identical.

| | Firefox Add-ons | Direct download |
|---|---|---|
| From | addons.mozilla.org | [this site](/releases/enso-latest.xpi) |
| Versions | 0.5.7 | 0.5.7.1 |
| Updates | from Mozilla, after review | from this site |
| `page_eval` | no | yes |

`page_eval` lets agents run JavaScript in your pages to debug them. Firefox Add-ons versions have three parts, direct download versions four.

`page_query` and `page_inspect`, which answer most debugging questions (which elements match a selector, why one is hidden or covered) without running code, are in both. Until the listing on addons.mozilla.org is public, **Get it for Firefox** gives you the direct download.

**Which one you have:** **Settings → Setup → This copy of Ensō** says "Firefox Add-ons build", "Direct download build" or "Development build".

**Switching:** remove Ensō in Zen (**Settings → Extensions & Themes**, or `about:addons`, then **Remove**), then install the other build. Your settings, conversations and memory live in the helper's folder on your computer, not in the extension, so they are kept; you don't need to run the install command again. Two settings live in the extension itself and go back to their defaults: **Type straight into Ensō on new tabs** and **Search suggestions while typing**.

## 2. Run one command

Press <kbd>⌘E</kbd> on macOS or <kbd>Ctrl+E</kbd> on Linux and Windows. Ensō sees that its helper isn't there yet and shows the command for your system with a **Copy** button.

On macOS and Linux:

```sh
curl -fsSL https://enso.wicker.life/install.sh | bash
```

On macOS, open Terminal (<kbd>⌘ Space</kbd>, type *Terminal*, <kbd>Return</kbd>). On Linux, open your terminal app (often <kbd>Ctrl+Alt+T</kbd>). Paste the command (<kbd>⌘V</kbd> in Terminal, <kbd>Ctrl+Shift+V</kbd> in most Linux terminals) and press <kbd>Return</kbd>.

On Windows:

```powershell
irm https://enso.wicker.life/install.ps1 | iex
```

Open PowerShell (<kbd>Win</kbd>, type *PowerShell*, <kbd>Enter</kbd>), paste the command and press <kbd>Enter</kbd>. Windows PowerShell 5.1, which comes with Windows, and PowerShell 7 both work.

Ensō waits and continues by itself once the helper is installed; you don't need to restart Zen.

**Why a terminal step?** Browsers don't let an extension install or start a program: the helper has to be on disk and registered before the extension can talk to it. An extension can't open a terminal for you either, so this is the one step you do by hand.

What the command does:

1. checks your system and looks for Node.js 18 or newer. If there is none, it downloads Node.js 24.22.2 from nodejs.org (about 30 MB) into the `runtime` folder of Ensō's data folder (below), after checking it against a SHA-256 pinned in the script;
2. downloads the latest helper for your system from this site (`/api/latest`) and checks its SHA-256; nothing is installed if it doesn't match;
3. installs it in the `helper` folder of Ensō's data folder (your data and `config.local.json` in that folder are left alone);
4. writes the `enso` command and puts it on your PATH;
5. registers the helper with Zen and Firefox;
6. writes `install.json` next to it (versions and paths, which Setup shows) and prints a short summary;
7. opens the extension in Zen if no Zen profile has it yet.

Where things go:

| | macOS | Linux | Windows |
|---|---|---|---|
| Data folder (helper, Node, your data) | `~/Library/Application Support/Enso` | `~/.local/share/enso` (or `$XDG_DATA_HOME/enso`) | `%APPDATA%\Enso` |
| `enso` command | `Enso/bin/enso`, linked as `~/.local/bin/enso` when that folder exists | `enso/bin/enso`, linked as `~/.local/bin/enso` | `%APPDATA%\Enso\bin\enso.cmd`, added to your user PATH |
| Registration with Zen and Firefox | `enso.json` in `~/Library/Application Support/zen/NativeMessagingHosts/` and `…/Mozilla/NativeMessagingHosts/` | `enso.json` in `~/.mozilla/native-messaging-hosts/` and `~/.zen/native-messaging-hosts/` | the registry key `HKCU\Software\Mozilla\NativeMessagingHosts\enso`, pointing at `%APPDATA%\Enso\enso.json` |
| Log | `~/Library/Logs/Enso/helper.log` | `~/.local/state/enso/helper.log` (or `$XDG_STATE_HOME/enso`) | `%LOCALAPPDATA%\Enso\Logs\helper.log` |

It never asks questions and never asks for your password or administrator rights. Nothing is installed outside your home folder (your user profile on Windows). It is safe to run again; that is also how the helper updates (Setup does it for you). On Windows, open a new terminal before you type `enso`, so it sees the new PATH.

> Prefer to read it first? On macOS and Linux: `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then `bash install.sh`. On Windows: `irm https://enso.wicker.life/install.ps1 -OutFile install.ps1`, read it, then `powershell -ExecutionPolicy Bypass -File install.ps1`.

Both installers read a few optional environment variables:

| Variable | Effect |
|---|---|
| `ENSO_NODE=private` | Always use Ensō's own Node.js. `ENSO_NODE=system` never downloads one. |
| `ENSO_REGISTER_MCP=1` | Also let Claude Code use Zen straight away (otherwise turn it on in Setup). |
| `ENSO_NO_OPEN=1` | Don't open the extension in Zen at the end. |
| `ENSO_NO_PATH=1` | Windows only: don't add the `enso` command to your user PATH. |

On macOS and Linux set them in front of `bash` (`curl -fsSL https://enso.wicker.life/install.sh | ENSO_NODE=private bash`); in PowerShell, run `$env:ENSO_NO_PATH = "1"` first.

If the guide says the helper **didn't start**, run the same command again: it repairs the install (for example after you removed the Node.js it was using).

## 3. Finish in Setup

Once the helper is connected, Ensō asks your name, a few lines about you and, if you use Zen spaces, what each space is for. **Skip for now** leaves them empty; change them later in **Settings → You & memory**.

Then it opens **Settings → Setup**, which the helper keeps up to date. A dot on **Settings** means something there, or in Connections or Agents, needs you. Each item has a button:

| Where | Item | What the button does |
|---|---|---|
| **Setup** | **Helper** | Shows the installed version. **Update** runs the installer in the background and restarts the helper. |
| **Setup** | **Claude** | **Install Claude Code** and **Sign in** open a terminal window (Terminal on macOS, PowerShell on Windows, your terminal app on Linux) with Anthropic's installer or `claude auth login`; Setup notices when you're done. With the API-key engine (**General → Engine**), the key goes from a password field straight into your system's secret store (the Keychain on macOS, Credential Manager on Windows, the keyring on Linux). |
| **Setup** | **Where Ensō keeps things** | The data folder, the log folder and the secret store, as the helper reports them, with a warning on Linux when there is no keyring. |
| **Agents & screenshots** | **Agents that can use Zen** | A switch each for Claude Code, Codex, Cursor and OpenCode (the ones found on your computer), **Register read only**, and the **Claude Code hook** that delivers screenshots to an idle session. See [other agents](/docs/other-agents). |
| **Connections** | **T3 Code** | **Connect** or **Disconnect**. See [screenshots](/docs/screenshots). |
| **Connections** | **GitHub** | Shows whether the GitHub CLI is signed in. **Sign in with gh** opens `gh auth login` in a terminal window, or paste a token. |
| **Connections** | **Tools** | **Manage** opens the [Tools](/docs/tools) page for claude.ai connectors and servers that need a sign-in. |
| **Agents & screenshots** | **Agent access token** | **Rotate** replaces the token agents use to reach Zen. |

Only Claude is needed to chat; everything else is optional. The same checks run in a terminal with `enso setup`, and every button has a command: `enso update`, `enso mcp install`, `enso t3 connect`, `enso mcp rotate`.

## Why it asks for these permissions

| Permission | Used for |
|---|---|
| Access your data for all websites | Reading the current page when you ask about it, acting on pages when you ask, the [developer tools](/docs/session-access) |
| Exchange messages with programs other than Firefox | Talking to the local helper |
| Access browser tabs, tab groups | Mentioning tabs, listing, opening, grouping and closing tabs by chat |
| Access browsing history, bookmarks | Suggestions in the new-tab box; searching history when you ask |
| Replace the new tab and home page | The search-or-ask box |
| Cookies, containers | Knowing which [Zen space](/docs/spaces) a tab is in; requests with your session on sites you allow |
| Monitor requests | The network log Claude can read when you debug a page |

## Open it

Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and Windows) for the sidebar, or open a new tab. The first answer after starting Zen takes a few seconds longer while Ensō warms up.

## Updating

- **The extension** updates itself: the Firefox Add-ons build from addons.mozilla.org, the direct download build from this site. If a new version needs a new permission, Zen asks first.
- **The helper**: **Settings → Setup → Update** when a new version is out (or `enso update`, or the install command again). It replaces the program files, keeps your settings and data, and Ensō reconnects by itself.

Check the versions in **Add-ons and themes** and in **Settings → Setup** (or `enso setup`).

## Uninstalling

1. Remove the extension in *Add-ons and themes*.
2. If you let other agents use Zen, run `enso mcp uninstall` (or turn them off in Setup first).
3. Remove the helper and its registration. On macOS, in Terminal:

```sh
rm -rf ~/Library/Application\ Support/Enso ~/Library/Logs/Enso
rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/enso.json
rm -f ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json
rm -f ~/.local/bin/enso
```

On Linux:

```sh
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/enso" "${XDG_STATE_HOME:-$HOME/.local/state}/enso"
rm -f ~/.mozilla/native-messaging-hosts/enso.json ~/.zen/native-messaging-hosts/enso.json
rm -f ~/.local/bin/enso
```

On Windows, in PowerShell (quit Zen first, so the helper isn't running):

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\Enso", "$env:LOCALAPPDATA\Enso"
Remove-Item -Force "HKCU:\Software\Mozilla\NativeMessagingHosts\enso"
```

Then remove `%APPDATA%\Enso\bin` from your user PATH (Settings → System → About → Advanced system settings → Environment Variables).

4. Your conversations, memory and settings were in that same `Enso` folder, so they are gone too. If you used them, also remove the API key (`enso-anthropic`) and a saved GitHub token (`enso-github`) from your secret store: on macOS `security delete-generic-password -s enso-anthropic`, on Linux `secret-tool clear service enso-anthropic`, on Windows `cmdkey /delete:enso-anthropic` (and the same with `enso-github`).
