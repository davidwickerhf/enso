---
title: Privacy & data
description: Exactly what Ensō stores, where it is stored, and what leaves your Mac.
order: 20
group: Your data
---

# Privacy & data

The short version: Ensō stores everything on your Mac. What you send in a conversation goes to Anthropic so Claude can answer, and tool calls go to the services you connected. Nothing goes to us. The formal version is the [privacy policy](/privacy).

## Stored on your Mac

In `~/Library/Application Support/Enso/` unless noted:

| What | Where |
|---|---|
| Conversations, with tool calls, approvals and page actions | `conversations/` |
| Activity log (page actions, session requests, GitHub changes, other agents' actions) | `actions.jsonl` |
| Profile and memory, global and per space | `profile.md`, `memory.md`, `memory/` |
| Settings, your skills, your configuration | `settings.json`, `skills.json`, `config.local.json` |
| Reports | `reports/` |
| Home brief (the last one) | `dashboard.json` |
| Tool status and sign-in details without secrets | `servers.json`, `connections.json` |
| Access tokens for [other agents](/docs/other-agents) | `mcp-token`, `mcp-token-read` (readable only by you) |
| The helper program | `helper/` |
| Claude Code's own record of subscription-engine conversations | `~/.claude/projects/` (kept by Claude Code) |
| API key (if you use one) | macOS Keychain, item `enso-anthropic` |
| GitHub token (if you saved one) | macOS Keychain, item `enso-github` |
| Sign-ins to tools you connected with the Connect button | macOS Keychain, items `enso-mcp-<name>` |
| Tokens for servers in `config.local.json` | macOS Keychain, items you name |
| Widget layout, quick links, note | Your settings and the extension's own storage |

These are ordinary files in your home folder, readable by your user account, and included in your Time Machine backups like everything else. The network and console logs Ensō keeps of your tabs for the [developer tools](/docs/session-access) are held in memory only, until Zen quits.

## What leaves your Mac

**To Anthropic, when you send a message.** Your message, your profile and memory, the time and your Zen space with your note about it, the conversation so far, and whatever context you included: the current page's text, mentioned tabs, attachments, screenshots, and the results of tools Ensō used to answer. With the subscription engine this goes through Claude Code; with an API key, directly to the Anthropic API. Anthropic handles it under the terms you agreed with them.

**To Anthropic, for the brief.** About once an hour (Settings → Home), Ensō makes the Home brief: your profile and memory, plus what read-only tools return (calendar, mail, tasks, a GitHub summary), go to Anthropic through Claude Code.

**To the services you connected, when a tool runs.** A Gmail search goes to Google, a calendar event is created in your calendar, a GitHub comment goes to GitHub, and so on. Read-only tools run without asking; anything that changes something asks first. The Tasks widget asks your task apps for open tasks every few minutes.

**To the web, when Ensō searches or opens a page** on your behalf, like any browser request, and requests with your session on sites you [allowed](/docs/session-access).

**To other agents' providers, when you use Zen from them.** What Claude Code, Codex or Cursor reads through Ensō goes to that agent's AI provider.

**To enso.wicker.life**, only:

- the extension's update check (Zen fetches `updates.json` and the new version, which puts your IP address in the server's request log);
- the helper download when you run the install script.

## What never leaves your Mac

- Anything from banking, payment, password-manager and health sites. Ensō doesn't read or act on them at all.
- Your browsing history, except search results Ensō looks up when you ask it to, which become part of that conversation.
- Pages you didn't include. Ensō sends the current page only when the page chip is on (it is on by default; turn the default off in Settings), and other tabs only when you mention them.
- Cookie values, passwords and tokens. Claude never sees them.

## Sync

The website runs an end-to-end encrypted [sync](/docs/sync) server, but the extension and helper can't use it yet, so nothing of yours is uploaded to it.

## No tracking

The extension and helper contain no analytics, telemetry or crash reporting. The website may count page views with a self-hosted, cookieless analytics tool (Umami) that stores no personal data; the account pages and the API are never counted.
