---
title: Install
description: Add the extension, run one command, and finish setup with buttons in Ensō. Updating and removing it.
order: 1
group: Start
---

# Install in two steps

Ensō has two parts: the **browser extension** and a small **helper** program that runs on your Mac. You install the extension, run one command, and do everything else with buttons in Ensō.

> **Ensō needs a Mac.** The helper runs on macOS only for now. Windows and Linux support is planned. On Linux or Windows the extension installs, but chat, memory, history, settings and tools don't work without the helper (the new tab's search box, clock, quick links and note do). Follow the work on [GitHub](https://github.com/davidwickerhf/enso).

## Requirements

| | |
|---|---|
| System | **macOS only for now.** Windows and Linux support is planned; the installer stops with that message on other systems. |
| Browser | [Zen](https://zen-browser.app). Firefox 139 or newer works too, without Zen's spaces. |
| Engine | Your Claude subscription (through Claude Code) **or** an Anthropic API key. Both are set up from Ensō afterwards; see [Engines](/docs/engines). |

Nothing else has to be installed first. If your Mac has no Node.js 18 or newer, the installer fetches Ensō's own copy.

## 1. Add the extension

[Download the extension](/releases/enso-latest.xpi) in Zen. Zen asks whether to add Ensō and lists the permissions it needs ([what each one is for](#why-it-asks-for-these-permissions)); click **Add**.

The extension is signed by Mozilla, so it installs with signature checks on, and it updates itself (from addons.mozilla.org since 0.5.5).

## 2. Run one command

Press <kbd>⌘E</kbd>. Ensō sees that its helper isn't there yet and shows the command with a **Copy** button:

```sh
curl -fsSL https://enso.wicker.life/install.sh | bash
```

Open Terminal (<kbd>⌘ Space</kbd>, type *Terminal*, <kbd>Return</kbd>), paste the command and press <kbd>Return</kbd>. Ensō waits and continues by itself once the helper is installed; you don't need to restart Zen.

**Why a terminal step?** Browsers don't let an extension install or start a program: the helper has to be on disk and registered before the extension can talk to it. An extension can't open Terminal for you either, so this is the one step you do by hand.

What the command does:

1. checks that you are on macOS and looks for Node.js 18 or newer. If there is none, it downloads Node.js 24 from nodejs.org (about 27 MB, 130 MB unpacked) into `~/Library/Application Support/Enso/runtime`, after checking it against a SHA-256 pinned in the script;
2. downloads the latest helper from this site (`/api/latest`) and checks its SHA-256; nothing is installed if it doesn't match;
3. installs it in `~/Library/Application Support/Enso/helper` (your data and `config.local.json` in that folder are left alone);
4. writes the `enso` command to `~/Library/Application Support/Enso/bin/enso`, and links it as `~/.local/bin/enso` when that folder exists;
5. registers the helper with Zen and Firefox (a file called `enso.json` in `~/Library/Application Support/zen/NativeMessagingHosts/` and `…/Mozilla/NativeMessagingHosts/`);
6. writes `install.json` next to it (versions and paths, which Setup shows) and prints a short summary;
7. opens the extension in Zen if no Zen profile has it yet.

It never asks questions and never asks for your password. Nothing is installed outside your home folder. It is safe to run again; that is also how the helper updates (Setup does it for you).

> Prefer to read it first? `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then `bash install.sh`.

If the guide says the helper **didn't start**, run the same command again: it repairs the install (for example after you removed the Node.js it was using).

## 3. Finish in Setup

Once the helper is connected, Ensō asks your name, a few lines about you and, if you use Zen spaces, what each space is for. **Skip for now** leaves them empty; change them later in **Settings → Profile**.

Then it opens **Settings → Setup**, a checklist the helper keeps up to date. Each item has a button:

| Item | What the button does |
|---|---|
| **Helper** | Shows the installed version. **Update** runs the installer in the background and restarts the helper. |
| **Claude** | Choose your subscription or an API key. **Install Claude Code** and **Sign in** open Terminal with Anthropic's installer or `claude auth login`; Setup notices when you're done. An API key goes from a password field straight into your Keychain. |
| **Use Zen from your agents** | A switch each for Claude Code, Codex, Cursor and OpenCode (the ones found on your Mac), a **Read only** switch, and the **Claude Code hook** that delivers screenshots to an idle session. See [other agents](/docs/other-agents). |
| **Send screenshots to T3 Code** | **Connect** or **Disconnect**, when T3 Code is installed. See [screenshots](/docs/screenshots). |
| **GitHub** | Shows whether the GitHub CLI is signed in. **Sign in with gh** opens `gh auth login` in Terminal, or paste a token. |
| **Tools** | Opens the [Tools](/docs/tools) page for claude.ai connectors and servers that need a sign-in. |
| **Agent access token** | **Rotate** replaces the token agents use to reach Zen. |

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

Press <kbd>⌘E</kbd> for the sidebar, or open a new tab. The first answer after starting Zen takes a few seconds longer while Ensō warms up.

## Updating

- **The extension** updates itself from this site. If a new version needs a new permission, Zen asks first.
- **The helper**: **Settings → Setup → Update** when a new version is out (or `enso update`, or the install command again). It replaces the program files, keeps your settings and data, and Ensō reconnects by itself.

Check the versions in **Add-ons and themes** and in **Settings → Setup** (or `enso setup`).

## Uninstalling

1. Remove the extension in *Add-ons and themes*.
2. In Terminal:

```sh
enso mcp uninstall     # if you let other agents use Zen (or turn them off in Setup first)
rm -rf ~/Library/Application\ Support/Enso
rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/enso.json
rm -f ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json
rm -f ~/.local/bin/enso
```

3. Your conversations, memory and settings were in that same `Enso` folder, so they are gone too. If you used them, also remove the API key (`security delete-generic-password -s enso-anthropic`) and a saved GitHub token (`security delete-generic-password -s enso-github`).
