# Development

How to run Ensō from a checkout, work on the UI without Zen, run the tests and
debug the helper. Architecture first? Read [architecture.md](architecture.md).

## Contents

- [Requirements](#requirements)
- [Run from a checkout](#run-from-a-checkout)
- [Unsigned extensions](#unsigned-extensions)
- [After a change](#after-a-change)
- [The UI without Zen](#the-ui-without-zen)
- [Tests](#tests)
- [CI](#ci)
- [Debugging](#debugging)
- [Marionette](#marionette)
- [Conventions](#conventions)
- [Recipes](#recipes)

## Requirements

- macOS or Linux for `scripts/dev.sh`. The helper itself runs on macOS, Linux
  and Windows (`lib/platform.mjs` holds the per-OS folders, secret store,
  browser files and terminals); on Windows, install a release with
  `install.ps1` or point the registry at a checkout by hand. A few things are
  macOS-only: HEIC/TIFF images and `.doc`/`.rtf` attachments are converted with
  `sips` and `textutil` (`.docx` and `.odt` work everywhere).
- [Zen](https://zen-browser.app). The headless Zen looks for it in
  `/Applications/Zen.app` on macOS, `Program Files\Zen Browser\zen.exe` on
  Windows, and on `PATH`, in `~/.tarball-installations/zen` and `/opt` on
  Linux; `ENSO_BROWSER_BIN` overrides.
- Node.js 18.17 or newer; Node 22.5 or newer for copying sessions into the
  headless Zen (`node:sqlite`). CI uses Node 22. With Volta, `dev.sh` uses
  `volta which node`.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code/setup), signed
  in, for the subscription engine and the dashboard. Or an API key in the
  system's secret store (`enso-anthropic`).

## Run from a checkout

```sh
scripts/dev.sh            # helper deps, native-messaging manifests, unsigned build/enso-dev.xpi
scripts/dev.sh --open     # … and open the xpi in Zen (asks to add or update the extension)
scripts/dev.sh --mcp      # … and register zen-browser with Claude Code if it isn't yet
```

`scripts/dev.sh`:

1. installs helper dependencies with `npm ci --omit=optional` when
   `helper/node_modules` is missing (or a dangling link). Optional packages are
   skipped: they carry the Agent SDK's bundled ~200 MB Claude Code binary, and
   the helper uses your `claude` instead;
2. writes `helper/run.sh` (git-ignored) with this machine's `node` path;
3. writes `<data>/bin/enso` (`~/Library/Application Support/Enso` on macOS,
   `~/.local/share/enso` on Linux) pointing at this checkout, and links
   `~/.local/bin/enso` when that folder exists and the name is free or already
   points there;
4. writes `enso.json` native-messaging manifests for Zen and Firefox pointing
   at `helper/run.sh` (`ENSO_EXTENSION_ID` overrides the allowed id);
5. zips `extension/` into `build/enso-dev.xpi`;
6. with `--mcp`, runs `enso mcp install --client claude` unless Claude Code
   already has a `zen-browser` entry;
7. with `--open`, opens the xpi in Zen.

The dev setup uses your real data folder. `dev.sh` has no switch for another
one; to keep it separate, add `export ENSO_DATA=/tmp/enso-dev` before the `exec`
line in `helper/run.sh`. `enso mcp` reads its tokens from the default folder
unless `ENSO_DATA` is set for it too.

To go back to the release, run the installer again; it rewrites the manifests
and `bin/enso`.

## Unsigned extensions

Zen installs unsigned extensions only with signature checks off:

- `about:config` → `xpinstall.signatures.required` = `false`, or
- `user_pref("xpinstall.signatures.required", false);` in the profile's `user.js`.

Release builds are signed by addons.mozilla.org and don't need this. A dev
build has the same id (`enso@wicker.life`) as the release, so it replaces the
installed release. It has no `update_url` (the release workflow adds that), so
it never updates itself; to go back, run the installer, which opens the signed
release in Zen.

## After a change

| Changed | Do |
|---|---|
| `extension/` | Bump `version` in `extension/manifest.json`, then `scripts/dev.sh --open`. Zen only replaces an extension with a higher version. Or load it temporarily from `about:debugging` → This Firefox → Load Temporary Add-on (until Zen restarts). |
| `helper/` | Quit Zen (<kbd>⌘Q</kbd> on macOS, close every window elsewhere) and reopen it. Zen starts the helper again when the extension connects. |
| `helper/config.json` or `config.local.json` | Same: the config is read when the helper starts. |
| `extension/ui/` only, on the mock | Reload the page. |

Keep `extension/manifest.json` and `helper/package.json` at the same version in
commits that go to `main`; CI checks it. See [releasing.md](releasing.md).

## The UI without Zen

```sh
python3 -m http.server -d extension 8000
```

Open `http://127.0.0.1:8000/full.html`, `sidebar.html` or `newtab.html`. Outside
the extension, `ui/transport.js` uses an in-page mock helper (`ui/mock.js`) with
a fictional user (Maya, a designer at Northwind): a dashboard, past
conversations, tool calls and approvals, and a streamed answer for every
message.

- `?onboarding=1` starts without a profile (the first-run card).
- `?helper=missing` or `?helper=failed` shows the first-run install guide (no
  helper, or one that can't start); add `&connectAfter=6` to have it connect
  after 6 seconds, or call `__ensoMock.connectHelper()`.
- `?ensoDefault=0` makes Ensō not Zen's default search engine: the new tab and
  Settings → General show the "Make the address bar Ensō's box" card, and
  `?onboarding=1&ensoDefault=0` adds its step to the first-run card.
  `__ensoMock.setEnsoDefault(true)` turns it into "Done";
  `localStorage.removeItem("enso.searchNudge")` undoes "Not now" or "Don't ask again".
- `?setup=ready | mixed | fresh` sets the Settings → Setup checklist (default
  `ready`); `#setup` opens it. Its buttons change the mock's state.
- Messages to try: anything (a Gmail and calendar answer with a table), "fill
  in the form on this page" (page actions and an approval), "error" (the
  missing API key error); press Stop while an answer streams.
- Hooks in the browser console:

  ```js
  __ensoMock.presetWidgets("all")      // "four", "all", "tasks", "tasksSmall", "github", or [] to clear
  __ensoMock.setActiveTab(17)          // a private page (lock on the page chip)
  __ensoMock.prefill("text")           // what "Ask Ensō about this" does
  __ensoMock.githubConnected(false)    // the GitHub token box
  __ensoMock.disconnect()              // the "helper stopped" banner
  __ensoMock.connectHelper()           // the helper appears (first-run guide → connected)
  __ensoMock.setEnsoDefault(false)     // Ensō isn't Zen's default engine (the address-bar card)
  ```

Keep the mock fictional: no real names, addresses, hostnames or accounts. The
site's screenshots are taken from it.

Stop the server when you are done.

## Tests

```sh
cd helper
npm test                          # all offline
ENSO_SKIP_KEYCHAIN=1 npm test     # macOS: skip the tests that write to the login Keychain
ENSO_TEST_REAL_SECRETS=1 npm test # Linux, Windows: also test this machine's keyring / Credential Manager
ENSO_TEST_SDK=1 npm test          # also one real turn on your Claude plan
```

`test/run.mjs` runs each file in its own process (120 s timeout each):

| File | What it covers | When |
|---|---|---|
| `unit.test.mjs` | Config overlay, profile, migration, CLI lookup and other pure functions. | Always |
| `hello.test.mjs` | Starts `host.mjs` with a temporary `HOME` and talks native messaging to it. | Always |
| `tasks.test.mjs` | `list_tasks` normalisation, completion, the dashboard's read-only rule. | Always |
| `mcp.test.mjs` | Client labels, the Codex TOML edit, `enso mcp install/status/uninstall` in a temporary `HOME`, the launcher bridge, read scope, rotate, offline answers. | Always |
| `platform.test.mjs` | `lib/platform.mjs` for all three OSes (folders, manifests, client configs), the secrets file fallback. | Always |
| `windows.test.mjs` | `run.cmd` starting `host.mjs` through `cmd.exe`, the registry value, `enso.cmd` and the Cursor entry. | Windows |
| `secrets-store.test.mjs` | The real secret store: libsecret through `secret-tool`, or Credential Manager. | `ENSO_TEST_REAL_SECRETS=1` |
| `connections.test.mjs`, `host-connect.test.mjs` | OAuth sign-in against `mock-oauth-mcp.mjs`, secret storage. They store and delete test items in the real secret store. | macOS unless `ENSO_SKIP_KEYCHAIN=1`; Linux and Windows with `ENSO_TEST_REAL_SECRETS=1` |
| `transfer.test.mjs` | Messages over 1 MB in chunks (5 MB round trip), the upload store, `lib/upload.mjs` path checks and streaming, every `page_wait` condition (`extension/waits.js`) on a fake clock, timeout defaults and messages. | Always |
| `upload-host.test.mjs` | `host.mjs` and its MCP endpoint with a stand-in extension: 5 MB `page_type`, `page_upload` streaming (SHA-256 checked) and refusals, `page_wait`, timeouts that say the action may still be running. | Always |
| `pageupload.test.mjs` | `page_upload` into file inputs and a drop zone, and `page_wait`'s probes, in the page agent on a fixture page (Playwright's Chromium). | Skips without Chromium |
| `upload-firefox.test.mjs` | The same against real content-script compartments: a separate headless Zen or Firefox (own profile) with a temporary test extension; also `page_eval` awaiting a promise with `timeoutMs`. | Skips without Zen or Firefox, with `ENSO_SKIP_FIREFOX=1`, and in CI unless `ENSO_TEST_FIREFOX=1` |
| `sdk-mcp.test.mjs` | One real Agent SDK turn with an MCP server. | `ENSO_TEST_SDK=1` |

Tests use temporary data folders and random ports; they don't touch your
`Enso` folder or a running helper. Off macOS they use the file secret store
(`ENSO_SECRETS=file`) unless real secrets are asked for. `mcp`, `t3`, `setup`
and `install` use bash fakes and are skipped on Windows.

The extension's UI has no automated tests (the page agent, `transfer.js` and
`waits.js` do, above). Check UI changes on the mock
(headless browser, light and dark, sidebar width and full page) and in Zen.

## CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`, with
Node 22. The `check` job on `macos-latest`:

1. `node --check` on every `.js` and `.mjs` file, `bash -n` on the scripts;
2. the manifest's id is `enso@wicker.life` and its version matches
   `helper/package.json`;
3. `web-ext lint --self-hosted` on `extension/`;
4. `npm ci --omit=optional` and `npm test` (including the Keychain tests,
   against the runner's login keychain);
5. builds the helper tarball and fails if it is 40 MB or larger.

The `helper-tests` job runs `npm test` on Linux and Windows (x64 and arm64)
against the real secret store: a throwaway GNOME Keyring on Linux, the
runner's Credential Manager on Windows. On Linux it also runs `install.sh` in
a throwaway `HOME` and checks `enso doctor`. The `windows-install` job does the
same for `install.ps1` in a temporary profile.

## Debugging

- **Helper logs.** The helper writes to stderr with an `[enso]` prefix. Zen
  shows a native host's stderr in the Browser Console
  (<kbd>⌘⇧J</kbd>, or <kbd>Ctrl+Shift+J</kbd> on Linux and Windows,
  "Multiprocess" or "Parent process" mode). It also writes `helper.log`
  (`~/Library/Logs/Enso` on macOS, `~/.local/state/enso` on Linux,
  `%LOCALAPPDATA%\Enso\Logs` on Windows); `enso doctor` prints its end. Look for "turn
  failed", "MCP server on …", "could not read ~/.claude.json", config errors.
- **The extension.** `about:debugging` → This Firefox → Ensō → Inspect opens the
  background page's console and lets you inspect `background.js`. The sidebar
  and new tab can be inspected with the usual developer tools.
- **Messages.** Every message between the UI and the helper passes through
  `background.js`; a `console.log` in `connectNative`'s listener or in
  `forward` shows the traffic. Shapes are in [PROTOCOL.md](PROTOCOL.md).
- **The helper outside Zen.** `host.mjs` speaks native-messaging framing on
  stdin/stdout, so it can't be driven from a terminal directly.
  `test/hello.test.mjs` shows how to start it with a temporary `HOME` and send
  framed messages; copy that pattern for a quick script.
- **The MCP server.** With Zen open:

  ```sh
  enso mcp status
  printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"debug","version":"0"}}}' \
                '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | enso mcp
  ```

- **Claude Code sessions.** The subscription engine runs Claude Code with
  `cwd` = `<data>/workspace`; its transcripts are in `~/.claude/projects/` under
  that path, which helps when a turn fails inside Claude Code.
- **Data.** Everything is plain files in the data folder ([data-model.md](data-model.md)).
  `conversations/<id>.jsonl` shows exactly what was emitted for a turn.

## Marionette

The headless Zen (`lib/headless.mjs`) is driven over Marionette, Firefox's
WebDriver protocol, through `lib/marionette.mjs` (length-prefixed JSON over TCP:
`[0, id, name, params]` commands, `[1, id, error, result]` replies). Notes:

- It starts Zen (`/Applications/Zen.app/Contents/MacOS/zen` on macOS; see
  [Requirements](#requirements) for the other systems) with `-headless
  -no-remote -profile <tmp>/profile --marionette` on the first free port from
  2829.
- `-no-remote` and a separate profile keep it apart from your running Zen.
- Elements are found by the `data-enso-ref` attribute the helper adds when it
  reads the page; a `ref` goes stale when the page changes (call
  `headless_read` again).
- Leftover `enso-headless-*` folders in the temp directory from a crashed
  helper are removed at the next start; a headless Zen still owned by another
  live helper is left alone.
- To drive your own Zen over Marionette (for UI checks of the real extension),
  start it with `-marionette`; commands in the chrome context also need
  `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1` in its environment. Quit and start it
  normally afterwards.

## Conventions

- Plain JavaScript modules (`.mjs` in the helper, ES modules in the UI), no
  build step and no framework. The UI builds DOM with `h()` from `ui/dom.js`.
- The helper never writes to stdout except native-messaging frames.
- No secrets on command lines, in logs or in files other than the 0600 MCP
  tokens (see [security.md](security.md#secrets)).
- User-facing text: short, plain, British spelling ("colour", "summarise").
- A new message type goes into [PROTOCOL.md](PROTOCOL.md) in the same change.
- New tools: a definition in the right `lib/*tools.mjs` module with `kind`, and
  a row in [mcp.md](mcp.md#tool-reference). If it acts, decide how it behaves
  for MCP callers (`ctx.external`), and keep it out of the read scope.

## Recipes

### Add a tool

1. Add `{ name, title, description, shape, kind, run }` to the module that fits
   (`pagetools`, `browsertools`, `devtools`, `headless`, `github`). It is picked
   up by `toolset.mjs`, both engines and the MCP server.
2. If it needs the browser, add the action to `browserAction` or `pageAction`
   in `background.js` (and to `pageagent.js` for in-page work), and to the
   tables in [PROTOCOL.md](PROTOCOL.md).
3. For an action: `ctx.act(...)` for page actions (approval and logging), or
   `ctx.ask(...)` / `ctx.record(...)` yourself; refuse for `ctx.external` when
   there is nobody to ask.
4. A test in `helper/test/` when it has logic beyond a pass-through.

### Add a message

1. A `case` in `handle()` in `host.mjs`.
2. An action in `ui/store.js` that sends it, and handling of the reply.
3. The mock (`ui/mock.js`) answers it too, so the UI works without Zen.
4. A row in [PROTOCOL.md](PROTOCOL.md).

### Add a widget

`ui/views/widgets.js`: a `TYPES` entry (name, description, icon, sizes, and
`data: true` if it reads the dashboard), a body function, and mock data.
