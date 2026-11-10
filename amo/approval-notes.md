Source: https://github.com/davidwickerhf/enso (extension/ is this add-on, helper/ the native app), not bundled or minified. This package is extension/ at this version's tag, built with `node scripts/build-extension.mjs --channel listed`, which drops the `// <unlisted-only>` blocks in pageagent.js and writes channel.js (CHANNEL = "listed").

Permissions:
- nativeMessaging: the add-on is the browser half of a local helper app ("enso", Node.js; macOS, Linux, Windows), installed with `curl -fsSL https://enso.wicker.life/install.sh | bash` or, on Windows, `irm https://enso.wicker.life/install.ps1 | iex`. The helper runs Claude (Claude Code or the user's API key) and the user's tools; the add-on is its interface and acts on pages for it.
- <all_urls>, tabs, webNavigation, webRequest, cookies: the user asks Claude about, or to act on, the current page. pageagent.js is injected on demand to read it or click/type when asked. webRequest/webNavigation keep an in-memory per-tab network and console log for developer tools (no bodies). cookies: signed-in requests only on sites the user allows; values never reach the model.
- history, bookmarks, search: new-tab suggestions and search. tabGroups, contextualIdentities: Zen spaces. menus, clipboardWrite, storage: context menu, copy, settings.

Search engine: search_provider has is_default: true, so Firefox asks at install whether to make Ensō the default. Only Yes changes it (No just adds the engine) and updates don't ask. The add-on never sets it; a dismissible new-tab card lists the manual steps.

Dynamic code: no remote code, eval or new Function. The listed build omits the developer tool that evaluates JavaScript (self-distributed build only). page_query, page_inspect and page_upload are fixed code: the first two run a CSS selector through querySelectorAll and return attributes, rects or styles; page_upload puts files the helper read, unaltered, on a file input or drop zone.

Safety: banking, payment, password-manager, health, tax and government sites are never read or acted on (sensitiveHosts in helper/config.json, mirrored in background.js). Irreversible actions always ask. No analytics or telemetry. The add-on's only direct request is search suggestions from Google or DuckDuckGo (no credentials) while typing in the new tab, off until enabled in Settings. The helper's daily brief is also off by default.

Testing without the helper: a new tab or the sidebar (Ctrl/Cmd+E) shows a guided setup with the install command and continues once the helper connects. Full UI with a mock helper: `cd extension && python3 -m http.server 8000`, then http://127.0.0.1:8000/newtab.html or /sidebar.html (docs/development.md).
