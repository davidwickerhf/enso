# Privacy

What Ensō keeps on your computer, what it sends where, and when. This page describes
what the code does, for developers and reviewers. The legal text is the privacy
policy at <https://enso.wicker.life/privacy> (source:
[site/content/privacy.md](../site/content/privacy.md)); the user-facing summary is
<https://enso.wicker.life/docs/privacy-data>. If this page and the policy
disagree, the policy needs a decision, not a quiet edit: see
[Checked against the published policy](#checked-against-the-published-policy).

## Contents

- [Principles](#principles)
- [Stored on your computer](#stored-on-your-computer)
- [What leaves your computer](#what-leaves-your-computer)
- [What never leaves your computer](#what-never-leaves-your-computer)
- [No telemetry](#no-telemetry)
- [The website and sync](#the-website-and-sync)
- [Checked against the published policy](#checked-against-the-published-policy)

## Principles

- Ensō has no server in the conversation path. The helper talks to Anthropic
  (directly or through Claude Code), to the tools you connected, and to GitHub
  if you use it. enso.wicker.life only serves the installer, updates and the
  website.
- Everything Ensō remembers is a file in its data folder or an item in the
  system's secret store. See [data-model.md](data-model.md).

| | macOS | Linux | Windows |
|---|---|---|---|
| Data folder (`Enso/` below) | `~/Library/Application Support/Enso` | `$XDG_DATA_HOME/enso` (default `~/.local/share/enso`) | `%APPDATA%\Enso` |
| Helper log | `~/Library/Logs/Enso/helper.log` | `$XDG_STATE_HOME/enso/helper.log` (default `~/.local/state/enso`) | `%LOCALAPPDATA%\Enso\Logs\helper.log` |
| Secret store | login Keychain | libsecret through `secret-tool` (GNOME Keyring, KWallet, KeePassXC); without a keyring, `Enso/secrets.json` (0600) with a warning in Setup and `enso doctor` | Windows Credential Manager (generic credentials) |
- Banking, payment, password-manager, health, tax and government sites are never read or acted
  on ([security.md](security.md#private-sites)).

## Stored on your computer

| What | Where |
|---|---|
| Conversations with tool calls, approvals and page actions | `Enso/conversations/` |
| Engine state (Claude Code session id, or the API engine's full message history including page text and attachments) | `Enso/conversations/<id>.engine.json` |
| Claude Code's own copy of each subscription-engine conversation | `~/.claude/projects/<…Enso-workspace>/` (written by Claude Code) |
| Activity log | `Enso/actions.jsonl` |
| Profile, memory, space memory | `Enso/profile.md`, `Enso/memory.md`, `Enso/memory/` |
| Settings, your skills, config overlay | `Enso/settings.json`, `Enso/skills.json`, `Enso/config.local.json` |
| Reports, last briefing | `Enso/reports/`, `Enso/dashboard.json` |
| Screenshots saved for T3 Code, the Claude Code hook or "Save + copy path" (0600, deleted after 14 days) | `Enso/screenshots/` |
| Tool status and OAuth metadata (no secrets) | `Enso/servers.json`, `Enso/connections.json` |
| MCP server tokens | `Enso/mcp-token`, `Enso/mcp-token-read` (0600) |
| API key, GitHub token, OAuth tokens (monday.com, Commonfold and other Connect-button servers), T3 Code session | Secret store, account `enso`: `enso-anthropic`, `enso-github`, `enso-mcp-<name>`, `enso-t3` |
| Widget layout, quick links, note | `settings.json` and the extension's `localStorage` |
| Network and console logs of your tabs | In the extension's memory only, until Zen quits |

## What leaves your computer

| To | What | When |
|---|---|---|
| **Anthropic** (through Claude Code on your plan, or the API with your key) | Your message; your profile and memory (system prompt); time, Zen space name, your note about it and that space's memory; the conversation so far; whatever context is attached: the current page's text when the page chip is on, `@`-mentioned tabs, attachments, screenshots; every tool result Claude reads (page snapshots, mail, calendar, GitHub data, console and network output). | Each chat turn. |
| **Anthropic** | Profile, memory and the results of read-only tool calls (calendar, mail, tasks, a GitHub summary) for the Home briefing. | Automatically when the briefing is stale: when Ensō connects and while Home is open, by default when it is more than an hour old or from before 05:00 today (Settings → Home → Refresh the briefing). "Off" (0) stops every automatic refresh, on the helper side (`dashboardStale` returns false) and in the UI; the brief then only runs from its refresh button. |
| **The services behind your tools** | The tool call's input (a Gmail search, an event to create), under your account there. claude.ai connectors go through Anthropic's connector service; servers Ensō signs in to are called by the helper directly. | When a tool runs, and for task apps and monday.com when their widgets refresh (every five minutes at most). Connect-button servers (monday.com, Commonfold, …) use OAuth tokens from the secret store. |
| **Your default search engine** (Google or DuckDuckGo suggestion endpoints) | What you type in the new tab's search box, from the extension (`transport.suggestions`, `credentials: "omit"`, no referrer). | As you type on the new tab. |
| **GitHub** (`api.github.com`) | API requests with your token. | GitHub tools, the GitHub widget, the briefing. |
| **Websites** | Ordinary requests: pages Ensō opens or navigates to, web search and fetch, `session_fetch` with your session on sites you allowed. | When Claude uses those tools. |
| **Other agents' providers** | Whatever an MCP client reads through `zen-browser`: tab lists, page text, screenshots, history, console and network logs, GitHub data. It goes to that client's model provider (Anthropic for Claude Code, OpenAI for Codex, Cursor's providers for Cursor). | When you use Zen from that client. |
| **Your T3 Code server, or a connected agent** | Screenshots the user sends (⌘⇧2 on macOS, Ctrl+Shift+2 elsewhere), with the page URL, title and console errors when ticked. T3 must be on a loopback address; see [security.md](security.md#screenshots-to-agents-and-t3-code). The agent's own provider sees it once the agent uses it. | Only when the user presses Send. |
| **addons.mozilla.org** | Zen's update checks and downloads for the listed add-on, under Mozilla's policy. | Copies installed from AMO, and self-hosted copies after their next update (the listed `.xpi` has no `update_url`). |
| **enso.wicker.life** | Update checks (`/updates.json`) and downloads (the `.xpi`, the helper tarball, `install.sh`), with your IP address in the request log. | Self-hosted copies until they move to AMO; running the installer. |

## What never leaves your computer

- Anything from a private site: no page text, screenshot, session request or
  session copy.
- Page text when the page chip is off, and tabs you didn't mention.
- Your browsing history, except results of `history_search` calls, which become
  part of that conversation.
- Cookie values and tokens (see [security.md](security.md#what-ensō-never-returns)).
- The data folder as a whole: nothing uploads it.

## No telemetry

The extension and helper contain no analytics, telemetry or crash reporting,
and make no requests to enso.wicker.life other than the update feed. Claude Code
(used by the subscription engine) is Anthropic's program and follows
Anthropic's terms, including its own usage reporting; Ensō doesn't change its
settings.

## The website and sync

The site's request logs, its cookieless analytics (Umami) and the session cookie
for account pages are covered by the policy. The site also runs an
end-to-end-encrypted sync server; the extension and helper don't contain a sync
client yet, so no Ensō data is uploaded to it today.

## Checked against the published policy

Checked against `content/privacy.md` (last updated 10 November 2026). The open
points from the previous check are closed:

1. **Tax sites.** Tax authorities and government sign-in portals are now in
   `sensitiveHosts` (Netherlands, US, UK, Germany, France, Italy, Spain,
   Belgium, Australia, New Zealand), and the policy lists every category and
   service by name and links to the patterns.
2. **Automatic briefing.** The policy describes the Home brief, what it sends,
   and how to switch it off; "Off" now really stops it (it didn't before 0.5.5).
3. **Claude Code transcripts.** Disclosed in the policy and in Privacy & data.
4. **Other agents.** Disclosed: what an MCP client reads goes to its provider.
5. **Sync.** The policy and the sync docs say it isn't available in Ensō yet.

Also added: screenshots to T3 Code and agents, OAuth-connected tools
(monday.com, Commonfold) and the addons.mozilla.org listing. The policy is also
sent to AMO as the listing's privacy policy (`amo/amo.mjs listing`), so change
it there by re-running the AMO listing workflow after editing the site.
