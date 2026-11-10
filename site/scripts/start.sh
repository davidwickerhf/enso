#!/bin/sh
# Container entrypoint (Coolify): migrate, then serve. If a migration fails
# the container exits and Coolify keeps the previous one running.
set -eu
node scripts/migrate.mjs
exec node build
