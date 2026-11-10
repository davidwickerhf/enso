---
title: Use Zen from other agents
description: Let Claude Code, Codex, Cursor and other MCP apps read and operate Zen through Ensō, with full or read-only access.
order: 19
group: Using Ensō
---

# Use Zen from other agents

While Zen is open, other AI agents on your Mac can use it through Ensō: Claude Code in a terminal, Codex, Cursor, T3 Code and other apps that support MCP. They can list and read your tabs, act on pages, read a page's console and network, search your history, use GitHub, and test pages in a separate headless Zen.

## Set it up

The installer offers to set up Claude Code. For all of them:

```sh
enso mcp install
```

It registers Ensō as `zen-browser` with Claude Code, Codex and Cursor, whichever you have. Restart them, or start a new session, and ask "what tabs do I have open?".

| Command | Does |
|---|---|
| `enso mcp install --client codex` | Just one client: `claude`, `codex` or `cursor` |
| `enso mcp install --read-only` | Read-only access (below) |
| `enso mcp status` | Whether Zen's helper is reachable, and which clients are registered |
| `enso mcp uninstall` | Removes the registrations |
| `enso mcp rotate` | New access tokens; registered clients keep working |

No password or token ends up in the agents' settings: they start the `enso` command, which reads the token on your Mac and connects to Zen. `install` backs up the files it changes and prints what changed, never values.

`enso` is `~/Library/Application Support/Enso/bin/enso`, also linked as `~/.local/bin/enso`. If your shell doesn't find it, use the full path.

### Other apps

Any app that can start an MCP server command can use it. Point it at the command `~/Library/Application Support/Enso/bin/enso` with the argument `mcp` (add `--read-only` for read access). For Claude Desktop, that goes in `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`.

## Look, but don't touch

- **One agent:** `enso mcp install --client cursor --read-only`. It can list and read tabs, take screenshots, read the console and network, search history and read GitHub; nothing else is even listed.
- **All agents:** **Settings → Claude Code can use Zen → External control**: **Full**, **Read only** or **Off**.

## Seeing what an agent is doing

While an agent works in Zen, you can see it in three places:

- **On the page**, a pill at the top names it and what it is doing: "✦ Claude Code · Draft the methods section". A dot pulses while it acts, and each thing it clicks or types into flashes a soft outline with its name. Click the pill to open Ensō's sidebar on that tab.
- **In Zen's tab list**, the tab's title starts with ✦, and Ensō's toolbar button shows a copper **AI** badge on that tab. The title goes back to normal when the agent is done. Turn the ✦ off in **Settings → Claude Code can use Zen → Mark the tab while an agent works**.
- **In Ensō's sidebar**, a card at the top shows the agent, its task, how long it has been working and its recent steps. Sends, deletes and other steps that can't be undone are highlighted. If agents are working in other tabs or spaces, an **Agents** row lists them: click one to go to its tab.

**Activity** in the full page lists every action with the agent's name, and fills in as it happens.

When one app runs another (T3 Code running Claude Code, for example), set the name yourself with `enso mcp --client "T3 Code"` in the app's MCP settings.

## Steering an agent

From the card in the sidebar:

- **Tell the agent…** sends it a note, such as "use the work account, not the personal one". The agent gets it with the result of its next step, marked as coming from you. The note says "Waiting for the agent's next step" until then, and **Delivered** after.
- **Pause** holds the agent on this tab: its next steps there are refused and it is told to wait. **Resume** lets it continue, and tells it to read the page again, since you may have changed it.
- **Stop** ends the task: everything it tries in Zen is refused, and it is told to stop. It keeps running in its own app; a new session there can use Zen again.

Agents are asked to say what they are doing when they start (`session_start`). Those that don't still show up, with their name and their latest step.

## What agents may do

Ensō can't ask you on an agent's behalf; the agent's own permission prompts apply. With external control on **Full**, page actions run when the agent calls them. Some things are refused for agents however you set it:

- requests with your session on sites you haven't allowed in [session access](/docs/session-access);
- GitHub comments, reviews and other changes you didn't ask for;
- anything on banking, payment, password-manager and health sites.

## When Zen is closed

The agent still starts and sees Ensō's tools, but every call answers "Zen isn't running: open Zen and try again." Open Zen and carry on; the agent picks it up within a few seconds.

## Where the data goes

What an agent reads in Zen goes to that agent's AI provider, like anything else you give it: Anthropic for Claude Code, OpenAI for Codex, and so on. Ensō sends nothing to us.

## If it doesn't work

| Problem | Fix |
|---|---|
| `enso: command not found` | Use the full path above, or run the installer again. |
| Every call says "Zen isn't running" | Open Zen. |
| `enso mcp status` says "token rejected" | Quit Zen with <kbd>⌘Q</kbd> and reopen it. |
| `status` says "registered over http with the token in its config" | An older setup. Run `enso mcp install`. |
| "external control" or "read-only" errors | Check the settings above. |
| An agent doesn't see new tools after an update | Restart the agent. |
| Clicking the pill doesn't open Ensō | Some pages block it; the pill then says "Press ⌘E for Ensō". |
| A tab title still starts with ✦ | It goes when the agent has been quiet for two minutes. |
