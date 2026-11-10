# Widgets

Small tiles under the box on the new tab. The page stays empty until you add
some. The first time you open edit mode, Ensō starts you with Next up, Due
soon, Tasks and Clock.

## Which widgets are there?

| Widget | Shows | Data from |
|---|---|---|
| Next up | Your next event, and the one after. | The brief (your calendar) |
| Due soon | Deadlines and tasks by date; tick tasks off. | The brief |
| Tasks | Open tasks from your task apps, such as Commonfold; tick them off. | Your task apps, directly, plus the brief |
| monday.com | Items assigned to you across your boards, with status and due date, and the latest update. | monday.com, directly |
| Mail | How many emails need you, and the top one. | The brief (your mail) |
| Practice | Today's practice (for example a language app) in one line. | The brief |
| GitHub | Reviews waiting for you, your PRs that need you, assigned issues. | GitHub, directly |
| Clock | The time and date. | Your Mac |
| Recent chats | Your last three conversations in this space. | Your history |
| Quick links | Up to eight sites, one click away. | You |
| Note | A small scratchpad, saved as you type. | You |
| Ask | Three things Ensō suggests asking today. | The brief |

Widgets that read the brief update when the brief does: about once an hour and
each morning (**Settings → General → Refresh the brief**), or when you press refresh on Home. A widget
whose tool isn't connected stays empty.

## How do I add, move or remove widgets?

Open edit mode in any of these ways:

- **Add widgets** under the box (when there are none yet);
- the **Edit widgets** button at the top right of the new tab;
- **Edit widgets** under the grid;
- right-click a widget.

In edit mode:

- drag a widget to move it, or focus it and use the arrow keys;
- **S** and **M** switch between small and wide (each widget offers the sizes
  that suit it);
- **×** removes it;
- **Add widget** opens the list above.

Choose **Done** or press <kbd>Esc</kbd> to finish. The layout is saved in your
settings, so every new tab shows the same.

## How does the Tasks widget work?

Tasks lists open tasks from task apps you connected:

- **Apps Ensō signs in to itself** (Connect on the Tools page, for example
  Commonfold): Ensō asks the app for its open tasks directly, about every five
  minutes. Ticking a task marks it done in the app, and the change appears in
  Activity.
- **claude.ai connectors** (Todoist, Notion and others connected on claude.ai):
  their tasks come through the brief. Ticking one hides it on this Mac only;
  finish it in the app itself.

The wide size shows up to four tasks with the app's name and the due date; the
small size shows the count and the top task. When Due soon and Tasks are both on
the page, task-app tasks show in Tasks only.

See [connecting tools](connecting-tools.md) to connect a task app.

## Does the Tasks list keep up?

Yes. When you ask Ensō in a chat to add, change or finish a task, the list is
fetched again a moment later and the new task shows with a **New** tag. A new tab,
or a tab you come back to, fetches again when the list is more than a minute old,
and every five minutes while it is open. Overdue tasks come first, then today's,
then the rest by date; reminder times show with a bell.

## How does the monday.com widget work?

Connect monday.com on the Tools page. The widget shows items assigned to you on
your favourite and most-used boards, with status and due date, and the latest
update someone else wrote on them. Items with a due date also show in Tasks. If
monday.com's server fails, the widget says "monday.com isn't responding (server
error)" with Retry, and the Tools page shows "Signed in · server error".

## How does the GitHub widget work?

It uses the same GitHub connection as Ensō's GitHub tools (see
[connecting tools](connecting-tools.md#how-do-i-connect-github)): reviews
requested from you, your open PRs with failing checks, requested changes or
merge conflicts, and issues assigned to you, across all your orgs. It refreshes
at most every five minutes.

## Where are Quick links and the Note stored?

In this browser only, like a bookmark. They don't go to Claude and aren't part
of your Ensō data folder.

## Can I hide "Your tools" under the box?

Yes: the **×** at the end of the strip. Manage tools in **Settings → Connections → Manage**.
