# Changelog

What changed in each release of Ensō, newest first. The extension and the helper
share one version number. Dates are the tag dates. Releases are published to
<https://enso.wicker.life> by the release workflow ([docs/releasing.md](docs/releasing.md));
the extension updates itself, the helper updates when you run the installer again.

## Unreleased

A Tasks widget that keeps up, and monday.com on the new tab.

- **Tasks refresh after a chat changes them.** When Claude adds, updates,
  completes or deletes a task in a task app (either engine), the helper drops
  its cache, fetches the list again and pushes it; the new task shows with a
  "New" tag and a short highlight (none with reduced motion), and is kept
  visible even when other tasks come first.
- **Background refresh.** Pages ask for tasks at most a minute old when they
  open or become visible, and every five minutes while visible; the helper
  shares one cache between pages (`maxAge` on `tasks.widget`).
- **Ordering.** Overdue, then due today, then later by date, then undated.
  Reminder times (Commonfold's `remindAt`) show with a bell; tasks due today
  or tomorrow stand out.
- **The brief** gets what task apps and monday.com say is due in the next
  week as data, so it always mentions it.
- **monday.com widget**: items assigned to you across your boards, with status
  and due date, and the latest update by someone else (mentions marked). Plain
  states for "not connected" and "server error · Retry". Items with a due date
  also appear in Tasks.
- **Tools page: signed in but the server fails** (e.g. monday.com answering
  HTTP 500) now reads "Signed in · server error" with **Retry**, which
  re-checks the server (`connections.probe`) instead of starting a new sign-in.
  Errors are one short line; whole HTML error pages no longer come through.
- A token refresh that finished after **Disconnect** could write the token back
  to the Keychain; it no longer does.

## 0.5.2 (10 November 2026)

Using Zen from other agents, without a token in their configs.

- **`enso mcp`**, a stdio launcher that MCP clients start. It forwards to the
  helper's `zen-browser` server, reading the token from the data folder on every
  request. While Zen is closed it answers `initialize`, lists the tools it saw
  last and returns "Zen isn't running: open Zen and try again."; it sends
  `tools/list_changed` when Zen is back.
- **`enso mcp install | uninstall | status | rotate`** for Claude Code, Codex
  (`~/.codex/config.toml`, edited table by table and backed up) and Cursor
  (`~/.cursor/mcp.json`). They print what changed, never values.
- **Client identity.** Each call is attributed to the client that made it
  (Claude Code, Codex, Cursor, T3 Code, …): in the activity log, in tool errors
  and on the page ribbon ("Codex is working on this page"). `enso mcp --client
  <label>` or `ENSO_MCP_CLIENT` sets the label.
- **Read-only scope.** A second token, `mcp-token-read`, for connections that
  may only use read-only tools (`enso mcp install --read-only`).
- Tokens are re-read on every request, so `enso mcp rotate` applies at once.
- The installer and `scripts/dev.sh` write the `enso` command
  (`Enso/bin/enso`, linked as `~/.local/bin/enso` when free) and register
  Claude Code through the launcher.

Upgrading: run `enso mcp install` to move existing http registrations to the
launcher. A helper started before 0.5.2 keeps its old token until Zen restarts.

## 0.5.1 (10 November 2026)

- **Tasks widget.** Open tasks from task apps on the new tab. The helper calls
  `list_tasks` itself on connected MCP servers that have it (Commonfold through
  Ensō's own sign-in), caches them for five minutes, and adds task-app tasks from
  the Home briefing without duplicates. Ticking a task completes it in the app
  (`complete_task` or `update_task`) and logs it in the activity log. Tasks is
  in the default layout and is added once next to Due soon in existing layouts.
- **The briefing** also lists open tasks from any connected task app, next to
  follow-ups from mail, calendar and study.
- **Easier widget editing.** An "Edit widgets" button under the grid, a
  right-click on a widget opens edit mode, and the top-bar button is labelled
  "Edit widgets".
- Bare due dates are read as local days, not UTC midnight.
- `page_type` selects the editor's own contents before inserting, with paste as
  a fallback, so rich editors (Outlook's, for example) take the text.

## 0.5.0 (9 November 2026)

Ensō as a standalone product: its own repository, installer, CI and release
pipeline. Earlier builds were called Zen Chat.

- **Extension id** `enso@wicker.life`, native-messaging host `enso`.
- **Data** in `~/Library/Application Support/Enso`. On first start the helper
  copies an older `zen-chat` folder once (the old folder is left alone) and
  reads the old `zen-chat-anthropic` Keychain item when `enso-anthropic` is
  missing. The MCP port and token stay the same.
- **Onboarding** asks your name, a few lines about you and, optionally, what
  each Zen space is for; editable in Settings → Profile.
- **`config.local.json`** in the data folder for personal configuration, merged
  over the shipped defaults, so updates never overwrite it.
- **The subscription engine runs on your installed `claude` CLI**, so the helper
  ships without the Agent SDK's bundled Claude Code binary (about 200 MB).
  Without Claude Code, Ensō says how to install it and the API-key engine
  still works.
- **Installer** (`curl -fsSL https://enso.wicker.life/install.sh | bash`) with
  SHA-256 checks, **CI** on every pull request, and a **release workflow** that
  signs the extension on addons.mozilla.org (unlisted) and publishes it and the
  helper to enso.wicker.life.
- **MIT licence.**
- `page_type` types through the browser's editing path, so sites that ignore
  synthetic input events see the text.
- `scripts/dev.sh` reinstalls helper dependencies when `node_modules` is a
  dangling link.

## Before 0.5.0: Zen Chat

Ensō started as Zen Chat, a sidebar extension in a personal configuration
repository. That history was not carried into this repository; the summary
below comes from the changelog published on the website.

- **0.3** (November 2026). The new tab as one box that opens sites, searches or
  asks, with widgets; Zen spaces for conversations, memory and tab tools; the
  tools panel; attachments of any type up to 25 MB; warm sessions (answers start
  in about two seconds); the local MCP server for Claude Code.
- **0.2.0.** The subscription and API-key engines; the Home briefing; acting on
  pages with the approval rule; tab and history tools; page context, `@`-mentions,
  attachments and screenshots; skills; reports with charts; history and the
  activity log; editable memory and profile; private sites; MCP servers beyond
  Claude Code's, with tokens in the Keychain.
- **0.1.0.** A Claude chat in Zen's sidebar, with MCP tools.
