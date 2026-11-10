# Getting started

Ensō is an assistant inside the Zen browser: a chat in the sidebar, a
search-or-ask box and widgets on every new tab, and an agent that can read and
act on web pages. It runs on your own Claude subscription (through Claude Code)
or an Anthropic API key, and keeps what it knows on your computer.

## What do I need?

| | |
|---|---|
| System | macOS; Linux (x86_64, arm64); Windows 10 or 11 (x64, arm64). |
| Browser | [Zen](https://zen-browser.app). Firefox 142 or newer works too, without Zen's spaces. |
| Claude | Your Claude plan (through Claude Code, which Setup installs for you) or an Anthropic API key. |

Nothing else has to be installed first: if there is no Node.js 18 or newer, the
installer fetches Ensō's own copy (on Linux this needs `xz`). Zen or Firefox
from Flatpak or Snap is untested and may need the browser's native-messaging
portal.

## How do I install it?

1. **Add the extension.** Open <https://enso.wicker.life/releases/enso-latest.xpi>
   in Zen. Zen asks whether to add Ensō and lists its permissions. Choose **Add**.
2. **Run one command.** Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd> on Linux and
   Windows). Ensō sees its helper isn't there yet and shows the command for
   your system with a **Copy** button. On macOS and Linux:

   ```sh
   curl -fsSL https://enso.wicker.life/install.sh | bash
   ```

   On macOS open Terminal (<kbd>⌘ Space</kbd>, type *Terminal*,
   <kbd>Return</kbd>); on Linux open your terminal app. Paste it and press
   <kbd>Return</kbd>. On Windows, open PowerShell (5.1 or 7) and run:

   ```powershell
   irm https://enso.wicker.life/install.ps1 | iex
   ```

   It downloads the helper and checks its SHA-256 (and, only if needed,
   Node.js, checked against a pinned SHA-256); installs it in Ensō's data
   folder (`~/Library/Application Support/Enso` on macOS, `~/.local/share/enso`
   on Linux, `%APPDATA%\Enso` on Windows); registers it with Zen and Firefox;
   writes the `enso` command; and prints a short summary. It asks no questions,
   needs no password or administrator rights and leaves your data alone. Ensō
   moves on by itself when it's done: no need to restart Zen.

   Why a terminal step? Browsers don't let an extension install or start a
   program, and an extension can't open a terminal either. It's the only one.
3. **Finish in Setup.** After a few words about you, Ensō opens
   **Settings → Setup**: install or sign in to Claude Code (or paste an API key).
   Then, if you like, let Claude Code, Codex, Cursor or OpenCode use Zen
   (**Agents & screenshots**) and connect T3 Code and GitHub (**Connections**).
   Each item is a button; the same checks run in a terminal with `enso setup`.

Prefer to read the script first: `curl -fsSL https://enso.wicker.life/install.sh -o install.sh`, read it, then `bash install.sh`. On Windows: `irm https://enso.wicker.life/install.ps1 -OutFile install.ps1`, read it, then `powershell -ExecutionPolicy Bypass -File install.ps1`.

## Why does it ask for these permissions?

| Permission | Used for |
|---|---|
| Access your data for all websites | Reading the page when you ask about it, acting on pages when you ask it to, the developer tools. |
| Exchange messages with programs other than Firefox | Talking to the helper on your computer. |
| Access browser tabs and tab groups | `@`-mentioning tabs, listing, opening, grouping and closing tabs. |
| Access browsing history, bookmarks | Suggestions in the new-tab box; searching history when you ask. |
| Replace the new tab and home page | The search-or-ask box. |
| Cookies, containers | Knowing which Zen space a tab is in; requests with your session on sites you allow. |
| Monitor requests | The network log Claude can read when you debug a page. |

## What happens the first time?

Press <kbd>⌘E</kbd> (<kbd>Ctrl+E</kbd>) to open the sidebar. Ensō asks:

1. your name and a few lines about you (what you do, how you like answers);
2. if you use Zen spaces, what each space is for ("Work at Northwind: use my
   work accounts").

Both go into files on your computer and are sent with each message so Claude knows
the context. **Skip for now** leaves them empty. Change them later in
**Settings → You & memory**.

## Which engine should I use?

- **Claude subscription** (default): uses the Claude plan you are signed in to
  in Claude Code, and your claude.ai connectors (Gmail, Calendar, Drive and
  others) work in Ensō too. No extra bill; it counts against your plan's limits.
- **API key**: pay per token. Paste the key in **Settings → Setup → Claude**,
  or add it to your system's secret store by hand (each asks for the key and
  doesn't echo it), then choose **API key** in **Settings → General → Engine**:

  ```sh
  security add-generic-password -s enso-anthropic -a enso -w           # macOS
  secret-tool store --label=Ensō service enso-anthropic account enso   # Linux
  cmdkey /generic:enso-anthropic /user:enso /pass                      # Windows
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
2. Run `enso mcp uninstall` if you let other agents use Zen.
3. Remove the helper. On macOS:

   ```sh
   rm -rf ~/Library/Application\ Support/Enso ~/Library/Logs/Enso
   rm -f ~/Library/Application\ Support/{Mozilla,zen}/NativeMessagingHosts/enso.json ~/.local/bin/enso
   ```

   On Linux:

   ```sh
   rm -rf ~/.local/share/enso ~/.local/state/enso
   rm -f ~/.mozilla/native-messaging-hosts/enso.json ~/.zen/native-messaging-hosts/enso.json ~/.local/bin/enso
   ```

   On Windows, quit Zen, then in PowerShell:

   ```powershell
   Remove-Item -Recurse -Force "$env:APPDATA\Enso", "$env:LOCALAPPDATA\Enso"
   Remove-Item -Force "HKCU:\Software\Mozilla\NativeMessagingHosts\enso"
   ```

   and remove `%APPDATA%\Enso\bin` from your user PATH.

4. If you used them, remove the API key (`enso-anthropic`) and GitHub token
   (`enso-github`) from your secret store: `security delete-generic-password -s
   enso-anthropic` on macOS, `secret-tool clear service enso-anthropic` on
   Linux, `cmdkey /delete:enso-anthropic` on Windows.

Your conversations, memory and settings were in that `Enso` folder, so they
are gone too. Make a copy first if you want to keep them.
