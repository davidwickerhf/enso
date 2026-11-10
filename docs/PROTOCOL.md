# Ensō protocol

Three parts talk to each other:

```
UI (app.html: sidebar / new tab / full page)  ⇄  background.js  ⇄  helper (helper/, native messaging host "enso")
                                                       ⇣
                                              page agent (content script in the tab)
```

- The **UI** never talks to the host directly. It opens
  `browser.runtime.connect({ name: "ui" })` and sends/receives the JSON messages
  below. Every connected UI receives every broadcast, so the sidebar, the new
  tab page and the full page stay in sync.
- **background.js** relays UI ⇄ host, fills in page context, and executes page
  actions in tabs for the host.
- The **host** owns all state: conversations, history, settings, memory,
  dashboard. It persists to `~/Library/Application Support/Enso/` (override with
  `ENSO_DATA`). On first start it copies an older `~/Library/Application Support/zen-chat/`
  folder there once, if the new one has no conversations yet.

All messages are objects with a `type`. Times are ISO strings. Ids are strings.

## UI → host

| type | fields | answer |
|---|---|---|
| `hello` | | `state` |
| `conversation.new` | | `conversation.created` |
| `conversation.open` | `id` | `conversation.loaded` |
| `conversation.rename` | `id`, `title` | `conversation.updated` |
| `conversation.delete` | `id` | `conversation.deleted` |
| `chat.send` | `conversationId`, `text`, `skill?` (name), `includePage` (bool), `mentionedTabIds?` (number[]), `attachScreenshot?` (bool), `attachments?` ([{ name, mimeType, dataBase64 }], any file type, ≤ 25 MB total, converted by `lib/attachments.mjs`) | stream of `event` |
| `chat.stop` | `conversationId` | `event` notice + `turn.end` |
| `approval.reply` | `id`, `decision`: `"allow"` \| `"always"` \| `"deny"` | `event` `approval.resolved` |
| `history.search` | `query`, `spaceId?` (only that space's conversations) | `history.results` |
| `actions.list` | `url?`, `host?`, `limit?` | `actions.results` |
| `dashboard.refresh` | | `dashboard` (with `loading: true` first) |
| `settings.update` | `patch` (partial settings) | `settings` |
| `profile.save` | `name`, `about`, `spaceHints?` ({ spaceId: text }, empty text removes one), or `skip: true` | `settings` + `profile` |
| `profile.get` | | `profile` |
| `memory.get` | `spaceId?` (omit for global memory) | `memory` |
| `memory.set` | `text`, `spaceId?` | `memory` |
| `spaces.list` | | `spaces` |
| `tools.toggle` | `name`, `enabled` (bool) | `settings` + `servers` |
| `connections.status` | | `connections` + `servers` |
| `connections.start` | `server` (name of an OAuth server) | `connections` (`state: "connecting"`, opens the sign-in page in a new tab), later `connections` with `done` |
| `connections.add` | `name` (letters, digits, `-`, `_`), `url` (MCP URL, https or loopback http), `label?` | adds a custom OAuth server, then as `connections.start`; a bad name/URL answers `connections` with `done: { ok: false, add: true, error }` |
| `connections.disconnect` | `server` | revokes the token at the server when it supports it, deletes the Keychain item; `connections` + `servers` |
| `connections.remove` | `server` (custom only) | disconnects and forgets it; `connections` + `servers` |
| `skills.save` | `skill: { name, description, prompt }` (name without `/`; `prompt` may contain `{input}` for the text typed after the command) | `skills` |
| `skills.delete` | `name` | `skills` |
| `report.get` | `id` | `report` |
| `reports.list` | | `reports` |
| `github.widget` | `force?` (skip the helper's 5-minute cache) | `github` |
| `tasks.widget` | `force?` (skip the helper's 5-minute cache) | `tasks` |
| `tasks.complete` | `server`, `id` (a task from the last `tasks` list; the user ticked it, so no approval) | `tasks.completed` + `tasks` (marks it done with the app's `update_task` / `complete_task`; logged in actions.jsonl as `complete_task`) |
| `github.token` | `token` (pasted in Tools → GitHub; checked against GitHub, then saved to the Keychain service `enso-github` through `security -i` on stdin) | `github.saved` + `servers` |
| `github.forget` | | `servers` (deletes the Keychain token) |
| `agents.list` | | `agents` |
| `agents.pause` | `id` (an `AgentSession` id) | `agents` (that agent's calls on that tab, and its tab-less actions, are refused until resumed) |
| `agents.resume` | `id` | `agents` (its next call carries the hand-back note) |
| `agents.stop` | `id` | `agents` (every further call of that agent session is refused for 30 minutes) |
| `agents.note` | `id`, `text` (≤ 1000 characters) | `agents` (the note, undelivered) + `actions.added` (`action: "note"`, without the text); `deliveredAt` is set when the agent's next tool result carries it |
| `agents.dismiss` | `id` | `agents` (removes the session from the list, e.g. a stopped one) |
| `send.targets` | `tabId`, `url` (the captured tab) | `send.targets` (see [Send screenshots](#send-screenshots)) |
| `send.screenshot` | `target: { kind: "t3" \| "agent", id }`, `image` (PNG/JPEG data URL, ≤ 25 MB), `message`, `url`, `title`, `includePage` (bool, default true), `consoleErrors?` ([{ text, source }], only when ticked) | `send.result` + `actions.added` (`action: "screenshot"`) |
| `screenshot.save` | `image`, `url` | `screenshot.saved` `{ ok, path }` (saved under `<data>/screenshots`; the UI copies the path) |
| `send.link` | `link`: `{ type: "tab", tabId, host, kind, id, title, pageTitle }` or `{ type: "host", host, projectId, projectTitle }` | `settings` (`sendLinks`) |
| `send.unlink` | `link`: `{ type: "tab", tabId }` or `{ type: "host", host }` | `settings` |
| `t3.status` | | `t3` `{ status: T3Status }` |
| `t3.connect` | | `t3` `{ status, done: { action: "connect", ok, error? } }` (runs `t3 auth session issue`, token into the Keychain) |
| `t3.disconnect` | | `t3` `{ status, done }` (revokes the session, deletes the item) |
| `t3.open` | `threadId` | none: opens `t3code://threads/<environment>/<thread>` in the T3 Code app the `t3` CLI belongs to |

`chat.send`: background always adds `page: { tabId, url, title }` for the active
tab (so page tools act on the tab the user was looking at), plus `text` when
`includePage` is true, `screenshot` (PNG data URL) when `attachScreenshot` is
true, `mentionedTabs: [{ tabId, url, title, text }]` for `mentionedTabIds` (at
most 20), and `space: { id, name, icon, containerId } | null`, the Zen space of
the active tab. On a private site no `text` or `screenshot` is added.

### Answered by background.js itself (never reach the host)

| type | fields | answer |
|---|---|---|
| `tabs.list` | | `tabs`: `{ type, tabs: [{ tabId, title, url, favIconUrl, active }] }` (open http(s) tabs; each also has `hidden` (true = another Zen space) and `space` (name); current space's tabs first) |
| `page.current` | | `page.current`: `{ type, tab: { tabId, title, url, favIconUrl, sensitive } \| null }`, also pushed whenever the active tab changes. `sensitive: true` on banking/health sites: the page chip shows a lock and the page is not sent or acted on. |
| `agents.switch` | `tabId` | none: activates that tab and focuses its window (the Agents list) |
| `screenshot.capture` | `mode`: `"region"` (drag; Enter = visible area, F = full page, Esc = cancel) \| `"visible"` \| `"full"` | `screenshot.captured` (to that port) |

background.js accepts `ui` ports only from Ensō's own pages (`port.sender.url`
under the extension's origin), so notes, Pause and Stop can't come from page
content. On connect it sends the last `agents` it has.

background.js also sends messages of its own to every UI:

- `composer.prefill`: `{ type, text }` from the "Ask Ensō about this" context menu;
- `agents.focus`: `{ type, tabId }` when the user clicked the page pill on that
  tab (the sidebar scrolls to the agent card and focuses "Tell the agent…");
- `screenshot.captured`: `{ type, image, mode, tab: { tabId, url, title, … },
  consoleErrors: [{ t, text, source }] | null, at }`, or `{ cancelled: true }`, or
  `{ error }`. After the `send-screenshot` command (⌘⇧2) it goes to the sidebar
  only, which the command opens; if the sidebar isn't connected yet it is kept
  for up to a minute and sent when it connects. `consoleErrors` is null when
  console capture never ran on that tab. Private sites are refused.
- an `event` with `conversationId: null` and `code: "host_disconnected"` when the
  native port closes (the UI shows "The chat helper stopped" with Reconnect).

Error `code`s the UI handles specially: `host_disconnected` (the helper isn't
running; `host_missing` is handled the same way but nothing sends it today),
`no_claude_code` (subscription engine without Claude Code), `no_api_key` (API
engine without a key).

## host → UI

### `state` (reply to `hello`)
```js
{
  type: "state",
  settings: Settings,
  engines: { subscription: { available, label }, api: { available, label } },
  servers: [Server],
  conversations: [ConversationSummary],   // newest first
  activeConversationId: string | null,    // the one with a running turn, if any
  dashboard: Dashboard | null,            // cached, may be stale
  profile: Profile,                       // see below; onboarding: true on first run
  paths: { data, localConfig },           // data folder and config.local.json on this Mac
  skills: [Skill],                        // slash commands, built-ins first
  sensitiveHosts: ["*.bank*", ...],       // patterns where page reading/acting is off
  spaces: [Space],                        // the user's Zen spaces
  connections: [Connection],              // OAuth servers, see Connections below
  reports: [{ id, title, createdAt, conversationId }],
  agents: [AgentSession]                  // live sessions of external agents, see below
}
```

### `AgentSession` (external agents, `lib/agentsessions.mjs`)
`agents`: `{ type, sessions: [AgentSession] }`, newest activity first, pushed on
every change (a call starting or ending, a note, Pause, Resume, Stop, a
session ending). background.js uses it too, for the page pill, the "✦ " title
prefix and the toolbar badge.
```js
{ id: "3f2a9c1b04de", client: "Claude Code", clientName: "claude-code",
  task: "Draft the methods section",       // from session_start; "" if none
  tabId: 42 | null,                        // null: no tab yet (tabs_list, GitHub…)
  url, title,                              // the tab's page as last seen
  startedAt, lastAt, endsAt,               // ISO; endsAt = when it ends if nothing happens
  running: false,                          // a call is in progress
  paused: false, stopped: false,
  explicit: true,                          // the agent called session_start
  idleMs: 1200,
  actions: [{ id, at, tool: "page_type", title: "Type", target: 'textbox "Body"',
              ok: true, irreversible: false, typed?: "Dear Sam…" /* ≤ 40 chars, "••••••" for password fields */,
              error?: "…", refused?: true }],   // the last 30
  notes: [{ id, text, at, deliveredAt: ISO | null }] }
```
A session ends two minutes after its last call (paused: 30 minutes), or when
the agent calls `session_end`. Since the screenshot work a session also has
`t3ThreadId` (the T3 Code thread its launcher announced, or null), `t3`
(`{ threadId, title, projectTitle, openable }` when the helper knows the
thread) and `agentId` (its connected agent, below).

`agents` also carries `connected: [ConnectedAgent]`, and `state` carries
`connectedAgents`: agents connected through the launcher, which can be sent
screenshots even while idle. One per launcher process, kept while its process
runs (checked by pid) and for at most 12 hours without a request:
```js
{ id: "ag-1f2e3d4c5b6a", client: "Claude Code", clientName: "claude-code",
  task: "",                 // its live session's task, if any
  tabIds: [42], sessionIds: ["3f2a…"], active: true,
  t3ThreadId: null, lastAt, pending: 0,   // screenshots not yet delivered
  inbox: [{ id, kind: "screenshot", text, path, at, deliveredAt, via?: "tool result" | "prompt hook" }] }
```

### Send screenshots

`send.targets` answers with everything the send sheet and picker need:
```js
{ type: "send.targets", tabId, url, host,
  t3: T3Status,             // { cli, origin, reachable, connected, tokenValid, environmentId,
                            //   serverVersion, route: "attachment" | "path" | null, expiresAt, error }
  threads: [{ id, title, projectId, projectTitle, status, running, waiting, activeAt }],
  projects: [{ id, title, repo }],
  agents: [ConnectedAgent],
  target: { kind: "t3" | "agent", id } | null,
  source: "agent" | "tab-link" | "host-link" | "picker",
  client, projectId, links: { tabs: [...], hosts: { host: { projectId, projectTitle } } } }
```
Resolution order (`resolveTarget` in `lib/t3.mjs`): an agent session on the tab
with a T3 thread → that thread; an agent session without one → that agent; a
tab link; a site → project link (the project's running/waiting, else latest
thread); else no target, and the UI opens the picker. Threads are ordered
running and waiting first, then threads of a project matching the page (repo
page, dev-server port in the project's scripts, or a name in the host), then by
recency. T3 being down or disconnected only empties `threads`.

`send.result`: `{ type, reqId, ok, kind, title, route, path?, openUrl?, queued?, error?, code? }`.
`route` is `"attachment"` (T3 image attachment), `"path"` (T3 without
attachment uploads: PNG saved, path sent as text with `t3 thread send`) or
`"inbox"` (an agent: queued for its next tool call). Settings gain
`sendLinks: { tabs: [{ tabId, host, kind, id, title, pageTitle, at }], hosts }`;
tab links are dropped when the tab closes (background.js sends
`send.tab_closed { tabId }` to the host).

### `Space`
```js
{ id: "{55e5…}", name: "Work", icon: "briefcase", containerId: 6, urls: [...] }
```
`icon` is a Zen icon name (`grid-2x2`, `briefcase`, `heart`, `star`, …) or an emoji;
draw your own small SVG per name, fall back to the first letter. The current
space arrives with `page.current` (`space: { id, name, icon, containerId } | null`)
and is stored on each conversation (`ConversationSummary.space`) from its first
message. Conversations, memory and tab tools are scoped to it: show which space
a conversation belongs to, let history filter to "this space" (default) or all,
and offer the current space's memory next to the global memory in settings.

### `Profile`
```js
{ name: "Maya", about: "Markdown the user wrote", summary: "first line of about",
  set: true,          // profile.md exists
  onboarding: false,  // true until a profile is saved or onboarding is skipped: show the first-run card
  spaceHints: { "{space id}": "what this space is for" } }
```
`profile.md` in the data folder is `# <name>` followed by `about`. Space hints
come from Settings → Profile (`settings.spaceHints`, by space id or name), else
from `spaceHints` in `config.local.json` (by space name).

`engines.subscription` also carries `reason` when Claude Code wasn't found, and
`path` / `version` of the CLI in use. `engines` (`{ type, engines }`) is sent
again after `settings.update` changes `claudePath`.

### `Skill`
```js
{ name: "summarize", description: "Summarise this page in five bullets", prompt: "…{input}…", builtIn: true }
```
Typing `/` in the composer opens a picker of skills; choosing one sends
`chat.send` with `text` = the typed message and `skill: "<name>"`. The host
expands the skill's prompt (replacing `{input}` with the text).

### `Server` (a connected tool: claude.ai connector or MCP server)
```js
{ name: "claude.ai Gmail", label: "Gmail", status: "connected" | "pending" | "failed" | "needs-auth",
  enabled: true, tools: 12, toolNames: ["search_threads", "get_thread", …],
  about: "Search, read and draft email in your Google account.",
  examples: ["What needs a reply from me today?"],
  connectUrl: "https://claude.ai/customize/connectors" | null,   // where to connect/manage it
  source: "claude.ai connector" | "MCP server" | "built in",
  detail?: "Connected through GitHub CLI as …",   // built-in tools (GitHub): status line
  tokenEntry?: true }                              // show the paste-a-token box
```
GitHub is a built-in entry (`name: "github"`): its tools live in the helper
(`lib/github.mjs`), so `tools.toggle` makes them refuse instead of removing a
server.
`toolNames` fill in after the first chat on the subscription engine. Switching a
server off (`tools.toggle`) removes its tools from future turns.

Servers Ensō signs in to itself (OAuth; `oauthServers` in `config.json` / `config.local.json`, plus
custom servers added from the Tools page) also carry
```js
auth: { type: "oauth", state: "connected" | "disconnected" | "connecting" | "expired" | "error",
        custom: false, url: "https://…/mcp", error?: "…", authUrl?: "…" /* while connecting */, expiresAt?: ISO }
```
and their `status` is `"needs-auth"` (or `"pending"` while connecting) until
signed in. Show Connect / Reconnect (expired) / Try again (error) from `auth`,
Disconnect when connected, Remove when `custom`.

### Connections (OAuth sign-in for MCP servers)
`connections`: `{ type, connections: [Connection], done?: { server, ok, error?, add? } }`
(`state` also carries `connections`). `done` arrives once a sign-in finishes or fails.
```js
{ server: "notes", label: "Notes", url: "https://notes.example.com/mcp", custom: false,
  state: "connected" | "disconnected" | "connecting" | "expired" | "error",
  error?: "…", authUrl?: "…", expiresAt?: ISO, connectedAt?: ISO }
```
The host does the OAuth 2.1 flow itself (discovery, dynamic client
registration, PKCE, code exchange, refresh) with `@modelcontextprotocol/sdk`.
The sign-in page opens through `browser.request` `tabs_open`; the server
redirects to `http://127.0.0.1:47823/oauth/callback` (an ephemeral loopback port
when another helper holds 47823), which checks `state`, stores the tokens in the
Keychain (service `enso-mcp-<name>`) and closes the tab with `tabs_close`.
Connected servers go to Claude as `{ type: "http", url, headers: { Authorization: "Bearer …" } }`
with a token refreshed when it is within 5 minutes of expiry; a changed token
starts a fresh warm session. A Claude Code registration of the same name
(`claude mcp add notes`) is ignored by Ensō.

### `Settings`
```js
{
  engine: "subscription" | "api",
  model: "claude-opus-5-5",
  effort: "low" | "medium" | "high",
  includePageByDefault: true,
  autoApproveReadOnly: true,
  alwaysAllowedTools: ["mcp__notes__search_notes", ...],
  dashboard: { autoRefreshMinutes: 60 },
  externalControl: "full" | "read" | "off",   // what MCP clients (zen-browser) may do; a read-scope token caps it at "read"
  agentTitlePrefix: true,                      // "✦ " in front of the page title while an external agent works on the tab
  developerTools: true,                        // console/network/eval/storage/session tools (default on)
  headless: true,                              // headless Zen tools (default on)
  sessionAccess: { "https://github.com": "allow" },  // per-site use of the user's signed-in sessions; missing = "ask"
  serverOverrides: { "claude.ai Gmail": false },      // Tools page switches (tools.toggle)
  spaceHints: { "{space id}": "what this space is for" },
  homeWidgets: [{ id, type, size: "S" | "M" }],       // new-tab widget layout
  onboardingDone: true,
  claudePath: "/path/to/claude"                       // Settings → Engine → Claude Code location
}
```
`sessionAccess` keys are origins; an entry also covers its subdomains (same
scheme; for headless sites given as bare hostnames the scheme is ignored).
"Always allow on this site" in an approval writes `"allow"`; the settings view
lists, adds and removes entries. Banking/health sites can never be allowed.

### `ConversationSummary`
```js
{ id, title, createdAt, updatedAt, engine, messageCount, actionCount, space: { id, name, icon } | null,
  pages: [{ url, title }],   // pages that were in context or acted on
  preview: "first line of the last answer" }
```

### Conversation events
`conversation.loaded` is `{ type, id, conversation: ConversationSummary, events: [Event] }`.
Live updates arrive as `{ type: "event", conversationId, event: Event }`.

Persisted `Event` kinds (all have `id` and `at`):

| kind | fields |
|---|---|
| `user` | `text`, `page: { url, title } \| null`, `tabs?: [{ url, title }]` (mentioned), `attachments?: [{ name, mimeType }]`, `screenshot?: bool` |
| `assistant` | `text` (Markdown, complete) |
| `thinking` | `text` (summary of reasoning) |
| `tool.call` | `toolUseId`, `category`: `"mcp"` \| `"page"` \| `"memory"` \| `"web"`, `server`, `tool`, `title` (human label, e.g. "Search Gmail"), `input` |
| `tool.result` | `toolUseId`, `ok`, `preview` (≤ 600 chars), `durationMs` |
| `approval.request` | `toolUseId`, `server`, `tool`, `title`, `input`, `reason`, `alwaysLabel?` (label for the "always" button, e.g. "Always allow on this site" for session access; default "Always allow") |
| `approval.resolved` | `toolUseId`, `decision` |
| `page.action` | `toolUseId`, `url`, `title`, `action` (`click`, `type`, `navigate`, …), `target` (element description), `ok` |
| `notice` | `text` |
| `error` | `text`, `code?` |
| `turn.start` | |
| `turn.end` | `usage?: { inputTokens, outputTokens, costUsd? }`, `stopped?: bool` |

Streaming-only kinds (not persisted, folded into `assistant` / `thinking` at the end):

| kind | fields |
|---|---|
| `assistant.delta` | `messageId`, `text` |
| `thinking.delta` | `messageId`, `text` |

### Other
- `conversation.created` / `conversation.updated`: `{ type, conversation: ConversationSummary }`
- `conversation.deleted`: `{ type, id }`
- `history.results`: `{ type, query, results: [{ conversationId, title, snippet, at }] }`
- `actions.results`: `{ type, actions: [{ id, at, conversationId, url, title, host, action, target, ok, source?, client? }] }` (`source`: the MCP client's label for external agents, "You" for notes)
- `actions.added`: `{ type, action }`, pushed when an external agent's action (or a note to one) is logged, so Activity and the recent list update live; same shape as an `actions.results` entry
- `dashboard`: `{ type, loading?: true, data?: Dashboard, error?: string }`
- `settings`: `{ type, settings }`
- `memory`: `{ type, spaceId, text }` (Markdown the user can edit; spaceId null = global)
- `spaces`: `{ type, spaces: [Space] }`
- `servers`: `{ type, servers }`
- `skills`: `{ type, skills: [Skill] }`
- `report`: `{ type, report: { id, title, createdAt, conversationId, markdown } }` — Markdown may contain fenced ```chart blocks holding JSON `{ "type": "bar" | "line", "title", "labels": [...], "series": [{ "name", "values": [...] }] }`
- `reports`: `{ type, reports: [{ id, title, createdAt }] }`
- `github`: `{ type, data?: { login, review: [GitHubRow], mine: [GitHubRow], assigned: [GitHubRow], counts: { review, mine, authored, assigned }, fetchedAt }, error?: string }` — `GitHubRow` = `{ kind: "pr" | "issue", repo, number, title, url, updatedAt, ci, review, conflict, draft }`; `mine` = the user's open PRs with failing CI, changes requested or a merge conflict
- `github.saved`: `{ type, ok, login?, error? }`
- `tasks`: `{ type, data?: { tasks: [Task], servers: [{ name, label, ok, error? }], fetchedAt }, error?: string }` — open tasks from enabled, connected http MCP servers with a `list_tasks` tool that the helper can call itself (e.g. Commonfold through Ensō's own sign-in; `lib/tasks.mjs`). `Task` = `{ id, title, due?, url?, source, server, space?, done?, completable }`; `completable: false` for tasks parsed from free text (no id). claude.ai connectors (Notion, Todoist…) can't be called directly; their tasks come through the dashboard's `tasks` with `kind: "app"`.
- `tasks.completed`: `{ type, server, id, ok, error? }`

### `Dashboard`
```js
{
  generatedAt,
  greeting: "Good afternoon, Maya",
  headline: "One line on what matters today",
  calendar: [{ time, title, location?, url? }],
  mail:     [{ from, subject, why, url? }],
  study:    [{ course, item, due?, url? }],
  tasks:    [{ title, due?, source, url?, kind?: "app" | "follow-up" }],  // app: open task in a task app (source = app name); follow-up: from mail, calendar, study, GitHub
  language: { summary, url? } | null,
  suggestions: ["Ask: summarise my unread work mail", ...]   // tappable prompts
}
```
The UI adds local sections itself from `state`: recent conversations and the
pages the assistant acted on (`actions.list`).

## host → background (page actions)

`{ type: "page.request", reqId, tabId, action, args, agent? }` →
`{ type: "page.response", reqId, ok, result?, error? }`

`agent` (also on `browser.request`) names the MCP client acting ("Codex",
"Cursor", …) when the request comes from the zen-browser server; background.js
passes it to the page agent with the action, and the pill and outline flash name
it. Without it (Ensō's own turns) they say "Claude". For external agents with a
live session the pill comes from `presence` instead (below) and stays for the
whole session.

| action | args | result |
|---|---|---|
| `snapshot` | | `{ url, title, elements: [{ ref, role, name, value?, href? }], text }` |
| `click` | `ref` | `{ description }` |
| `type` | `ref?`, `text`, `submit?` | `{ description }`. Without `ref`: the focused field. On `docs.google.com/document/…`, without `ref` or with the ref of a non-editable element (the canvas), the text goes into Docs' hidden input frame (`.docs-texteventtarget-iframe`) with `execCommand("insertText")` at the cursor, an Enter keydown per newline; `description` is "Google Docs document body (at the cursor)". |
| `select` | `ref`, `value` | `{ description }` |
| `press` | `key` | |
| `scroll` | `direction` (`up`/`down`), `ref?` | |
| `navigate` | `url` | `{ url, title }` |
| `back` | | `{ url, title }` |
| `screenshot` | | `{ dataUrl }` (PNG) |
| `console` | `since?` (ms), `level?`, `limit?` | `{ tabId, url, now, started, dropped, entries: [{ t, level, text, source?, stack? }] }`; the first call for a tab starts capture (`started: true`); `level: "nav"` entries mark navigations |
| `eval` | `expression` | `{ ok, world: "page" \| "isolated", type?, json?, error?, stack?, url, title, description }` (page world; falls back to the content-script world when the page CSP blocks eval) |
| `presence` | `{ label, task, running, paused, stopped, titlePrefix }`, or `{ off: true }` | `{ shown, title }`. Sent by background.js itself (not the host) from `agents`: shows or updates the session pill and the "✦ " title prefix, or removes both (the page's latest own title restored exactly). |
| `pill_ready` / `pill_hint` | — / `{ text }` | background.js → page agent: the pill's frame loaded (clicks go to it now) / a short hint on the pill ("Press ⌘E for Ensō") |
| `storage` | `includeValues?` | `{ url, local: [{ key, length, value? }], session: [...], cookies: [{ name, domain, path, secure, httpOnly, sameSite, session, expires, partitioned }], container }`; cookie values are never included, credential-looking storage values are redacted |

The envelope's `tabId` can be any tab, not only the active one: developer tools
pass the tab the caller chose (default: the active tab).

Browser-level actions use the same envelope (`browser.request` / `browser.response`):

| action | args | result |
|---|---|---|
| `tabs_list` | `allSpaces?` | `[{ tabId, title, url, groupId, active, windowId, space }]` (the current space only unless `allSpaces`) |
| `tab_text` | `tabId` | `{ url, title, text }` |
| `active_tab` | | `{ tabId, url, title }` or `{}`: the tab page tools act on by default (the MCP server resolves it for sessions and Pause) |
| `tabs_open` | `urls`, `background?` | `[{ tabId, url }]` |
| `tabs_close` | `tabIds` | |
| `tabs_group` | `tabIds`, `title?`, `color?`, `groupId?` | `{ groupId }` |
| `tabs_ungroup` | `tabIds` | |
| `group_update` | `groupId`, `title?`, `color?`, `collapsed?` | |
| `history_search` | `text`, `days?`, `max?` | `[{ url, title, lastVisit, visits }]` |
| `open_report` | `id` | opens `report.html?id=…` in a new tab |
| `network_log` | `tabId?`, `filter?` (substring or `/regex/`), `type?`, `failedOnly?`, `since?`, `includeHeaders?`, `limit?` | `{ tabId, url, now, total, requests: [{ id, t, method, url, type, status, ms, fromCache, ip, reqSize, resSize, initiator, error?, requestHeaders?, responseHeaders? }] }` (ring buffer of 500 per tab, recorded for all web tabs; secret query values and cookie/auth/token header values redacted; never bodies) |
| `session_fetch` | `url`, `method`, `headers`, `body?`, `maxChars` | `{ status, statusText, url, redirected, headers, contentType, body, bodyLength, truncated, tabOrigin, tabTitle, tabId, openedTab, container }`: made with `content.fetch` inside a tab of that origin (an open one in the current space's container, else a background tab in the site's container, closed afterwards) |
| `site_cookies` | `hosts` | `{ "<host>": { container, containerName, cookies: [...] } }` with values, for the helper to build the headless profile; the helper never passes them to Claude |

The pill's click target, `pill.html` (web-accessible, laid transparently over
the pill), calls `sidebarAction.open()` in its click handler and sends
`runtime.sendMessage({ ensoPill: "ready" | "click", opened? })`; background.js
checks `sender.url` is that page. When the frame can't load, the page agent's own
click sends `{ ensoPillFallback: true }`. Per tab with a session, background.js
also sets a copper "AI" badge and a title on Ensō's toolbar button
(`browserAction.setBadgeText` / `setBadgeBackgroundColor` / `setTitle` with
`tabId`) and re-sends `presence` after a navigation.

The page agent posts captured console entries to background.js as
`runtime.sendMessage({ ensoConsole: true, entries })`; background keeps up
to 1000 per tab and re-arms capture at `document_start` after each navigation
of a captured tab (`webNavigation.onCommitted`).

## Developer, session and headless tools (helper side)

Defined in `helper/lib/devtools.mjs` and `lib/headless.mjs`, listed with the
page and browser tools in `lib/toolset.mjs`, so Ensō's chat (both engines) and
the zen-browser MCP server get the same set:

| tool | what it does | approval |
|---|---|---|
| `devtools_console` | console + uncaught errors of a tab, from first use | read |
| `devtools_network` | the tab's requests (redacted) | read |
| `page_eval` | JS in the page world, JSON-safe result | action: asks unless requested by the user; logged |
| `page_storage` | storage keys, cookie names/flags; `includeValues` = action | read / action |
| `session_fetch` | request with the user's session in a tab of that site | `sessionAccess` allow, else asks (Ensō) / refused (MCP); non-GET also needs `requested_by_user` |
| `headless_start` | separate headless Zen (`-headless -no-remote`, temp profile, Marionette port from 2829), optional `sites` whose cookies (+ localStorage) are copied | copying a site needs `sessionAccess` allow or approval (Ensō) / allow + Full (MCP) |
| `headless_navigate`, `headless_read`, `headless_screenshot`, `headless_console` | drive/read the headless page | read |
| `headless_click`, `headless_type`, `headless_eval` | act in it | asks like page actions only when it carries copied sessions |
| `headless_stop` | quit it and delete the temp profile | |

The headless browser stops after 10 minutes idle, on `headless_stop`, and when
the helper exits; leftovers of a crashed helper are removed at the next start.
All of these are refused on `sensitiveHosts`, switched off by
`developerTools: false` / `headless: false`, and logged in the activity log
(`source`: the MCP client's label, e.g. "Claude Code" or "Codex", for MCP callers; see below).

## GitHub tools (helper side)

Defined in `helper/lib/github.mjs` and listed in `lib/toolset.mjs`, so
Ensō's chat (both engines) and zen-browser get them. The token comes from
`gh auth token` (GitHub CLI; works in every org that allows the CLI's OAuth
app, no GitHub App needed), else `GH_TOKEN` / `GITHUB_TOKEN`, else the Keychain
(`enso-github`). It is read at use time, kept in memory, never logged or shown
to Claude. Orgs that block it can still be read with `session_fetch` on
github.com, if the user allowed that site.

| tool | what it does | approval |
|---|---|---|
| `github_my_work` | their open PRs (CI, review, conflicts), PRs awaiting their review, assigned issues, mentions (14 days), by repo; one GraphQL request, cached 5 min | read |
| `github_search` | issue/PR search with GitHub syntax, `cursor` paging | read |
| `github_notifications` | unread (or `all`) notifications, reason, subject's current state | read |
| `github_pr` | body, labels, reviewers, reviews, unresolved threads, comments, checks with failing jobs and annotations, linked issues, files; `includeDiff` (capped) | read |
| `github_issue` | body, labels, assignees, milestone, linked PRs, comments | read |
| `github_repo` | open PRs, recent commits on the default branch, latest workflow runs | read |
| `github_comment`, `github_review` (approve / request changes / comment), `github_set_labels`, `github_set_assignees`, `github_close_reopen`, `github_mark_notifications_read` | write as the user | action: runs when `requested_by_user`, otherwise asks (Ensō) / refused (MCP, which also needs `externalControl: "full"`); logged in the activity log |

No merge, delete or force operations. Output is compact text capped at 30k
characters; issue and PR text is marked as data. The morning brief gets a short
GitHub summary (reviews waiting, own PRs that need him) as input for `tasks`.

The page agent flashes a soft outline with the actor's name on the element it
acts on and shows a small "Claude is working on this page" pill (with the MCP
client's name instead when one is acting) while a turn uses page tools; for an
external agent's session the pill stays until the session ends.

## zen-browser MCP server (`helper/lib/mcpserver.mjs`)

`http://127.0.0.1:47823/mcp`, Streamable HTTP, stateless (a fresh server per
POST). Requests with an `Origin` header are refused (403), so web pages can't
call it.

**Tokens and scopes** (`lib/mcpauth.mjs`). `Authorization: Bearer <token>`,
compared against two files in the data folder, re-read on every request:

| file | scope | tools |
|---|---|---|
| `mcp-token` | `full` | every page, browser, developer, headless and GitHub tool (subject to `externalControl`) |
| `mcp-token-read` | `read` | read-only tools only: `tabs_list`, `tab_read`, `history_search`, `page_read`, `page_screenshot`, `page_scroll`, `devtools_console`, `devtools_network`, `page_storage`, `headless_read`, `headless_screenshot`, `headless_console`, `github_my_work`, `github_search`, `github_notifications`, `github_pr`, `github_issue`, `github_repo`. Other tools aren't listed, and calling one returns a tool error. `externalControl` is capped at `"read"`. |

`enso mcp rotate` rewrites both (0600). A helper started before this version
read the token once at start and keeps the old one until Zen restarts.

**Client identity.** Each request is attributed to a client, available to every
tool as `ctx.client = { name, version, label, scope, via, session? }` (`via`:
`"launcher"` or `"http"`; `session`: the launcher's `X-Enso-Session` id, one per
launcher process):

1. `X-Enso-Client: <name>/<version>`, sent by the launcher from the
   `initialize` request's `clientInfo`;
2. else the `clientInfo` of an `initialize` request in the body;
3. else a recognisable `User-Agent`;

`X-Enso-Client-Label` (launcher `--client`) overrides the label. Labels:
`claude-code` → "Claude Code", `codex-mcp-client` / `codex` → "Codex",
`cursor*` → "Cursor", `t3*` → "T3 Code", `claude-ai` → "Claude Desktop",
otherwise the raw name (40 characters), or "An MCP client". The label is the
activity log's `source` (with `client`: the raw name) and the page request's
`agent`.

**Launcher** (`helper/bin/enso.mjs` → `lib/mcplauncher.mjs`): `enso mcp
[--read-only] [--client <label>]` is a stdio MCP server that POSTs each
JSON-RPC line to the endpoint above with the token for its scope (read from the
file per request), `X-Enso-Client`, `X-Enso-Session` and `MCP-Protocol-Version`, and writes the
JSON or SSE replies back as lines. If the helper can't be reached it answers
`initialize` and `ping` itself, `tools/list` from `mcp-tools-cache[-read].json`
(the last list it forwarded), and `tools/call` with
`{ isError: true, content: [{ type: "text", text: "Zen isn't running: open Zen and try again." }] }`;
it then polls every 5 s and sends `notifications/tools/list_changed` when the
helper is back.

**Registration** (`lib/mcpinstall.mjs`): `enso mcp install | uninstall | status`,
see [mcp.md](mcp.md).

**Agent sessions and steering** (`lib/agentsessions.mjs`, wrapped around every
tool's `run` in `mcpserver.mjs`): before a tool runs, the helper checks Stop and
Pause for that agent (and tab; page tools without `tabId` resolve the active tab
with `browser.request` `active_tab`) and collects undelivered notes and the
hand-back note. A refused call returns a tool error; any collected messages are
prepended as separate text blocks (`Message from the user (via Ensō): …`) to
the result, refused or not. The session tools `session_start`,
`session_status` and `session_end` exist only on this server. Every change is
pushed as `agents`; every logged external action as `actions.added`. Semantics:
[mcp.md](mcp.md#sessions-and-steering).

**Screenshots for agents.** Messages collected before a tool runs can also be
MCP content: a screenshot the user sent is a text block
`Screenshot from the user (via Ensō): <message>, <title>, <url>` followed by
`{ type: "image", data, mimeType }`, once. The session tool `inbox_read`
returns everything waiting (notes and screenshots) on demand. The launcher
also sends `X-Enso-T3-Thread` (`$T3CODE_THREAD_ID`, when a T3 Code agent
started it) and `X-Enso-Agent-Pid` (its parent process); both end up in
`ctx.client` (`t3Thread`, `agentPid`).

**`POST /inbox`** (full token only; no `Origin`): the Claude Code
UserPromptSubmit hook (`enso inbox --session-env`). Body
`{ pids: [the hook's ancestors, ≤ 12], t3Thread }`; answer `{ items: [text] }`
for agents whose process is one of `pids` (or that run in `t3Thread`): notes,
and screenshots named by their saved path (a hook can only add text). Items are
marked delivered.
