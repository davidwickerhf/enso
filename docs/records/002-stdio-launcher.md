# 002: A stdio launcher (`enso mcp`) in front of the HTTP server

Status: accepted in 0.5.2 (PR #2, 10 November 2026).

## Context

Before 0.5.2, clients were registered with the HTTP endpoint and the token in a
header, for example
`claude mcp add-json zen-browser '{"type":"http","url":"http://127.0.0.1:47823/mcp","headers":{"Authorization":"Bearer <token>"}}'`.
That had three problems:

- the token sat in each client's config file, next to other secrets, and in
  shell history;
- rotating the token broke every registration;
- while Zen was closed the clients saw a dead server: connection errors at
  start and no tool list.

The helper itself can't be the stdio server, because Zen starts and owns it;
clients can't start it.

## Decision

`enso mcp` (`helper/bin/enso.mjs` → `helper/lib/mcplauncher.mjs`) is a small
stdio MCP server that clients start. It forwards each JSON-RPC message to the
helper's HTTP endpoint, reading the token from the 0600 file on every request,
and adds `X-Enso-Client` with the client's `clientInfo`. When the helper isn't
reachable it answers `initialize` and `ping` itself, lists the last tools it saw
(`mcp-tools-cache.json`), returns a clear tool error for calls, and sends
`tools/list_changed` when the helper is back.

`enso mcp install` registers the launcher with Claude Code, Codex and Cursor,
replacing old http registrations, and prints only what changed.

## Consequences

- No token in any client config; `enso mcp rotate` doesn't need
  re-registration.
- Clients start cleanly with Zen closed and pick up the tools when it opens.
- Ensō knows which client is acting, which feeds the activity log and the page
  ribbon.
- One more process per client session (Node, small). The HTTP endpoint stays
  for clients that can't start a command, with the old trade-offs.
- The launcher's path (`Enso/bin/enso`) is part of the install: the installer,
  `dev.sh` and `enso mcp install` write it.
