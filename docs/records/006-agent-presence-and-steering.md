# 006: Agent presence and steering

Status: accepted and built in 0.5.3 (10 November 2026). This was the plan
`docs/plans/agent-presence.md`; the open questions it listed are answered below.

## Context

Since 0.5.2 other agents (Claude Code, Codex, Cursor) act in Zen through the
`zen-browser` MCP server, and Ensō knows which client made each call. In a live
test, Claude Code typed into a Google Doc and the only sign was the page ribbon,
shown during each action and fading between them. Zen's tab list showed
nothing, Ensō's sidebar showed nothing (the activity log was only read when the
Activity page opened), and the user had no way to pause the agent or correct it
without going back to the terminal. The user asked to see what the agent is
doing when they open Ensō on that page, and to steer it from there.

## Decision

1. **Sessions in the helper** (`helper/lib/agentsessions.mjs`). One session per
   agent per tab: client label, optional task, start and last-action time, the
   last 30 steps (tool, short description, target, ok/error, irreversible). The
   agent is identified by the launcher's per-process id (`X-Enso-Session`);
   plain http clients by label and clientInfo name. A session ends after two
   minutes without calls or on `session_end`. In memory only.
2. **`session_start`, `session_status`, `session_end`** as MCP tools. The
   server instructions and `session_start`'s description ask agents to call it
   first with a one-line task. Agents that don't still get a session, shown with
   their client label and latest step.
3. **Steering rides on tool results.** MCP has no way to push into the agent's
   conversation, so:
   - a **note** typed in Ensō is prepended to the next tool result of that agent
     (any tab) as `Message from the user (via Ensō): …`, exactly once, and the
     card shows "Delivered";
   - **Pause** refuses that agent's calls on that tab, and its tab-less actions
     (closing tabs, GitHub writes, opening tabs), with "The user paused you on
     this tab. Wait, then call session_status or retry later; don't work around
     it." Tab-less reads (`tabs_list`, history, GitHub reads) still pass. Reading
     the paused tab is refused too: the user has taken the tab back, and may be
     typing something they don't want read;
   - the first call after **Resume** carries a hand-back note: the page may have
     changed, call `page_read` again;
   - **Stop** refuses every call of that agent session for 30 minutes, including
     `session_start`. A new agent process (a new launcher id) is not affected.
   Calls return at once instead of waiting: the client may time out first, and a
   clear error lets the agent tell the user.
4. **Live push.** The helper sends `agents` (all sessions) on every change and
   `actions.added` for each logged external action, to background.js and every
   open Ensō page. The sidebar no longer needs reopening to notice an agent.
5. **On the page**, the pill stays for the whole session ("Claude Code · Draft
   the methods section"), with a live dot while a call runs, Paused/Stopped
   states, and a soft outline flash with the client's name on each element acted
   on (static under `prefers-reduced-motion`).
6. **Opening the sidebar from the pill.** Firefox only lets
   `sidebarAction.open()` run in a user-input handler of an extension page, and
   a message from a content script doesn't count (bug 1392624). So the pill
   carries a transparent extension frame (`pill.html`, web-accessible) whose
   click handler opens the sidebar. If the frame can't load, the content script
   asks background.js, which tries anyway and otherwise shows "Press ⌘E for
   Ensō" on the pill.
7. **Zen's tab list.** Extensions can't style Zen's native tab list. What we
   checked in Zen 1.24.1b's `omni.ja`: there is no Zen-specific WebExtension
   API (`ext-browser.json` lists Firefox's); `tabs.update` accepts only `url`,
   `active`, `autoDiscardable`, `highlighted`, `pinned`, `muted`, `openerTabId`,
   `loadReplace` and `successorTabId`; `tab.attention` is read-only for
   extensions, and Zen's theme hides the attention dot anyway
   (`--attention-dot-color: transparent`). Muting, pinning or grouping a tab
   would misuse user-visible state. Changing the favicon was rejected: pages like
   Docs and Gmail rewrite theirs, cross-origin favicons can't be drawn on, and
   restoring them is fragile. So Ensō uses the **page title**: "✦ " in front
   while a session is active (a setting, on by default), kept in place with a
   MutationObserver on `<title>` for pages that rewrite it, and the page's own
   latest title restored exactly at the end; plus a **per-tab copper "AI" badge**
   on Ensō's toolbar button.
8. **Google Docs typing.** Docs draws on a canvas and reads typing from a hidden
   same-origin iframe (`.docs-texteventtarget-iframe`). `page_type` without a
   ref, or with the ref of the page/canvas, on `docs.google.com/document/` types
   there with `execCommand("insertText")` at Docs' cursor, with an Enter keydown
   per newline. Sheets and Slides keep the normal path.

## Consequences

- Notes are user-authored text injected into an agent's context. They only come
  from Ensō's own pages (background.js accepts `ui` ports from extension pages
  only), never from page content, and are labelled. See
  [security.md](../security.md#notes-to-agents).
- MCP clients still never get approvals in Ensō: there is nothing to show inline
  on the card. Approvals for MCP clients remain out of scope (they would change
  [who decides per caller](../security.md#who-decides-per-caller)).
- Agents that ignore refusals can't get around Pause or Stop through Zen; they
  can only stop asking. Agents that never call again never receive a note; it is
  dropped when the session ends.
- `pill.html` is web-accessible, so a page can tell that Ensō is installed by
  probing its URL. The URL contains the per-install extension UUID, which
  Firefox randomises.
- The title prefix changes what the page reports as its title while an agent
  works (bookmarks, history entries made during that time include "✦ ").
- Not verified live in Zen: that `sidebarAction.open()` works from the
  `pill.html` frame. The fallback covers it if not.
