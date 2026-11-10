# 001: A local MCP server inside the helper, not a hosted one

Status: accepted. In use since the Zen Chat builds (before 0.5.0); recorded
10 November 2026.

## Context

Other agents on the same Mac (Claude Code in a terminal, T3 Code, Codex,
Cursor) should be able to read and operate the user's Zen: tabs, pages, the
console, signed-in requests, GitHub. Two ways to offer that:

- a hosted MCP server (for example on enso.wicker.life) that the extension
  connects out to and agents call over the internet;
- a server on the Mac, inside the helper that Zen already runs.

## Decision

The helper serves the `zen-browser` MCP server on `127.0.0.1:47823`
(`helper/lib/mcpserver.mjs`), reusing the same tool definitions as Ensō's own
chat (`helper/lib/toolset.mjs`). It runs only while Zen is open. It accepts
only loopback connections with a bearer token from the data folder, and refuses
any request with a browser `Origin`.

## Consequences

- Page content, tabs and session requests never pass through a server of ours;
  the privacy promise ("Ensō has no server in the conversation path") holds for
  other agents too.
- No accounts, no relay, no hosting cost, and it works offline (except for the
  agents' own model calls).
- One tool list for Ensō and for agents: a new tool appears in both.
- Only agents on the same Mac can use it. Remote agents would need their own
  bridge.
- The server is down while Zen is closed. The stdio launcher softens that
  ([002](002-stdio-launcher.md)).
- Any program running as the user can read the token file; loopback plus token
  protects against web pages and other users, not against local malware
  ([security.md](../security.md#known-limits)).
