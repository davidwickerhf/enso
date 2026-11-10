# Changelog

What changed in each release of Ensō, newest first. The extension and the helper
share one version number. Dates are the tag dates. Releases are published to
<https://enso.wicker.life> by the release workflow ([docs/releasing.md](docs/releasing.md));
the extension updates itself, the helper updates when you run the installer again.

## Unreleased

Send screenshots to your agents: capture a page in Zen and send it, with a
message, to the agent you're working with. Guide:
[site/content/docs/screenshots.md](site/content/docs/screenshots.md).

- **Capture**: ⌘⇧2 (Ctrl+Shift+2 elsewhere; manifest command `send-screenshot`)
  or the camera button in the sidebar and full page. Drag a region, Enter for
  the visible area, F for the full page (Firefox's `captureTab` with a page
  rect; long pages are scaled, huge PNGs become JPEG). Private sites refused.
- **Send sheet and picker**: thumbnail, target, message (Enter sends, Esc
  cancels), page URL and title (on) and console errors (off) as context;
  "Always send this tab here"; a site → T3 project link; a toast with
  "Open in T3" (`t3code://threads/<environment>/<thread>`).
- **Targets are pluggable** (`lib/screenshots.mjs`): T3 Code threads; agents
  connected through `enso mcp` (Claude Code, Codex, OpenCode, Cursor…), which
  get the image as MCP content with their next tool call or from the new
  `inbox_read` tool; and the clipboard ("Copy image", "Save + copy path").
- **Target order**: an agent on the tab (its T3 thread when it runs in T3
  Code), a tab link, a site → project link, then the picker (running and
  waiting threads first, then the matching project, then recent).
- **T3 Code** (`lib/t3.mjs`): `enso t3 connect | status | disconnect` and
  Settings → Send screenshots → Connect T3 issue a T3 session with only
  `orchestration:read` and `orchestration:operate` (30 days), kept in the
  Keychain (`enso-t3`). Threads come from `/api/orchestration/shell`; images are
  uploaded with `attachments.createUploadUrl` and sent with
  `orchestration.dispatchCommand` (`message.dispatch`, queued after a running
  turn) over T3's RPC WebSocket. Without attachment uploads the PNG is saved
  and its path sent with `t3 thread send`.
- **The launcher** sends `X-Enso-T3-Thread` (`$T3CODE_THREAD_ID`) and
  `X-Enso-Agent-Pid`; agent sessions and the agent card show the T3 thread.
- **`enso mcp install`**: OpenCode (`~/.config/opencode/opencode.json`), Codex
  `env_vars = ["T3CODE_THREAD_ID"]`, and `--hooks`, a Claude Code
  UserPromptSubmit hook (`enso inbox --session-env`, backed by `POST /inbox`)
  so an idle Claude Code gets screenshots with the next message.
- **Settings → Send screenshots**: T3 connection, connected agents, and Linked
  threads (tab links end with the tab; site links stay until removed).

## 0.5.3 (10 November 2026)

Agent presence and steering: what an external agent does in Zen is visible
while it happens, and the user can pause, stop or correct it from Ensō.
Design and reasons: [docs/records/006](docs/records/006-agent-presence-and-steering.md).

- **Agent sessions in the helper** (`lib/agentsessions.mjs`): per agent (the
  launcher's new `X-Enso-Session` id) and tab, with task, recent steps and a
  two-minute idle timeout. New MCP tools `session_start`, `session_status` and
  `session_end`; the server instructions ask agents to call `session_start`
  first.
- **Steering through tool results**: notes from Ensō arrive at the start of the
  agent's next result ("Message from the user (via Ensō): …", once); Pause
  refuses its calls on that tab and its tab-less actions; Resume adds a
  hand-back note; Stop refuses every call of that session for 30 minutes.
- **Live push**: the helper sends `agents` and `actions.added` to every UI, so
  the sidebar and Activity update without reopening (also for `page_eval`).
- **Agent card and Agents row** in the sidebar and full page: client, task,
  elapsed time, steps (irreversible ones highlighted), Pause/Resume, Stop,
  "Tell the agent…" with delivery state; sessions in other tabs and spaces with
  Switch and Stop.
- **On the page**: the pill stays for the whole session ("Claude Code · task"),
  with live, Paused and Stopped states; clicking it opens the sidebar
  (`pill.html`, a web-accessible frame); elements acted on flash a soft outline
  with the agent's name (static with reduced motion).
- **In Zen's tab list**: a "✦ " title prefix while an agent works (setting
  `agentTitlePrefix`, on by default; restored exactly afterwards) and a per-tab
  copper "AI" badge on the toolbar button. Zen offers extensions nothing more
  direct (see the record).
- **Google Docs**: `page_type` without a ref (or with the canvas's ref) types
  into the document body at the cursor; `ref` is now optional everywhere
  (the focused field).
- background.js accepts `ui` ports from Ensō's own pages only.
- Tests: `agents.test.mjs` (sessions, steering, the push, end to end through
  host.mjs) and `pageagent.test.mjs` (Docs typing, title prefix, pill; needs
  Playwright's Chromium, skipped without it). `playwright-core` is a dev
  dependency.

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
