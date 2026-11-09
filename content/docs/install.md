---
title: Install
description: Install the Ensō helper and browser extension on macOS.
order: 1
group: Start
---

# Install

Ensō needs two things on your Mac: the **local helper** and the **browser extension**. It takes about a minute.

## Requirements

| | |
|---|---|
| System | macOS. Linux is planned. |
| Browser | Zen, or Firefox 139 or newer |
| Node.js | 18 or newer (`node --version`) |
| Engine | [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and signed in, **or** an Anthropic API key |

## 1. Install the helper

Run this in Terminal:

```sh
curl -fsSL https://enso.wicker.life/install.sh | bash
```

The script prints each step as it goes. It:

1. checks that you are on macOS and that Node.js 18 or newer is installed;
2. checks for Claude Code (`claude --version`) and, if it is missing or signed out, tells you how to fix that (you can still continue and use an API key instead);
3. downloads the latest helper release from this site and checks its SHA-256;
4. installs it in `~/Library/Application Support/Enso/helper`, keeping your `config.json` if you already had one;
5. registers the helper with Zen and Firefox by writing a native messaging manifest called `zen_chat.json` to
   `~/Library/Application Support/Mozilla/NativeMessagingHosts/` and `~/Library/Application Support/zen/NativeMessagingHosts/`.

It is safe to run again: that is also how you update the helper by hand. Nothing is installed outside your home folder and it never asks for your password.

> Prefer to read it first? Download it with `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then run `bash install.sh`.

## 2. Add the extension

[Download the extension](/releases/enso-latest.xpi) in Zen. Zen asks whether to add Ensō and lists the permissions it needs; click **Add**.

The extension is signed by Mozilla for self-distribution, so it installs with signature checks on. Updates are checked automatically and installed in the background; you can see the version under *Add-ons and themes*.

### Why it asks for these permissions

| Permission | Used for |
|---|---|
| Access your data for all websites | Reading the current page when you ask about it, and acting on pages when you ask it to |
| Exchange messages with programs other than Firefox | Talking to the local helper |
| Access browser tabs, tab groups | Mentioning tabs, grouping and closing tabs by chat |
| Access browsing history | Searching your history when you ask |
| Replace the new tab and home page | The search-or-ask box |

## 3. Open it

Press <kbd>⌘E</kbd> for the sidebar, or open a new tab. The first answer after starting Zen takes a few seconds longer while Ensō warms up; after that it starts answering in about two seconds.

## Updating

- **The extension** updates itself from this site.
- **The helper**: run the install command again. It replaces the program files and keeps your settings and data.

## Uninstalling

1. Remove the extension in *Add-ons and themes*.
2. Delete the helper and its registration:

```sh
rm -rf ~/Library/Application\ Support/Enso
rm -f ~/Library/Application\ Support/Mozilla/NativeMessagingHosts/zen_chat.json
rm -f ~/Library/Application\ Support/zen/NativeMessagingHosts/zen_chat.json
```

3. Your conversations, memory and settings are in `~/Library/Application Support/zen-chat/`. Delete that folder too if you want them gone. If you used the API-key engine, remove the key with `security delete-generic-password -s zen-chat-anthropic`.
