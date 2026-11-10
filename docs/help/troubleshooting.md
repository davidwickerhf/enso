# Troubleshooting

## "Ensō's helper isn't running" or "The chat helper stopped"

Zen couldn't start the helper on your Mac, or it stopped.

1. Quit Zen completely (<kbd>⌘Q</kbd>, not just the window) and open it again.
   Zen reads the helper's registration when it starts.
2. Run the installer again; it rewrites the helper and its registration:

   ```sh
   curl -fsSL https://enso.wicker.life/install.sh | bash
   ```

3. Check the registration:

   ```sh
   cat ~/Library/Application\ Support/zen/NativeMessagingHosts/enso.json
   ```

   `path` must point at `~/Library/Application Support/Enso/helper/run.sh` and
   `allowed_extensions` must contain `enso@wicker.life`.
4. Check Node. `run.sh` contains the full path to the `node` found at install
   time. If you removed or upgraded that Node (or switched with a version
   manager), run the installer again.
5. Still failing: open the Browser Console (<kbd>⌘⇧J</kbd>) and look for lines
   starting with `[enso]`.

## "Install Claude Code" or "Claude Code is not available"

The subscription engine needs the `claude` command.

- Run `claude --version` in Terminal. If it isn't found, install it:
  `curl -fsSL https://claude.ai/install.sh | bash`.
- Run `claude` once and sign in; quit with `/exit`.
- Zen starts the helper with a minimal `PATH`. Ensō looks in your `PATH`,
  `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`.
  If `claude` is elsewhere, set its location in **Settings → Engine → Claude
  Code location**.
- Quit and reopen Zen.

Or switch to the API key engine in **Settings → Engine**.

## "No Anthropic API key"

Add one to the Keychain (it asks for the key and doesn't echo it), then send
again:

```sh
security add-generic-password -s enso-anthropic -a "$USER" -w
```

## The extension asks to update, or wants new permissions

The extension updates itself from enso.wicker.life. When a new version needs a
permission it didn't have, Zen asks first: a badge on the menu button, then a
prompt listing the permission. Accept it to get the update.

After an extension update, update the helper too, so both are the same version:
run the installer again and restart Zen. To check versions: **Add-ons and
themes** for the extension, and

```sh
cat ~/Library/Application\ Support/Enso/helper/VERSION
```

for the helper. To check for an extension update now: **Add-ons and themes** →
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
- **Servers with a Keychain token** (`extraServers`): check the Keychain item
  named in `tokenKeychainService` exists.

## A server I added to Claude Code doesn't appear

New Claude Code servers are off for Ensō. Switch it on on the Tools page, or set
`"servers": { "<name>": { "enabled": true } }` in
`~/Library/Application Support/Enso/config.local.json` and restart Zen.

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

## Still stuck

Write to [support@enso.wicker.life](mailto:support@enso.wicker.life) with what
you did, what you expected and what happened, plus the helper version (`cat
~/Library/Application\ Support/Enso/helper/VERSION`) and the extension version.
Please don't send conversation contents unless they are needed.
