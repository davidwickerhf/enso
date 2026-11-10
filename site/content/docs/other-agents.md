---
title: Use Zen from other agents
description: Let Claude Code, Codex, Cursor and other MCP apps read and operate Zen through Ensō, with full or read-only access.
order: 19
group: Using Ensō
---

# Use Zen from other agents

While Zen is open, other AI agents on your computer can use it through Ensō: Claude Code in a terminal, Codex, Cursor, T3 Code and other apps that support MCP. They can list and read your tabs, act on pages, read a page's console and network, search your history, use GitHub, and test pages in a separate headless Zen.

## Set it up

Open **Settings → Agents & screenshots**. Ensō lists Claude Code, Codex, Cursor and OpenCode and shows which are on your computer; turn on the ones that may use Zen. Two more switches there: **Register read only** (below) and the **Claude Code hook**, which delivers your [screenshots](/docs/screenshots) to an idle Claude Code with your next message. Start a new session in that agent and ask "what tabs do I have open?".

Each switch runs the same code as the `enso` command, so you can also do it in a terminal:

```sh
enso mcp install
```

That registers Ensō as `zen-browser` with every client it finds.

| Command | Does |
|---|---|
| `enso mcp install --client codex` | Just one client: `claude`, `codex`, `cursor` or `opencode` |
| `enso mcp install --hooks` | Also lets an idle Claude Code get your [screenshots](/docs/screenshots) with your next message |
| `enso mcp install --read-only` | Read-only access (below) |
| `enso mcp status` | Whether Zen's helper is reachable, and which clients are registered |
| `enso mcp uninstall` | Removes the registrations |
| `enso mcp rotate` | New access tokens; registered clients keep working (Setup: **Agent access token → Rotate**) |
| `enso setup` | The whole Setup checklist in the terminal |

No password or token ends up in the agents' settings: they start the `enso` command, which reads the token on your computer and connects to Zen. `install` backs up the files it changes and prints what changed, never values.

`enso` is `~/Library/Application Support/Enso/bin/enso` on macOS and `~/.local/share/enso/bin/enso` on Linux, both linked as `~/.local/bin/enso`. On Windows it is `%APPDATA%\Enso\bin\enso.cmd`, which the installer adds to your user PATH (open a new terminal to pick it up). If your shell doesn't find it, use the full path.

### Other apps

Any app that can start an MCP server command can use it. Point it at the `enso` command above with the argument `mcp` (add `--read-only` for read access). On Windows, use `node.exe` with the arguments `%APPDATA%\Enso\helper\bin\enso.mjs mcp` instead, which is what `enso mcp install` registers there; many apps can't start a `.cmd` file directly. For Claude Desktop, that goes in its `claude_desktop_config.json` under `mcpServers` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows).

## Look, but don't touch

- **One agent:** `enso mcp install --client cursor --read-only`. It can list and read tabs, take screenshots, read the console and network, search history and read GitHub; nothing else is even listed.
- **All agents:** **Settings → Agents & screenshots → Access**: **Full**, **Read** or **Off**.

## Seeing what an agent is doing

While an agent works in Zen, you can see it in three places:

- **On the page**, a pill at the top names it and what it is doing: "✦ Claude Code · Draft the methods section". A dot pulses while it acts, and each thing it clicks or types into flashes a soft outline with its name. Click the pill to open Ensō's sidebar on that tab.
- **In Zen's tab list**, the tab's title starts with ✦, and Ensō's toolbar button shows a copper **AI** badge on that tab. The title goes back to normal when the agent is done. Turn the ✦ off in **Settings → Agents & screenshots → Mark the tab an agent uses**.
- **In Ensō's sidebar**, a card at the top shows the agent, its task, how long it has been working and its recent steps. Sends, deletes and other steps that can't be undone are highlighted. If agents are working in other tabs or spaces, an **Agents** row lists them: click one to go to its tab.

**Activity** in the full page lists every action with the agent's name, and fills in as it happens.

When one app runs another (T3 Code running Claude Code, for example), set the name yourself with `enso mcp --client "T3 Code"` in the app's MCP settings.

## Steering an agent

From the card in the sidebar:

- **Tell the agent…** sends it a note, such as "use the work account, not the personal one". The agent gets it with the result of its next step, marked as coming from you. The note says "Waiting for the agent's next step" until then, and **Delivered** after.
- **Pause** holds the agent on this tab: its next steps there are refused and it is told to wait. **Resume** lets it continue, and tells it to read the page again, since you may have changed it.
- **Stop** ends the task: everything it tries in Zen is refused, and it is told to stop. It keeps running in its own app; a new session there can use Zen again.

You can also send an agent a screenshot of the page, even while it's idle: press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>2</kbd> (<kbd>Ctrl+Shift+2</kbd> on Linux and Windows) and pick it under **Agents**. It gets the image with its next step, or when it calls `inbox_read`. See [Send screenshots to your agents](/docs/screenshots).

Agents are asked to say what they are doing when they start (`session_start`). Those that don't still show up, with their name and their latest step.

## Two agents on one tab

Only one agent acts on a tab at a time. The first one to click, type, scroll or navigate there has the tab for as long as it keeps working; it lets go when it finishes, when you stop it, or after about a minute and a half without doing anything. Pausing an agent doesn't take the tab away from it, since you may resume it.

Other agents can still read that tab, but what they try to do there is refused, and they're told to open their own tab or ask you. In the sidebar the card then shows both: **In control** on the one working, **Waiting for the tab** on the other. You decide:

- **Hand over to …** gives the tab to the other agent. It's told to read the page again before doing anything.
- **Let both act** lets them work on the tab at the same time. The card reminds you that they may overwrite each other's changes; **One at a time** goes back.

Your own clicks and typing are never blocked. To take a tab back from an agent, pause it.

Agents are asked to prefer a tab of their own: one they open with `tabs_open` opens in the background, in your current space with its logins, so it doesn't pull you away from what you're doing.

## Running JavaScript: page_eval and the two builds

Agents can debug your pages with `devtools_console`, `devtools_network`, `page_storage`, and two fixed queries that run no code: `page_query` (the elements matching a CSS selector, with their text, attributes, visibility and position) and `page_inspect` (one element's computed styles, size, scroll size, and whether it is visible, in view or covered by something else).

`page_eval`, which runs JavaScript an agent writes in your page, is only in the **direct download build** from this site (and development builds). The **Firefox Add-ons build** doesn't have it: addons.mozilla.org doesn't allow add-ons to run code that isn't part of the add-on. With that build, agents don't see `page_eval` at all, and Ensō tells them it isn't available. See [Install → Two builds](/docs/install#two-builds) for which one you have and how to switch.

## What agents may do

Ensō can't ask you on an agent's behalf; the agent's own permission prompts apply. With external control on **Full**, page actions run when the agent calls them. Some things are refused for agents however you set it:

- requests with your session on sites you haven't allowed in [session access](/docs/session-access);
- GitHub comments, reviews and other changes you didn't ask for;
- anything on banking, payment, password-manager, health, tax and government sites.

## When Zen is closed

The agent still starts and sees Ensō's tools, but every call answers "Zen isn't running: open Zen and try again." Open Zen and carry on; the agent picks it up within a few seconds.

## Where the data goes

What an agent reads in Zen goes to that agent's AI provider, like anything else you give it: Anthropic for Claude Code, OpenAI for Codex, and so on. Ensō sends nothing to us.

## If it doesn't work

| Problem | Fix |
|---|---|
| `enso: command not found` | Use the full path above, or run the installer again. |
| Every call says "Zen isn't running" | Open Zen. |
| `enso mcp status` says "token rejected" | Quit Zen completely (<kbd>⌘Q</kbd> on macOS) and reopen it. |
| `status` says "registered over http with the token in its config" | An older setup. Run `enso mcp install`. |
| "external control" or "read-only" errors | Check the settings above. |
| An agent doesn't see new tools after an update | Restart the agent. |
| Clicking the pill doesn't open Ensō | Some pages block it; the pill then says "Press ⌘E for Ensō" (Ctrl+E on Linux and Windows). |
| A tab title still starts with ✦ | It goes when the agent has been quiet for two minutes. |
