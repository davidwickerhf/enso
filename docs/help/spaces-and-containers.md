# Spaces and containers

Zen spaces (workspaces) keep different parts of your life apart: work,
personal, study. Each space can have its own **container**, so its tabs have
their own cookies and logins. Ensō follows the space you are in.

## What changes per space?

| | In a space |
|---|---|
| Conversations | Each conversation belongs to the space of its first message. History shows this space's conversations by default; switch to **All** at the top. |
| What Ensō knows | Your note about the space ("Work at Northwind: Figma, Linear; use my work accounts") and the space's own memory go with every message in that space. |
| Memory | "Remember" can save a fact to the current space only. **Settings → Memory → Everywhere / <space>** shows either. |
| Tabs | `@`-mentions list this space's tabs first. "List my tabs" means this space unless you ask for all. New tabs Ensō opens land in this space, in its container, so they use its logins. |
| Recent chats widget | This space's conversations. |
| Requests with your session | Made in a tab of the site in the right container, so they use the account you are signed in to in that space. |

## How do I describe my spaces?

The first time you open Ensō it lists your spaces and asks what each is for.
Change the notes in **Settings → Profile → Zen spaces**. Keep them short and
practical: who you are there, which accounts and tools to use.

## How does Ensō know which space I'm in?

Browser extensions can't see Zen's spaces directly. Ensō's helper reads the
list of spaces from Zen's session file in your Zen profile (names, icons,
containers and their tabs), and the extension matches the tab you are on to a space by its
container. When two spaces share a container (or both have none), it picks the
space whose tabs are open in the window.

So spaces work best when each one has its own container. In Zen, choose a
container in the space's settings (or when you create the space).

## I added or renamed a space and Ensō doesn't show it

Zen updates its session file regularly, not instantly. Wait a little, then
reopen the sidebar. If it still doesn't appear, quit and reopen Zen.

## Does Ensō work without spaces, or in Firefox?

Yes. Without spaces, everything is in one place: all conversations, global
memory only, all tabs.

## Netflix or another site won't sign in after I moved my logins into containers

That is the browser, not Ensō, but it often happens after migrating to Zen:

- **DRM.** Netflix, Spotify, Disney+ and similar need DRM (Widevine). In Zen's
  **Settings → General → Digital Rights Management (DRM) Content**, turn on
  **Play DRM-controlled content**, then restart Zen. The first time, Zen
  downloads the Widevine module in the background; give it a minute. Check
  `about:addons` → **Plugins**: "Widevine Content Decryption Module provided by
  Google Inc." should be there and enabled.
- **Imported cookies.** Logins copied from another browser can be stale or tied
  to that browser. Sign out on the site and sign in again in the right space.
- **The wrong container.** A login lives in the container where you signed in.
  Open the site in the space where you want to use it.
