#!/usr/bin/env bash
# Ensō installer.
#
#   curl -fsSL https://enso.wicker.life/install.sh | bash
#
# macOS and Linux (x86_64 and arm64). Windows has its own installer:
#   irm https://enso.wicker.life/install.ps1 | iex
#
# Installs the local helper (the Node.js program Zen starts through native
# messaging) into the Ensō folder, registers it with Zen and Firefox, and writes
# the `enso` command (<folder>/bin/enso, linked as ~/.local/bin/enso). The folder:
#   macOS  ~/Library/Application Support/Enso   (log: ~/Library/Logs/Enso)
#   Linux  $XDG_DATA_HOME/enso, ~/.local/share/enso by default
#          (log: $XDG_STATE_HOME/enso, ~/.local/state/enso)
# When there is no Node.js 18+, it downloads Ensō's own copy of Node (checksums
# pinned below) into <folder>/runtime, so nothing has to be installed first. Everything
# else (Claude Code, letting your agents use Zen, T3 Code, GitHub) is set up
# afterwards with buttons in Ensō → Settings → Setup.
#
# Safe to run again: that is also how you update (Setup → Update helper runs it
# for you). Nothing is installed outside your home folder and nothing needs
# sudo. Your data and config.local.json in the Ensō folder are never touched.
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
	local LATEST_URL # set below, with ?platform= for this system
	local XPI_URL="$SITE/releases/enso-latest.xpi"
	local EXTENSION_ID="${ENSO_EXTENSION_ID:-enso@wicker.life}"
	local HOST_NAME="enso"
	local MIN_NODE=18
	# Ensō's own Node, used only when there is no Node 18+. SHA-256s from
	# https://nodejs.org/dist/v24.22.2/SHASUMS256.txt, whose signature was checked
	# against the Node.js release key 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.
	local NODE_VERSION="24.22.2"
	local NODE_SHA_DARWIN_ARM64="1f5ac075be50bed4780ea3be19a007fda95ea4d527d28d76d0b91de47d915115"
	local NODE_SHA_DARWIN_X64="6965578fd823e72c1b5387f5ab84cb25368f886e02eb8779e6f0fce6b91c27b7"
	local NODE_SHA_LINUX_ARM64="eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8"
	local NODE_SHA_LINUX_X64="48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75"

	# Folders per system (the helper computes the same ones: helper/lib/platform.mjs).
	local OS="" APP_DIR="" LOG_DIR="" LEGACY_DIR="" SYSTEM="this computer"
	local MANIFEST_DIRS=() PROFILE_GLOBS=()
	case "$(uname -s)" in
		Darwin)
			OS=darwin SYSTEM="this Mac"
			local SUPPORT="$HOME/Library/Application Support"
			APP_DIR="$SUPPORT/Enso"
			LOG_DIR="$HOME/Library/Logs/Enso"
			LEGACY_DIR="$SUPPORT/zen-chat"
			MANIFEST_DIRS=("$SUPPORT/Mozilla/NativeMessagingHosts" "$SUPPORT/zen/NativeMessagingHosts")
			PROFILE_GLOBS=("$SUPPORT/zen/Profiles" "$SUPPORT/Firefox/Profiles")
			;;
		Linux)
			OS=linux
			APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/enso"
			LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/enso"
			# Zen and Firefox read ~/.mozilla (zen-browser/desktop#10622); ~/.zen is for when Zen reads its own.
			MANIFEST_DIRS=("$HOME/.mozilla/native-messaging-hosts" "$HOME/.zen/native-messaging-hosts")
			PROFILE_GLOBS=("$HOME/.zen" "$HOME/.mozilla/firefox" "$HOME/.var/app/app.zen_browser.zen/.zen")
			;;
		*)
			OS=other
			;;
	esac
	local HELPER_DIR="$APP_DIR/helper"
	local RUNTIME_DIR="$APP_DIR/runtime"
	LATEST_URL="$SITE/api/latest?platform=$OS"

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

	# 1. The system: macOS or Linux (Windows: install.ps1)
	step "Checking your system"
	case "$OS" in
		darwin) info "macOS $(sw_vers -productVersion 2>/dev/null || echo '') on $(uname -m)" ;;
		linux) info "Linux ($( (. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-}") || true)) on $(uname -m)" ;;
		*)
			case "$(uname -s)" in
				MINGW* | MSYS* | CYGWIN*) die "This is Windows: run Ensō's Windows installer in PowerShell instead:
    irm $SITE/install.ps1 | iex" ;;
			esac
			die "Ensō's helper runs on macOS, Linux and Windows; $(uname -s) isn't supported.
    Requirements: $SITE/docs/install#requirements · Follow along: https://github.com/davidwickerhf/enso"
			;;
	esac
	sha256_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }

	local tmp
	tmp="$(mktemp -d "${TMPDIR:-/tmp}/enso-install.XXXXXX")"
	# shellcheck disable=SC2064
	trap "rm -rf '$tmp'" EXIT

	# 2. Node.js 18+: this computer's own, or Ensō's private copy.
	step "Checking Node.js"
	node_major_of() { "$1" --version 2>/dev/null | sed 's/^v//; s/\..*//'; }
	# Prefer a real binary over a version-manager shim: Zen starts the helper
	# with a minimal environment, so run.sh must point at something that runs.
	local node_bin="" node_source="" candidate major
	local candidates=()
	if [ "${ENSO_NODE:-}" != "private" ]; then
		if command -v volta >/dev/null 2>&1; then candidates+=("$(volta which node 2>/dev/null || true)"); fi
		candidates+=("$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node /home/linuxbrew/.linuxbrew/bin/node)
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
		case "$OS-$(uname -m)" in
			darwin-arm64) arch="arm64" node_sha="$NODE_SHA_DARWIN_ARM64" ;;
			darwin-x86_64) arch="x64" node_sha="$NODE_SHA_DARWIN_X64" ;;
			linux-aarch64 | linux-arm64) arch="arm64" node_sha="$NODE_SHA_LINUX_ARM64" ;;
			linux-x86_64) arch="x64" node_sha="$NODE_SHA_LINUX_X64" ;;
			*) die "No Node.js $MIN_NODE+ found, and Ensō has no Node of its own for $(uname -m). Install Node.js $MIN_NODE or newer (https://nodejs.org), then run this again." ;;
		esac
		command -v xz >/dev/null 2>&1 || [ "$OS" = darwin ] || die "No Node.js $MIN_NODE+ found, and unpacking Ensō's own copy needs xz. Install Node.js $MIN_NODE+ or xz (xz-utils), then run this again."
		local node_name="node-v$NODE_VERSION-$OS-$arch"
		local private_node="$RUNTIME_DIR/$node_name/bin/node"
		if [ -x "$private_node" ] && [ "$("$private_node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
			info "Ensō's own Node $NODE_VERSION is already here."
		else
			info "No Node.js $MIN_NODE+ on $SYSTEM: downloading Ensō's own copy (Node $NODE_VERSION, about 27 MB)."
			curl -fsSL --retry 2 -o "$tmp/node.tar.xz" "https://nodejs.org/dist/v$NODE_VERSION/$node_name.tar.xz" || die "Could not download Node.js. Check your connection and try again."
			local got_sha
			got_sha="$(sha256_of "$tmp/node.tar.xz")"
			[ "$got_sha" = "$node_sha" ] || die "Node.js checksum mismatch: expected $node_sha, got $got_sha. Nothing was installed."
			mkdir -p "$tmp/node" "$RUNTIME_DIR"
			tar -xJf "$tmp/node.tar.xz" -C "$tmp/node" "$node_name/bin/node" "$node_name/LICENSE" || die "The Node.js download is not a valid archive."
			rm -rf "${RUNTIME_DIR:?}/$node_name"
			mv "$tmp/node/$node_name" "$RUNTIME_DIR/$node_name"
			[ "$("$private_node" --version 2>/dev/null)" = "v$NODE_VERSION" ] || die "The downloaded Node.js doesn't run on $SYSTEM."
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
	for candidate in "$(command -v claude 2>/dev/null || true)" "$HOME/.local/bin/claude" "$HOME/.claude/local/claude" /opt/homebrew/bin/claude /usr/local/bin/claude /home/linuxbrew/.linuxbrew/bin/claude; do
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
	actual_sha="$(sha256_of "$tmp/helper.tar.gz")"
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
LOG="$LOG_DIR/helper.log"
mkdir -p "$LOG_DIR" 2>/dev/null
# Keep it near 1 MB × 2 (the helper rotates too, while it runs).
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" 2>/dev/null | tr -d ' ' || echo 0)" -gt 1000000 ]; then mv -f "$LOG" "$LOG.1" 2>/dev/null; fi
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
# The helper's stderr is appended to $LOG_DIR/helper.log, so a crash
# before the helper's own logging starts (Node missing, too old, a syntax error)
# is there too. "enso doctor" shows the end of it.
NODE="$node_bin"
HOST="$HELPER_DIR/host.mjs"
MIN_NODE=$MIN_NODE
LOG_DIR="$LOG_DIR"
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
	# (Linux: ~/.local/bin is on PATH in most desktop sessions, so it is created when missing.)
	[ "$OS" = linux ] && mkdir -p "$HOME/.local/bin"
	if [ -d "$HOME/.local/bin" ] && { [ ! -e "$HOME/.local/bin/enso" ] || [ "$(readlink "$HOME/.local/bin/enso" 2>/dev/null)" = "$ENSO_BIN" ]; }; then
		ln -sf "$ENSO_BIN" "$HOME/.local/bin/enso"
		info "Linked ~/.local/bin/enso"
	fi
	if [ -f "$APP_DIR/config.local.json" ]; then
		info "Your config.local.json is kept as it is."
	fi
	# Keep the MCP token of an install from before the rename.
	if [ -n "$LEGACY_DIR" ] && [ ! -f "$APP_DIR/mcp-token" ] && [ -f "$LEGACY_DIR/mcp-token" ]; then
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
		if [ "$OS" = darwin ]; then
			real_home="$(dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | sed 's/^NFSHomeDirectory: *//')"
		else
			real_home="$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)"
		fi
		[ -z "$real_home" ] || [ "$(cd "$HOME" 2>/dev/null && pwd -P)" = "$(cd "$real_home" 2>/dev/null && pwd -P)" ]
	}
	# Zen on Linux: on PATH, the zen-browser.app script's tarball, or /opt.
	zen_bin() {
		local c
		for c in "$(command -v zen 2>/dev/null || true)" "$(command -v zen-browser 2>/dev/null || true)" "$HOME/.tarball-installations/zen/zen" /opt/zen/zen /opt/zen-browser/zen; do
			[ -n "$c" ] && [ -x "$c" ] && { printf '%s' "$c"; return 0; }
		done
		return 1
	}
	local ext_state profiles_have_it=0 g
	for g in "${PROFILE_GLOBS[@]}"; do
		if grep -qs "\"$EXTENSION_ID\"" "$g"/*/extensions.json; then profiles_have_it=1; fi
	done
	if [ "$profiles_have_it" = 1 ]; then
		ext_state="installed"
	elif [ "${ENSO_NO_OPEN:-}" = "1" ] || ! home_is_real; then
		# ENSO_NO_OPEN=1, or a test run in a throwaway HOME: never pop "Add Ensō" in the real Zen.
		ext_state="skipped"
	elif [ "$OS" = darwin ] && open -Ra Zen >/dev/null 2>&1; then
		open -a Zen "$XPI_URL"
		ext_state="opened"
	elif [ "$OS" = linux ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && zen_bin >/dev/null; then
		(nohup "$(zen_bin)" "$XPI_URL" >/dev/null 2>&1 &)
		ext_state="opened"
	elif [ "$OS" = linux ] && [ -d "$HOME/.var/app/app.zen_browser.zen" ] && command -v flatpak >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
		(nohup flatpak run app.zen_browser.zen "$XPI_URL" >/dev/null 2>&1 &)
		ext_state="opened"
	else
		ext_state="no-zen"
	fi
	local OPEN_KEY="Ctrl+E"
	[ "$OS" = darwin ] && OPEN_KEY="Cmd+E"

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
		opened) info "Next     Zen is asking to add Ensō${xpi_version:+ $xpi_version}: click Add, then press $OPEN_KEY." ;;
		skipped) info "Next     Add the extension from $SITE if you haven't, then press $OPEN_KEY in Zen." ;;
		no-zen) warn "Zen was not found. Install it from https://zen-browser.app, then add Ensō from $SITE." ;;
	esac
	info "${dim}Then finish in Ensō → Settings → Setup. Docs: $SITE/docs/install${reset}"
}

main "$@"
