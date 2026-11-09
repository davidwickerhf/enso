# Hosting: enso-site (enso.wicker.life)

Status: **not deployed yet.** This describes what to create on wicker-01, following [wicker-infra](https://github.com/davidwickerhf/wicker-infra) (`AGENTS.md`, `docs/apps.md`, `docs/coolify.md`, `docs/databases.md`, `docs/storage.md`, `docs/mail.md`, `docs/auth.md`, `docs/dns-domains.md`, `docs/gotchas.md`). Once it is live, fill in the uuids below and add the app to wicker-infra's `docs/apps.md`.

## Overview

| | |
|---|---|
| Coolify app uuid | *(after creation)* |
| Coolify project | Personal (`yzzzxoeygijivcpdwggvphu0`) |
| Build pack | Dockerfile (repo root: SvelteKit adapter-node on `node:24-slim`) |
| Port | 3000 |
| Deploy branch | `main` (auto-deploy through the Coolify GitHub App `huliejufyuharbrgw3jz6lty`) |
| Services | one container: migrates, then serves (`scripts/start.sh`). Run **one replica**: rate limits are in memory |
| Health check | `GET /api/health` (200 `{"ok":true}` when the DB answers; also a Dockerfile `HEALTHCHECK`) |
| Domains | https://enso.wicker.life, preview/debug https://enso.c.wicker.life |
| Database | postgres-main / `enso` |
| Object storage | `wicker-01-private/enso/sync/…` (encrypted blobs), `wicker-01-assets/enso/releases/…` (public release files) |
| Mail | Stalwart, `noreply@enso.wicker.life` via `SMTP_URL` |
| Umami website id | *(optional, create one in Umami)* |

## What to create

### 1. DNS (Hetzner DNS, zone `wicker.life`)

- `enso` A → `195.201.108.244` (TTL 300).
- `enso.c` for the preview hostname: check whether `dig enso.c.wicker.life` already resolves (wildcard); if not, add an A record → `195.201.108.244` too.
- Add the domain in Coolify **after** it resolves; if the certificate failed anyway, `docker restart coolify-proxy`.
- Don't touch the BISS records (`citations`, `api`, `test-api`).

### 2. Database (postgres-main, `oepzupuymcq4a2sf6julevmm`)

Create role and database `enso` (owner role = db name, the house convention). Generate the password on the server and store it in `/root/.pgpass-enso`; never print it:

```sh
ssh root@195.201.108.244
PW=$(openssl rand -hex 24); umask 077; echo "$PW" > /root/.pgpass-enso
docker exec -i oepzupuymcq4a2sf6julevmm psql -U postgres -v pw="$PW" <<'SQL'
CREATE ROLE enso LOGIN PASSWORD :'pw';
CREATE DATABASE enso OWNER enso;
SQL
unset PW
```

`DATABASE_URL=postgres://enso:<pw>@oepzupuymcq4a2sf6julevmm:5432/enso` (Docker network, no TLS). The app uses `gen_random_uuid()` (built in since PG 13); no extensions needed. Add the DB to the nightly Coolify backup like the others (03:00 → `wicker-01-backups`, 30 kept).

### 3. Object storage

No new bucket: use the existing ones with prefix `enso/` (`S3_PREFIX=enso`).
- `wicker-01-private` (private): sync ciphertext under `enso/sync/<user id>/<blob key>/<version>-<random>`.
- `wicker-01-assets` (public read): release files under `enso/releases/` (`/releases/<file>` redirects there; `update_hash` in the feed protects integrity).
- Push the S3 vars with `scripts/s3-env.py <app_uuid>` from wicker-infra.

Without S3 vars the app stores bytes in Postgres (`objects` table). That is for development; in production set the S3 vars.

### 4. Mail (Stalwart, see wicker-infra `docs/mail.md`)

- Create Stalwart domain `enso.wicker.life` (next free id) and sender account `noreply@enso.wicker.life`; store the password in Keychain as "Stalwart SMTP noreply@enso.wicker.life".
- DNS: MX `10 mail.wicker.life` and SPF `v=spf1 a:mail.wicker.life -all` on `enso`. Stalwart publishes DKIM/DMARC itself.
- Mailbox `hello@enso.wicker.life` with aliases support, privacy, security, legal, contact, postmaster, abuse (these addresses appear on the site and in the privacy policy).
- `SMTP_URL=smtps://noreply%40enso.wicker.life:<password>@mail.wicker.life:465`.
- **Outbound status:** wicker-infra notes the Stalwart outbound switch is still pending. If you have to bridge through Resend meanwhile, mail leaves the EU and the sender must be `noreply@wicker.life`; update `EMAIL_FROM` and the "Where data is stored" section of `content/privacy.md` before doing that.
- Without `SMTP_URL` in production the app refuses to send (it would otherwise log sign-in links).

### 5. Coolify application

- New resource → Public/Private repo (GitHub App) → `davidwickerhf/enso-site`, branch `main`, build pack **Dockerfile**, port 3000.
- Domains: `https://enso.wicker.life,https://enso.c.wicker.life`.
- Health check path `/api/health`.
- Environment variables (names only; values per the sections above):

| Name | Notes |
|---|---|
| `DATABASE_URL` | runtime connection (role `enso`) |
| `DATABASE_URL_ADMIN` | optional; owner-role URL for migrations (same as above when one role is used) |
| `BETTER_AUTH_SECRET` | 32+ chars, `openssl rand -base64 32`; copy in Keychain "BETTER_AUTH_SECRET enso" |
| `PUBLIC_URL` | `https://enso.wicker.life` (links in emails, feed and release URLs) |
| `BETTER_AUTH_URL` | optional, defaults to `PUBLIC_URL` |
| `SMTP_URL` | Stalwart sender |
| `EMAIL_FROM` | optional, default `Ensō <noreply@enso.wicker.life>` |
| `RELEASE_TOKEN` | random 32+ chars; the same value goes into the extension repo's `ENSO_RELEASE_TOKEN` secret |
| `EXTENSION_IDS` | optional, default `zen-chat@wicker.life`; comma-separated when the add-on id changes (list new and old) |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PRIVATE_BUCKET`, `S3_PUBLIC_BUCKET`, `S3_PUBLIC_BASE_URL` | via `scripts/s3-env.py` |
| `S3_PREFIX` | optional, default `enso` |
| `SYNC_QUOTA_BYTES`, `SYNC_MAX_BLOB_BYTES`, `SYNC_RATE_LIMIT_PER_MINUTE`, `RELEASE_MAX_BYTES` | optional limits (defaults 1 GiB, 16 MiB, 300, 200 MiB) |
| `PUBLIC_UMAMI_WEBSITE_ID` | optional; enables cookieless page-view counting (never on `/account`) |

All of these are runtime variables (nothing is read at build time), so changing one needs a **restart**, not a redeploy. The Dockerfile already sets `NODE_ENV`, `PORT`, `PROTOCOL_HEADER`/`HOST_HEADER` (public origin from Traefik's forwarded headers, so both domains work), `ADDRESS_HEADER` and `BODY_SIZE_LIMIT`.

## How deploys happen

- **Merging to `main` deploys to production.** Coolify builds the Dockerfile on wicker-01 and swaps the container once healthy. Don't also trigger a manual deploy (it queues a duplicate).
- On start, `scripts/start.sh` runs `scripts/migrate.mjs` (applies `migrations/NNN_*.sql` once each, in a transaction, under an advisory lock, with checksums), then `node build`. A failed migration exits the container and the old one keeps serving. **Never edit an applied migration**; add a new file.
- CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests against a throwaway Postgres service, and the build. It never touches production.
- Roll back: Coolify → Deployments → redeploy an earlier one, or `git revert` on `main`. Migrations are not rolled back.
- Housekeeping runs inside the app once a day: tombstones older than 90 days, expired device requests, sessions and sign-in links are deleted. No Coolify scheduled task is needed.

## Releases (extension + helper)

The extension repo publishes with `docs/ci/extension-release.yml` (copy it to that repo's `.github/workflows/release.yml`). On a `v*` tag it signs the xpi through AMO (unlisted), builds the helper tarball and calls:

```sh
curl --fail-with-body -X PUT -H "Authorization: Bearer $ENSO_RELEASE_TOKEN" \
  -H "Content-Type: application/octet-stream" --data-binary @enso-0.3.0.xpi \
  "https://enso.wicker.life/api/releases/extension/0.3.0?strict_min_version=139.0"
```

(`helper` instead of `extension` for the tarball.) Re-uploading identical bytes is a no-op; different bytes for a published version are refused (409) unless `?replace=1`. The content type must not be a form type, or SvelteKit's CSRF guard rejects it.

The extension's manifest must contain `browser_specific_settings.gecko.update_url = "https://enso.wicker.life/updates.json"`; the release workflow injects it into the signed build. Secrets in the extension repo: `AMO_JWT_ISSUER`, `AMO_JWT_SECRET`, `ENSO_RELEASE_TOKEN`.

Public endpoints: `/updates.json` (Firefox update manifest), `/api/latest`, `/releases/<file>`, `/releases/enso-latest.xpi`, `/releases/enso-helper-latest-darwin.tar.gz`, `/install.sh`.

## First-deploy checklist

1. [ ] DNS `enso` A record resolves to 195.201.108.244.
2. [ ] Role/database `enso` on postgres-main; password in `/root/.pgpass-enso`; backup schedule added.
3. [ ] Stalwart domain, `noreply@` sender, `hello@` mailbox and aliases, MX + SPF; test mail delivered.
4. [ ] GitHub repo `davidwickerhf/enso-site` pushed; CI green.
5. [ ] Coolify app created (Dockerfile, port 3000, both domains, health check `/api/health`), env vars set, S3 vars pushed.
6. [ ] First deploy: logs show `migrate: applying 001_init.sql` then `Listening on http://0.0.0.0:3000`.
7. [ ] `curl https://enso.wicker.life/api/health` → `{"ok":true,"db":"ok","storage":"s3"}`.
8. [ ] Sign up on `/account` with a real address; the email arrives from `noreply@enso.wicker.life`; the link signs you in. (Sign-in links always point at `PUBLIC_URL`, so test on the real domain, not `enso.c.wicker.life`.)
9. [ ] Create a device token by hand, `PUT`/`GET` a test blob with it, check the object appears under `wicker-01-private/enso/sync/`, then delete the account and check it is gone.
10. [ ] Set `ENSO_RELEASE_TOKEN`, `AMO_JWT_ISSUER`, `AMO_JWT_SECRET` in the extension repo; tag a release; `/api/latest` lists it and `/updates.json` has its sha256.
11. [ ] Run the installer on a Mac: `curl -fsSL https://enso.wicker.life/install.sh | bash`.
12. [ ] Optional: Umami website, `PUBLIC_UMAMI_WEBSITE_ID`, restart.
13. [ ] Check that request-log retention on the server matches the privacy policy (at most 30 days).
14. [ ] Add the app to wicker-infra `docs/apps.md`, `docs/coolify.md`, `docs/databases.md` and `docs/mail.md`.
