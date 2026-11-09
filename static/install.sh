#!/usr/bin/env bash
# Ensō installer.
#
#   curl -fsSL https://enso.wicker.life/install.sh | bash
#
# Installs the local helper (the Node.js program Zen starts through native
# messaging) into ~/Library/Application Support/Enso/helper, registers it with
# Zen and Firefox, optionally lets Claude Code use Zen (the zen-browser MCP
# server), then opens the signed extension in Zen. Safe to run again: that is
# also how you update. Nothing is installed outside your home folder and
# nothing needs sudo. Your data and config.local.json in the Enso folder are
# never touched.
#
# Environment overrides (optional):
#   ENSO_SITE            site to download from (default https://enso.wicker.life)
#   ENSO_HELPER_URL      helper tarball to install instead of the latest release
#   ENSO_EXTENSION_ID    add-on id allowed to talk to the helper (default enso@wicker.life)
#   ENSO_SKIP_CHECKSUM   1 = don't require the SHA-256 from /api/latest (not recommended)
#   ENSO_REGISTER_MCP    1 = register zen-browser with Claude Code without asking, 0 = never
#   ENSO_NO_OPEN         1 = don't open the extension in Zen at the end

# Everything runs inside main(), so a download cut off halfway runs nothing.
main() {
	set -euo pipefail

	local SITE="${ENSO_SITE:-https://enso.wicker.life}"
	local LATEST_URL="$SITE/api/latest"
	local XPI_URL="$SITE/releases/enso-latest.xpi"
	local EXTENSION_ID="${ENSO_EXTENSION_ID:-enso@wicker.life}"
	local HOST_NAME="enso"
	local MCP_NAME="zen-browser"
	local MCP_PORT=47823
	local MIN_NODE=18

	local SUPPORT="$HOME/Library/Application Support"
	local APP_DIR="$SUPPORT/Enso"
	local HELPER_DIR="$APP_DIR/helper"
	local LEGACY_DIR="$SUPPORT/zen-chat"
	local MANIFEST_DIRS=(
		"$SUPPORT/Mozilla/NativeMessagingHosts"
		"$SUPPORT/zen/NativeMessagingHosts"
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
	# Interactive when a terminal is attached (also under `curl | bash`, through /dev/tty).
	interactive() { [ -t 1 ] && { : </dev/tty; } 2>/dev/null; }
	ask() { # ask "Question?" → 0 for yes
		local answer=""
		printf '    %s [y/N] ' "$1"
		read -r answer </dev/tty || answer=""
		[[ "$answer" =~ ^[Yy] ]]
	}

	printf '%sEnsō installer%s\n' "$bold" "$reset"

	# 1. macOS
	step "Checking your system"
	[ "$(uname -s)" = "Darwin" ] || die "Ensō currently runs on macOS only."
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

	# 3. Claude Code (the subscription engine runs on it; optional with an API key)
	step "Checking Claude Code"
	local claude_bin=""
	for candidate in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
		if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
			claude_bin="$candidate"
			break
		fi
	done
	if [ -n "$claude_bin" ]; then
		info "$("$claude_bin" --version 2>/dev/null | head -1) at $claude_bin"
		info "${dim}If you haven't signed in yet, run 'claude' once and follow the prompt.${reset}"
	else
		warn "Claude Code was not found. Ensō uses it to run on your Claude subscription."
		info "Install it:  curl -fsSL https://claude.ai/install.sh | bash"
		info "Then sign in once by running: claude"
		info "Or use an Anthropic API key instead (see $SITE/docs/engines)."
	fi

	# 4. Download and verify
	step "Downloading the helper"
	local tmp
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/enso-install.XXXXXX")"
	# shellcheck disable=SC2064
	trap "rm -rf '$tmp'" EXIT

	local helper_url="${ENSO_HELPER_URL:-}" expected_sha="" release_version="" xpi_version=""
	if [ -z "$helper_url" ]; then
		curl -fsSL --retry 2 -o "$tmp/latest.json" "$LATEST_URL" || die "Could not reach $LATEST_URL. Check your connection and try again."
		read_latest() { "$node_bin" -e 'const j=require(process.argv[1]);const v=process.argv[2].split(".").reduce((o,k)=>o?.[k],j);process.stdout.write(v==null?"":String(v))' "$tmp/latest.json" "$1"; }
		helper_url="$(read_latest helper.url)"
		expected_sha="$(read_latest helper.sha256)"
		release_version="$(read_latest helper.version)"
		xpi_version="$(read_latest extension.version)"
		[ -n "$helper_url" ] || die "No helper release is published yet at $SITE."
	fi
	info "From $helper_url"
	curl -fsSL --retry 2 -o "$tmp/helper.tar.gz" "$helper_url" || die "Download failed. Check your connection and try again."

	local actual_sha
	actual_sha="$(shasum -a 256 "$tmp/helper.tar.gz" | awk '{print $1}')"
	if [ -n "$expected_sha" ]; then
		[ "$expected_sha" = "$actual_sha" ] || die "Checksum mismatch: expected $expected_sha, got $actual_sha. Nothing was installed."
		info "Version ${release_version:-unknown}, SHA-256 verified"
	elif [ "${ENSO_SKIP_CHECKSUM:-}" = "1" ] || [ -n "${ENSO_HELPER_URL:-}" ]; then
		warn "Checksum not verified (custom download)."
	else
		die "$LATEST_URL did not list a checksum. Nothing was installed."
	fi

	# 5. Unpack and install (replace the helper folder in one move)
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
	if [ -f "$APP_DIR/config.local.json" ]; then
		info "Your config.local.json is kept as it is."
	fi

	# 6. Register with Zen and Firefox
	step "Registering with Zen and Firefox"
	local manifest dir
	manifest="$("$node_bin" -e '
		const [name, path, id] = process.argv.slice(1);
		process.stdout.write(JSON.stringify({ name, description: "Ensō helper", path, type: "stdio", allowed_extensions: [id] }, null, 2) + "\n");
	' "$HOST_NAME" "$HELPER_DIR/run.sh" "$EXTENSION_ID")"
	for dir in "${MANIFEST_DIRS[@]}"; do
		mkdir -p "$dir"
		printf '%s' "$manifest" >"$dir/$HOST_NAME.json"
		info "Wrote $dir/$HOST_NAME.json"
	done

	# 7. Let Claude Code use Zen (optional)
	if [ -n "$claude_bin" ]; then
		step "Claude Code and Zen"
		if "$claude_bin" mcp get "$MCP_NAME" >/dev/null 2>&1; then
			info "Claude Code already has the $MCP_NAME server."
		else
			local register="${ENSO_REGISTER_MCP:-}"
			if [ -z "$register" ]; then
				if interactive; then
					info "Ensō can let Claude Code (in a terminal or editor) read and use your Zen tabs,"
					info "through a local MCP server on 127.0.0.1:$MCP_PORT. Change or turn it off any time in Ensō's settings."
					if ask "Register it with Claude Code as \"$MCP_NAME\"?"; then register=1; else register=0; fi
				else
					register=0
					info "Skipped (not interactive). Run again in a terminal, or with ENSO_REGISTER_MCP=1, to add it."
				fi
			fi
			if [ "$register" = "1" ]; then
				local token_file="$APP_DIR/mcp-token"
				if [ ! -f "$token_file" ] && [ -f "$LEGACY_DIR/mcp-token" ]; then
					cp -p "$LEGACY_DIR/mcp-token" "$token_file" # keep the token of an install from before the rename
				fi
				if [ ! -f "$token_file" ]; then
					(umask 077 && openssl rand -hex 32 >"$token_file")
				fi
				chmod 600 "$token_file"
				local config_json
				config_json="$("$node_bin" -e '
					const fs = require("fs");
					const [file, port] = process.argv.slice(1);
					const token = fs.readFileSync(file, "utf8").trim();
					process.stdout.write(JSON.stringify({ type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } }));
				' "$token_file" "$MCP_PORT")"
				if "$claude_bin" mcp add-json --scope user "$MCP_NAME" "$config_json" >/dev/null 2>&1; then
					info "Added. Claude Code can use Zen while Zen is open."
				else
					warn "Claude Code did not accept the server; you can add it later from Ensō's docs."
				fi
			fi
		fi
	fi

	# 8. The extension
	step "Adding the extension to Zen"
	if [ "${ENSO_NO_OPEN:-}" = "1" ]; then
		info "Open $XPI_URL in Zen to add the extension."
	elif open -Ra Zen >/dev/null 2>&1; then
		open -a Zen "$XPI_URL"
		info "Zen is asking to add Ensō${xpi_version:+ $xpi_version}: click Add."
	else
		warn "Zen was not found. Install it from https://zen-browser.app, then open $XPI_URL in it."
	fi

	step "Done"
	info "Press Cmd+E in Zen to open Ensō. If Zen was already open and Ensō says its helper"
	info "isn't running, quit Zen fully (Cmd+Q) and reopen it once."
	info "Docs: $SITE/docs"
}

main "$@"
