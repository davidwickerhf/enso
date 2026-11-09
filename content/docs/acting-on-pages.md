---
title: Acting on pages
description: What Ensō can do on a web page, when it asks first, and which sites it never touches.
order: 11
group: Using Ensō
---

# Acting on pages

Ensō can work on the page in front of you, much like Claude in Chrome: it reads the page, clicks, types, chooses options, scrolls, navigates, goes back, and takes screenshots.

## What it can do

| Action | What happens |
|---|---|
| Read | Takes a snapshot of the page: its text, and the buttons, links and fields on it |
| Click | Clicks a button or link |
| Type | Types into a field, and can submit the form |
| Select | Picks an option in a menu |
| Press | Presses a key, such as Enter or Escape |
| Scroll | Scrolls the page or a panel |
| Navigate, back | Opens a URL in the tab, or goes back |
| Screenshot | Captures what is visible, to look at it |

While it works, a small ribbon on the page says that Ensō is working, and each element it touches is outlined for a moment, so you can follow along.

## The approval rule

> What you ask for runs. Steps it proposes on its own, and anything that can't be undone, ask you first.

In practice:

- You ask "fill in this form with my address" and it fills the form: you asked for that.
- Along the way it wants to click **Submit**, which you didn't mention. It asks first.
- Anything irreversible always asks, even when you asked for it: paying, sending, deleting, booking, posting.

Approvals look the same as for other tools: **Allow**, **Always allow** or **Deny**. Denying stops that step; Ensō tells you what it would have done and waits.

## Sensitive sites

Banking, payment, tax, health and password-manager sites are **never read or acted on**. When one is open, the page chip in the composer shows a lock, the page is not sent with your message, and page tools refuse to run on it.

The list ships with common banks, payment services, government and health portals, and patterns such as `*bank*` and `*health*`. You can extend it under `sensitiveHosts` in `config.json`; patterns use `*` as a wildcard.

## Where it acts

Page actions run in the tab you were looking at when you sent the message, even if you switch tabs meanwhile. Ensō can also open new tabs and read other tabs you mention with @.

Every action is written to the [activity log](/docs/history) for that site.
