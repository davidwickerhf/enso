---
title: Widgets
description: The tiles on the new tab, how to arrange them, and how the Tasks, monday.com and GitHub widgets get their data.
order: 10
group: Using Ensō
---

# Widgets

Small tiles under the box on the new tab. The page stays empty until you add some; the first time you open edit mode, Ensō starts you with Next up, Due soon, Tasks and Clock.

## The widgets

| Widget | Shows | Data from |
|---|---|---|
| Next up | Your next event, and the one after | The brief (your calendar) |
| Due soon | Deadlines and tasks by date; tick tasks off | The brief |
| Tasks | Open tasks from your task apps, such as Commonfold; tick them off | Your task apps, monday.com, plus the brief |
| monday.com | Items assigned to you across your boards, with status and due date, and the latest update | monday.com |
| Mail | How many emails need you, and the top one | The brief (your mail) |
| Practice | Today's practice, for example in a language app, in one line | The brief |
| GitHub | Reviews waiting for you, your PRs that need you, assigned issues | GitHub |
| Clock | The time and date | Your computer |
| Recent chats | Your last three conversations in this space | Your history |
| Quick links | Up to eight sites, one click away | You |
| Note | A small scratchpad, saved as you type | You |
| Ask | Three things Ensō suggests asking today | The brief |

Widgets that read [the brief](/docs/sidebar#the-brief) update when it does: about once an hour and each morning, or when you press refresh on Home. A widget whose tool isn't connected stays empty.

## Arranging them

Open edit mode with **Add widgets** under the box, the **Edit widgets** button at the top right, **Edit widgets** under the grid, or by right-clicking a widget. Then:

- drag a widget to move it, or focus it and use the arrow keys;
- **S** and **M** switch between small and wide;
- **×** removes it;
- **Add widget** lists the rest.

Choose **Done** or press <kbd>Esc</kbd> to finish. The layout is saved in your settings, so every new tab shows the same.

## The Tasks widget

Tasks lists open tasks from task apps you connected:

- **Apps Ensō signs in to itself**, with the **Connect** button on the Tools page (for example Commonfold): Ensō asks the app for its open tasks directly, about every five minutes. Ticking a task marks it done in the app, and the change shows in **Activity**.
- **claude.ai connectors** (Todoist, Notion and others): their tasks come through the brief. Ticking one hides it on this computer only; finish it in the app itself.

The wide size shows up to four tasks with the app's name, due date and reminder time; the small size shows the count and the top task. Overdue tasks come first, then today's, then the rest by date, then tasks without a date. Tasks due today or tomorrow stand out. Items assigned to you on monday.com that have a due date show here too.

The list keeps itself up to date:

- When you ask Ensō in a chat to add, change or finish a task, the widget fetches the list again a moment later and the new task appears with a small **New** tag (it briefly lights up unless your system is set to reduce motion).
- When you open a new tab or come back to one, it fetches again if the list is more than a minute old, and every five minutes while the page is open.
- Changes another agent (Claude Code, Codex) makes in your task app show at the next of these refreshes.

When Due soon and Tasks are both on the page, task-app tasks show in Tasks only. To connect a task app, see [Connecting tools](/docs/tools#the-connect-button).

## The monday.com widget

Connect monday.com on the Tools page (**Add more** → monday.com → **Connect**, then sign in with your monday account). The widget shows the items assigned to you on your favourite and most-used boards, with their status and due date, and the latest update someone else wrote on one of them (an @ marks updates that mention you). Click an item to open it in monday.com. It refreshes like Tasks, and right after you change something on monday.com from a chat.

If monday.com isn't connected, the widget says so with a link to Tools. If monday.com's server is failing, it says "monday.com isn't responding (server error)" with **Retry**; the Tools page shows the same as "Signed in · server error", and its **Retry** checks again without signing in anew.

## The GitHub widget

It uses Ensō's GitHub connection (see [Connecting tools](/docs/tools#github)): reviews requested from you, your open PRs with failing checks, requested changes or merge conflicts, and issues assigned to you, across all your orgs. It refreshes at most every five minutes.

## Where Quick links and the Note are kept

In this browser only, like a bookmark. They aren't sent to Claude.
