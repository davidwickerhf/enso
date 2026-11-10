---
title: The new tab
description: One box that opens sites, searches like an address bar and asks like an assistant, plus your tools and widgets. Zen's own address bar can work as that box too.
order: 9
group: Using Ensō
---

# The new tab

Every new tab opens on a single box, with the cursor already in it. It is an address bar and an assistant at once.

## Search or ask

As you type, Ensō offers what you probably meant:

- **A site.** If the text looks like an address, or matches a site in your history or bookmarks, it completes inline (`goo` → `google.com`). Press <kbd>→</kbd> or <kbd>Tab</kbd> to accept.
- **A search** with your default search engine, plus that engine's suggestions if you turn on **Search suggestions while typing** in **Settings → General → New tab & Home** (off by default: what you type then goes to the engine as you type).
- **Your open tabs, bookmarks and history.**
- **Ask Ensō.** Send it to the chat instead.

The button shows what <kbd>Enter</kbd> will do: **Go** for a site, your engine's name for a search, **Ask** for the chat. Two shortcuts skip the guess: <kbd>⇧⌘↵</kbd> always searches, <kbd>⌃⌘↵</kbd> always asks (on Linux and Windows, <kbd>Shift+Ctrl+Enter</kbd> and <kbd>Ctrl+Alt+Enter</kbd>). Opening and searching happen in the browser itself, so they are instant; only questions go to Claude.

Private sites (banking, health, tax; see [Acting on pages](/docs/acting-on-pages#private-sites)) never appear in suggestions.

## Your tools

Under the box, small icons show the tools Ensō can use (Gmail, Calendar, GitHub and so on). Click one to see what it can do, try an example question, switch it off, or open its settings. Hide the strip with its **×**. See [Connecting tools](/docs/tools).

## Widgets

The page stays empty until you add something: choose **Add widgets** under the box, or **Edit widgets** at the top right. Next up, Due soon, Tasks, Mail, GitHub, Quick links and more: see [Widgets](/docs/widgets).

## The address bar

Ensō adds itself to Zen as a search engine called **Ensō**. Make it the default and Zen's address bar becomes Ensō's box too: web addresses still open directly, and everything else you type comes to Ensō.

**Turn it on:** Zen Settings → Search → Default Search Engine → **Ensō**. Ensō never changes your default engine by itself. Settings → General → **Address bar** shows whether it's on.

What happens when you press <kbd>Enter</kbd> depends on one setting, **Address-bar queries go to**:

- **Ensō** (the default): everything goes to an Ensō chat, which starts answering at once. A **Search Google instead** button above the chat sends the same words to your web search engine.
- **Web search**: plain searches go straight to your web search engine, as if Ensō weren't there.
- **Choose each time**: Ensō shows two options, **Ask Ensō** and **Search Google**. <kbd>Enter</kbd> picks the highlighted one, <kbd>Tab</kbd> or the arrow keys switch, and <kbd>Esc</kbd> puts the text in Ensō's box to edit. The highlight starts on whichever you picked last.

Two prefixes override the setting for one search, whatever it is:

| Start with | Goes to |
|---|---|
| <kbd>e</kbd> and a space (`e plan my week`) | Ensō |
| <kbd>g</kbd> and a space (`g lisbon weather`) | your web search engine |

Ensō's page shows the rule in force in one line, for example *Address bar → Ensō · start with g to search Google*, with a link to the setting. Ensō doesn't guess from the words: a question goes to a web search in **Web search** mode, and a single word goes to Ensō in **Ensō** mode.

**Web search engine** is its own setting, next to it. It lists Zen's engines except Ensō, and starts on the engine that was your default before Ensō. The searches on Ensō's new tab use it too.

In Ensō's own box, `?` and `@enso` also ask and `/` also searches. In the address bar Zen uses those characters itself (`?` starts a search with the default engine, `@enso` is Ensō's keyword, `/` opens a file), so use `e` and `g` there. If Ensō isn't your default engine, `@enso` followed by your question still reaches Ensō.

### Dia-style: one floating box

Zen can open its floating command bar instead of a page when you press <kbd>⌘T</kbd>. In `about:config`, set `zen.urlbar.replace-newtab` to `true`. With Ensō as the default engine, that bar is then one box for addresses, searches and questions.

### Privacy

Ensō's search address is `https://enso.wicker.life/ask#q=…`. Your words are in the part after `#`, which browsers never send to a server. The extension catches the address before it loads and opens Ensō's own page instead, takes the address back out of your history, and keeps the words out of any address. If the extension isn't there to catch it, the site's page explains what the link is and offers a web search; it has no analytics and records nothing. Zen itself may remember what you typed in the address bar, as it does for every search.

## Where the cursor starts

Zen puts the cursor in its address bar on every new tab, and extensions can't move it into the page. With Ensō as your default search engine (above) that's no longer a problem: type in the address bar and it comes to Ensō. Otherwise, type a web address or a search there as usual, or click Ensō's box (or press <kbd>Tab</kbd> a few times) to ask Ensō.

If you'd rather type straight into Ensō's own box, turn on **Type straight into Ensō on new tabs** in Settings. Ensō then swaps each new tab for an identical one that gets the cursor; Zen briefly shows the extra tab while it does.
