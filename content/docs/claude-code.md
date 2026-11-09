---
title: Use Zen from Claude Code
description: Let Claude in your terminal, or apps built on Claude Code, read and operate Zen through Ensō.
order: 16
group: Using Ensō
---

# Use Zen from Claude Code

While Zen is open, Ensō's helper also runs a small MCP server on your Mac. Claude Code, and apps built on it, can connect to it and use Zen: list, read, open, group and close tabs, read and act on pages, take screenshots and search your history.

The installer registers it for you as **zen-browser**. To add it by hand:

```sh
claude mcp add-json --scope user zen-browser \
  '{"type":"http","url":"http://127.0.0.1:47823/mcp","headers":{"Authorization":"Bearer <token>"}}'
```

The token is in `~/Library/Application Support/Enso/mcp-token` (readable only by you).

## What keeps it safe

- It only listens on this Mac (`127.0.0.1`), needs the token, and refuses requests coming from web pages.
- Private sites stay off-limits, exactly as in Ensō itself.
- Every action appears in Ensō's **Activity**, marked "Claude Code".
- **Settings → Claude Code can use Zen** chooses **Full** (read and act), **Read only**, or **Off**.

"This space" in tab lists means the Zen space you are using; ask for all spaces to see the rest.
