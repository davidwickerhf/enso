---
title: Privacy & data
description: Exactly what Ensō stores, where it is stored, and what leaves your computer.
order: 20
group: Your data
---

# Privacy & data

The short version: Ensō stores everything on your computer. What you send in a conversation goes to Anthropic so Claude can answer, and tool calls go to the services you connected. Nothing goes to us. The formal version is the [privacy policy](/privacy).

## Stored on your computer

In Ensō's data folder unless noted: `~/Library/Application Support/Enso` on macOS, `~/.local/share/enso` on Linux (or `$XDG_DATA_HOME/enso`), `%APPDATA%\Enso` on Windows.

| What | Where |
|---|---|
| Conversations, with tool calls, approvals and page actions | `conversations/` |
| Activity log (page actions, session requests, GitHub changes, other agents' actions) | `actions.jsonl` |
| Profile and memory, global and per space | `profile.md`, `memory.md`, `memory/` |
| Settings, your skills, your configuration | `settings.json`, `skills.json`, `config.local.json` |
| Reports | `reports/` |
| Screenshots you saved or sent to T3 Code or an agent (deleted after 14 days) | `screenshots/` |
| Home brief (the last one) | `dashboard.json` |
| Tool status and sign-in details without secrets | `servers.json`, `connections.json` |
| Access tokens for [other agents](/docs/other-agents) | `mcp-token`, `mcp-token-read` (readable only by you) |
| The helper program | `helper/` |
| Claude Code's own record of subscription-engine conversations | `~/.claude/projects/` (kept by Claude Code) |
| API key (if you use one) | Secret store, item `enso-anthropic` |
| GitHub token (if you saved one) | Secret store, item `enso-github` |
| Sign-ins to tools you connected with the Connect button (monday.com, Commonfold, …) | Secret store, items `enso-mcp-<name>` |
| T3 Code access token (if you connected T3) | Secret store, item `enso-t3` |
| Tokens for servers in `config.local.json` | Secret store, items you name |
| Widget layout, quick links, note | Your settings and the extension's own storage |
| The helper's log (startup lines and errors, never your messages, keys or tokens) | `~/Library/Logs/Enso` on macOS, `~/.local/state/enso` on Linux, `%LOCALAPPDATA%\Enso\Logs` on Windows |

The secret store is your system's own: the login Keychain on macOS, Credential Manager on Windows, and on Linux your desktop keyring (GNOME Keyring, KWallet or KeePassXC, through `secret-tool`). On Linux without a keyring, Ensō keeps these in `secrets.json` in the data folder, readable only by you, and Settings → Setup warns about it.

These are ordinary files in your home folder, readable by your user account, and included in your backups (Time Machine, File History or whatever you use) like everything else. The network and console logs Ensō keeps of your tabs for the [developer tools](/docs/session-access) are held in memory only, until Zen quits.

## What leaves your computer

**To Anthropic, when you send a message.** Your message, your profile and memory, the time and your Zen space with your note about it, the conversation so far, and whatever context you included: the current page's text, mentioned tabs, attachments, screenshots, and the results of tools Ensō used to answer. With the subscription engine this goes through Claude Code; with an API key, directly to the Anthropic API. Anthropic handles it under the terms you agreed with them.

**To Anthropic, for the brief.** The Home brief is off by default: it is made when you press its refresh button, or by itself once you turn it on (**Turn on the daily brief** during setup, or **Settings → General → Refresh the brief**). Each brief sends your profile and memory, plus what read-only tools return (calendar, mail, tasks, a GitHub summary), to Anthropic through Claude Code. **Off** stops every automatic refresh. Installs from before 0.5.7 keep the hourly refresh they had until they change it.

**To the services you connected, when a tool runs.** A Gmail search goes to Google, a calendar event is created in your calendar, a GitHub comment goes to GitHub, and so on. Read-only tools run without asking; anything that changes something asks first. The Tasks and monday.com widgets ask those services for your open items every few minutes. Tools you connect with the Connect button sign in with OAuth, and the helper talks to them directly.

**To your search engine, as you type in the new tab's search box, only if you turn it on.** With **Settings → General → Search suggestions while typing** on, Google or DuckDuckGo (whichever is your default) gets what you type, for suggestions, without cookies. It is off for new installs; installs from before 0.5.7 keep it on until they switch it off.

**To the web, when Ensō searches or opens a page** on your behalf, like any browser request, and requests with your session on sites you [allowed](/docs/session-access).

**To other agents' providers, when you use Zen from them.** What Claude Code, Codex, Cursor or another agent reads through Ensō (`enso mcp`) goes to that agent's AI provider: Anthropic for Claude Code, OpenAI for Codex, and so on.

**Screenshots you send** stay on your computer: they go to your own T3 Code server on this computer, to a connected agent, or to the clipboard. Whatever that agent does with them next is up to the agent.

**To addons.mozilla.org**, if you installed Ensō from there: Zen gets updates from Mozilla, like any listed add-on.

**To enso.wicker.life**, only:

- the update check of copies installed from our site (Zen fetches `updates.json` and the new version, which puts your IP address in the server's request log), until their next update moves them to the addons.mozilla.org version;
- the helper download when you run the install script.

## What never leaves your computer

- Anything from [private sites](#private-sites): banking, payment, password-manager, health, tax and government sites. Ensō doesn't read or act on them at all.
- Your browsing history, except search results Ensō looks up when you ask it to, which become part of that conversation.
- Pages you didn't include. Ensō sends the current page only when the page chip is on (it is on by default; turn the default off in Settings → General), and other tabs only when you mention them.
- Cookie values, passwords and tokens. Claude never sees them.

## Private sites

Ensō never reads, screenshots or acts on these sites, never makes requests with your session there, and won't copy that session to the headless Zen:

- **Banks and payment:** any address containing `bank`, and PayPal, Wise, Revolut, bunq, N26, Monzo, Chase, American Express.
- **Password managers:** 1Password, Bitwarden, LastPass, Dashlane.
- **Health:** any address containing `health` or `patient`.
- **Tax and government:** Belastingdienst, Toeslagen, MijnOverheid and DigiD (Netherlands); IRS, Social Security and Login.gov (US); HMRC, GOV.UK tax services and GOV.UK One Login (UK); ELSTER (Germany); impots.gouv.fr (France); Agenzia delle Entrate (Italy); Agencia Tributaria (Spain); MyMinfin (Belgium); the Australian Taxation Office and myGov; Inland Revenue (New Zealand).

The exact patterns are `sensitiveHosts` in [helper/config.json](https://github.com/davidwickerhf/enso/blob/main/helper/config.json). They match the site's address, so a bank or office whose address isn't listed isn't covered. Add your own in `config.local.json` in the data folder, then restart Zen:

```json
{ "sensitiveHosts": ["*.mybank.example", "portal.example.gov"] }
```

`*.example.com` covers example.com and every subdomain. You can add sites to the list but not remove the shipped ones.

## Sync

**Sync isn't available in Ensō yet.** The website runs an end-to-end encrypted [sync](/docs/sync) server, but the extension and helper have no way to turn it on, so nothing of yours is uploaded to it.

## No tracking

The extension and helper contain no analytics, telemetry or crash reporting. The website may count page views with a self-hosted, cookieless analytics tool (Umami) that stores no personal data; the account pages and the API are never counted.
