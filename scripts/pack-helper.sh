#!/usr/bin/env bash
# Builds the helper tarball the installer downloads:
#
#   scripts/pack-helper.sh <version> [out-dir]     → <out-dir>/enso-helper-<version>.tar.gz
#
# One archive for macOS, Linux and Windows: the helper is plain JavaScript and
# its production dependencies have no native or per-OS files (checked below),
# so the same tarball runs on any Node 18+. Windows' install.ps1 unpacks it with
# the tar.exe that ships with Windows 10 and 11.
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
# One archive for every OS only works without native addons or per-OS packages.
native="$(find "$WORK/helper/node_modules" \( -name '*.node' -o -name binding.gyp -o -name '*.dylib' -o -name '*.so' -o -name '*.dll' -o -name '*.exe' \) -print)"
per_os="$(cd "$WORK/helper/node_modules" && grep -l '"os": *\[' ./*/package.json ./@*/*/package.json 2>/dev/null || true)"
if [ -n "$native$per_os" ]; then
  echo "The helper now has native or per-OS dependencies; build one tarball per platform instead:" >&2
  printf '%s\n' $native $per_os >&2
  exit 1
fi
echo "$VERSION" > "$WORK/helper/VERSION"
TARBALL="$OUT/enso-helper-$VERSION.tar.gz"
# No macOS extended attributes or ._ files (GNU tar on Linux warns about them).
if tar --version 2>/dev/null | grep -q bsdtar; then
  COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -czf "$TARBALL" -C "$WORK" helper
else
  tar -czf "$TARBALL" -C "$WORK" helper
fi
echo "$TARBALL ($(du -h "$TARBALL" | cut -f1), unpacked $(du -sh "$WORK/helper" | cut -f1))"
