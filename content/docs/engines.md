---
title: Engines
description: Run Ensō on your Claude subscription through Claude Code, or on an Anthropic API key kept in the Keychain.
order: 2
group: Start
---

# Engines

Ensō doesn't have its own model. It asks Claude, in one of two ways. You can switch at any time in **Settings → Engine**; a conversation carries over when you switch.

## Your Claude subscription (default)

The helper runs each turn through **Claude Code**, using the Claude Agent SDK, with the account Claude Code is signed in to. That means:

- it uses the Claude plan you already have, and counts against that plan's usage limits, the same as using Claude Code in a terminal;
- your **claude.ai connectors** (Gmail, Google Calendar, Drive, Docs and others you have connected on claude.ai) and the MCP servers you have signed in to through Claude Code are available to it;
- there is no separate bill.

To set it up, install Claude Code by following [Anthropic's setup guide](https://docs.anthropic.com/en/docs/claude-code/setup), then sign in once:

```sh
claude          # follow the sign-in prompt, then quit with /exit
claude --version
```

Ensō deliberately does **not** load your Claude Code settings files, hooks or permission rules for chat turns, so a hook you wrote for coding never fires on a browser question. It passes in only the MCP servers you enabled for Ensō.

## An Anthropic API key

If you don't have a Claude plan, or want pay-as-you-go billing, use an API key from the [Anthropic Console](https://console.anthropic.com/). Anthropic bills you per token.

The key is stored in the **macOS Keychain**, never in a file. Add it in Terminal; it asks for the key and nothing is echoed:

```sh
security add-generic-password -s enso-anthropic -a "$USER" -w
```

Then choose **API key** in Settings. To replace the key, delete the old one first with `security delete-generic-password -s enso-anthropic` and add it again.

With an API key, Ensō connects to your MCP servers itself. claude.ai connectors are only available through the subscription engine, because they belong to your claude.ai account.

## Model and effort

Settings let you choose the model and how much effort it puts into each answer (low, medium, high). Higher effort is slower and uses more of your plan or budget.

## What Anthropic receives

Whichever engine you use, the text of your message, and whatever context you include (the page, mentioned tabs, attachments, screenshots, tool results), is sent to Anthropic so Claude can answer. That happens under your own agreement with Anthropic: their consumer terms for a subscription, their commercial terms for an API key. Ensō's servers are never in that path. See [Privacy & data](/docs/privacy-data).
