---
title: Troubleshooting
description: Fixes for the common problems, from a helper that won't start to extension updates, tools that need a sign-in and streaming sites.
order: 31
group: Reference
---

# Troubleshooting

## If Ensō says the helper stopped

"Ensō's helper isn't running" (or the older "The chat helper stopped") means the helper program Zen starts for Ensō exited. The message says how: **Not found** (Zen can't find it), **Failed to start** (it exited as soon as it started) or **Exited** (it ran, then stopped). Sections that need the helper show the same message, or "Couldn't load" with **Retry** when it doesn't answer within 8 seconds, instead of loading forever.

1. **Are you on a Mac?** The helper runs on macOS only for now; Windows and Linux support is planned. On other systems Ensō says so instead.
2. **Run the doctor** in Terminal:

   ```sh
   ~/Library/Application\ Support/Enso/bin/enso doctor
   ```

   (or just `enso doctor` if `~/.local/bin` is on your PATH). It checks the registration files Zen and Firefox read, the Node.js the helper runs with (still there, version 18 or newer), starts the helper the way Zen does and waits for its answer, checks the agent port (47823), and prints the end of the helper's log. Every ✗ comes with a suggested fix; most are "run the installer again".
3. **Run the installer again**: `curl -fsSL https://enso.wicker.life/install.sh | bash`. Then press **Try again** in Ensō.
4. **Send us the details.** Press **Copy diagnostics** in Ensō: it copies the extension version, the helper's status and last error, your browser and system. Paste it in a mail to [support@enso.wicker.life](mailto:support@enso.wicker.life) and attach the log, `~/Library/Logs/Enso/helper.log` (in Finder: Go → Go to Folder…, paste the path). The log has startup lines (versions, Node's path) and errors with their stack. It never contains your messages, page text, keys or tokens.

## "One step in Terminal", "The helper didn't start" or "Lost Ensō's helper"

Zen couldn't find or start the local helper, or it stopped. Ensō keeps trying by itself (every 2 seconds while it's open), so once the problem is fixed it reconnects without a restart.

1. Run the install command again: `curl -fsSL https://enso.wicker.life/install.sh | bash`. It rewrites the helper and its registration, and fetches Ensō's own Node.js if yours is gone.
2. If Ensō still waits, press **Check now**, or quit Zen completely (<kbd>⌘Q</kbd>) and open it again.
3. Check that the registration exists:
   `cat ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json`
   The `path` in it must point at `~/Library/Application Support/Enso/helper/run.sh`, and `allowed_extensions` must contain `enso@wicker.life`.
4. Check that Node still exists where the helper expects it. `run.sh` contains the full path to the `node` found at install time; if you removed, upgraded or switched that Node, run the installer again.
5. Still stuck: run `enso doctor` and look at `~/Library/Logs/Enso/helper.log` ([above](#if-ens-says-the-helper-stopped)).

## "Install Claude Code"

The subscription engine needs the `claude` command.

- Open **Settings → Setup → Claude**: **Install Claude Code** or **Sign in** open Terminal with the right command, and the item turns green when it worked.
- By hand: `claude --version`; if it isn't found, install Claude Code ([setup guide](https://docs.anthropic.com/en/docs/claude-code/setup)), then `claude auth login`.
- Zen starts the helper with a minimal `PATH`. Ensō looks in your `PATH`, `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`. If `claude` lives somewhere else, set **Settings → Engine → Claude Code location**.

Or switch to the API-key engine in Settings.

## "No Anthropic API key"

Add one (it asks for the key and doesn't echo it):

```sh
security add-generic-password -s enso-anthropic -a "$USER" -w
```

## The extension wants to update, or asks for new permissions

The extension updates itself from this site. When a new version needs a permission it didn't have, Zen asks first: a badge on the menu button, then a prompt listing the permission. Accept it to get the update. To check now: **Add-ons and themes** → gear menu → **Check for Updates**.

After the extension updates, update the helper as well, so both are the same version: run the installer again and restart Zen. Compare the version in **Add-ons and themes** with `cat ~/Library/Application\ Support/Enso/helper/VERSION`.

## A tool shows "Needs sign-in"

- **claude.ai connectors:** reconnect the service on claude.ai.
- **Tools you connected with the Connect button:** open the row on the Tools page and choose **Reconnect**.
- **Servers from Claude Code:** run `claude` and use `/mcp` to sign in again.
- **Servers in `config.local.json`:** check that the Keychain item named in `tokenKeychainService` exists.

## A server I added to Claude Code doesn't appear

New Claude Code servers are off for Ensō. Switch it on on the Tools page, or set `"servers": { "<name>": { "enabled": true } }` in `~/Library/Application Support/Enso/config.local.json` and restart Zen.

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

See [Use Zen from other agents](/docs/other-agents#if-it-doesnt-work).

## The sign-in email doesn't arrive

This is for the account pages on this site.

- Wait a minute and check spam. Mail comes from `noreply@enso.wicker.life`.
- Links expire after 15 minutes and work once. Ask for a new one.
- You can ask for at most five links per 15 minutes.

## Still stuck

Write to [support@enso.wicker.life](mailto:support@enso.wicker.life) with what you did, what you expected, and what happened. Include the extension version and your helper version (`cat ~/Library/Application\ Support/Enso/helper/VERSION`). Please don't send conversation contents unless they are needed.
