---
title: Overview
description: What Ensō is, how its two parts fit together, and where to start.
order: 0
group: Start
---

# Ensō documentation

<p class="lede">Ensō is a personal assistant that lives in the Zen browser. It knows you, uses your tools, and can read and act on web pages. It runs on your own Claude subscription, and keeps what it knows on your Mac.</p>

## Where it lives

- **The sidebar.** Press <kbd>⌘E</kbd> to open a chat next to the page you are on.
- **The new-tab page.** Every new tab opens on Home, a short brief for the day: calendar, mail that needs you, deadlines and follow-ups.
- **A full page.** Right-click the Ensō button for the full-page app, with your conversations, reports and activity.

All three show the same conversations, so you can start in one and continue in another.

## Two parts

Ensō has two pieces, and you install both:

1. **The browser extension.** The interface: sidebar, new tab, full page. It also carries out page actions in your tabs.
2. **The local helper.** A small Node.js program that Zen starts through Firefox *native messaging* whenever the extension needs it. The helper runs Claude (through Claude Code or an API key), talks to your MCP servers, and stores your conversations, memory and settings on disk.

The extension never talks to a server of ours. Your questions go from the helper to Anthropic, and nowhere else. The Ensō website only serves updates and, if you turn it on, encrypted sync.

## Start here

- [Install](/docs/install) the helper and the extension.
- Choose an [engine](/docs/engines): your Claude subscription, or an API key.
- See how it [acts on pages](/docs/acting-on-pages) and when it asks first.
- Read [Privacy & data](/docs/privacy-data) for exactly what is stored where.
