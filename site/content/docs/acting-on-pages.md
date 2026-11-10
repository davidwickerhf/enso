---
title: Acting on pages
description: What Ensō can do on a web page, when it asks first, and which sites it never touches.
order: 12
group: Using Ensō
---

# Acting on pages

Ensō can work on the page in front of you: it reads the page, clicks, types, chooses options, presses keys, scrolls, navigates, goes back and takes screenshots.

## What it can do

| Action | What happens |
|---|---|
| Read | Takes a snapshot of the page: its text, and the buttons, links and fields on it |
| Click | Clicks a button or link |
| Type | Types into a field, replacing what is there, and can submit the form |
| Select | Picks an option in a menu |
| Press | Presses a key, such as Enter or Escape |
| Scroll | Scrolls the page or to an element |
| Navigate, back | Opens a URL in the tab, or goes back |
| Screenshot | Captures what is visible, to look at it |

While it works, a pill at the top of the page says "✦ Claude is working on this page", and the element it touches flashes an outline, so you can follow along. When another agent works through Ensō, the pill names it and its task ("✦ Codex · Fix the failing checkout test") and stays until it is done; see [Use Zen from other agents](/docs/other-agents#seeing-what-an-agent-is-doing).

## The approval rule

> What you ask for runs. Steps it proposes on its own, and anything that can't be undone, ask you first.

In practice:

- You ask "fill in this form with my address" and it fills the form: you asked for that.
- Along the way it wants to click **Submit**, which you didn't mention. It asks first.
- Anything irreversible always asks, even when you asked for it: paying, sending, deleting, booking, posting.

Approvals look the same as for other tools: **Allow**, **Always allow** or **Deny**. Denying stops that step; Ensō tells you what it would have done and waits. It never types passwords, payment details or one-time codes itself; it asks you to do that part.

## Private sites

Banking, payment, password-manager and health sites are **never read or acted on**. When one is open, the page chip in the composer shows a lock, the page and screenshots are not sent with your message, and page tools refuse to run on it.

The list ships with PayPal, Wise, Revolut, bunq, N26, Monzo, Chase, American Express, 1Password, Bitwarden, LastPass and Dashlane, and any site whose address contains `bank`, `health` or `patient`. It is short, so if your bank's address doesn't contain "bank", add it under `sensitiveHosts` in `~/Library/Application Support/Enso/config.local.json` (patterns use `*` as a wildcard, for example `"*.mybank.example"`) and restart Zen. You can add to the list but not remove from it.

## Where it acts

Page actions run in the tab you were looking at when you sent the message, even if you switch tabs meanwhile. Ensō can also open new tabs (in the current space) and read other tabs you mention with <kbd>@</kbd>. Tabs Zen has unloaded can't be read until you open them.

Every action is written to the [activity log](/docs/history).
