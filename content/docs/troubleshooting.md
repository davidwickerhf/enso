---
title: Troubleshooting
description: Fixes for the common problems, from a silent sidebar to sign-in links that don't arrive.
order: 31
group: Reference
---

# Troubleshooting

## The sidebar says it can't reach the helper

Zen couldn't start the local helper.

1. Run the installer again: `curl -fsSL https://enso.wicker.life/install.sh | bash`. It rewrites the helper and its registration.
2. Check that the registration exists:
   `cat ~/Library/Application\ Support/zen/NativeMessagingHosts/zen_chat.json`
   The `path` in it must point at `~/Library/Application Support/Enso/helper/run.sh`, and `allowed_extensions` must contain the extension's id.
3. Check that Node still exists where the helper expects it. `run.sh` contains the full path to the `node` that was found at install time; if you removed or upgraded that Node, run the installer again.
4. Quit Zen completely (<kbd>⌘Q</kbd>) and open it again. Zen reads the registration at start.

## "Claude Code is not available"

The subscription engine needs the `claude` command.

- Run `claude --version` in Terminal. If it isn't found, install Claude Code ([setup guide](https://docs.anthropic.com/en/docs/claude-code/setup)).
- Run `claude` once and sign in; quit with `/exit`.
- Zen starts the helper with a minimal `PATH`. The helper adds `~/.volta/bin`, `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. If `claude` lives somewhere else, link it into one of those.

Or switch to the API-key engine in Settings.

## "No Anthropic API key in the Keychain"

Add one (it asks for the key and doesn't echo it):

```sh
security add-generic-password -s zen-chat-anthropic -a "$USER" -w
```

## A tool shows "needs sign-in"

For claude.ai connectors, reconnect the service on claude.ai. For servers you added to Claude Code, run `claude` and use `/mcp` to sign in again. For servers under `extraServers`, check that the Keychain item named in `tokenKeychainService` exists.

## A server I added doesn't appear

New servers are off for Ensō by default. Set `"enabled": true` for it under `servers` in `~/Library/Application Support/Enso/helper/config.json`, then reload the sidebar.

## It won't read the page

- The page may be on the sensitive list (a lock shows on the page chip). That is deliberate.
- Browser pages such as `about:` pages, the add-ons page and other extensions' pages can't be read by any extension.
- Some PDFs and canvas-drawn apps have little readable text. Try a screenshot instead.

## Home is empty or old

Home refreshes every hour and on the first start each morning, using read-only tools. Click refresh on Home to run it now. If it fails, the error is shown there; most often a connector needs sign-in again.

## The sign-in email doesn't arrive

- Wait a minute and check spam. Mail comes from `noreply@enso.wicker.life`.
- Links expire after 15 minutes and work once. Ask for a new one.
- You can ask for at most five links per 15 minutes.

## Sync says "version conflict" over and over

Another Mac keeps changing the same item. Usually it settles by itself within a few seconds. If not, make sure both Macs run the same helper version.

## Still stuck

Write to [support@enso.wicker.life](mailto:support@enso.wicker.life) with what you did, what you expected, and what happened. Include your helper version (`cat ~/Library/Application\ Support/Enso/helper/VERSION`). Please don't send conversation contents unless they are needed.
