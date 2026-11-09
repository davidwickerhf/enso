---
title: Privacy & data
description: Exactly what Ensō stores, where it is stored, and what leaves your Mac.
order: 21
group: Your data
---

# Privacy & data

The short version: Ensō stores everything on your Mac. What you send in a conversation goes to Anthropic so Claude can answer. Nothing goes to us, unless you turn on sync, and then only ciphertext we cannot read. The formal version is the [privacy policy](/privacy).

## Stored on your Mac

| What | Where |
|---|---|
| Conversations, with tool calls and page actions | `~/Library/Application Support/Enso/conversations/` |
| Activity log (page actions per site) | `~/Library/Application Support/Enso/actions.jsonl` |
| Memory and profile | `memory.md`, `profile.md` in the same folder |
| Settings and your skills | `settings.json`, `skills.json` |
| Reports | `reports/` |
| Home brief (last one) | `dashboard.json` |
| Helper program and its `config.json` | `~/Library/Application Support/Enso/helper/` |
| API key (if you use one) | macOS Keychain, item `enso-anthropic` |
| Tokens for extra MCP servers | macOS Keychain, items you name |
| Sync account key and device token (if sync is on) | macOS Keychain |

These are ordinary files in your home folder, readable only by your user account, and included in your Time Machine backups like everything else.

## What leaves your Mac

**To Anthropic, when you send a message.** Your message, your profile and memory, the conversation so far, and whatever context you included: the current page's text, mentioned tabs, attachments, screenshots, and the results of tools Ensō used to answer. With the subscription engine this goes through Claude Code; with an API key, directly to the Anthropic API. Anthropic handles it under the terms you agreed with them.

**To the services you connected, when a tool runs.** A Gmail search goes to Google, a calendar event is created in your calendar, and so on, through the MCP servers you enabled. Read-only tools run without asking; anything that changes something asks first.

**To the web, when Ensō searches or opens a page** on your behalf, like any browser request.

**To enso.wicker.life**, only:

- the extension's update check (Zen fetches `updates.json` and the new version, which includes your IP address in the server's request log);
- the helper download when you run the install script;
- encrypted sync, if you turn it on.

## What never leaves your Mac

- Anything from banking, payment, tax, health or password-manager sites. Ensō doesn't read or act on them at all.
- Your browsing history, except search results Ensō looks up when you ask it to, which become part of that conversation.
- Pages you didn't include. Ensō sends the current page only when the page chip is on (it is on by default; turn the default off in Settings), and other tabs only when you mention them.

## No tracking

The extension and helper contain no analytics, telemetry or crash reporting. The website may count page views with a self-hosted, cookieless analytics tool (Umami) that stores no personal data; the account pages and the API are never counted.
