---
title: Send screenshots to your agents
description: Take a screenshot of a page in Zen and send it to a T3 Code thread, to Claude Code, Codex, OpenCode or Cursor, or to the clipboard.
order: 19.5
group: Using Ensō
---

# Send screenshots to your agents

Press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>2</kbd> (<kbd>Ctrl+Shift+2</kbd> on Linux and Windows) on any page (or the camera button at the top of Ensō's sidebar), drag over the part you want, and send it to the agent you're working with: a thread in T3 Code, a Claude Code, Codex, OpenCode or Cursor session, or the clipboard for anything else. A message and the page's address can go with it.

## Take the screenshot

With the shortcut, the page dims and a hint appears at the top:

- **Drag** to select a region.
- <kbd>↵</kbd> takes the **visible area**; a click without dragging does too.
- <kbd>F</kbd> takes the **full page**, top to bottom (very long pages are scaled down).
- <kbd>Esc</kbd> cancels.

The sidebar opens with the send sheet. macOS keeps <kbd>⌘</kbd><kbd>⇧</kbd><kbd>3</kbd>, <kbd>4</kbd> and <kbd>5</kbd> for its own screenshots; to use another key on any system, open `about:addons`, click the gear, and choose **Manage Extension Shortcuts**. Screenshots are off on banking, health, tax and other private sites.

## Send it

The sheet shows the screenshot, where it's going, and a message box.

- **Where it goes.** Ensō picks the target when it can (below). **Change** opens the list: agents first, then T3 threads that are running or waiting for you, then threads of the project that matches this site, then recent ones. Type to search.
- **Page URL and title** go along unless you untick it. **Console errors** are off by default; the box is there when Ensō has been reading this tab's console.
- **Always send this tab here** remembers the choice for this tab until you close it.
- <kbd>↵</kbd> sends, <kbd>⇧</kbd><kbd>↵</kbd> adds a new line, <kbd>Esc</kbd> cancels.

A note at the bottom says "Sent to …". For T3 threads, **Open in T3** jumps to the thread.

### How Ensō picks the target

1. **An agent is working on this tab.** If it runs inside T3 Code, the screenshot goes to its T3 thread; otherwise to the agent itself.
2. **You linked this tab** to a thread or an agent.
3. **You linked this site to a T3 project** (from the sheet: "Use atlas-web for localhost:5173"). Its running or most recent thread is chosen.
4. Otherwise you choose from the list.

Links are listed under **Settings → Agents & screenshots → Linked threads**, where you can remove them.

## T3 Code

Connect once: **Settings → Connections → T3 Code → Connect**, or in a terminal:

```sh
enso t3 connect
```

This asks T3 Code for a token that can read your threads and send them messages, and nothing else, valid for 30 days. It is kept in your system's secret store (Keychain, Credential Manager or your Linux keyring). `enso t3 status` shows whether it still works; `enso t3 disconnect` revokes it.

Screenshots arrive in the thread as images, just like pasting one into T3. If the thread is busy, yours is queued as its next message; nothing is interrupted. If your T3 Code can't take images from Ensō, the sheet says so: Ensō then saves the PNG in its folder and sends the file's path, which Claude Code and Codex open.

T3 Code has to be open. Your threads appear in the list only while it is running.

## Claude Code, Codex, OpenCode and Cursor

Any agent connected to Zen through Ensō (see [Use Zen from other agents](/docs/other-agents)) is listed under **Agents**, even when it's idle. The screenshot waits for it and arrives with its next step in Zen, as an image, marked as coming from you. You can also tell the agent "I sent you a screenshot": it fetches it with `inbox_read`.

So that an idle **Claude Code** gets it with your next message instead, turn on **Claude Code hook** in **Settings → Agents & screenshots** (or run `enso mcp install --hooks`).

Claude Code then gets the screenshot's file path with your message and opens it. Codex and OpenCode have no such hook; they get it with their next step or when they call `inbox_read`.

## Any other agent: copy it

**Copy image** puts the screenshot on the clipboard: paste it into Claude Code, Codex or OpenCode in the terminal with <kbd>⌘</kbd><kbd>V</kbd> on macOS or <kbd>Ctrl</kbd><kbd>V</kbd> on Linux and Windows (some terminals use <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>V</kbd>). **Save + copy path** saves it in Ensō's folder and copies the file path instead.

## Privacy

Screenshots show whatever is on the page, so look before you send. They stay on your computer: they go to T3 Code on this machine, to a local agent, or to your clipboard, and from there to that agent's AI provider like anything else you give it. Saved copies are in the `screenshots` folder of Ensō's data folder (`~/Library/Application Support/Enso` on macOS, `~/.local/share/enso` on Linux, `%APPDATA%\Enso` on Windows) and are deleted after 14 days. Details: [Privacy and data](/docs/privacy-data).

## Console errors

Ensō captures a tab's console errors on development sites by itself (localhost, LAN addresses and `.local`, `.test` or `.localhost` hosts). On other sites, choose **Start capturing** in the send sheet (errors from then on; reload the page to catch errors while it loads) or **Always on <site>** to capture there every time.

If **Enter**, **F** or **Esc** don't respond while you select a region, use the buttons in the bar at the top of the page; Ensō also passes those keys on from its sidebar.
