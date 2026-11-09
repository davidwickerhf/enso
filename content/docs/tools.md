---
title: Your tools
description: Connect Gmail, Calendar, Drive and any MCP server, switch them on or off, and decide what runs without asking.
order: 10
group: Using Ensō
---

# Your tools

Ensō reaches your mail, calendar, files and other services through **MCP servers** (Model Context Protocol). A server offers tools such as "search mail" or "create event"; Ensō decides when to use them, and you decide what may run without asking.

## Where the servers come from

- **claude.ai connectors.** With the subscription engine, the connectors you have set up on claude.ai (Gmail, Google Calendar, Google Drive, Google Docs and others) work in Ensō too. Connect or disconnect them on claude.ai.
- **Your Claude Code servers.** MCP servers you have added to Claude Code (`claude mcp add …`) are listed in `~/.claude.json`, and Ensō can use them. Servers that need a sign-in use the sign-in Claude Code already did.
- **Servers only for Ensō.** You can add servers that Claude Code doesn't know about under `extraServers` in the helper's `config.json`. If one needs a token, keep the token in the Keychain and name the Keychain item in `tokenKeychainService`; Ensō reads it when it connects and never writes it to disk.

## Switching servers on and off

Each server is listed under `servers` in `~/Library/Application Support/Enso/helper/config.json` with `"enabled": true` or `false`. New servers you add to Claude Code stay **off** for Ensō until you enable them (`"enableNewServers": false`), so a server you set up for coding doesn't quietly appear in your browser.

**Settings → Connected tools** shows every enabled server with its status: connected, waiting, failed, or needs sign-in.

## Approvals

Every tool call is shown in the conversation as it happens, with what was sent and a short preview of the result.

- **Reading tools run straight away**: searching mail, listing events, reading a document. (You can turn this off in Settings so that everything asks.)
- **Anything that changes something asks first**: sending or drafting mail, creating or moving events, editing files, deleting anything. You see an approval card with the tool, its input and the reason Ensō gives.
- On the card you choose **Allow** (this once), **Always allow** (this tool, from now on), or **Deny**.

"Always allow" is per tool, not per server: allowing *create draft* does not allow *send*. The list lives in your settings (`alwaysAllowedTools`) and you can remove entries there at any time.

## The browser's own tools

Some tools are built in and don't need a server: reading and acting on the page ([Acting on pages](/docs/acting-on-pages)), listing, opening, grouping and closing tabs, searching your browsing history, creating [reports](/docs/reports), and remembering things about you ([Memory & profile](/docs/memory)). Web search and fetching a URL are available too and can be switched off in `config.json` (`"webSearch": false`).

## The tools panel

Click a tool's icon under the new-tab box, or open **Settings → Tools**, to see what it is for, what it can do, example questions, and an on/off switch. Switching a tool off removes it from the next message.

## Adding more

Anything you connect on claude.ai (**Customize → Connectors**) appears in Ensō on the subscription engine. That covers Slack, Notion, Linear, GitHub, Atlassian, Figma, Asana and **Microsoft 365** (Outlook mail and calendar, Teams chats and meetings, SharePoint, OneDrive). Microsoft 365 needs a work or school account, and your organisation's administrator must allow it.

