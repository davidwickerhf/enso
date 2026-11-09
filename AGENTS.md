# Agent notes: enso-site

- Read `/Users/davidwickerhf/Projects/personal/wicker-infra/AGENTS.md` first (deploy = merge to `main`, no secrets in output, no AI attribution, headless browsers only, no local `docker build`).
- Hosting, env vars and the deploy checklist: `docs/HOSTING.md`.
- Server code lives in `src/lib/server/` and reads `process.env` (via `config.ts`), so it runs in the tests without SvelteKit. Route files are thin wrappers around `src/lib/server/api.ts`.
- Migrations: add `migrations/NNN_name.sql`; never edit an applied one (checksummed by `scripts/migrate.mjs`).
- The server must never receive keys or plaintext for sync. If you change what it stores, update `content/privacy.md`, `content/docs/sync.md` and `content/docs/sync-api.md` in the same change.
- Tests need a Postgres (`DATABASE_URL`, or `TEST_DATABASE_URL`); they use a separate `_test` database.
