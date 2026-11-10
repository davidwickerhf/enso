---
title: Changelog
description: What changed in each release of the Ensō extension and helper.
order: 32
group: Reference
---

# Changelog

The extension and the helper share one version number. The extension updates itself; run the [installer](/docs/install) again to update the helper.

## 0.5.7 — 10 November 2026

- **Two builds.** The **Firefox Add-ons build** from addons.mozilla.org (recommended) and the **direct download build** from this site, which also has `page_eval` for agents that debug your pages with JavaScript. **Settings → Setup** says which one you have. See [Install → Two builds](/docs/install#two-builds).
- **Find elements and inspect them**, without running code: `page_query` and `page_inspect` for Claude and your [agents](/docs/other-agents), in both builds.
- **Nothing is sent automatically on new installs.** The Home brief only runs when you press refresh, or once a day after **Turn on the daily brief**; new-tab search suggestions are off until you turn on **Search suggestions while typing**. Existing installs keep their settings.

## 0.5.5 — 10 November 2026

- **On Firefox Add-ons.** Ensō is now a listed add-on on addons.mozilla.org, and updates come from there. Copies installed from this site move over with this update.
- **Guided setup.** Without the helper, Ensō shows the one install command with a Copy button and carries on by itself when the helper is there. **Settings → Setup** then has a button for everything else: Claude Code or an API key, your agents, T3 Code, GitHub and tools. See [Install](/docs/install).
- **Tax and government sites are private** too, like banking and health sites: the Belastingdienst, DigiD, MijnOverheid, the IRS, HMRC and others. See [Privacy & data](/docs/privacy-data#private-sites).
- **"Off" really stops the Home brief** (Settings → Home); it then only updates when you press refresh.
- The [privacy policy](/privacy) now covers the Home brief, Claude Code's own transcripts, other agents, screenshots and connected tools, and lists every private site.

## 0.5.4 — 10 November 2026

- **Tasks refresh** after a chat changes them, and in the background while the new tab is open.
- **monday.com on the new tab**: what's assigned to you, with recent updates.

## 0.5.3 — 10 November 2026

- **See what other agents are doing.** When Claude Code, Codex or another agent works in Zen, the page shows a pill with its name and task for as long as it works, the tab's title starts with ✦ in Zen's tab list, and Ensō's toolbar button shows an **AI** badge on that tab.
- **Steer them from the sidebar.** A card shows the agent's task and steps as they happen, with **Pause**, **Stop** and **Tell the agent…**; an **Agents** row lists agents in other tabs and spaces. Click the pill to get there. See [Use Zen from other agents](/docs/other-agents#steering-an-agent).
- **Activity updates live**, including other agents' actions.
- **Typing into Google Docs** works for agents.

## 0.5.2 — 10 November 2026

- **Use Zen from Claude Code, Codex and Cursor** without a token in their settings: `enso mcp install` registers Ensō with each of them, and `enso mcp status`, `uninstall` and `rotate` manage it. See [Use Zen from other agents](/docs/other-agents).
- **Read-only access** for agents you only want looking: `enso mcp install --read-only`.
- **Ensō names the agent** that is acting, in Activity and on the page ribbon ("Codex is working on this page").
- Agents start cleanly while Zen is closed, and pick Zen up when it opens.
- The installer writes the `enso` command.

## 0.5.1 — 10 November 2026

- **Tasks widget**: open tasks from your task apps, such as Commonfold, on the new tab. Tick one off and it is done in the app. See [Widgets](/docs/widgets#the-tasks-widget).
- The brief also lists open tasks from connected task apps.
- **Editing widgets is easier**: an Edit widgets button under the grid, and right-click on a widget.
- Typing into rich editors, such as Outlook's, works reliably.

## 0.5.0 — 9 November 2026

The first release as Ensō, with this website, a one-line installer and automatic extension updates. Earlier builds were called Zen Chat.

- **Onboarding** asks your name, a few lines about you and what each Zen space is for.
- **`config.local.json`** in your data folder for your own configuration; updates never overwrite it.
- Ensō runs on the Claude Code you installed, so the helper is a small download.
- Existing Zen Chat data is copied over on first start.
- Typing into pages that ignore simulated keystrokes works.
- **MIT licence.**

## 0.3 — November 2026

- **New tab:** one box that searches like an address bar and asks like an assistant, with inline completion, search suggestions and the cursor already in it. Widgets replace the daily brief on the new tab.
- **Zen spaces:** Ensō knows which space you are in; conversations, memory and tab tools follow it.
- **Tools panel:** see what each tool does, switch it off, or connect more on claude.ai, including Microsoft 365.
- **Attach any file:** Word, Excel, PowerPoint, archives, code and images (HEIC too), up to 25 MB.
- **Faster:** answers start in about two seconds; sessions stay warm between messages.
- **Claude Code can use Zen** through a local MCP server.

## 0.2.0

The release that made the sidebar chat into Ensō.

- **Two engines.** Your Claude subscription through Claude Code (Claude Agent SDK), or an Anthropic API key from the Keychain. Conversations carry over when you switch.
- **Home.** A morning brief on every new tab: calendar, mail that needs you, deadlines, follow-ups and suggestions, refreshed hourly with read-only tools.
- **Acting on pages.** Read, click, type, select, scroll, navigate and screenshot, with the approval rule: what you ask for runs; proposed or irreversible steps ask first.
- **Browser tools.** List, open, close, group and rename tabs; search browsing history.
- **Context.** The current page (with YouTube transcripts), @-mentions of tabs or all tabs, attachments up to 10 MB, screenshots, and suggestions that fit the site you are on.
- **Skills.** `/summarize`, `/tldr`, `/factcheck`, `/explain`, `/translate`, `/reply`, `/brief`, `/tabs`, and your own.
- **Reports.** Documents with bar and line charts that open in a new tab.
- **History.** Every conversation with its tool calls, approvals and page actions; search; a per-site activity log.
- **Memory and profile.** Editable Markdown files that Ensō reads in every conversation and adds to when you tell it something lasting.
- **Sensitive sites.** Banking, payment, government, health and password-manager sites are never read or acted on.
- **MCP servers beyond Claude Code's**, with tokens kept in the Keychain.

## 0.1.0

- A Claude chat in Zen's sidebar, with MCP tools.
