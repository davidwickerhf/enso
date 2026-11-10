# Troubleshooting

## Where the files are

| | macOS | Linux | Windows |
|---|---|---|---|
| Data folder | `~/Library/Application Support/Enso` | `~/.local/share/enso` (`$XDG_DATA_HOME/enso`) | `%APPDATA%\Enso` |
| Helper log | `~/Library/Logs/Enso/helper.log` | `~/.local/state/enso/helper.log` (`$XDG_STATE_HOME/enso`) | `%LOCALAPPDATA%\Enso\Logs\helper.log` |
| What Zen starts | `Enso/helper/run.sh` | `enso/helper/run.sh` | `%APPDATA%\Enso\bin\run.cmd` |
| `enso` command | `Enso/bin/enso`, linked as `~/.local/bin/enso` | `enso/bin/enso`, linked as `~/.local/bin/enso` | `%APPDATA%\Enso\bin\enso.cmd`, on your user PATH |

On Windows, output from a crash before the helper's own logging starts goes to
`%LOCALAPPDATA%\Enso\Logs\helper-stderr.log`.

## "One step in Terminal" (or PowerShell, or a terminal), "The helper didn't start" or "Lost Ensō's helper"

Zen couldn't find or start the helper on your computer, or it stopped. Ensō
keeps trying by itself, so once it's fixed it reconnects without a restart.

1. Run the doctor. It checks the registration, Node, the agent port and the
   secret store, starts the helper the way Zen does, and suggests a fix for
   each problem:

   ```sh
   enso doctor
   ```

   It works on all three systems. On Windows, run it in a new terminal after
   installing (so the PATH is picked up), or as
   `%APPDATA%\Enso\bin\enso.cmd doctor`. On macOS and Linux the full path is
   `<data folder>/bin/enso`.

2. Run the install command again; it rewrites the helper and its registration
   (and fetches Ensō's own Node.js if the one it used is gone). On macOS and
   Linux:

   ```sh
   curl -fsSL https://enso.wicker.life/install.sh | bash
   ```

   On Windows, in PowerShell:

   ```powershell
   irm https://enso.wicker.life/install.ps1 | iex
   ```

3. Still waiting? Press **Check now**, or quit Zen completely (<kbd>⌘Q</kbd> on
   macOS; close every window on Linux and Windows) and open it again.

4. Check the registration:

   - macOS: `cat ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json`
   - Linux: `cat ~/.mozilla/native-messaging-hosts/enso.json`. Zen on Linux
     reads Mozilla's folder, not `~/.zen/native-messaging-hosts` yet
     ([zen-browser/desktop#10622](https://github.com/zen-browser/desktop/issues/10622));
     the installer writes both.
   - Windows: `reg query HKCU\Software\Mozilla\NativeMessagingHosts\enso`
     must point at `%APPDATA%\Enso\enso.json` (Zen reads Mozilla's key).

   `path` in `enso.json` must point at the launcher in the table above, and
   `allowed_extensions` must contain `enso@wicker.life`.
5. Check Node. The launcher contains the full path to the `node` found at
   install time. If you removed or upgraded that Node (or switched with a
   version manager), run the installer again.
6. Zen or Firefox from Flatpak or Snap is untested and may need the browser's
   native-messaging portal to start the helper.
7. Still failing: open the Browser Console (<kbd>⌘⇧J</kbd>, or
   <kbd>Ctrl+Shift+J</kbd> on Linux and Windows) and look for lines starting
   with `[enso]`, and read the helper's log.

## "Install Claude Code" or "Claude Code is not available"

The subscription engine needs the `claude` command.

- Run `claude --version` in a terminal. If it isn't found, install it
  ([setup guide](https://docs.anthropic.com/en/docs/claude-code/setup)); on
  macOS and Linux: `curl -fsSL https://claude.ai/install.sh | bash`.
- Run `claude` once and sign in; quit with `/exit`.
- Zen starts the helper with a minimal `PATH`. Ensō looks in your `PATH`,
  `~/.local/bin` and `~/.claude/local`, plus Homebrew and `/usr/local/bin` on
  macOS and Linux, `/snap/bin` on Linux, and npm's folder on Windows
  (`claude.exe` or `claude.cmd`). If `claude` is elsewhere, set its location in
  **Settings → Engine → Claude Code location**.
- Quit and reopen Zen.

Or switch to the API key engine in **Settings → Engine**.

## "No Anthropic API key"

Paste it in **Settings → Setup → Claude → API key**, or add it to your system's
secret store by hand (each asks for the key and doesn't echo it), then send
again:

```sh
security add-generic-password -s enso-anthropic -a enso -w           # macOS
secret-tool store --label=Ensō service enso-anthropic account enso   # Linux
cmdkey /generic:enso-anthropic /user:enso /pass                      # Windows
```

## Linux: "No system keyring"

Without a keyring, the helper keeps keys and sign-ins in
`~/.local/share/enso/secrets.json` (readable only by you), and `enso doctor`
and **Settings → Setup** warn about it. To fix it, install `secret-tool`
(`libsecret-tools` on Debian and Ubuntu) and run a keyring: GNOME Keyring,
KWallet or KeePassXC with its Secret Service integration. Restart Zen and save
the API key, GitHub token and tool sign-ins again.

## The extension asks to update, or wants new permissions

The extension updates itself from enso.wicker.life. When a new version needs a
permission it didn't have, Zen asks first: a badge on the menu button, then a
prompt listing the permission. Accept it to get the update.

After an extension update, update the helper too, so both are the same version:
run the installer again and restart Zen. To check versions: **Add-ons and
themes** for the extension, and **Settings → Setup** (or `enso setup`) for the
helper. To check for an extension update now: **Add-ons and themes** →
gear menu → **Check for Updates**.

## Zen says the extension "could not be verified" or "appears to be corrupt"

You are installing an unsigned build (from a checkout). Use the release
installer, or set `xpinstall.signatures.required` to `false` in `about:config`
for development builds.

## A tool shows "Needs sign-in" or "Failed"

- **claude.ai connectors:** reconnect the service on claude.ai.
- **Servers Ensō signs in to** (Connect button): open the row on the Tools page
  and choose **Reconnect**.
- **Servers from Claude Code:** run `claude`, then `/mcp`, and sign in again.
- **Servers with a stored token** (`extraServers`): check the item named in
  `tokenKeychainService` exists in your secret store (Keychain, keyring or
  Credential Manager).

## A server I added to Claude Code doesn't appear

New Claude Code servers are off for Ensō. Switch it on on the Tools page, or set
`"servers": { "<name>": { "enabled": true } }` in `config.local.json` in the
[data folder](#where-the-files-are) and restart Zen.

## It won't read the page

- The page is on the private-site list (a lock on the page chip). That is
  deliberate.
- `about:` pages, the add-ons page and other extensions' pages can't be read by
  any extension.
- The tab is unloaded (Zen unloads tabs it hasn't shown for a while). Open or
  reload it.
- Some PDFs and canvas-drawn apps have little readable text. Attach a screenshot
  instead (the camera button).

## Home is empty or old

The brief refreshes about once an hour and on the first start each morning,
using read-only tools. Press refresh on Home to run it now. If it fails, the
error is shown there; usually a connector needs signing in again. The brief
needs Claude Code, even on the API key engine.

## Ensō doesn't know which space I'm in

See [spaces and containers](spaces-and-containers.md#how-does-ensō-know-which-space-im-in):
give each space its own container.

## Netflix or another streaming site won't play or sign in

Turn on DRM in Zen and check imported logins: see
[spaces and containers](spaces-and-containers.md#netflix-or-another-site-wont-sign-in-after-i-moved-my-logins-into-containers).

## Other agents can't reach Zen

See [using Ensō from other agents](other-agents.md#something-doesnt-work).
`enso doctor` checks the agent port (47823). To see which program holds it:

```sh
lsof -nP -iTCP:47823 -sTCP:LISTEN     # macOS
ss -ltnp 'sport = :47823'             # Linux
netstat -ano | findstr :47823         # Windows
```

## Still stuck

Write to [support@enso.wicker.life](mailto:support@enso.wicker.life) with what
you did, what you expected and what happened, plus the helper version
(**Settings → Setup** or `enso setup`), the extension version and your system.
**Copy diagnostics** in Ensō copies all of that.
Please don't send conversation contents unless they are needed.
