---
title: Memory & profile
description: What Ensō knows about you, how it learns, and how to read and change it.
order: 17
group: Using Ensō
---

# Memory & profile

Ensō is meant to know you, so you don't have to explain yourself every time. What it knows is in two plain Markdown files that you can read and edit.

## Profile

A short description of you: name, what you do, how you like answers. It is included in every conversation and gives Home its greeting. Ensō asks for it the first time you open it (your name, a few lines about you, and optionally what each Zen space is for); change it any time in **Settings → Profile**. It is the file `~/Library/Application Support/Enso/profile.md`.

## Memory

A list of lasting facts and preferences, one per line, each with the date it was added. Ensō adds to it when you tell it something worth keeping ("I'm vegetarian", "call me Dave", "my thesis is due on 12 June"), or when you ask it to remember something. It tells you when it saves something, and the tool call shows exactly what was written.

You can edit or delete any line in **Settings → Memory**. It is the file `memory.md` in the same folder.

## Memory per space

If you use [Zen spaces](/docs/spaces), Ensō can keep a fact to the space you are in, such as a work detail in your work space. Choose **Everywhere** or a space at the top of **Settings → Memory** to see and edit either. A space's memory goes only with messages in that space, in `memory/<space id>.md`.

## What memory is not

Memory doesn't contain your conversations. Ensō only learns from a past conversation if it saved a fact to memory then, or if it [searches your history](/docs/history) when you ask.

## Privacy

Profile and memory never leave your Mac on their own. They are sent to Anthropic as part of each request, as context, because that is how Claude can use them, and with the hourly [brief](/docs/sidebar#the-brief).
