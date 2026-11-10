# Getting started

Ensō is an assistant inside the Zen browser: a chat in the sidebar, a
search-or-ask box and widgets on every new tab, and an agent that can read and
act on web pages. It runs on your own Claude subscription (through Claude Code)
or an Anthropic API key, and keeps what it knows on your Mac.

## What do I need?

| | |
|---|---|
| Mac | macOS. Linux and Windows aren't supported yet. |
| Browser | [Zen](https://zen-browser.app). Firefox 139 or newer works too, without Zen's spaces. |
| Claude | Your Claude plan (through Claude Code, which Setup installs for you) or an Anthropic API key. |

Nothing else has to be installed first: if your Mac has no Node.js 18 or newer,
the installer fetches Ensō's own copy.

## How do I install it?

1. **Add the extension.** Open <https://enso.wicker.life/releases/enso-latest.xpi>
   in Zen. Zen asks whether to add Ensō and lists its permissions. Choose **Add**.
2. **Run one command.** Press <kbd>⌘E</kbd>. Ensō sees its helper isn't there yet
   and shows this command with a **Copy** button:

   ```sh
   curl -fsSL https://enso.wicker.life/install.sh | bash
   ```

   Open Terminal (<kbd>⌘ Space</kbd>, type *Terminal*, <kbd>Return</kbd>), paste
   it and press <kbd>Return</kbd>. It downloads the helper and checks its
   SHA-256 (and, only if needed, Node.js, checked against a pinned SHA-256);
   installs it in `~/Library/Application Support/Enso/helper`; registers it with
   Zen and Firefox; writes the `enso` command; and prints a short summary. It
   asks no questions, needs no password and leaves your data alone. Ensō moves
   on by itself when it's done: no need to restart Zen.

   Why a terminal step? Browsers don't let an extension install or start a
   program, and an extension can't open Terminal either. It's the only one.
3. **Finish in Setup.** After a few words about you, Ensō opens
   **Settings → Setup**: install or sign in to Claude Code (or paste an API key).
   Then, if you like, let Claude Code, Codex, Cursor or OpenCode use Zen
   (**Agents & screenshots**) and connect T3 Code and GitHub (**Connections**).
   Each item is a button; the same checks run in a terminal with `enso setup`.

Prefer to read the script first: `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then `bash install.sh`.

## Why does it ask for these permissions?

| Permission | Used for |
|---|---|
| Access your data for all websites | Reading the page when you ask about it, acting on pages when you ask it to, the developer tools. |
| Exchange messages with programs other than Firefox | Talking to the helper on your Mac. |
| Access browser tabs and tab groups | `@`-mentioning tabs, listing, opening, grouping and closing tabs. |
| Access browsing history, bookmarks | Suggestions in the new-tab box; searching history when you ask. |
| Replace the new tab and home page | The search-or-ask box. |
| Cookies, containers | Knowing which Zen space a tab is in; requests with your session on sites you allow. |
| Monitor requests | The network log Claude can read when you debug a page. |

## What happens the first time?

Press <kbd>⌘E</kbd> to open the sidebar. Ensō asks:

1. your name and a few lines about you (what you do, how you like answers);
2. if you use Zen spaces, what each space is for ("Work at Northwind: use my
   work accounts").

Both go into files on your Mac and are sent with each message so Claude knows
the context. **Skip for now** leaves them empty. Change them later in
**Settings → You & memory**.

## Which engine should I use?

- **Claude subscription** (default): uses the Claude plan you are signed in to
  in Claude Code, and your claude.ai connectors (Gmail, Calendar, Drive and
  others) work in Ensō too. No extra bill; it counts against your plan's limits.
- **API key**: pay per token. Add the key to the Keychain (it asks for the key
  and doesn't echo it), then choose **API key** in **Settings → General → Engine**:

  ```sh
  security add-generic-password -s enso-anthropic -a "$USER" -w
  ```

You can switch at any time; a conversation carries over. Settings also has the
model and the effort (low, medium, high).

## What can I try first?

- On any article: "summarise this" or `/summarize`.
- On a form: "fill this in with my address". Ensō fills it; it asks before
  submitting.
- "What's on my calendar tomorrow?" (with a calendar connected).
- "Group my open tabs by topic".
- Open a new tab and choose **Add widgets**.

Next: [the sidebar and the new tab](sidebar-and-new-tab.md).

## How do I update it?

The extension updates itself. For the helper, choose **Update** in
**Settings → Setup** when it says a new version is out (or run `enso update`, or
the install command again). It replaces the program, keeps your data, and Ensō
reconnects by itself.

## How do I uninstall it?

1. Remove Ensō in Zen's **Add-ons and themes**.
2. In Terminal:

   ```sh
   enso mcp uninstall          # if you let other agents use Zen
   rm -rf ~/Library/Application\ Support/Enso
   rm -f ~/Library/Application\ Support/{Mozilla,zen}/NativeMessagingHosts/enso.json ~/.local/bin/enso
   ```

3. If you used them: `security delete-generic-password -s enso-anthropic`
   (API key) and `security delete-generic-password -s enso-github` (GitHub
   token).

Your conversations, memory and settings were in that `Enso` folder, so they
are gone too. Make a copy first if you want to keep them.
