---
title: History & activity
description: Every conversation with its tool calls and page actions, a per-site activity log, and search.
order: 16
group: Using Ensō
---

# History & activity

Ensō keeps a full record, so you can always check what it did, when, and where.

## Conversations

Every conversation is saved with everything that happened in it: your messages, the answers, its reasoning summaries, each tool call with its input and a preview of the result, every approval you gave or refused, and every page action. Open any past conversation from the history list to read it back or carry on.

Conversations get a title automatically; rename or delete them from the list. Deleting a conversation removes its file from your Mac. Each conversation belongs to the [Zen space](/docs/spaces) of its first message, and the list shows this space's conversations unless you switch to all.

## Search

Search finds words in titles, messages, tool calls and page actions across all conversations. Ensō can search your history too: ask "what did we find about flights to Yerevan last week?" and it looks it up.

## Activity per site

Every click, keystroke, selection and navigation Ensō performs is also written to an activity log, with the time, the page, what it did and whether it worked. So are requests made with your session, GitHub changes, tasks ticked off in the Tasks widget, and everything [other agents](/docs/other-agents) do through Ensō, marked with the agent's name. Open **Activity** in the full-page app to see it, filtered to one site if you like; Home also lists the pages Ensō acted on recently. Ensō can read this log as well, when you ask "what did you do on this site?".

## Where it is stored

| What | File |
|---|---|
| Conversation list | `~/Library/Application Support/Enso/conversations/index.json` |
| One conversation | `conversations/<id>.jsonl`, one event per line |
| Activity log | `actions.jsonl` |

They are plain text files you can read, back up or delete. Nothing in them is uploaded.
