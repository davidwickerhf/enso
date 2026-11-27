---
title: Engines
description: Choose Claude, Codex or Antigravity for Ensō chat.
order: 2
group: Start
---

# Engines

Choose your chat engine in **Settings → General → Engine**. Ensō can use a Claude subscription, an Anthropic API key, or your signed-in Codex or Antigravity CLI. Recent messages carry over when you switch.

## Your Claude subscription (default)

The helper runs each turn through **Claude Code**, using the Claude Agent SDK, with the account Claude Code is signed in to. That means:

- it uses the Claude plan you already have, and counts against that plan's usage limits, the same as using Claude Code in a terminal;
- your **claude.ai connectors** (Gmail, Google Calendar, Drive, Docs and others you connected on claude.ai) and the MCP servers you set up in Claude Code are available to it;
- there is no separate bill.

To set it up, open **Settings → Setup** in Ensō. **Install Claude Code** opens a terminal window (Terminal on macOS, PowerShell on Windows, your terminal app on Linux) with Anthropic's installer and then the sign-in; if Claude Code is already installed, **Sign in** opens `claude auth login`. Setup notices when you are signed in and shows your plan. By hand, the same thing is:

```sh
curl -fsSL https://claude.ai/install.sh | bash   # Anthropic's installer on macOS and Linux (or their setup guide)
irm https://claude.ai/install.ps1 | iex          # the same on Windows, in PowerShell
claude auth login                                # sign in to your Claude account
```

Ensō uses the `claude` you installed; it doesn't ship its own copy. It looks in your `PATH`, `~/.local/bin`, `~/.claude/local`, Homebrew's folders on macOS and Linux, and npm's folder on Windows. If yours is elsewhere, set **Settings → Advanced → Claude Code location**.

Ensō deliberately does **not** load your Claude Code settings, hooks or permission rules for chat turns, so a hook you wrote for coding never fires on a browser question. It passes in only the tools you enabled for Ensō.

Claude Code keeps its own record of these conversations in `~/.claude/projects/`, as it does for any session. See [Privacy & data](/docs/privacy-data).

## An Anthropic API key

If you don't have a Claude plan, or want pay-as-you-go billing, use an API key from the [Anthropic Console](https://console.anthropic.com/). Anthropic bills you per token.

The key is stored in your system's secret store: the login Keychain on macOS, Credential Manager on Windows, and your keyring on Linux (GNOME Keyring, KWallet or KeePassXC, through `secret-tool`). On Linux without a keyring it goes in a file only you can read, and Setup warns about it ([how to fix that](/docs/troubleshooting)). To add it by hand (each command asks for the key and nothing is echoed):

```sh
security add-generic-password -s enso-anthropic -a enso -w           # macOS, in Terminal
secret-tool store --label=Ensō service enso-anthropic account enso   # Linux
cmdkey /generic:enso-anthropic /user:enso /pass                      # Windows
```

That is what **Settings → Setup → Claude** does for you: paste the key in its password field and choose **Save to Keychain** (**Save key** on Linux and Windows). It goes straight to the helper, which checks it with Anthropic and stores it in the system's secret store; it isn't shown again or written to any other file. **Replace key** and **Remove key** are there too. Then the engine is **API key**.

With an API key, Ensō connects to your MCP servers itself. claude.ai connectors are only available through the subscription engine, because they belong to your claude.ai account. The Home brief always runs through Claude Code, so it needs Claude Code even on this engine.

## Codex and Antigravity

Install the provider CLI on the same computer that runs Zen and sign in once in a terminal. Use `codex login` for Codex or open `agy` for Antigravity. In **Settings → General**, select the engine, then choose a model the CLI reports for your account. **CLI default** uses the model and reasoning settings from the CLI. Use **Refresh models** if you just installed the CLI, signed in or changed accounts.

These engines answer from your messages, recent conversation text, the pages you include, and supported text and image attachments. Ensō's browser actions and connected tools are available through Claude. Home briefs use Claude Code. Local CLI sign-in is separate from an account connected inside another app.

## Model and effort

Settings let you choose the model and how much effort it puts into each answer (low, medium, high). Higher effort thinks longer, is slower, and uses more of your plan or budget.

## What your provider receives

Your selected engine sends your message and its context to its provider under your account. Claude uses Anthropic. Codex and Antigravity use the provider configured in their respective CLIs. See [Privacy & data](/docs/privacy-data).
