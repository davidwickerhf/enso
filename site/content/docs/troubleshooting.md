---
title: Troubleshooting
description: Fixes for the common problems, from a helper that won't start to extension updates, tools that need a sign-in and streaming sites.
order: 31
group: Reference
---

# Troubleshooting

## If Ensō says the helper stopped

"Ensō's helper isn't running" (or the older "The chat helper stopped") means the helper program Zen starts for Ensō exited. The message says how: **Not found** (Zen can't find it), **Failed to start** (it exited as soon as it started) or **Exited** (it ran, then stopped). Sections that need the helper show the same message, or "Couldn't load" with **Retry** when it doesn't answer within 8 seconds, instead of loading forever.

1. **Is your system supported?** The helper runs on macOS, Linux and Windows. On other systems Ensō says so instead.
2. **Run the doctor** in a terminal (Terminal on macOS, PowerShell on Windows):

   ```sh
   enso doctor
   ```

   If `enso` isn't found, use the full path: `~/Library/Application\ Support/Enso/bin/enso doctor` on macOS, `~/.local/share/enso/bin/enso doctor` on Linux. On Windows, open a new terminal after installing (so it sees the PATH the installer set), or run `%APPDATA%\Enso\bin\enso.cmd doctor` (in PowerShell: `& "$env:APPDATA\Enso\bin\enso.cmd" doctor`). The doctor checks the registration Zen and Firefox read, the Node.js the helper runs with (still there, version 18 or newer), starts the helper the way Zen does and waits for its answer, checks the agent port (47823) and the secret store, and prints the end of the helper's log. Every ✗ comes with a suggested fix; most are "run the installer again".
3. **Run the installer again**: `curl -fsSL https://enso.wicker.life/install.sh | bash` on macOS and Linux, `irm https://enso.wicker.life/install.ps1 | iex` in PowerShell on Windows. Then press **Try again** in Ensō.
4. **Send us the details.** Press **Copy diagnostics** in Ensō: it copies the extension version, the helper's status and last error, your browser and system. Paste it in a mail to [support@enso.wicker.life](mailto:support@enso.wicker.life) and attach the helper's log ([where it is](#where-the-files-are)). The log has startup lines (versions, Node's path) and errors with their stack. It never contains your messages, page text, keys or tokens.

## Where the files are

| | macOS | Linux | Windows |
|---|---|---|---|
| Data folder (helper, settings, conversations) | `~/Library/Application Support/Enso` | `~/.local/share/enso` (`$XDG_DATA_HOME/enso`) | `%APPDATA%\Enso` |
| Helper log | `~/Library/Logs/Enso/helper.log` | `~/.local/state/enso/helper.log` (`$XDG_STATE_HOME/enso`) | `%LOCALAPPDATA%\Enso\Logs\helper.log` |
| Open the log folder | Finder: Go → Go to Folder…, paste the path | your file manager: <kbd>Ctrl+L</kbd>, paste the path | File Explorer: paste the path into the address bar |
| What Zen starts | `Enso/helper/run.sh` | `enso/helper/run.sh` | `%APPDATA%\Enso\bin\run.cmd` |

On Windows, output from a crash before the helper's own logging starts (Node missing, a syntax error) goes to `%LOCALAPPDATA%\Enso\Logs\helper-stderr.log`. On macOS and Linux it goes into `helper.log` itself.

## "One step in Terminal" (or PowerShell, or a terminal), "The helper didn't start" or "Lost Ensō's helper"

Zen couldn't find or start the local helper, or it stopped. Ensō keeps trying by itself (every 2 seconds while it's open), so once the problem is fixed it reconnects without a restart.

1. Run the install command again ([above](#if-ens-says-the-helper-stopped)). It rewrites the helper and its registration, and fetches Ensō's own Node.js if yours is gone.
2. If Ensō still waits, press **Check now**, or quit Zen completely (<kbd>⌘Q</kbd> on macOS; on Linux and Windows close every Zen window) and open it again.
3. Check that the registration exists. `enso doctor` does this for you; by hand:
   - macOS: `cat ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json`
   - Linux: `cat ~/.mozilla/native-messaging-hosts/enso.json`. Zen on Linux reads Mozilla's folder, not `~/.zen/native-messaging-hosts` yet ([zen-browser/desktop#10622](https://github.com/zen-browser/desktop/issues/10622)); the installer writes both.
   - Windows: `reg query HKCU\Software\Mozilla\NativeMessagingHosts\enso` must show `%APPDATA%\Enso\enso.json` (Zen reads Mozilla's key). Then `Get-Content "$env:APPDATA\Enso\enso.json"` in PowerShell.

   The `path` in `enso.json` must point at the launcher (`run.sh` on macOS and Linux, `%APPDATA%\Enso\bin\run.cmd` on Windows), and `allowed_extensions` must contain `enso@wicker.life`.
4. Check that Node still exists where the helper expects it. The launcher contains the full path to the `node` found at install time; if you removed, upgraded or switched that Node, run the installer again.
5. Still stuck: run `enso doctor` and look at the helper's log ([where it is](#where-the-files-are)).
6. Zen or Firefox from Flatpak or Snap is untested. Its sandbox may keep it from starting the helper unless the browser's native-messaging portal is available; try the regular download or your distribution's package.

## "Install Claude Code"

The subscription engine needs the `claude` command.

- Open **Settings → Setup → Claude**: **Install Claude Code** or **Sign in** open a terminal window with the right command, and the item turns green when it worked.
- By hand: `claude --version`; if it isn't found, install Claude Code ([setup guide](https://docs.anthropic.com/en/docs/claude-code/setup)), then `claude auth login`.
- Zen starts the helper with a minimal `PATH`. Ensō looks in your `PATH`, `~/.local/bin` and `~/.claude/local`, plus `/opt/homebrew/bin` and `/usr/local/bin` on macOS, Homebrew and `/snap/bin` on Linux, and npm's folder on Windows (where it looks for `claude.exe` and `claude.cmd`). If `claude` lives somewhere else, set **Settings → Advanced → Claude Code location**.

Or switch to the API-key engine in **Settings → General → Engine**.

## "No Anthropic API key"

Paste it in **Settings → Setup → Claude (with the API-key engine)**. Or add it by hand (each of these asks for the key and doesn't echo it):

```sh
# macOS (login Keychain)
security add-generic-password -s enso-anthropic -a enso -w
# Linux (keyring, through secret-tool)
secret-tool store --label=Ensō service enso-anthropic account enso
# Windows (Credential Manager)
cmdkey /generic:enso-anthropic /user:enso /pass
```

## Linux: "No system keyring"

Without a keyring the helper keeps keys and sign-ins in `~/.local/share/enso/secrets.json`, readable only by you, and `enso doctor` and **Settings → Setup** warn about it. To use a keyring instead, install `secret-tool` (the `libsecret-tools` package on Debian and Ubuntu, `libsecret` elsewhere) and run a keyring such as GNOME Keyring, KWallet or KeePassXC (with its Secret Service integration on). Restart Zen, then save the API key, GitHub token and tool sign-ins again.

## The extension wants to update, or asks for new permissions

The extension updates itself from this site. When a new version needs a permission it didn't have, Zen asks first: a badge on the menu button, then a prompt listing the permission. Accept it to get the update. To check now: **Add-ons and themes** → gear menu → **Check for Updates**.

After the extension updates, update the helper as well, so both are the same version: run the installer again and restart Zen. Compare the version in **Add-ons and themes** with the one in **Settings → Setup** (or `enso setup`).

## A tool shows "Needs sign-in"

- **claude.ai connectors:** reconnect the service on claude.ai.
- **Tools you connected with the Connect button:** open the row on the Tools page and choose **Reconnect**.
- **Servers from Claude Code:** run `claude` and use `/mcp` to sign in again.
- **Servers in `config.local.json`:** check that the secret store item (Keychain, keyring or Credential Manager) named in `tokenKeychainService` exists.

## A server I added to Claude Code doesn't appear

New Claude Code servers are off for Ensō. Switch it on on the Tools page, or set `"servers": { "<name>": { "enabled": true } }` in `config.local.json` in Ensō's [data folder](#where-the-files-are) and restart Zen.

## It won't read the page

- The page may be on the private-site list (a lock shows on the page chip). That is deliberate.
- Browser pages such as `about:` pages, the add-ons page and other extensions' pages can't be read by any extension.
- Zen may have unloaded the tab. Open or reload it.
- Some PDFs and canvas-drawn apps have little readable text. Attach a screenshot instead.

## Home is empty or old

The brief refreshes about once an hour and on the first start each morning, using read-only tools. Click refresh on Home to run it now. If it fails, the error is shown there; most often a connector needs signing in again. The brief needs Claude Code, even on the API-key engine.

## Netflix or another streaming site won't play or sign in

Turn on DRM in Zen and sign in again in the right space: see [Spaces & containers](/docs/spaces#sites-that-wont-sign-in-after-moving-to-containers).

## Other agents can't reach Zen

See [Use Zen from other agents](/docs/other-agents#if-it-doesnt-work). `enso doctor` checks the agent port (47823). To see which program holds it:

```sh
lsof -nP -iTCP:47823 -sTCP:LISTEN     # macOS
ss -ltnp 'sport = :47823'             # Linux
netstat -ano | findstr :47823         # Windows (the last column is the process id)
```

## The sign-in email doesn't arrive

This is for the account pages on this site.

- Wait a minute and check spam. Mail comes from `noreply@enso.wicker.life`.
- Links expire after 15 minutes and work once. Ask for a new one.
- You can ask for at most five links per 15 minutes.

## Still stuck

Write to [support@enso.wicker.life](mailto:support@enso.wicker.life) with what you did, what you expected, and what happened. Include the extension version and your helper version (shown in **Settings → Setup**, or with `enso setup`). Please don't send conversation contents unless they are needed.
