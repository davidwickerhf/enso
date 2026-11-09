#!/usr/bin/env bash
# Builds the helper tarball the installer downloads:
#
#   scripts/pack-helper.sh <version> [out-dir]     → <out-dir>/enso-helper-<version>-darwin.tar.gz
#
# Production dependencies only, and no optional ones: the Claude Agent SDK's
# platform packages (@anthropic-ai/claude-agent-sdk-<os>-<arch>) each carry a
# ~200 MB Claude Code binary. The helper runs on the user's own `claude` CLI
# instead (helper/lib/claude-cli.mjs), so they are left out.
set -euo pipefail

VERSION="${1:?usage: scripts/pack-helper.sh <version> [out-dir]}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$(mkdir -p "${2:-$REPO/dist}" && cd "${2:-$REPO/dist}" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/enso-pack.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/helper"
rsync -a --exclude node_modules --exclude test --exclude run.sh --exclude .DS_Store "$REPO/helper/" "$WORK/helper/"
(cd "$WORK/helper" && npm ci --omit=dev --omit=optional --no-audit --no-fund --loglevel=error)
# Belt and braces: no platform binaries even if npm pulled one in.
rm -rf "$WORK/helper/node_modules/@anthropic-ai/"claude-agent-sdk-*
if find "$WORK/helper/node_modules" -type f -size +20M | grep -q .; then
  echo "Unexpected large files in the helper:" >&2
  find "$WORK/helper/node_modules" -type f -size +20M >&2
  exit 1
fi
echo "$VERSION" > "$WORK/helper/VERSION"
TARBALL="$OUT/enso-helper-$VERSION-darwin.tar.gz"
tar -czf "$TARBALL" -C "$WORK" helper
echo "$TARBALL ($(du -h "$TARBALL" | cut -f1), unpacked $(du -sh "$WORK/helper" | cut -f1))"
