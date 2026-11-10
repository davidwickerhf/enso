Source: https://github.com/davidwickerhf/enso (extension/ is this add-on, helper/ the native app). Nothing is bundled, minified or generated; the files are extension/ at the tag for this version.

Permissions:
- nativeMessaging: the add-on is the browser half of a local helper app ("enso", Node.js, macOS), installed with `curl -fsSL https://enso.wicker.life/install.sh | bash`. The helper runs Claude (through Claude Code or the user's Anthropic API key) and the user's tools; the add-on shows the chat, new tab and settings and carries out page actions for it.
- <all_urls>, tabs, webNavigation, webRequest, cookies: the user asks Claude about, or to act on, whatever page they're on. pageagent.js is injected on demand to read the page and click/type when asked. webRequest/webNavigation keep a per-tab network and console log in memory for the developer tools (no bodies). cookies: signed-in requests only on sites the user allowed; cookie values never reach the model.
- history, bookmarks, search: new-tab suggestions and history search. tabGroups, contextualIdentities: Zen spaces. menus, clipboardWrite, storage: context menu, copy, settings.

Dynamic code: no remote code. One developer tool, page_eval (can be switched off in Settings → Developer), evaluates an expression in the page's own world via window.wrappedJSObject.eval (pageagent.js, evaluate()) so a user debugging their web app can inspect page state. It never runs in the extension's context, refuses on private sites, asks for approval unless the user asked for it, refuses document.cookie, and is logged.

Safety: banking, payment, password-manager, health, tax and government sites are never read or acted on (helper/config.json sensitiveHosts, copied in background.js). Irreversible actions always ask. No analytics or telemetry. The only direct network request from the add-on is search suggestions from the default engine (Google or DuckDuckGo, no credentials) while typing in the new tab's search box.

Testing without the helper: open a new tab or the sidebar (Ctrl+E). Ensō shows a guided setup with the install command and continues by itself when the helper connects. To see the full UI with a mock helper: `cd extension && python3 -m http.server 8000`, then open http://127.0.0.1:8000/newtab.html or /sidebar.html (docs/development.md).
