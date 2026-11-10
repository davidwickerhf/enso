# Changelog

What changed in each release of Ensō, newest first. The extension and the helper
share one version number. Dates are the tag dates. Releases are published to
<https://enso.wicker.life> by the release workflow ([docs/releasing.md](docs/releasing.md));
the extension updates itself, the helper updates when you run the installer again.

## Unreleased

Agents can give pages files, wait for slow work, and send large payloads.

- **Making Ensō the default search engine is one choice away.** New installs
  get Firefox's own question, *Ensō would like to change your default search
  engine…*, at install (`search_provider.is_default`); nothing changes unless
  you choose Yes, and updates never ask. Everyone else sees a small card under
  the new tab's box, **Make the address bar Ensō's box**, with the three clicks
  in Zen's settings and a button that copies `about:preferences#search`
  (add-ons can't open it). It says **Done** once Ensō is the default; **Not
  now** hides it for 30 days, **Don't ask again** for good. The same card is in
  Settings → General → Address bar and an optional last step of the first-run
  card.

- **The new tab's "Your tools" strip fits a narrow sidebar.** The tool icons
  scroll sideways, faded at the cut-off edge, while the label and the manage
  and hide buttons stay in view.

- **`page_upload`** attaches files from this computer to a file input, or drops
  them on a drop zone, exactly as they are on disk: streamed in 512 KiB chunks,
  checked by size and SHA-256 before anything is attached, built as `File`
  objects in the page's own compartment so the page's handlers can read them.
  No code is evaluated, so it works in every build. Up to 100 MB and 20 files
  per call; credential folders, browser profiles and Ensō's data are refused.
- **`page_wait`** waits for a selector to appear or go, text, a URL, the network
  going idle, or the page loading, instead of polling.
- **Timeouts.** `page_eval` awaits promises for up to `timeoutMs` (default 30 s,
  up to 120 s; `awaitPromise: false` returns at once), and `page_navigate`,
  `page_back`, `page_upload` and `session_fetch` take `timeoutMs` too. A timeout
  now says the action may still be running and how to check, instead of
  "The browser did not answer".
- **Large payloads.** Messages from the helper to the extension over 900 KB go
  in chunks under native messaging's 1 MB limit (up to 64 MB), so long
  `page_type` text and `page_eval` expressions arrive whole; too large is a
  clear error. The MCP server takes requests up to 16 MB and no longer garbles
  a multi-byte character split across network chunks.
- **Several agents on one page.** One pill per tab however many sessions work
  there: "Claude Code · task", or "2 agents · Claude Code: task (+1)" led by the
  most important state (working, then paused, then idle); hovering or clicking
  it lists each agent with its task and state, and clicking a row opens that
  agent's card in Ensō. Each agent's outline flashes have their own shade and
  name. The sidebar shows one card with a tab per agent. The "✦ " title prefix
  appears once, never "✦ ✦ ", and goes only when the last session ends; after an
  extension update the old copy's pill, flashes and prefix are removed instead
  of stacking under the new one's.
- **One agent acts on a tab at a time.** The first agent session to click, type,
  upload, navigate, press, select, scroll or run `page_eval` on a tab holds it;
  each action renews the lease, which ends with `session_end`, Stop or 90 s
  without an action (never while the agent is paused). Other agents can still
  read the tab, but their actions there are refused with who holds it and what
  it is doing, and a nudge to open their own tab, use the headless browser or
  ask you. `session_start` on a held tab warns. In the agent card the holder
  wears **In control** and a refused agent **Waiting for the tab**; **Hand over
  to …** gives the tab to another session and **Let both act** lets them share
  it, with the risk in one line. Your own clicks never take a lease.
- **Exact attribution.** Every page action from an agent session carries that
  session's id to the extension, so the outline flash and the pill name the
  right one of two Claude Code sessions on a tab instead of guessing.
- **`tabs_open` for agents** opens tabs in the background (your tab keeps
  focus) in the current space, replies with their tab ids, and gives them to
  the agent that opened them. The server instructions now say to prefer an own
  tab.
- **Agents ask before using your login on a new site.** When an agent's
  `session_fetch` or `headless_start` is refused because the site isn't on your
  session-access list, Ensō asks you instead of leaving it to fail: "Claude Code
  wants to use your login on desec.io" with **Allow** and **Not now**, on the
  page pill of any tab of that site and in the agent's card (or above the Agents
  row when it works elsewhere). **Allow** adds exactly that origin; the agent's
  next result says it can retry. **Not now** tells it not to ask again in this
  task. One request per agent and site, gone when the agent's session ends.
  Only your click allows: no MCP tool can, the pill's buttons only count through
  Ensō's own frame with a trusted click, and private sites never prompt.
  Settings → Session access lists recently allowed sites first, with when and
  for which agent.
- **Agent instructions** (the MCP server's and Ensō's own): use `page_upload` for
  files and never shrink or edit a user's file to fit a limit; use `page_wait`;
  a timeout isn't a failure, so check before retrying.

## 0.5.7.1 (10 November 2026)

The same code as 0.5.7, as the direct download build for enso.wicker.life
(signed unlisted, includes page_eval).

## 0.5.7 (10 November 2026)

Two builds, clearly labelled; nothing sent automatically on new installs; two
new page tools that answer questions without running code.

- **Two builds.** The **Firefox Add-ons build** (addons.mozilla.org, three-part
  versions like 0.5.7) and the **direct download build** (enso.wicker.life,
  four-part versions like 0.5.7.1). They are the same Ensō, except that only the
  direct download has `page_eval`, which runs JavaScript an agent writes in the
  page: addons.mozilla.org doesn't allow add-ons to run code that isn't in their
  package. `scripts/build-extension.mjs` makes the listed build by removing the
  code between `// <unlisted-only>` markers, writes `channel.js`, and fails if
  `eval(` or `new Function` is left; CI builds and lints it. Settings → Setup
  and Advanced say which build this is ("Firefox Add-ons build", "Direct
  download build", "Development build"), and the website offers both. To
  switch, remove one and install the other; settings live in the helper.
- **The helper knows the build.** The extension sends `extension.hello`
  (version, channel, capabilities) when it connects. With the Firefox Add-ons
  build, `page_eval` is left out of MCP `tools/list` and Ensō's own chat, the
  MCP instructions and `session_start` say it isn't available, and a call
  returns "not available in the Firefox Add-ons build". Settings → Advanced →
  Developer tools says so too.
- **`page_query` and `page_inspect`**, in every build: the elements matching a
  CSS selector (text, chosen attributes with URLs resolved, visibility, rect),
  and one element's computed styles, size, scroll size and whether it is in
  view or covered (and by what). Fixed queries, read-only, no code evaluated;
  password values never returned.
- **Nothing sent automatically by default, for new installs.** The Home brief
  no longer refreshes by itself (`dashboard.autoRefreshMinutes` 60 → 0):
  onboarding offers **Turn on the daily brief** (once a day, each morning), and
  Settings → General → Refresh the brief gained "Once a day". New-tab search
  suggestions from Google or DuckDuckGo are off until **Search suggestions
  while typing** (Settings → General → New tab & Home) is on. Existing installs
  keep what they had: the helper writes the old hourly default into their
  settings.json once where they never chose a value, and an update from an
  earlier version turns suggestions on once. The privacy policy says both are
  off by default.
- `/releases/enso-latest.xpi` on the site always serves the newest direct
  download build (four-part version).
- **Firefox 142 or newer** (was 139): `data_collection_permissions` needs
  Firefox 140 on desktop and 142 on Android, and AMO's validator warned about
  the older minimum. Zen is on Firefox 159.

## 0.5.6.1 (10 November 2026)

The same code as 0.5.6, signed as a self-distributed build so enso.wicker.life
can offer it for direct download while 0.5.6 waits for review on
addons.mozilla.org. Version numbers are unique across AMO's listed and
self-distributed channels, hence the fourth number.

## 0.5.6 (10 November 2026)

Linux and Windows, a clearer Settings, the address bar as Ensō's box, and a
helper whose crashes can be diagnosed.

- **Linux and Windows.** See below; the helper, installers and releases now
  cover all three systems.
- **Settings in sections** (General, You & memory, Skills, Connections, Agents &
  screenshots, Privacy & safety, Setup, Advanced) with a nav, search (`/`),
  deep links (`#settings/<section>`) and a dot where something needs attention.
  The separate Setup page is folded in; no setting was renamed.
- **The address bar as Ensō's box.** Ensō is a search engine in Zen (keyword
  `@enso`). One setting decides where address-bar queries go: Ensō, a web
  search engine, or a choice each time; `e ` and `g ` override it. With
  `zen.urlbar.replace-newtab` on, ⌘T opens Zen's command bar for addresses,
  searches and questions.
- **New tabs open once.** The tab swap that moved keyboard focus into Ensō is
  off by default (it showed as an extra tab); Settings → General can turn it on.

### Crash diagnostics


- **Helper log.** The helper writes `~/Library/Logs/Enso/helper.log` (about 1 MB,
  plus one older file): startup (helper and Node version, Node's path, macOS),
  errors it handled, and uncaught exceptions with their stack, written before it
  exits. No messages, page text or secrets. `run.sh` appends the helper's stderr
  to the same file, so a crash before Node runs (Node removed, too old, a syntax
  error) is there too; it also checks Node's version before starting.
- **"Ensō's helper isn't running".** When the helper stops, Ensō says how (not
  found, failed to start, exited) with the browser's reason, and offers **Try
  again**, **Copy diagnostics** (versions, status, last error, browser, system,
  and the log's end when the helper answers) and **Open the install guide**.
- **No more endless "Loading…".** Settings, memory, Setup, history, Activity,
  tools, the brief, widgets and conversations show that state, or "Couldn't
  load" with **Retry** after 8 seconds without an answer.
- **`enso doctor`** checks the native-messaging manifests, run.sh's Node, a test
  start of the helper (hello answered), the MCP port and the log's last lines,
  with a fix for each problem.
- **Linux and Windows.** The helper runs on macOS, Linux (x86_64, arm64) and
  Windows 10/11 (x64, arm64), with Zen or Firefox. Linux installs with the same
  `install.sh` (into `~/.local/share/enso`, log in `~/.local/state/enso`,
  secrets in the desktop keyring through libsecret, or a 0600 file with a
  warning when there is none). Windows installs with
  `irm https://enso.wicker.life/install.ps1 | iex` (into `%APPDATA%\Enso`,
  registered under `HKCU\Software\Mozilla\NativeMessagingHosts`, secrets in
  the Credential Manager, `enso` on your PATH). Both download Ensō's own pinned
  Node when there is no Node 18+. The extension shows the right install command,
  terminal, paths, secret store and shortcuts for the system; a system the
  helper doesn't run on (ChromeOS, BSD) gets a plain message. One helper
  release serves all three; `/api/latest?platform=` picks it.
- The installer resolves version-manager shims (asdf, nodenv, Volta) to the real
  Node binary, and never opens Zen from a temporary HOME.

## 0.5.5 (10 November 2026)

Setup from inside Ensō, a privacy policy that matches the code, and a listing
on addons.mozilla.org.

- **First-run guide.** Without a helper, Ensō explains why one terminal step is
  needed, shows the install command with a Copy button and how to open
  Terminal, then waits and moves on by itself when the helper connects (no Zen
  restart). A helper that can't start gets a "run it again to repair" variant.
  background.js now tracks the helper's state (`helper.status`) and retries
  `connectNative` on its own, also after a crash or an update.
- **Settings → Setup.** A checklist the helper keeps current: helper version
  and **Update**, Claude Code (install or sign in through Terminal, plan shown)
  or an API key stored in the Keychain from a password field, a switch per agent
  (Claude Code, Codex, Cursor, OpenCode) with read-only and the Claude Code hook,
  T3 Code, GitHub (gh sign-in or a token), Tools and the agent token. New helper
  messages `setup.status` and `setup.run`; `enso setup` and `enso update` in the
  terminal.
- **Installer.** No questions any more (agents are set up in Setup); fetches its
  own Node.js 24 with a pinned SHA-256 when the Mac has no Node 18+; doesn't
  reopen the extension when Zen already has it; writes `install.json`; ends with
  a short summary.
- **Tax and government sites are private.** The private-site list now covers
  tax authorities and government sign-in portals (Belastingdienst, Toeslagen,
  MijnOverheid, DigiD, IRS, Social Security, Login.gov, HMRC and GOV.UK tax
  services, GOV.UK One Login, ELSTER, impots.gouv.fr, Agenzia delle Entrate,
  Agencia Tributaria, MyMinfin, ATO, myGov, Inland Revenue NZ). A pattern like
  `*.paypal.com` now also covers `paypal.com` itself, and the extension knows
  the whole list before the helper connects.
- **"Off" really stops the Home brief.** Settings → Home → Refresh the briefing
  → Off used to still refresh when Ensō connected; now the brief only runs from
  its refresh button. The setting says what each refresh sends.
- **`page_eval` runs only in the page.** On pages whose Content Security Policy
  blocks eval it now returns an error instead of running in Ensō's content
  script.
- **Privacy policy.** Now also describes the Home brief, Claude Code's own
  transcripts, what other agents read, screenshots, OAuth-connected tools
  (monday.com, Commonfold), search suggestions, the addons.mozilla.org listing,
  and the full private-site list; sync is marked as not available yet.
- **On addons.mozilla.org.** Releases are submitted as a listed add-on, with
  the listing kept in `amo/`. Copies installed from enso.wicker.life move to
  AMO updates with this release. The manifest declares its data collection
  (website content, browsing activity, search terms) for Firefox's consent
  prompt.

## 0.5.4 (10 November 2026)

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

## 0.5.3 (not released on its own; ships in 0.5.4)

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
