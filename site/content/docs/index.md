---
title: Overview
description: What Ensō is, how its two parts fit together, and where to start.
order: 0
group: Start
---

# Ensō documentation

<p class="lede">Ensō is an assistant inside the Zen browser. It knows you, uses your tools, and can read and act on web pages. It runs on your own Claude subscription, and keeps what it knows on your computer.</p>

## Where it lives

- **The sidebar.** Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and Windows) for a chat next to the page you are on. See [the sidebar](/docs/sidebar).
- **The new tab.** One box that [opens sites, searches or asks](/docs/new-tab), with the cursor already in it, plus [widgets](/docs/widgets) you choose.
- **A full page.** Right-click the Ensō toolbar button for the full-page app, with your conversations, reports, tools and activity.

All three show the same conversations, so you can start in one and continue in another. Other agents on your computer, such as Claude Code or Codex, can [use Zen through Ensō](/docs/other-agents) too.

## Two parts

You add the extension, then run one command for the helper; everything after that is buttons in **Settings**:

1. **The browser extension**: the sidebar, new tab and full page. It also carries out page actions in your tabs.
2. **The local helper**: a small Node.js program that Zen starts whenever the extension needs it. It runs Claude (through Claude Code or an API key), talks to your tools, and stores your conversations, memory and settings on your computer. It runs on macOS, Linux and Windows.

Your questions go from the helper to Anthropic, and to the tools you connected. Ensō's website only serves the installer and updates.

## Start here

1. [Install](/docs/install) the extension and the helper, then finish in **Settings → Setup**.
2. Choose an [engine](/docs/engines) there: your Claude subscription, or an API key.
3. Learn [when Ensō asks first](/docs/acting-on-pages) before acting on a page.
4. [Connect your tools](/docs/tools): mail, calendar, task apps, GitHub.

All guides:
