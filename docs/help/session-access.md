# Session access and developer tools

Ensō can debug web pages with you: read a tab's console and network requests,
run JavaScript on the page, look at its storage, make a request with your
signed-in session, and drive a separate, invisible Zen for testing. Using your
session is sensitive, so it needs your permission per site.

## What can it do?

| Tool | What it does | Asks you? |
|---|---|---|
| Read the console | Console messages and errors of a tab, from the first time it looks. | No |
| List network requests | The tab's requests: URL, status, timing, sizes. Secret header values are hidden; bodies are never recorded. | No |
| Inspect storage | Storage keys and cookie names and flags. Never cookie values. | No; with values, only if you didn't ask |
| Run JavaScript on the page | For debugging: reading state, checking a selector. | Unless you asked for it |
| Request with your session | An HTTP request made inside a tab of the site, with your login there. | The site needs your permission |
| Headless Zen | A separate, invisible Zen with a throwaway profile, signed out unless you let it copy a site's session. | Copying a session needs permission |

Turn them off in **Settings → Advanced**: **Developer tools** (console,
network, JavaScript, storage, session requests) and **Headless mode**. Every
action appears in **Activity**.

## What is session access?

A list of sites where Claude may use your signed-in session: to make requests
as you, or to copy your login on that site into the headless Zen.

- **When a site isn't on the list,** Ensō asks each time, with **Allow**,
  **Always allow on this site** and **Deny**. Other agents (Claude Code, Codex)
  are refused; they can't ask.
- **Always allow on this site** adds it to the list.
- **Settings → Privacy & safety → Session access** shows the list. Add a site
  (`github.com` or `https://app.example.com`) or remove one with ×.
- An entry covers its subdomains: `https://github.com` also allows
  `api.github.com`.
- Requests that can change data (anything but GET, HEAD and OPTIONS) also need
  you to have asked for exactly that, or your approval.

Banking, payment, password-manager, health, tax and government sites can't be added, and session
requests never run there.

## What does Claude see from my session?

The response of the request it made, with secret-looking headers hidden. It
never sees your cookie values, `Authorization` headers or tokens: the request is
made inside a browser tab, and the browser adds your cookies itself. Response
bodies are treated as data, never as instructions.

## How does the headless Zen work?

Ask, for example, "start a headless browser on localhost:5173 and check the
sign-up form". Ensō starts a second Zen without a window and with a temporary
profile, so your own windows and tabs aren't touched. It is signed out of
everything unless you let it copy specific sites' sessions (their cookies, and
optionally local storage). It stops after 10 minutes without use, when Claude
stops it, or when Zen quits, and its profile, including copied sessions, is
deleted.

Copying sessions needs Node.js 22.5 or newer on your Mac.

## Which sites should I allow?

Your own apps and the sites you debug often (`localhost`, a staging site,
`github.com`). Leave out sites where a mistaken request could cost you: shops,
social accounts, anything with payments.
