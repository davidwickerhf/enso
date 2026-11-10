# Using Ensō from other agents

While Zen is open, other AI agents on your Mac can use it through Ensō: Claude
Code in a terminal, Codex, Cursor, T3 Code and other apps that support MCP. They
can list and read your tabs, act on pages, look at a page's console and network,
search your history, use GitHub, and test pages in a separate headless Zen.

## How do I set it up?

Open **Settings → Setup → Use Zen from your agents** and turn on the agents
that may use Zen (Claude Code, Codex, Cursor and OpenCode, the ones found on
your Mac). The same panel has **Read only** and the **Claude Code hook**. Start
a new session in that agent, then ask "what tabs do I have open?".

From a terminal, the same thing for every client it finds:

```sh
enso mcp install
```

Just one: `enso mcp install --client codex` (`claude`, `codex` or `cursor`).
Check with `enso mcp status`. Remove with `enso mcp uninstall`.

No password or token ends up in their settings: they start the `enso` command,
which connects to Zen on your Mac.

## Can I let an agent look but not touch?

Yes, two ways:

- **One agent:** `enso mcp install --client cursor --read-only`. It can list and
  read tabs, take screenshots, read the console and network, search history and
  read GitHub, nothing else.
- **All agents:** **Settings → "Claude Code can use Zen" → External control**:
  **Full**, **Read only** or **Off**.

## How do I know what an agent did?

- While it acts on a page, the ribbon at the top says so: "✦ Codex is working on
  this page".
- **Activity** (full page) lists every action with the agent's name.

## Does an agent ask before it acts?

Ensō can't ask you on an agent's behalf; the agent's own permission prompts
apply. With external control on **Full**, page actions run when the agent calls
them. Some things are refused for agents however you set it:

- requests with your session on sites you haven't allowed in
  [session access](session-access.md);
- GitHub comments, reviews and other changes you didn't ask for;
- anything on banking, payment, password-manager and health sites.

## What happens when Zen is closed?

The agent still starts, and sees Ensō's tools, but every call answers "Zen
isn't running: open Zen and try again." Open Zen and carry on.

## Is my data sent anywhere?

What an agent reads in Zen goes to that agent's AI provider, like anything else
you give it: Anthropic for Claude Code, OpenAI for Codex, and so on. Ensō itself
sends nothing to us.

## Something doesn't work

| Message | Fix |
|---|---|
| `enso: command not found` | Use the full path `~/Library/Application\ Support/Enso/bin/enso`, or run the installer again. |
| "Zen isn't running" | Open Zen. |
| `status` says "token rejected" | Quit Zen with <kbd>⌘Q</kbd> and reopen it. |
| "external control" or "read-only" errors | See the settings above. |

More detail, including other apps and every tool: the
[developer guide to MCP](../mcp.md).
