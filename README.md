# enso-site

The website, docs, extension update feed and end-to-end-encrypted sync server for **Ensō**, a browser companion for Zen. Live at https://enso.wicker.life (once deployed; see [docs/HOSTING.md](docs/HOSTING.md)).

- **Stack:** SvelteKit (adapter-node) on Node, Postgres, Better Auth (email magic links), Hetzner Object Storage via `aws4fetch`, Stalwart mail via `nodemailer`. One Docker container on wicker-01 (Coolify).
- **Content:** docs and the privacy policy are Markdown in `content/`. Product screenshots (WebP, light and dark) are in `static/screenshots/`, listed in `src/lib/screenshots.ts`; see `DESIGN.md` for how they are made.
- **Installer:** `static/install.sh`, served at `/install.sh`.
- **Release workflow for the extension repo:** `docs/ci/extension-release.yml`.

## Develop

```sh
docker run -d --rm --name enso-site-pg -e POSTGRES_USER=enso -e POSTGRES_PASSWORD=enso -e POSTGRES_DB=enso \
  -p 127.0.0.1:55439:5432 postgres:17-alpine
cp .env.example .env
pnpm install
pnpm db:migrate
pnpm dev            # http://localhost:5173 — sign-in links are printed in the terminal
pnpm test           # uses a separate <db>_test database, created on first run
pnpm lint && pnpm check && pnpm build
docker stop enso-site-pg
```

## Routes

| Route | What |
|---|---|
| `/`, `/docs`, `/docs/:slug`, `/privacy` | Public site |
| `/account`, `/account/approve`, `/account/export` | Sign in, devices, storage, export, delete; device approval |
| `/api/auth/*` | Better Auth (magic link) |
| `/api/device/start`, `/api/device/poll` | Device sign-in flow |
| `/api/devices`, `/api/devices/:id` | List / revoke devices (bearer token) |
| `/api/sync/blobs/:key` (GET, PUT, DELETE), `/api/sync/manifest`, `/api/sync/usage` | Encrypted blob sync (bearer token) |
| `DELETE /api/account` | Delete account and all blobs (bearer token) |
| `PUT /api/releases/:kind/:version` | CI publishes an xpi or helper tarball (bearer `RELEASE_TOKEN`) |
| `/updates.json`, `/api/latest`, `/releases/:file`, `/install.sh` | Update feed and downloads |
| `/api/health` | Health check |

The sync protocol and client-side encryption scheme are documented at `/docs/sync-api` (`content/docs/sync-api.md`).
