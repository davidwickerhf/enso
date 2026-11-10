---
title: The sidebar
description: Chat next to the page: what goes with a message, the full page, the brief, and keyboard shortcuts.
order: 8
group: Using Ensō
---

# The sidebar

Press <kbd>⌘E</kbd>, or click the Ensō button in the toolbar, for a chat next to the page you are on. The same conversations are on the new tab and in the full page.

## What goes with your message

The composer shows everything that will be sent:

- **The page chip** (on by default): the text of the tab you are looking at. Click it to leave the page out of this message, or turn the default off in **Settings → General → Include the current page**. On banking, payment, password-manager, health, tax and government sites the chip shows a lock and the page is never sent.
- **<kbd>@</kbd>** mentions another open tab; **All open tabs** in the **+** menu sends all of them. Tabs in the current [Zen space](/docs/spaces) are listed first.
- **+** attaches files: any type, up to 25 MB in total. Images (HEIC too), PDFs, Word, Excel, PowerPoint, text and code are converted so Claude can read them. You can also drop or paste files.
- **The camera** adds a screenshot of the visible page.
- **<kbd>/</kbd>** picks a [skill](/docs/skills).

On familiar sites the box suggests prompts that fit the page: "Summarise this video" on YouTube, "Review this PR" on a GitHub pull request, "Draft a reply" in Gmail or Outlook. They only fill in the box; nothing runs until you send.

From any page you can also select text, right-click and choose **Ask Ensō about this**: the sidebar opens with the passage, link or page in the box.

## While it answers

You see each step as it happens: which tool it used, with what input, and a short preview of the result. Steps that change something wait for your approval (see [Acting on pages](/docs/acting-on-pages)). Press the stop button, or <kbd>Esc</kbd>, to stop; any open approval is denied.

## When another agent is working

When Claude Code, Codex or another agent works on the tab you are looking at through Ensō, a card at the top of the sidebar shows it: its name and task, how long it has been at it, and its last steps, updating as it goes. **Pause**, **Stop** and **Tell the agent…** let you hold it, end it or correct it without going back to its window. Agents in other tabs are listed in the **Agents** row below. Clicking the ✦ pill on the page opens the sidebar on that card. See [Use Zen from other agents](/docs/other-agents#steering-an-agent). When the agent runs in a T3 Code thread, the card names the thread, with **Open in T3**.

## Send a screenshot to an agent

The camera button at the top (or <kbd>⌘</kbd><kbd>⇧</kbd><kbd>2</kbd> anywhere) takes a screenshot of the page, a region you drag or the whole page, and sends it with a message to a T3 Code thread, to Claude Code, Codex, OpenCode or Cursor, or to the clipboard. See [Send screenshots to your agents](/docs/screenshots).

## The full page

Right-click the Ensō toolbar button and choose **Open Ensō as a page**. It has three columns: **Home**, **Activity**, **Tools**, **Settings**, your conversations and reports on the left; the chat in the middle; and on the right, the current page, the pages in this conversation, recent actions and your memory.

## The brief

**Home** in the sidebar and the full page shows a short briefing: a greeting, one line on what matters today, your calendar, mail that needs a reply, deadlines and tasks. Ensō makes it with read-only calls to your tools, about once an hour and on the first start each morning; the refresh button runs it now. Choose how often in **Settings → General → Refresh the brief**. The brief also feeds the [widgets](/docs/widgets). It needs Claude Code.

## Keyboard shortcuts

| Keys | Does |
|---|---|
| <kbd>⌘E</kbd> | Open or close the sidebar |
| <kbd>⌘K</kbd> | Focus the box |
| <kbd>⌘N</kbd> | New chat |
| <kbd>Esc</kbd> | Stop the answer; leave History or Settings |
