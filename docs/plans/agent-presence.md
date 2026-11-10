# Agent presence and steering

Status: **planned, not built.** Nothing on this page exists in 0.5.2 except
what is listed under [What exists today](#what-exists-today). Recorded 10
November 2026.

## Why

Since 0.5.2 other agents (Claude Code, Codex, Cursor) can act in Zen through
`zen-browser`, and Ensō knows which client made each call. But the user only
sees that after the fact (Activity) or as a thin ribbon on the page. They can't
see what the agent is trying to do, can't pause it without killing the agent's
session elsewhere, and can't correct it ("not that account, use the work one")
without switching to the terminal. This plan makes an acting agent visible in
the sidebar and steerable from it.

## What exists today

- `identifyClient` (`helper/lib/mcpauth.mjs`) labels each request from the
  launcher's `X-Enso-Client` header or `clientInfo`.
- Every MCP action is logged in `actions.jsonl` with `source` and `client`.
- `pageagent.js` outlines the element it acts on and shows a ribbon, "✦ Codex is
  working on this page".
- Settings → External control (Full, Read, Off) applies to all clients at once.

## The design

### 1. A live activity card per tab

When an MCP client acts on a tab, the sidebar (in the space that tab belongs
to) shows a card above the composer:

- the client and its task as a pill: "Codex · Fix the failing checkout test";
- the last few steps, live: "Read the page", "Clicked Pay now", "Typed into
  Email", with the same labels as Ensō's own tool calls;
- **Pause**, **Stop** and **Tell the agent**.

The card stays while the client has acted on that tab in the last few minutes,
then collapses into Activity.

### 2. Pause and Stop

- **Pause**: further tool calls from that client session wait (up to a timeout,
  then return a tool error "The user paused you in Zen; wait or ask them").
  Reads may continue while paused, or not; see open questions.
- **Stop**: every further call from that session returns a tool error "The user
  stopped you in Zen. Don't continue in the browser." until the client starts a
  new session. Stop doesn't kill the client; it only closes Zen to it.

### 3. Tell the agent

A text box on the card. The note is queued for that client session and
delivered in the agent's next tool result, as an extra text block:

```text
Note from the user (sent from Ensō while you were working): use the work account, not the personal one.
```

The agent sees it at its next step without any new client feature. The card
shows "Delivered" once a result carried it. Notes are kept in memory only and
logged in Activity.

### 4. Outline flash

Every element an agent acts on flashes an outline in the client's colour for
about a second, in addition to the ribbon, so the user can follow along on the
page. (The outline exists for Ensō's own actions; this extends it to a short
flash per action with the client's name.)

### 5. An Agents row across spaces

The full page and the sidebar get an **Agents** row listing clients that acted
in the last hour across all Zen spaces: client, task, space, last step, and the
same Pause, Stop and Tell controls. Useful when an agent works in a background
space.

### 6. Optional `session_start`

A new tool, `session_start`, that a client may call first:

| Parameter | Meaning |
|---|---|
| `task` | One line on what the agent is doing ("Fix the failing checkout test"). |
| `label?` | A display name, when the client's own name isn't helpful. |

It returns a short acknowledgement and any pending notes. Without it, the card
shows the client's label and "Working in Zen". The server instructions would
ask agents to call it; nothing breaks if they don't.

## How it would work

- **Session identity.** HTTP requests are stateless, so the launcher generates
  an id per process and sends it as `X-Enso-Session`; plain HTTP clients fall
  back to the client label. `identifyClient` adds `session` to `ctx.client`.
- **State in the helper.** An in-memory map `session → { client, task, tabIds,
  steps, paused, stopped, notes }` in `mcpserver.mjs`, updated by `record` and by
  a wrapper around each tool's `run`. Pause and Stop are checked in that wrapper
  before a tool runs; notes are appended to the result content after it runs.
- **Protocol.** New host → UI message `agents` (`{ sessions: [...] }`, pushed on
  change) and UI → host messages `agents.pause`, `agents.resume`,
  `agents.stop`, `agents.note` (`{ session, text }`). Both go in
  [PROTOCOL.md](../PROTOCOL.md) when built.
- **Page.** `page.request` already carries `agent`; it would also carry a colour
  index for the outline flash.
- **Space.** `background.js` already maps tabs to spaces (`spaceOf`); the card
  is shown in the sidebar of the tab's space.

## Open questions

- Should Pause also hold read-only tools, or only actions?
- How long does a paused call wait before it errors (the client may time out
  first)? Possibly return at once with "paused" and let the agent retry.
- Notes to a client that never calls again: expire after an hour?
- Should Stop also be offered as "Stop and switch this client to read-only"?
- Clients without the launcher can't send a session id; is per-label state good
  enough for them?
- Accessibility of a live-updating card: announce new steps politely, never
  steal focus.

## Out of scope

- Approvals for MCP clients inside Ensō (asking the user in the sidebar before
  an agent acts). Possible later on the same session state, but it changes the
  security model in [security.md](../security.md#who-decides-per-caller) and
  needs its own plan.
- Steering Ensō's own chat turns (it already has Stop and approvals).
