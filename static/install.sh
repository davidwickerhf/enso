#!/usr/bin/env bash
# Ensō helper installer.
#
#   curl -fsSL https://enso.wicker.life/install.sh | bash
#
# Installs the local helper (the Node.js program Zen starts through native
# messaging) into ~/Library/Application Support/Enso/helper and registers it
# with Zen and Firefox. Safe to run again: that is also how you update it.
# Nothing is installed outside your home folder and nothing needs sudo.
#
# Environment overrides (optional):
#   ENSO_HELPER_URL     tarball to install instead of the latest release
#   ENSO_EXTENSION_ID   add-on id allowed to talk to the helper
#   ENSO_SKIP_CHECKSUM  set to 1 to skip the SHA-256 check (not recommended)
#   ENSO_SITE           site to download from (testing)

# Everything runs inside main(), so a download cut off halfway runs nothing.
main() {
	set -euo pipefail

	local SITE="${ENSO_SITE:-https://enso.wicker.life}"
	local HELPER_TARBALL_URL="${ENSO_HELPER_URL:-$SITE/releases/enso-helper-latest-darwin.tar.gz}"
	local LATEST_URL="$SITE/api/latest"
	local EXTENSION_ID="${ENSO_EXTENSION_ID:-zen-chat@wicker.life}"
	local HOST_NAME="zen_chat"
	local MIN_NODE=18

	local APP_DIR="$HOME/Library/Application Support/Enso"
	local HELPER_DIR="$APP_DIR/helper"
	local MANIFEST_DIRS=(
		"$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
		"$HOME/Library/Application Support/zen/NativeMessagingHosts"
	)

	local bold="" dim="" red="" reset=""
	if [ -t 1 ]; then
		bold=$'\033[1m' dim=$'\033[2m' red=$'\033[31m' reset=$'\033[0m'
	fi
	step() { printf '\n%s==>%s %s\n' "$bold" "$reset" "$*"; }
	info() { printf '    %s\n' "$*"; }
	warn() { printf '    %s!%s %s\n' "$red" "$reset" "$*"; }
	die() {
		printf '\n%sError:%s %s\n' "$red" "$reset" "$*" >&2
		exit 1
	}

	printf '%sEnsō helper installer%s\n' "$bold" "$reset"

	# 1. macOS
	step "Checking your system"
	[ "$(uname -s)" = "Darwin" ] || die "Ensō currently runs on macOS only (Linux is planned)."
	info "macOS $(sw_vers -productVersion 2>/dev/null || echo '') on $(uname -m)"

	# 2. Node.js 18+
	step "Checking Node.js"
	# Prefer a real binary over a version-manager shim: Zen starts the helper
	# with a minimal environment, so run.sh must point at something that runs.
	local node_bin="" candidate
	local candidates=()
	if command -v volta >/dev/null 2>&1; then candidates+=("$(volta which node 2>/dev/null || true)"); fi
	candidates+=("$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node)
	for candidate in "${candidates[@]}"; do
		if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
			node_bin="$candidate"
			break
		fi
	done
	[ -n "$node_bin" ] || die "Node.js $MIN_NODE or newer is required. Install it from https://nodejs.org (or with 'brew install node'), then run this again."
	local node_version node_major
	node_version="$("$node_bin" --version 2>/dev/null | sed 's/^v//')"
	node_major="${node_version%%.*}"
	if ! [ "$node_major" -ge "$MIN_NODE" ] 2>/dev/null; then
		die "Node.js $MIN_NODE or newer is required; found $node_version at $node_bin."
	fi
	info "Node $node_version at $node_bin"

	# 3. Claude Code (needed for the subscription engine, optional with an API key)
	step "Checking Claude Code"
	if command -v claude >/dev/null 2>&1 && claude --version >/dev/null 2>&1; then
		info "$(claude --version 2>/dev/null | head -1) at $(command -v claude)"
		info "${dim}If you haven't signed in yet, run 'claude' once and follow the prompt.${reset}"
	else
		warn "Claude Code was not found. Ensō uses it to run on your Claude subscription."
		info "Install it: https://docs.anthropic.com/en/docs/claude-code/setup"
		info "Then sign in once by running: claude"
		info "Or use an Anthropic API key instead (see https://enso.wicker.life/docs/engines)."
	fi

	# 4. Download and verify
	step "Downloading the helper"
	local tmp
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/enso-install.XXXXXX")"
	# shellcheck disable=SC2064
	trap "rm -rf '$tmp'" EXIT
	info "From $HELPER_TARBALL_URL"
	curl -fsSL --retry 2 -o "$tmp/helper.tar.gz" "$HELPER_TARBALL_URL" || die "Download failed. Check your connection and try again."

	local expected_sha="" release_version=""
	if [ -z "${ENSO_HELPER_URL:-}" ]; then
		if curl -fsSL --retry 2 -o "$tmp/latest.json" "$LATEST_URL"; then
			expected_sha="$("$node_bin" -e 'const j=require(process.argv[1]);process.stdout.write(j.helper?.sha256??"")' "$tmp/latest.json" || true)"
			release_version="$("$node_bin" -e 'const j=require(process.argv[1]);process.stdout.write(j.helper?.version??"")' "$tmp/latest.json" || true)"
		fi
	fi
	local actual_sha
	actual_sha="$(shasum -a 256 "$tmp/helper.tar.gz" | awk '{print $1}')"
	if [ -n "$expected_sha" ]; then
		[ "$expected_sha" = "$actual_sha" ] || die "Checksum mismatch: expected $expected_sha, got $actual_sha. Nothing was installed."
		info "Version ${release_version:-unknown}, SHA-256 verified"
	elif [ "${ENSO_SKIP_CHECKSUM:-}" = "1" ] || [ -n "${ENSO_HELPER_URL:-}" ]; then
		warn "Checksum not verified (custom download)."
	else
		die "Could not fetch the expected checksum from $LATEST_URL. Nothing was installed."
	fi

	# 5. Unpack and install
	step "Installing into $HELPER_DIR"
	mkdir -p "$tmp/unpacked"
	tar -xzf "$tmp/helper.tar.gz" -C "$tmp/unpacked" || die "The download is not a valid archive."
	local src="$tmp/unpacked"
	[ -d "$src/helper" ] && src="$src/helper"
	[ -f "$src/host.mjs" ] || die "The archive does not contain the helper (host.mjs missing)."
	if [ -n "$release_version" ] && [ ! -f "$src/VERSION" ]; then
		printf '%s\n' "$release_version" >"$src/VERSION"
	fi

	mkdir -p "$APP_DIR"
	if [ -f "$HELPER_DIR/config.json" ]; then
		cp "$HELPER_DIR/config.json" "$src/config.json"
		info "Kept your existing config.json"
	fi
	rm -rf "$APP_DIR/helper.new" "$APP_DIR/helper.old"
	mv "$src" "$APP_DIR/helper.new"
	[ -d "$HELPER_DIR" ] && mv "$HELPER_DIR" "$APP_DIR/helper.old"
	mv "$APP_DIR/helper.new" "$HELPER_DIR"
	rm -rf "$APP_DIR/helper.old"

	cat >"$HELPER_DIR/run.sh" <<EOF
#!/bin/bash
# Started by Zen/Firefox through native messaging. Written by install.sh.
exec "$node_bin" "$HELPER_DIR/host.mjs"
EOF
	chmod +x "$HELPER_DIR/run.sh"
	info "Helper $(cat "$HELPER_DIR/VERSION" 2>/dev/null || echo '') installed; it runs with $node_bin"

	# 6. Register with Zen and Firefox
	step "Registering with Zen and Firefox"
	local manifest
	manifest="$("$node_bin" -e '
		const [name, path, id] = process.argv.slice(1);
		process.stdout.write(JSON.stringify({ name, description: "Ensō helper", path, type: "stdio", allowed_extensions: [id] }, null, 2) + "\n");
	' "$HOST_NAME" "$HELPER_DIR/run.sh" "$EXTENSION_ID")"
	local dir
	for dir in "${MANIFEST_DIRS[@]}"; do
		mkdir -p "$dir"
		printf '%s' "$manifest" >"$dir/$HOST_NAME.json"
		info "Wrote $dir/$HOST_NAME.json"
	done

	step "Done"
	info "Next: add the extension from $SITE/releases/enso-latest.xpi (open it in Zen),"
	info "then press Cmd+E. If Zen was open, quit it fully (Cmd+Q) and reopen it once."
	info "Docs: $SITE/docs"
}

main "$@"
