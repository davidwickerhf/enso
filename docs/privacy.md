# Privacy

What Ensō keeps on your Mac, what it sends where, and when. This page describes
what the code does, for developers and reviewers. The legal text is the privacy
policy at <https://enso.wicker.life/privacy> (source: `content/privacy.md` in
the enso-site repository); the user-facing summary is
<https://enso.wicker.life/docs/privacy-data>. If this page and the policy
disagree, the policy needs a decision, not a quiet edit: see
[Open points](#open-points-against-the-published-policy).

## Contents

- [Principles](#principles)
- [Stored on your Mac](#stored-on-your-mac)
- [What leaves your Mac](#what-leaves-your-mac)
- [What never leaves your Mac](#what-never-leaves-your-mac)
- [No telemetry](#no-telemetry)
- [The website and sync](#the-website-and-sync)
- [Open points against the published policy](#open-points-against-the-published-policy)

## Principles

- Ensō has no server in the conversation path. The helper talks to Anthropic
  (directly or through Claude Code), to the tools you connected, and to GitHub
  if you use it. enso.wicker.life only serves the installer, updates and the
  website.
- Everything Ensō remembers is a file in `~/Library/Application Support/Enso/`
  or an item in your login Keychain. See [data-model.md](data-model.md).
- Banking, payment, password-manager and health sites are never read or acted
  on ([security.md](security.md#private-sites)).

## Stored on your Mac

| What | Where |
|---|---|
| Conversations with tool calls, approvals and page actions | `Enso/conversations/` |
| Engine state (Claude Code session id, or the API engine's full message history including page text and attachments) | `Enso/conversations/<id>.engine.json` |
| Claude Code's own copy of each subscription-engine conversation | `~/.claude/projects/<…Enso-workspace>/` (written by Claude Code) |
| Activity log | `Enso/actions.jsonl` |
| Profile, memory, space memory | `Enso/profile.md`, `Enso/memory.md`, `Enso/memory/` |
| Settings, your skills, config overlay | `Enso/settings.json`, `Enso/skills.json`, `Enso/config.local.json` |
| Reports, last briefing | `Enso/reports/`, `Enso/dashboard.json` |
| Tool status and OAuth metadata (no secrets) | `Enso/servers.json`, `Enso/connections.json` |
| MCP server tokens | `Enso/mcp-token`, `Enso/mcp-token-read` (0600) |
| API key, GitHub token, OAuth tokens | Keychain: `enso-anthropic`, `enso-github`, `enso-mcp-<name>` |
| Widget layout, quick links, note | `settings.json` and the extension's `localStorage` |
| Network and console logs of your tabs | In the extension's memory only, until Zen quits |

## What leaves your Mac

| To | What | When |
|---|---|---|
| **Anthropic** (through Claude Code on your plan, or the API with your key) | Your message; your profile and memory (system prompt); time, Zen space name, your note about it and that space's memory; the conversation so far; whatever context is attached: the current page's text when the page chip is on, `@`-mentioned tabs, attachments, screenshots; every tool result Claude reads (page snapshots, mail, calendar, GitHub data, console and network output). | Each chat turn. |
| **Anthropic** | Profile, memory and the results of read-only tool calls (calendar, mail, tasks, a GitHub summary) for the Home briefing. | Automatically when the briefing is stale: when Ensō connects and while Home is open, by default when it is more than an hour old or from before 05:00 today (Settings → Home → Refresh the briefing). "Off" stops the refresh while Home is open, but the helper still refreshes when Ensō connects to it (a known issue: `dashboardStale` treats 0 minutes as always stale). |
| **The services behind your tools** | The tool call's input (a Gmail search, an event to create), under your account there. claude.ai connectors go through Anthropic's connector service; servers Ensō signs in to are called by the helper directly. | When a tool runs, and for task apps when the Tasks widget refreshes (`list_tasks`, every five minutes at most). |
| **GitHub** (`api.github.com`) | API requests with your token. | GitHub tools, the GitHub widget, the briefing. |
| **Websites** | Ordinary requests: pages Ensō opens or navigates to, web search and fetch, `session_fetch` with your session on sites you allowed. | When Claude uses those tools. |
| **Other agents' providers** | Whatever an MCP client reads through `zen-browser`: tab lists, page text, screenshots, history, console and network logs, GitHub data. It goes to that client's model provider (Anthropic for Claude Code, OpenAI for Codex, Cursor's providers for Cursor). | When you use Zen from that client. |
| **enso.wicker.life** | Update checks (`/updates.json`) and downloads (the `.xpi`, the helper tarball, `install.sh`), with your IP address in the request log. | Zen's update checks; running the installer. |

## What never leaves your Mac

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

## Open points against the published policy

Checked against `content/privacy.md` (last updated 9 November 2026). These are
for the policy's owner to decide; this repository doesn't change the policy.

1. **"Tax" sites.** The policy says Ensō never reads or acts on "banking,
   payment, tax, health or password-manager sites". The shipped list has no tax
   (or government) patterns. Either add patterns (for example
   `*belastingdienst*`, `*.irs.gov`, `*.hmrc.gov.uk`) or drop "tax" from the
   policy.
2. **Automatic briefing.** The policy describes data going to Anthropic "when
   you send a message". The Home briefing also sends profile, memory and tool
   results to Anthropic without a message, on a timer.
3. **Claude Code transcripts.** The policy says the extension and helper store
   data "as files in your home folder (listed in Privacy & data)". True, but the
   list doesn't include Claude Code's own transcripts in `~/.claude/projects/`.
4. **Other agents.** The policy doesn't mention that MCP clients you connect
   (Codex, Cursor, …) send what they read from Zen to their own providers.
5. **Sync.** The policy describes sync as available and "off unless you turn it
   on". There is no way to turn it on in the current extension or helper. The
   description is accurate for the server; it may be worth saying that the
   client doesn't exist yet.
