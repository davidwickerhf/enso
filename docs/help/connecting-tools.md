# Connecting tools

Ensō reaches your mail, calendar, files, tasks and code through **tools**. Most
come from MCP servers (Model Context Protocol); GitHub is built in. Claude
decides when to use a tool; you decide what may run without asking
([when Ensō asks first](sidebar-and-new-tab.md#when-ensō-asks-first)).

Open **Settings → Tools** (sidebar), **Tools** (full page), or click an icon in
**Your tools** under the new-tab box.

## Where do tools come from?

The Tools page groups them:

| Group | What | Set up |
|---|---|---|
| Connected via claude.ai | Gmail, Google Calendar, Drive, Docs, Microsoft 365, Slack, Notion and the other connectors on your claude.ai account. | Connect them on claude.ai (**Connect on claude.ai** opens the page). Subscription engine only. |
| Built into Ensō | GitHub. | [Below](#how-do-i-connect-github). |
| MCP servers | Servers you added to Claude Code (`claude mcp add …`), servers Ensō signs in to itself (the **Connect** button), and servers in your `config.local.json`. | See the sections below. |

Ensō's own tools (reading and acting on pages, tabs, history, reports, memory,
the developer tools) are always there and aren't listed.

## How do I connect a server with the Connect button?

For any MCP server that signs in with OAuth, for example Commonfold:

1. On the Tools page, under **Add more**, find **Custom MCP server**.
2. Give it a short **Name** (letters, digits, `-` or `_`, for example `notes`)
   and its **MCP URL** (`https://…/mcp`).
3. Choose **Connect**. The server's sign-in page opens in a new tab.
4. Sign in and approve. The tab closes by itself and the server shows
   **Connected**, with its tools.

Ensō handles the sign-in itself: it registers with the server, uses a one-time
code with PKCE, and keeps the tokens in your macOS Keychain, never in a file.
They are renewed automatically. If renewing fails, the server shows **Needs
sign-in** and a **Reconnect** button.

Open a server's row to **Disconnect** (Ensō tells the server to revoke the
token, then deletes it) or **Remove** a server you added. Servers set up in
`config.local.json` under `oauthServers` show a **Connect** button too.

A server Ensō signs in to works with both engines. If Claude Code also has a
server with the same name, Ensō uses its own sign-in and ignores Claude Code's.

## How do I use servers from Claude Code?

On the subscription engine, MCP servers you added to Claude Code (listed in
`~/.claude.json`) are available, with the sign-in Claude Code already did.
New ones stay **off** for Ensō until you switch them on, so a server you set up
for coding doesn't quietly appear in your browser. claude.ai connectors are on
by default.

## How do I switch a tool off?

Open its row on the Tools page and use the switch. It is left out from the next
message. Switching GitHub off makes its tools refuse.

## How do I connect GitHub?

Ensō's GitHub tools read your pull requests, reviews, issues and notifications
**across every org and repository your account can see**, and can comment,
review, label, assign, close and reopen when you ask. There is no merge or
delete.

The easiest way is the GitHub CLI, if you use it:

```sh
gh auth login
```

Ensō uses its sign-in (`gh auth token`), which works in every org that allows
the GitHub CLI, without installing a GitHub App. Otherwise:

1. Create a token on GitHub: a classic token with `repo`, `read:org` and
   `notifications`, or a fine-grained token.
2. Open **GitHub** on the Tools page, paste the token and choose **Save**.
   Ensō checks it with GitHub, then stores it in your Keychain.

The row shows how it is connected ("Connected through GitHub CLI as …"). To
remove a saved token, run `security delete-generic-password -s enso-github`
(there is no button for it yet). An org that blocks both can still be read with
your browser session, if you allow `github.com` in
[session access](session-access.md).

Try: "What's waiting on me on GitHub?", "Why is CI failing on my latest PR?"

## How do I add a server that uses an API key?

Servers with a fixed token go in `~/Library/Application Support/Enso/config.local.json`:

```json
{
  "extraServers": {
    "my-notes": { "type": "http", "url": "https://notes.example.com/mcp", "tokenKeychainService": "enso-notes-token" }
  },
  "servers": { "my-notes": { "enabled": true } }
}
```

Store the token in the Keychain under the name you chose (it asks for the
token and doesn't echo it):

```sh
security add-generic-password -s enso-notes-token -a "$USER" -w
```

Quit and reopen Zen. Ensō sends the token as `Authorization: Bearer …` and never
writes it to disk. (The Tools page still mentions `chat/host/config.json` for
this; the right file is `config.local.json`.)

## Which tools run without asking?

- Reading (searching mail, listing events, reading a document) runs straight
  away, unless you turned off **Settings → Behaviour → Auto-approve read-only
  tools**.
- Anything that changes something (sending, creating, moving, deleting) asks
  first, unless you chose **Always allow** for that tool.

"Always allow" is per tool: allowing *create draft* doesn't allow *send*.

## Does it work with the API key engine?

Partly. With an API key, Ensō connects to MCP servers itself: Claude Code's
servers (those that don't need Claude Code's own sign-in), `extraServers` and
servers you connected with the Connect button.
claude.ai connectors belong to your claude.ai account and only work on the
subscription engine.
