---
title: Spaces & containers
description: How Ensō follows your Zen spaces, what changes per space, and fixing sign-ins after moving logins into containers.
order: 13
group: Using Ensō
---

# Spaces & containers

Zen spaces keep different parts of your life apart: work, personal, study. Each space can have its own **container**, so its tabs have their own cookies and logins. Ensō follows the space you are in.

## Chats follow the space

The chat open in the sidebar belongs to the space it was started in. Switch spaces and Ensō puts it away and brings back the last chat you had open in the new space, or a new chat if there isn't one. Switch back and your chat is there again. A chat that's still answering keeps running while it's out of sight. Unsent text and attachments in the box stay with their space too. History shows this space's chats first; choose **All spaces** to see the rest.

## What changes per space

| | In a space |
|---|---|
| Conversations | Each conversation belongs to the space of its first message. History shows this space's conversations by default; switch to all at the top. |
| What Ensō knows | Your note about the space ("Work at Northwind: use my work accounts") and the space's own memory go with every message there. |
| Memory | Ensō can save a fact to the current space only. **Settings → Memory** shows **Everywhere** or a space. |
| Tabs | <kbd>@</kbd> lists this space's tabs first. "List my tabs" means this space unless you ask for all. New tabs Ensō opens land in this space's container, so they use its logins. |
| Recent chats widget | This space's conversations. |
| Requests with your session | Made in a tab of the site in the right container, so they use the account you are signed in to in that space. |

## Describing your spaces

The first time you open Ensō it lists your spaces and asks what each is for. Change the notes in **Settings → Profile → Zen spaces**. Keep them short and practical: who you are there, which accounts and tools to use.

## How Ensō knows which space you are in

Browser extensions can't see Zen's spaces directly. Ensō's helper reads the list of spaces from Zen's session file on your Mac (names, icons, containers and tabs), and the extension matches the tab you are on to a space by its container. When two spaces share a container, or neither has one, it picks the space whose tabs are open in the window.

So spaces work best when each has its own container. Choose one in the space's settings in Zen.

A space you just added or renamed may take a little while to show up, because Zen updates its session file regularly rather than instantly. If it doesn't appear, quit and reopen Zen.

## Without spaces

Ensō works without spaces, and in Firefox: everything is in one place, with global memory only.

## Sites that won't sign in after moving to containers

Not Ensō's doing, but common after migrating logins into Zen's containers:

- **Netflix, Spotify, Disney+ and other streaming sites need DRM.** In Zen's **Settings → General → Digital Rights Management (DRM) Content**, turn on **Play DRM-controlled content** and restart Zen. The first time, Zen downloads Google's Widevine module in the background; give it a minute. In `about:addons` → **Plugins**, "Widevine Content Decryption Module provided by Google Inc." should be listed and enabled.
- **Imported logins can be stale** or tied to the browser they came from. Sign out on the site and sign in again, in the space where you want to use it.
- **A login lives in its container.** Open the site in the space where you signed in.
