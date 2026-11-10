---
title: Connecting tools
description: Connect claude.ai connectors, MCP servers with the Connect button, Claude Code's servers and GitHub, and decide what runs without asking.
order: 11
group: Using Ensō
---

# Connecting tools

Ensō reaches your mail, calendar, files, tasks and code through **tools**. Most come from **MCP servers** (Model Context Protocol); GitHub is built in. Claude decides when to use a tool; you decide what may run without asking.

Open **Settings → Connections → Manage** in the sidebar, **Tools** in the full page, or click an icon under the new-tab box.

## Where tools come from

The Tools page groups them:

| Group | What | How to set it up |
|---|---|---|
| Connected via claude.ai | Gmail, Google Calendar, Drive, Docs, Microsoft 365, Slack, Notion and the other connectors on your claude.ai account | Connect them on claude.ai (**Connect on claude.ai**). Subscription engine only. |
| Built into Ensō | GitHub | [See below](#github) |
| MCP servers | Servers Ensō signs in to itself, servers you added to Claude Code, and servers in your `config.local.json` | See below |

Ensō's own tools are always there and aren't listed: reading and [acting on pages](/docs/acting-on-pages), tabs and history, [reports](/docs/reports), [memory](/docs/memory) and the [developer tools](/docs/session-access).

## The Connect button

**monday.com** has its own tile under **Add more**: choose **Connect** and sign in with your monday account. Ensō connects to monday's hosted MCP server (`https://mcp.monday.com/mcp`); no API key is needed.

For any other MCP server that signs in with OAuth, Commonfold for example:

1. On the Tools page, under **Add more**, find **Custom MCP server**.
2. Give it a short **Name** (letters, digits, `-` or `_`) and its **MCP URL** (`https://…/mcp`).
3. Choose **Connect**. The server's sign-in page opens in a new tab.
4. Sign in and approve. The tab closes by itself, and the server shows **Connected** with its tools.

Ensō does the sign-in itself: it registers with the server, uses a one-time code with PKCE, and keeps the tokens in your macOS Keychain, never in a file. They are renewed automatically. If renewing fails, the server shows **Needs sign-in** and a **Reconnect** button. Open a server's row to **Disconnect** (Ensō asks the server to revoke the token, then deletes it) or **Remove** a server you added.

Servers you connect this way work on both engines, and their tasks can appear in the [Tasks widget](/docs/widgets#the-tasks-widget).

## Servers from Claude Code

On the subscription engine, MCP servers you added to Claude Code (`claude mcp add …`) are available, with the sign-in Claude Code already did. New ones stay **off** for Ensō until you switch them on, so a server you set up for coding doesn't quietly appear in your browser. claude.ai connectors are on by default. If Claude Code has a server with the same name as one Ensō connected itself, Ensō uses its own.

## Switching tools on and off

Open a tool's row on the Tools page and use the switch. Switching a tool off removes it from the next message.

## GitHub

Ensō's GitHub tools read your pull requests, reviews, issues and notifications **across every org and repository your account can see**, and can comment, review, label, assign, close and reopen when you ask. There is no merge or delete.

**Settings → Connections → GitHub** shows whether you're connected. If you use the GitHub CLI, **Sign in with gh** opens Terminal with `gh auth login`; Ensō uses that sign-in, which works in every org that allows the GitHub CLI, without installing a GitHub App. Otherwise, create a token (classic with `repo`, `read:org` and `notifications`, or fine-grained), paste it in Setup (or in **GitHub** on the Tools page) and choose **Save token**. Ensō checks it with GitHub, then stores it in your Keychain. **Remove token** deletes it again.

An org that blocks both can still be read with your browser session, if you allow `github.com` in [session access](/docs/session-access).

Try: "What's waiting on me on GitHub?" or "Why is CI failing on my latest PR?"

## Servers with an API key

Servers that use a fixed token go in `~/Library/Application Support/Enso/config.local.json` (create it if it doesn't exist):

```json
{
  "extraServers": {
    "my-notes": { "type": "http", "url": "https://notes.example.com/mcp", "tokenKeychainService": "enso-notes-token" }
  },
  "servers": { "my-notes": { "enabled": true } }
}
```

Store the token in the Keychain under that name (it asks for the token and doesn't echo it), then quit and reopen Zen:

```sh
security add-generic-password -s enso-notes-token -a "$USER" -w
```

Ensō sends it as a bearer token and never writes it to disk.

## Approvals

Every tool call is shown in the conversation as it happens, with what was sent and a short preview of the result.

- **Reading tools run straight away**: searching mail, listing events, reading a document. Turn this off in **Settings → Privacy & safety → Run reading tools without asking** so that everything asks.
- **Anything that changes something asks first**: sending or drafting mail, creating or moving events, editing files, deleting. The approval card shows the tool, its input and why Ensō wants it.
- Choose **Allow** (this once), **Always allow** (this tool, from now on) or **Deny**.

"Always allow" is per tool, not per server: allowing *create draft* does not allow *send*. **Settings → Privacy & safety → Always allowed** lists them; remove one to be asked again.

## Adding more

Anything you connect on claude.ai (**Customize → Connectors**) appears in Ensō on the subscription engine: Slack, Notion, Linear, Atlassian, Figma, Asana and **Microsoft 365** (Outlook mail and calendar, Teams, SharePoint, OneDrive). Microsoft 365 needs a work or school account, and your organisation's administrator must allow it.
