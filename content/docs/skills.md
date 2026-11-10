---
title: Skills
description: Slash commands for things you ask often, built in or written by you.
order: 14
group: Using Ensō
---

# Skills

A skill is a saved prompt behind a slash command. Type `/` in the composer to see them all, pick one, and add any extra words you like.

## Built in

| Command | What it does |
|---|---|
| `/summarize` | Summarise the page or video in five bullets, plus why it matters to you |
| `/tldr` | A one-paragraph TL;DR |
| `/factcheck` | Lists the main claims and checks each against other sources, with links |
| `/explain` | Explains the page simply, with one example |
| `/translate` | Translates the page or your text (English unless you name a language) |
| `/reply` | Drafts a reply to the email or message on the page, in your voice. It never sends without asking |
| `/brief` | Your brief for today: calendar, mail that needs you, deadlines |
| `/tabs` | Proposes a tidy grouping of your open tabs, and groups them when you agree |

## Your own

In **Settings → Skills**, add a name, a one-line description and the prompt. Write the prompt the way you would ask a person. Put `{input}` where the words you type after the command should go; without it, your words are added at the end.

For example, a skill called `standup`:

```text
From my calendar and the mail I sent yesterday, write three lines for today's stand-up:
what I did, what I'm doing, what is blocking me. {input}
```

A skill of yours with the same name as a built-in one replaces it.

## Suggestions on familiar sites

On some sites the composer offers prompts that fit the page, and its placeholder changes to match. On a YouTube video it suggests "Summarise this video" and "What are the key moments?"; on a GitHub pull request, "Review this PR"; in Gmail, "Summarise this thread" and "Draft a reply". These are shortcuts that fill in the composer; nothing runs until you send.
