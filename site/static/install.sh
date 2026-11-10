#!/usr/bin/env bash
# Ensō installer.
#
#   curl -fsSL https://enso.wicker.life/install.sh | bash
#
# Installs the local helper (the Node.js program Zen starts through native
# messaging) into ~/Library/Application Support/Enso/helper, registers it with
# Zen and Firefox, and writes the `enso` command (Enso/bin/enso). When this Mac
# has no Node.js 18+, it downloads Ensō's own copy of Node (checksum pinned
# below) into Enso/runtime, so nothing has to be installed first. Everything
# else (Claude Code, letting your agents use Zen, T3 Code, GitHub) is set up
# afterwards with buttons in Ensō → Settings → Setup.
#
# Safe to run again: that is also how you update (Setup → Update helper runs it
# for you). Nothing is installed outside your home folder and nothing needs
# sudo. Your data and config.local.json in the Enso folder are never touched.
# It never asks questions, so `curl | bash` works in any terminal.
#
# At the end it writes Enso/install.json (versions and paths, no secrets),
# which the helper reports in Setup.
#
# Environment overrides (optional):
#   ENSO_SITE            site to download from (default https://enso.wicker.life)
#   ENSO_HELPER_URL      helper tarball to install instead of the latest release
#   ENSO_EXTENSION_ID    add-on id allowed to talk to the helper (default enso@wicker.life)
#   ENSO_SKIP_CHECKSUM   1 = don't require the SHA-256 from /api/latest (not recommended)
#   ENSO_REGISTER_MCP    1 = also register zen-browser with Claude Code (otherwise: Setup in Ensō)
#   ENSO_NO_OPEN         1 = don't open the extension in Zen at the end (also skipped when
#                        HOME isn't your home folder, e.g. a test run in a temporary HOME)
#   ENSO_NODE            private = always use Ensō's own Node; system = never download one

# Everything runs inside main(), so a download cut off halfway runs nothing.
main() {
	set -euo pipefail

	local SITE="${ENSO_SITE:-https://enso.wicker.life}"
	local LATEST_URL="$SITE/api/latest"
	local XPI_URL="$SITE/releases/enso-latest.xpi"
	local EXTENSION_ID="${ENSO_EXTENSION_ID:-enso@wicker.life}"
	local HOST_NAME="enso"
	local MIN_NODE=18
	# Ensō's own Node, used only when this Mac has no Node 18+. SHA-256 from
	# https://nodejs.org/dist/v24.22.2/SHASUMS256.txt, whose signature was checked
	# against the Node.js release key 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.
	local NODE_VERSION="24.22.2"
	local NODE_SHA_ARM64="1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115"
	local NODE_SHA_X64="6965578fd823e72c1b5387f5ab84cb25368f886e02eb8779e6f0fce6b91c27b7"

	local SUPPORT="$HOME/Library/Application Support"
	local APP_DIR="$SUPPORT/Enso"
	local HELPER_DIR="$APP_DIR/helper"
	local RUNTIME_DIR="$APP_DIR/runtime"
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

	printf '%sEnsō installer%s\n' "$bold" "$reset"

	# 1. macOS
	step "Checking your system"
	[ "$(uname -s)" = "Darwin" ] || die "Ensō's helper runs on macOS only for now. Windows and Linux support is planned.
    Requirements: $SITE/docs/install#requirements · Follow along: https://github.com/davidwickerhf/enso"
	info "macOS $(sw_vers -productVersion 2>/dev/null || echo '') on $(uname -m)"

	local tmp
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/enso-install.XXXXXX")"
	# shellcheck disable=SC2064
	trap "rm -rf '$tmp'" EXIT

	# 2. Node.js 18+: this Mac's own, or Ensō's private copy.
	step "Checking Node.js"
	node_major_of() { "$1" --version 2>/dev/null | sed 's/^v//; s/\..*//'; }
	# Prefer a real binary over a version-manager shim: Zen starts the helper
	# with a minimal environment, so run.sh must point at something that runs.
	local node_bin="" node_source="" candidate major
	local candidates=()
	if [ "${ENSO_NODE:-}" != "private" ]; then
		if command -v volta >/dev/null 2>&1; then candidates+=("$(volta which node 2>/dev/null || true)"); fi
		candidates+=("$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node)
	fi
	for candidate in ${candidates[@]+"${candidates[@]}"}; do
		[ -n "$candidate" ] && [ -x "$candidate" ] || continue
		major="$(node_major_of "$candidate")"
		if [ -n "$major" ] && [ "$major" -ge "$MIN_NODE" ] 2>/dev/null; then
			# A version manager's shim (asdf, nodenv, Volta's ~/.volta/bin/node) works in
			# this shell but not under Zen's minimal environment: use the binary it runs.
			local real
			real="$("$candidate" -p 'process.execPath' 2>/dev/null || true)"
			if [ -n "$real" ] && [ -x "$real" ] && [ "$(node_major_of "$real")" = "$major" ]; then candidate="$real"; fi
			node_bin="$candidate" node_source="system"
			break
		fi
	done
	if [ -z "$node_bin" ]; then
		[ "${ENSO_NODE:-}" = "system" ] && die "Node.js $MIN_NODE or newer is required (ENSO_NODE=system). Install it from https://nodejs.org, or run this again without ENSO_NODE."
		local arch node_sha
		case "$(uname -m)" in
			arm64) arch="arm64" node_sha="$NODE_SHA_ARM64" ;;
			x86_64) arch="x64" node_sha="$NODE_SHA_X64" ;;
			*) die "Unsupported processor: $(uname -m)." ;;
		esac
		local node_name="node-v$NODE_VERSION-darwin-$arch"
		local private_node="$RUNTIME_DIR/$node_name/bin/node"
		if [ -x "$private_node" ] && [ "$("$private_node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
			info "Ensō's own Node $NODE_VERSION is already here."
		else
			info "No Node.js $MIN_NODE+ on this Mac: downloading Ensō's own copy (Node $NODE_VERSION, about 27 MB)."
			curl -fsSL --retry 2 -o "$tmp/node.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/$node_name.tar.xz" || die "Could not download Node.js. Check your connection and try again."
			local got_sha
			got_sha="$(shasum -a 256 "$tmp/node.tar.xz" | awk '{print $1}')"
			[ "$got_sha" = "$node_sha" ] || die "Node.js checksum mismatch: expected $node_sha, got $got_sha. Nothing was installed."
			mkdir -p "$tmp/node" "$RUNTIME_DIR"
			tar -xJf "$tmp/node.tar.xz" -C "$tmp/node" "$node_name/bin/node" "$node_name/LICENSE" || die "The Node.js download is not a valid archive."
			rm -rf "${RUNTIME_DIR:?}/$node_name"
			mv "$tmp/node/$node_name" "$RUNTIME_DIR/$node_name"
			[ "$("$private_node" --version 2>/dev/null)" = "v$NODE_VERSION" ] || die "The downloaded Node.js doesn't run on this Mac."
			info "Node $NODE_VERSION verified (SHA-256) and put in $RUNTIME_DIR"
		fi
		# A stable path for run.sh; older private versions are removed.
		ln -sfn "$node_name" "$RUNTIME_DIR/node"
		find "$RUNTIME_DIR" -maxdepth 1 -name 'node-v*' ! -name "$node_name" -exec rm -rf {} + 2>/dev/null || true
		node_bin="$RUNTIME_DIR/node/bin/node" node_source="private"
	fi
	local node_version
	node_version="$("$node_bin" --version 2>/dev/null | sed 's/^v//')"
	info "Node $node_version at $node_bin"

	# 3. Claude Code (the subscription engine runs on it; optional, set up later in Ensō)
	step "Checking Claude Code"
	local claude_bin="" claude_version=""
	for candidate in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude; do
		if [ -n "$candidate" ] && [ -x "$candidate" ] && "$candidate" --version >/dev/null 2>&1; then
			claude_bin="$candidate"
			break
		fi
	done
	if [ -n "$claude_bin" ]; then
		claude_version="$("$claude_bin" --version 2>/dev/null | head -1)"
		info "$claude_version at $claude_bin"
	else
		info "Not found. That's fine: Ensō → Settings → Setup installs it with one click,"
		info "or you can use an Anthropic API key instead."
	fi

	# 4. Download and verify
	step "Downloading the helper"
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

	# The part of run.sh after its variables (dev.sh writes the same; keep them in sync).
	run_sh_body() {
		cat <<'RUNSH'
LOG_DIR="$HOME/Library/Logs/Enso"
LOG="$LOG_DIR/helper.log"
mkdir -p "$LOG_DIR" 2>/dev/null
# Keep it near 1 MB × 2 (the helper rotates too, while it runs).
if [ -f "$LOG" ] && [ "$(stat -f %z "$LOG" 2>/dev/null || echo 0)" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
note() {
	printf '%s run.sh: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG" 2>/dev/null
	printf 'Ensō helper: %s\n' "$*" >&2
}
if [ ! -x "$NODE" ]; then
	note "Node.js is not at $NODE any more. Run the installer again: curl -fsSL https://enso.wicker.life/install.sh | bash"
	exit 127
fi
major="$("$NODE" -p 'process.versions.node.split(".")[0]' 2>/dev/null)"
if ! [ "${major:-0}" -ge "$MIN_NODE" ] 2>/dev/null; then
	note "$NODE is Node ${major:-?}, too old or not working (Ensō needs $MIN_NODE+). Run the installer again: curl -fsSL https://enso.wicker.life/install.sh | bash"
	exit 1
fi
if { : >>"$LOG"; } 2>/dev/null; then
	export ENSO_STDERR_LOG="$LOG"
	exec "$NODE" "$HOST" "$@" 2>>"$LOG"
fi
exec "$NODE" "$HOST" "$@"
RUNSH
	}

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
# The helper's stderr is appended to ~/Library/Logs/Enso/helper.log, so a crash
# before the helper's own logging starts (Node missing, too old, a syntax error)
# is there too. "enso doctor" shows the end of it.
NODE="$node_bin"
HOST="$HELPER_DIR/host.mjs"
MIN_NODE=$MIN_NODE
$(run_sh_body)
EOF
	chmod +x "$HELPER_DIR/run.sh"
	info "Helper $(cat "$HELPER_DIR/VERSION" 2>/dev/null || echo '') installed; it runs with $node_bin"

	# The `enso` command (enso mcp: the stdio launcher MCP clients start; see docs/PROTOCOL.md).
	local ENSO_BIN="$APP_DIR/bin/enso"
	mkdir -p "$APP_DIR/bin"
	cat >"$ENSO_BIN" <<EOF
#!/bin/bash
# The enso command (enso mcp, enso setup, enso update…). Written by install.sh.
exec "$node_bin" "$HELPER_DIR/bin/enso.mjs" "\$@"
EOF
	chmod +x "$ENSO_BIN"
	info "Command: $ENSO_BIN"
	# Also on PATH as ~/.local/bin/enso, unless something else already has that name.
	if [ -d "$HOME/.local/bin" ] && { [ ! -e "$HOME/.local/bin/enso" ] || [ "$(readlink "$HOME/.local/bin/enso" 2>/dev/null)" = "$ENSO_BIN" ]; }; then
		ln -sf "$ENSO_BIN" "$HOME/.local/bin/enso"
		info "Linked ~/.local/bin/enso"
	fi
	if [ -f "$APP_DIR/config.local.json" ]; then
		info "Your config.local.json is kept as it is."
	fi
	# Keep the MCP token of an install from before the rename.
	if [ ! -f "$APP_DIR/mcp-token" ] && [ -f "$LEGACY_DIR/mcp-token" ]; then
		cp -p "$LEGACY_DIR/mcp-token" "$APP_DIR/mcp-token"
	fi

	# 6. Register with Zen and Firefox. The browser reads this file each time the
	#    extension connects, so an open Zen picks the helper up without a restart.
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

	# 7. Letting Claude Code, Codex, Cursor or OpenCode use Zen is a switch per
	#    client in Ensō → Settings → Setup (or `enso mcp install`).
	#    ENSO_REGISTER_MCP=1 registers Claude Code here, for scripted installs.
	if [ "${ENSO_REGISTER_MCP:-}" = "1" ] && [ -n "$claude_bin" ]; then
		step "Claude Code and Zen"
		if "$ENSO_BIN" mcp install --client claude >/dev/null 2>&1; then
			info "Added zen-browser to Claude Code."
		else
			warn "Claude Code did not accept the server; turn it on later in Ensō → Settings → Setup."
		fi
	fi

	# Versions and paths for Setup (no secrets).
	"$node_bin" -e '
		const [file, version, nodePath, nodeVersion, nodeSource, claudePath, claudeVersion, site] = process.argv.slice(1);
		const out = { version: version || null, installedAt: new Date().toISOString(), site,
			node: { path: nodePath, version: nodeVersion, source: nodeSource },
			claude: claudePath ? { path: claudePath, version: claudeVersion || null } : null };
		require("fs").writeFileSync(file, JSON.stringify(out, null, 2) + "\n", { mode: 0o644 });
	' "$APP_DIR/install.json" "$(cat "$HELPER_DIR/VERSION" 2>/dev/null || true)" "$node_bin" "$node_version" "$node_source" "$claude_bin" "$claude_version" "$SITE"

	# 8. The extension: open it in Zen, unless a Zen profile already has it.
	home_is_real() {
		local real_home
		real_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: *//')"
		[ -z "$real_home" ] || [ "$(cd "$HOME" 2>/dev/null && pwd -P)" = "$(cd "$real_home" 2>/dev/null && pwd -P)" ]
	}
	local ext_state
	if grep -qs "\"$EXTENSION_ID\"" "$SUPPORT"/zen/Profiles/*/extensions.json; then
		ext_state="installed"
	elif [ "${ENSO_NO_OPEN:-}" = "1" ] || ! home_is_real; then
		# ENSO_NO_OPEN=1, or a test run in a throwaway HOME: never pop "Add Ensō" in the real Zen.
		ext_state="skipped"
	elif open -Ra Zen >/dev/null 2>&1; then
		open -a Zen "$XPI_URL"
		ext_state="opened"
	else
		ext_state="no-zen"
	fi

	local version_now private_note=""
	version_now="$(cat "$HELPER_DIR/VERSION" 2>/dev/null || true)"
	[ "$node_source" = "private" ] && private_note=" (Ensō's own copy)"
	printf '\n%sDone. Ensō%s is installed.%s\n' "$bold" "${version_now:+ $version_now}" "$reset"
	info "Helper   $HELPER_DIR"
	info "Node     $node_version$private_note"
	if [ -n "$claude_bin" ]; then
		info "Claude   ${claude_version:-found}"
	else
		info "Claude   not installed yet (optional: Settings → Setup in Ensō)"
	fi
	case "$ext_state" in
		installed) info "Next     Go back to Zen: Ensō connects by itself within a few seconds." ;;
		opened) info "Next     Zen is asking to add Ensō${xpi_version:+ $xpi_version}: click Add, then press Cmd+E." ;;
		skipped) info "Next     Add the extension from $SITE if you haven't, then press Cmd+E in Zen." ;;
		no-zen) warn "Zen was not found. Install it from https://zen-browser.app, then add Ensō from $SITE." ;;
	esac
	info "${dim}Then finish in Ensō → Settings → Setup. Docs: $SITE/docs/install${reset}"
}

main "$@"
