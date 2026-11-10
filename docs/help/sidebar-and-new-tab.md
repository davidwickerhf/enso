# The sidebar and the new tab

Ensō shows up in three places, all with the same conversations: the sidebar,
the new tab, and a full page. Start in one and continue in another.

## How do I open it?

- **Sidebar:** <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and Windows), or the
  Ensō button in the toolbar.
- **New tab:** every new tab opens on Ensō's box, with the cursor already in it.
- **Full page:** right-click the Ensō toolbar button → **Open Ensō as a page**.
  It has three columns: Home, Activity, Tools, Settings and your conversations
  and reports on the left; the chat in the middle; the current page, pages in
  this conversation, recent actions and memory on the right.
- **From a page:** select text, right-click → **Ask Ensō about this**. The
  sidebar opens with the passage, link or page in the box.

## What goes with my message?

The composer shows what will be sent:

- **The page chip** (on by default): the text of the tab you are looking at.
  Click it to leave the page out of this message. Turn the default off in
  **Settings → Behaviour → Include the current page by default**. On banking,
  payment, password-manager and health sites the chip shows a lock and the page
  is never sent.
- **`@`** mentions another open tab; **All open tabs** (in the **+** menu)
  sends all of them. Tabs in the current Zen space are listed first.
- **+** attaches files: any type, up to 25 MB in total. Images, PDFs, Word,
  Excel, PowerPoint, text and code are converted so Claude can read them. You
  can also drop or paste files.
- **The camera button** adds a screenshot of the visible page.
- **`/`** picks a skill (below).

On familiar sites the box suggests prompts that fit: "Summarise this video" on
YouTube, "Review this PR" on a GitHub pull request, "Draft a reply" in Gmail or
Outlook. They only fill in the box; nothing runs until you send.

## What are skills?

Saved prompts behind a slash command. Type `/` to see them.

| Command | What it does |
|---|---|
| `/summarize` | The page or video in five bullets, plus why it matters to you. |
| `/tldr` | A one-paragraph TL;DR. |
| `/factcheck` | The main claims, each checked against other sources with links. |
| `/explain` | The page explained simply, with an example. |
| `/translate` | The page or your text, into English unless you name a language. |
| `/reply` | A draft reply to the email or message on the page. It asks before sending. |
| `/brief` | Your day: calendar, mail that needs you, deadlines. |
| `/tabs` | A tidy grouping of your open tabs, applied when you agree. |

Add your own in **Settings → Skills**: a name, a description and the prompt.
Put `{input}` where the words you type after the command should go.

## When Ensō asks first

> What you ask for runs. Steps Claude proposes on its own, and anything that
> can't be undone, ask you first.

- You say "fill in this form with my address": it fills the form.
- Along the way it wants to click **Submit**, which you didn't ask for: it asks.
- Sending, paying, deleting, booking and posting always ask, even when you
  asked.

An approval card shows the tool, what it will send and why. Choose **Allow**
(this once), **Always allow** (this tool from now on) or **Deny**. Remove
always-allowed tools in **Settings → Always allowed**. Reading tools (search
mail, list events) run without asking; turn that off with **Settings →
Behaviour → Auto-approve read-only tools**.

While Ensō works on a page, the element it touches is outlined and a ribbon at
the top says "✦ Claude is working on this page". It never types passwords,
payment details or one-time codes; it asks you to do that part.

## How do I stop it?

Press the stop button next to the box, or <kbd>Esc</kbd> while it is answering.
Any open approval is denied.

## The new tab

One box for everything. As you type it offers:

- **a site**: an address, or a site from your history or bookmarks, completed
  inline (`goo` → `google.com`). <kbd>→</kbd> or <kbd>Tab</kbd> accepts the
  completion;
- **a search** with your default search engine, with its suggestions;
- **your open tabs, bookmarks and history**;
- **Ask Ensō**, which sends it to the chat.

The button shows what <kbd>Enter</kbd> will do: **Go**, your search engine's
name, or **Ask**. <kbd>⇧⌘↵</kbd> always searches; <kbd>⌃⌘↵</kbd> always asks
(<kbd>Shift+Ctrl+Enter</kbd> and <kbd>Ctrl+Alt+Enter</kbd> on Linux and
Windows).
Opening and searching happen in the browser; only questions go to Claude.

Under the box, **Your tools** shows the tools Ensō can use. Click one to see
what it does, try an example, or switch it off. Hide the strip with its ×.
Below that are your [widgets](widgets.md).

## Where are my conversations?

- **Sidebar:** the clock icon (History). Search finds words in titles,
  messages, tool calls and page actions. History shows this space's
  conversations by default; switch to all spaces at the top.
- **Full page:** the left column.
- Rename or delete a conversation from the list. Deleting removes it from your computer.

## What is the brief?

**Home** in the sidebar and on the full page shows a short briefing: a greeting,
one line on what matters today, your calendar, mail that needs a reply, study
deadlines and tasks. Ensō makes it with read-only calls to your tools about once
an hour and on the first start each morning; the refresh button runs it now.
Choose how often in **Settings → Home**. It needs Claude Code.

## What does Ensō remember?

- **Profile** (**Settings → Profile**): what you wrote about yourself.
- **Memory** (**Settings → Memory**): facts Ensō saved when you told it
  something lasting ("I'm vegetarian", "my thesis is due on 12 June"), one per
  line with the date. Choose **Everywhere** or a Zen space at the top. Edit or
  delete any line.

Ensō says when it saves something, and the tool call shows exactly what was
written. It doesn't learn from conversations otherwise, but it can search them
when you refer to an earlier one.

## Keyboard shortcuts

On Linux and Windows, <kbd>Ctrl</kbd> takes the place of <kbd>⌘</kbd>, and the
new-tab shortcuts are <kbd>Shift+Ctrl+Enter</kbd> and <kbd>Ctrl+Alt+Enter</kbd>.

| Keys | Does |
|---|---|
| <kbd>⌘E</kbd> | Open or close the sidebar |
| <kbd>⌘K</kbd> | Focus the box |
| <kbd>⌘N</kbd> | New chat |
| <kbd>Esc</kbd> | Stop the answer; leave History or Settings |
| <kbd>⇧⌘↵</kbd> / <kbd>⌃⌘↵</kbd> | New tab: always search / always ask |
