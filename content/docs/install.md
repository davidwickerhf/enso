---
title: Install
description: Install the Ensō helper and browser extension on macOS, update them, or remove them.
order: 1
group: Start
---

# Install

Ensō needs two things on your Mac: the **local helper** and the **browser extension**. One command installs both. It takes about a minute.

## Requirements

| | |
|---|---|
| System | macOS. Linux and Windows aren't supported yet. |
| Browser | [Zen](https://zen-browser.app). Firefox 139 or newer works too, without Zen's spaces. |
| Node.js | 18 or newer (`node --version`). |
| Engine | [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup) installed and signed in, **or** an Anthropic API key. See [Engines](/docs/engines). |

## 1. Run the installer

In Terminal:

```sh
curl -fsSL https://enso.wicker.life/install.sh | bash
```

It prints each step as it goes:

1. checks that you are on macOS and that Node.js 18 or newer is installed;
2. checks for Claude Code and, if it is missing, tells you how to install it (you can continue and use an API key instead);
3. downloads the latest helper from this site (`/api/latest`) and checks its SHA-256; nothing is installed if it doesn't match;
4. installs it in `~/Library/Application Support/Enso/helper` (your data and `config.local.json` in that folder are left alone);
5. writes the `enso` command to `~/Library/Application Support/Enso/bin/enso`, and links it as `~/.local/bin/enso` when that folder exists;
6. registers the helper with Zen and Firefox (a file called `enso.json` in `~/Library/Application Support/zen/NativeMessagingHosts/` and `…/Mozilla/NativeMessagingHosts/`);
7. if Claude Code is installed, asks whether Claude Code may use Zen (see [other agents](/docs/other-agents));
8. opens the signed extension in Zen.

It is safe to run again: that is also how you update the helper. Nothing is installed outside your home folder and it never asks for your password.

> Prefer to read it first? `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then `bash install.sh`.

## 2. Add the extension

Zen asks whether to add Ensō and lists the permissions it needs; click **Add**. (Or [download the extension](/releases/enso-latest.xpi) in Zen yourself.)

The extension is signed by Mozilla for self-distribution, so it installs with signature checks on. It updates itself from this site.

If Zen was already open, quit it fully (<kbd>⌘Q</kbd>) and open it again, so it finds the helper.

### Why it asks for these permissions

| Permission | Used for |
|---|---|
| Access your data for all websites | Reading the current page when you ask about it, acting on pages when you ask, the [developer tools](/docs/session-access) |
| Exchange messages with programs other than Firefox | Talking to the local helper |
| Access browser tabs, tab groups | Mentioning tabs, listing, opening, grouping and closing tabs by chat |
| Access browsing history, bookmarks | Suggestions in the new-tab box; searching history when you ask |
| Replace the new tab and home page | The search-or-ask box |
| Cookies, containers | Knowing which [Zen space](/docs/spaces) a tab is in; requests with your session on sites you allow |
| Monitor requests | The network log Claude can read when you debug a page |

## 3. Open it

Press <kbd>⌘E</kbd> for the sidebar, or open a new tab. The first time, Ensō asks your name, a few lines about you and, if you use Zen spaces, what each space is for. **Skip for now** leaves them empty; change them later in **Settings → Profile**.

The first answer after starting Zen takes a few seconds longer while Ensō warms up.

## Updating

- **The extension** updates itself from this site. If a new version needs a new permission, Zen asks first.
- **The helper**: run the install command again, then quit and reopen Zen. It replaces the program files and keeps your settings and data.

Check the versions in **Add-ons and themes** and with `cat ~/Library/Application\ Support/Enso/helper/VERSION`.

## Uninstalling

1. Remove the extension in *Add-ons and themes*.
2. In Terminal:

```sh
enso mcp uninstall     # if you let other agents use Zen
rm -rf ~/Library/Application\ Support/Enso
rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/enso.json
rm -f ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json
rm -f ~/.local/bin/enso
```

3. Your conversations, memory and settings were in that same `Enso` folder, so they are gone too. If you used them, also remove the API key (`security delete-generic-password -s enso-anthropic`) and a saved GitHub token (`security delete-generic-password -s enso-github`).
