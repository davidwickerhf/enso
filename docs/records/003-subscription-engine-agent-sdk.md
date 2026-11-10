# 003: The default engine runs on the user's Claude Code through the Agent SDK

Status: accepted. The subscription engine dates from Zen Chat 0.2.0; running it
on the user's installed `claude` CLI instead of a bundled binary from 0.5.0
(9 November 2026).

## Context

Ensō needs a model. The options were an Anthropic API key (pay per token,
billed separately) or the Claude subscription the user already has. A
subscription can be used programmatically through Claude Code, and the Claude
Agent SDK (`@anthropic-ai/claude-agent-sdk`) drives Claude Code from Node. Claude
Code also brings the user's claude.ai connectors (Gmail, Calendar, Drive, …) and
the MCP servers they set up for it.

The SDK ships a platform binary of Claude Code as an optional dependency, about
200 MB per platform.

## Decision

- The default engine (`helper/lib/engine-sub.mjs`) runs each turn through the
  Agent SDK, with `pathToClaudeCodeExecutable` pointing at the user's own
  `claude` (`helper/lib/claude-cli.mjs`). The helper is installed and packed
  with `--omit=optional`, so the bundled binary is never shipped.
- `settingSources: []`: the user's Claude Code hooks, permission rules and
  settings don't apply to browser turns; MCP servers are passed in explicitly,
  and Ensō's own tools run in-process.
- An API-key engine (`helper/lib/engine-api.mjs`) stays available for people
  without a plan or without Claude Code.

## Consequences

- No separate bill for most users; usage counts against their plan's limits.
- claude.ai connectors work in Ensō without extra setup (subscription engine only).
- The helper tarball is about 8.6 MB (0.5.2) instead of 200+ MB.
- Ensō depends on a Claude Code install and sign-in, found on `PATH` or the
  usual locations; the UI explains how to install it when it is missing.
- Claude Code updates can change behaviour under Ensō; the SDK version is
  pinned in `helper/package.json` but the CLI is the user's.
- Starting Claude Code takes about three seconds, hence warm sessions and a
  spare session kept ready ([architecture.md](../architecture.md#subscription-engine-libengine-submjs)).
- Claude Code keeps its own transcripts of these sessions in `~/.claude/projects/`.
