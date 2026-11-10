#!/usr/bin/env bash
# Run Ensō from this checkout instead of a release.
#
#   scripts/dev.sh            # helper deps, native-messaging manifests, unsigned build/enso-dev.xpi
#   scripts/dev.sh --open     # … and open the xpi in Zen (asks to add or update the extension)
#   scripts/dev.sh --mcp      # … and register the zen-browser MCP server with Claude Code if missing (enso mcp install)
#
# The helper runs straight from helper/ (Zen starts helper/run.sh, written
# here with this machine's node path), so helper edits take effect the next
# time Zen starts it (quit and reopen Zen). Extension edits need a version
# bump in extension/manifest.json and another --open.
#
# Zen only installs unsigned extensions when signature checks are off:
# about:config → xpinstall.signatures.required = false, or in the profile's
# user.js: user_pref("xpinstall.signatures.required", false);
# (Release builds are signed by addons.mozilla.org and don't need this.)
#
# Environment: ENSO_EXTENSION_ID (default enso@wicker.life).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HELPER="$REPO/helper"
EXTENSION_ID="${ENSO_EXTENSION_ID:-enso@wicker.life}"
HOST_NAME="enso"
# Folders as in install.sh and helper/lib/platform.mjs (Windows: not supported by this script).
case "$(uname -s)" in
  Darwin)
    SUPPORT="$HOME/Library/Application Support"
    APP_DIR="$SUPPORT/Enso"
    LOG_DIR="$HOME/Library/Logs/Enso"
    MANIFEST_DIRS=("$SUPPORT/Mozilla/NativeMessagingHosts" "$SUPPORT/zen/NativeMessagingHosts") ;;
  Linux)
    APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/enso"
    LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/enso"
    MANIFEST_DIRS=("$HOME/.mozilla/native-messaging-hosts" "$HOME/.zen/native-messaging-hosts") ;;
  *) echo "scripts/dev.sh runs on macOS and Linux." >&2; exit 1 ;;
esac
OPEN=0
MCP=0
for arg in "$@"; do
  case "$arg" in
    --open) OPEN=1 ;;
    --mcp) MCP=1 ;;
    -h|--help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

NODE="$(command -v volta >/dev/null 2>&1 && volta which node 2>/dev/null || command -v node || true)"
[ -x "$NODE" ] || { echo "Node.js 18+ is required (https://nodejs.org)." >&2; exit 1; }
NODE="$("$NODE" -p 'process.execPath' 2>/dev/null || echo "$NODE")" # the real binary, not a version manager's shim
echo "Node: $NODE ($("$NODE" --version))"

# 1. Helper dependencies. Optional packages are skipped: the subscription engine
#    uses your installed `claude` CLI, not the SDK's bundled binary.
[ -L "$HELPER/node_modules" ] && [ ! -e "$HELPER/node_modules" ] && rm "$HELPER/node_modules" # dangling link
if [ ! -e "$HELPER/node_modules" ]; then
  (cd "$HELPER" && npm ci --omit=optional --no-audit --no-fund --loglevel=error)
fi

# 2. The script Zen starts. Same as install.sh's (keep them in sync): stderr goes
#    to <log folder>/helper.log, so crashes before Node's own logging are there too.
cat >"$HELPER/run.sh" <<EOF
#!/bin/bash
# Written by scripts/dev.sh: runs the helper from this checkout.
NODE="$NODE"
HOST="$HELPER/host.mjs"
MIN_NODE=18
LOG_DIR="$LOG_DIR"
EOF
cat >>"$HELPER/run.sh" <<'RUNSH'
LOG="$LOG_DIR/helper.log"
mkdir -p "$LOG_DIR" 2>/dev/null
# Keep it near 1 MB × 2 (the helper rotates too, while it runs).
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null | tr -d ' ' || echo 0)" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
note() {
	printf '%s run.sh: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG" 2>/dev/null
	printf 'Ensō helper: %s\n' "$*" >&2
}
if [ ! -x "$NODE" ]; then
	note "Node.js is not at $NODE any more. Run scripts/dev.sh again."
	exit 127
fi
major="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if ! [ "${major:-0}" -ge "$MIN_NODE" ] 2>/dev/null; then
	note "$NODE is Node ${major:-?}, too old or not working (Ensō needs $MIN_NODE+). Run scripts/dev.sh again with a newer Node."
	exit 1
fi
if { : >>"$LOG"; } 2>/dev/null; then
	export ENSO_STDERR_LOG="$LOG"
	exec "$NODE" "$HOST" "$@" 2>>"$LOG"
fi
exec "$NODE" "$HOST" "$@"
RUNSH
chmod +x "$HELPER/run.sh"

# 2b. The `enso` command (enso mcp: the stdio launcher MCP clients start), from this checkout.
mkdir -p "$APP_DIR/bin"
cat >"$APP_DIR/bin/enso" <<EOF
#!/bin/bash
# Written by scripts/dev.sh: the enso command from this checkout.
exec "$NODE" "$HELPER/bin/enso.mjs" "\$@"
EOF
chmod +x "$APP_DIR/bin/enso"
echo "Wrote $APP_DIR/bin/enso"
if [ -d "$HOME/.local/bin" ] && { [ ! -e "$HOME/.local/bin/enso" ] || [ "$(readlink "$HOME/.local/bin/enso" 2>/dev/null)" = "$APP_DIR/bin/enso" ]; }; then
  ln -sf "$APP_DIR/bin/enso" "$HOME/.local/bin/enso" && echo "Linked ~/.local/bin/enso"
fi

# 3. Native-messaging manifests for Zen and Firefox.
manifest="$("$NODE" -e '
  const [name, path, id] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ name, description: "Ensō helper (dev checkout)", path, type: "stdio", allowed_extensions: [id] }, null, 2) + "\n");
' "$HOST_NAME" "$HELPER/run.sh" "$EXTENSION_ID")"
for dir in "${MANIFEST_DIRS[@]}"; do
  mkdir -p "$dir" && printf '%s' "$manifest" >"$dir/$HOST_NAME.json"
  echo "Wrote $dir/$HOST_NAME.json"
done
mkdir -p "$APP_DIR"

# 4. Unsigned extension package.
mkdir -p "$REPO/build"
XPI="$REPO/build/enso-dev.xpi"
rm -f "$XPI"
(cd "$REPO/extension" && zip -qr -X "$XPI" . -x '.DS_Store' -x '*/.DS_Store')
VERSION="$("$NODE" -p "require('$REPO/extension/manifest.json').version")"
echo "Built $XPI (Ensō $VERSION, unsigned)"

# 5. Optional: let Claude Code use Zen, through the launcher (no token in its config).
if [ "$MCP" = 1 ]; then
  if ! command -v claude >/dev/null 2>&1; then
    echo "Claude Code not found; skipping the zen-browser registration."
  elif claude mcp get zen-browser >/dev/null 2>&1; then
    echo "Claude Code already has zen-browser (\"$APP_DIR/bin/enso\" mcp install switches it to the launcher)."
  else
    "$APP_DIR/bin/enso" mcp install --client claude
  fi
fi

if [ "$OPEN" = 1 ]; then
  if [ "$(uname -s)" = Darwin ]; then open -a Zen "$XPI"; else (nohup "$(command -v zen || command -v zen-browser || echo xdg-open)" "$XPI" >/dev/null 2>&1 &); fi
  echo "Zen is asking to add or update Ensō $VERSION (needs xpinstall.signatures.required = false)."
fi
echo "Done. Quit and reopen Zen to restart the helper after helper changes."
