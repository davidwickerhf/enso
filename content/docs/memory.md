---
title: Memory & profile
description: What Ensō knows about you, how it learns, and how to read and change it.
order: 15
group: Using Ensō
---

# Memory & profile

Ensō is meant to know you, so you don't have to explain yourself every time. What it knows is in two plain Markdown files that you can read and edit.

## Profile

A short description of you: name, what you do, how you like answers. It is included in every conversation and gives Home its greeting. Ensō starts it with a short template; edit it by opening `~/Library/Application Support/zen-chat/profile.md` in any text editor.

## Memory

A list of lasting facts and preferences, one per line, each with the date it was added. Ensō adds to it when you tell it something worth keeping ("I'm vegetarian", "call me Dave", "my thesis is due on 12 June"), or when you ask it to remember something. It tells you when it saves something, and the tool call shows exactly what was written.

You can edit or delete any line in **Settings → Memory**. It is the file `memory.md` in the same folder.

## What memory is not

Memory doesn't contain your conversations. Ensō only learns from a past conversation if it saved a fact to memory then, or if it [searches your history](/docs/history) when you ask.

## Privacy

Profile and memory never leave your Mac on their own. They are sent to Anthropic as part of each request, as context, because that is how Claude can use them. With [sync](/docs/sync) on, they are uploaded encrypted.
