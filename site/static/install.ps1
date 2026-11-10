# Enso installer for Windows (Windows 10 and 11, x64 and arm64).
#
#   irm https://enso.wicker.life/install.ps1 | iex
#
# Installs the local helper (the Node.js program Zen starts through native
# messaging) into %APPDATA%\Enso\helper, registers it with Zen and Firefox
# (HKCU\Software\Mozilla\NativeMessagingHosts\enso, which Zen reads too), and
# writes the `enso` command (%APPDATA%\Enso\bin\enso.cmd, added to your user
# PATH). When there is no Node.js 18+, it downloads Enso's own copy of Node
# (checksums pinned below) into %APPDATA%\Enso\runtime, so nothing has to be
# installed first. Everything else (Claude Code, letting your agents use Zen,
# GitHub) is set up afterwards with buttons in Enso > Settings > Setup.
#
# Safe to run again: that is also how you update (Setup > Update helper runs it
# for you). Nothing is installed outside your user profile and nothing needs
# administrator rights. Your data and config.local.json are never touched. It
# never asks questions.
#
# At the end it writes %APPDATA%\Enso\install.json (versions and paths, no
# secrets), which the helper reports in Setup. The log is in
# %LOCALAPPDATA%\Enso\Logs.
#
# This file is ASCII on purpose: `irm | iex` and Windows PowerShell 5.1 read it
# correctly whatever the code page.
#
# Environment overrides (optional):
#   ENSO_SITE            site to download from (default https://enso.wicker.life)
#   ENSO_HELPER_URL      helper tarball to install instead of the latest release (https:// or file://)
#   ENSO_EXTENSION_ID    add-on id allowed to talk to the helper (default enso@wicker.life)
#   ENSO_SKIP_CHECKSUM   1 = don't require the SHA-256 from /api/latest (not recommended)
#   ENSO_REGISTER_MCP    1 = also register zen-browser with Claude Code (otherwise: Setup in Enso)
#   ENSO_NO_OPEN         1 = don't open the extension in Zen at the end (also skipped when
#                        USERPROFILE isn't your real profile, e.g. a test run)
#   ENSO_NO_PATH         1 = don't add the enso command to your user PATH
#   ENSO_NODE            private = always use Enso's own Node; system = never download one

& {
	$ErrorActionPreference = 'Stop'
	$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is much faster without the progress bar
	try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

	$Enso = "Ens$([char]0x14D)"
	function Step($text) { Write-Host ""; Write-Host "==> $text" }
	function Info($text) { Write-Host "    $text" }
	function Warn($text) { Write-Host "    ! $text" -ForegroundColor Yellow }
	# throw, not exit: under `irm | iex` exit would close the user's PowerShell window.
	function Fail($text) { Write-Host ""; Write-Host "Error: $text" -ForegroundColor Red; throw "Enso installer: $text" }
	function EnvOr($name, $default) { $v = [Environment]::GetEnvironmentVariable($name); if ($v) { $v } else { $default } }

	$Site = EnvOr 'ENSO_SITE' 'https://enso.wicker.life'
	$LatestUrl = "$Site/api/latest?platform=win32"
	$XpiUrl = "$Site/releases/enso-latest.xpi"
	$ExtensionId = EnvOr 'ENSO_EXTENSION_ID' 'enso@wicker.life'
	$HostName = 'enso'
	$MinNode = 18
	# Enso's own Node, used only when there is no Node 18+. SHA-256s from
	# https://nodejs.org/dist/v24.22.2/SHASUMS256.txt, whose signature was checked
	# against the Node.js release key 5BE8A3F6C8A5C01D106C0AD820B1A390B168D356.
	$NodeVersion = '24.22.2'
	$NodeSha = @{
		'x64'   = 'ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2'
		'arm64' = 'f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468'
	}

	Write-Host "$Enso installer for Windows"

	# 1. The system
	Step 'Checking your system'
	if ($env:OS -ne 'Windows_NT') { Fail "This is the Windows installer. On macOS and Linux run: curl -fsSL $Site/install.sh | bash" }
	$cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
	$arch = switch ($cpu) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { $null } }
	$winVer = [Environment]::OSVersion.Version
	Info "Windows $($winVer.Major).$($winVer.Minor) build $($winVer.Build) on $cpu"
	if (-not $env:APPDATA -or -not $env:LOCALAPPDATA) { Fail 'APPDATA / LOCALAPPDATA are not set; run this in a normal PowerShell window.' }
	$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
	if (-not (Test-Path $tarExe)) { $tarExe = 'tar.exe' }

	$AppDir = Join-Path $env:APPDATA 'Enso'
	$HelperDir = Join-Path $AppDir 'helper'
	$RuntimeDir = Join-Path $AppDir 'runtime'
	$BinDir = Join-Path $AppDir 'bin'
	$LogDir = Join-Path $env:LOCALAPPDATA 'Enso\Logs'
	$tmp = Join-Path ([IO.Path]::GetTempPath()) ("enso-install-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
	New-Item -ItemType Directory -Force -Path $tmp | Out-Null

	try {
		# 2. Node.js 18+: this computer's own, or Enso's private copy.
		Step 'Checking Node.js'
		function NodeMajor($exe) {
			try { $v = & $exe -p 'process.versions.node' 2>$null; if ($LASTEXITCODE -eq 0 -and $v) { return [int]($v.ToString().Split('.')[0]) } } catch {}
			return 0
		}
		$nodeBin = $null; $nodeSource = $null
		if ($env:ENSO_NODE -ne 'private') {
			$candidates = @()
			$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
			if ($cmd) { $candidates += $cmd.Source }
			$candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
			if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
			foreach ($c in $candidates) {
				if (-not $c -or -not (Test-Path $c)) { continue }
				$major = NodeMajor $c
				if ($major -ge $MinNode) {
					# A version manager's shim (nvm-windows, Volta) works here but maybe not when
					# Zen starts the helper: use the binary it runs.
					$real = $null
					try { $real = (& $c -p 'process.execPath' 2>$null) } catch {}
					if ($real -and (Test-Path $real) -and ((NodeMajor $real) -eq $major)) { $c = $real }
					$nodeBin = $c; $nodeSource = 'system'
					break
				}
			}
		}
		if (-not $nodeBin) {
			if ($env:ENSO_NODE -eq 'system') { Fail "Node.js $MinNode or newer is required (ENSO_NODE=system). Install it from https://nodejs.org, or run this again without ENSO_NODE." }
			if (-not $arch) { Fail "No Node.js $MinNode+ found, and $Enso has no Node of its own for $cpu. Install Node.js $MinNode or newer from https://nodejs.org, then run this again." }
			$nodeName = "node-v$NodeVersion-win-$arch"
			$privateDir = Join-Path $RuntimeDir $nodeName
			$privateNode = Join-Path $privateDir 'node.exe'
			$have = $false
			if (Test-Path $privateNode) { try { $have = ((& $privateNode --version 2>$null) -eq "v$NodeVersion") } catch {} }
			if ($have) {
				Info "$Enso's own Node $NodeVersion is already here."
			} else {
				Info "No Node.js $MinNode+ on this computer: downloading $Enso's own copy (Node $NodeVersion, about 30 MB)."
				$zip = Join-Path $tmp 'node.zip'
				try { Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$NodeVersion/$nodeName.zip" -OutFile $zip } catch { Fail 'Could not download Node.js. Check your connection and try again.' }
				$got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
				if ($got -ne $NodeSha[$arch]) { Fail "Node.js checksum mismatch: expected $($NodeSha[$arch]), got $got. Nothing was installed." }
				$unz = Join-Path $tmp 'node'
				& $tarExe -xf $zip -C $tmp "$nodeName/node.exe" "$nodeName/LICENSE" 2>$null
				if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $tmp "$nodeName\node.exe"))) {
					Expand-Archive -Path $zip -DestinationPath $unz -Force
					Move-Item (Join-Path $unz $nodeName) (Join-Path $tmp $nodeName)
				}
				New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
				if (Test-Path $privateDir) { Remove-Item -Recurse -Force $privateDir }
				New-Item -ItemType Directory -Force -Path $privateDir | Out-Null
				Copy-Item (Join-Path $tmp "$nodeName\node.exe") $privateNode
				if (Test-Path (Join-Path $tmp "$nodeName\LICENSE")) { Copy-Item (Join-Path $tmp "$nodeName\LICENSE") $privateDir }
				if ((& $privateNode --version 2>$null) -ne "v$NodeVersion") { Fail "The downloaded Node.js doesn't run on this computer." }
				Info "Node $NodeVersion verified (SHA-256) and put in $RuntimeDir"
			}
			# Older private versions are removed (one in use by a running helper stays until next time).
			Get-ChildItem -Path $RuntimeDir -Directory -Filter 'node-v*' -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne $nodeName } | ForEach-Object { Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue }
			$nodeBin = $privateNode; $nodeSource = 'private'
		}
		$nodeVersionNow = (& $nodeBin -p 'process.versions.node').ToString().Trim()
		Info "Node $nodeVersionNow at $nodeBin"

		# 3. Claude Code (optional, set up later in Enso)
		Step 'Checking Claude Code'
		$claudeBin = $null; $claudeVersion = $null
		$claudeCandidates = @()
		$cc = Get-Command claude.exe -ErrorAction SilentlyContinue
		if ($cc) { $claudeCandidates += $cc.Source }
		$claudeCandidates += (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
		$npmShim = Join-Path $env:APPDATA 'npm\claude.cmd'
		foreach ($c in $claudeCandidates) {
			if ($c -and (Test-Path $c)) { try { $v = & $c --version 2>$null; if ($LASTEXITCODE -eq 0) { $claudeBin = $c; $claudeVersion = ($v | Select-Object -First 1); break } } catch {} }
		}
		if (-not $claudeBin -and (Test-Path $npmShim)) {
			$cli = Join-Path $env:APPDATA 'npm\node_modules\@anthropic-ai\claude-code\cli.js'
			if (Test-Path $cli) { try { $claudeVersion = (& $nodeBin $cli --version 2>$null | Select-Object -First 1); $claudeBin = $npmShim } catch {} }
		}
		if ($claudeBin) { Info "$claudeVersion at $claudeBin" }
		else {
			Info "Not found. That's fine: $Enso > Settings > Setup installs it with one click,"
			Info 'or you can use an Anthropic API key instead.'
		}

		# 4. Download and verify
		Step 'Downloading the helper'
		$helperUrl = $env:ENSO_HELPER_URL; $expectedSha = $null; $releaseVersion = $null; $xpiVersion = $null
		if (-not $helperUrl) {
			try { $latest = Invoke-RestMethod -UseBasicParsing -Uri $LatestUrl } catch { Fail "Could not reach $LatestUrl. Check your connection and try again." }
			if (-not $latest.helper -or -not $latest.helper.url) { Fail "No helper release is published yet at $Site." }
			$helperUrl = $latest.helper.url; $expectedSha = $latest.helper.sha256; $releaseVersion = $latest.helper.version
			if ($latest.extension) { $xpiVersion = $latest.extension.version }
		}
		Info "From $helperUrl"
		$tarball = Join-Path $tmp 'helper.tar.gz'
		try {
			if ($helperUrl -like 'file://*') { Copy-Item -LiteralPath ([Uri]$helperUrl).LocalPath -Destination $tarball }
			else { Invoke-WebRequest -UseBasicParsing -Uri $helperUrl -OutFile $tarball }
		} catch { Fail 'Download failed. Check your connection and try again.' }
		$actualSha = (Get-FileHash -Algorithm SHA256 -Path $tarball).Hash.ToLower()
		if ($expectedSha) {
			if ($expectedSha.ToLower() -ne $actualSha) { Fail "Checksum mismatch: expected $expectedSha, got $actualSha. Nothing was installed." }
			Info "Version $releaseVersion, SHA-256 verified"
		} elseif ($env:ENSO_SKIP_CHECKSUM -eq '1' -or $env:ENSO_HELPER_URL) {
			Warn 'Checksum not verified (custom download).'
		} else {
			Fail "$LatestUrl did not list a checksum. Nothing was installed."
		}

		# 5. Unpack and install (replace the helper folder in one move)
		Step "Installing into $HelperDir"
		$unpacked = Join-Path $tmp 'unpacked'
		New-Item -ItemType Directory -Force -Path $unpacked | Out-Null
		& $tarExe -xzf $tarball -C $unpacked 2>$null
		if ($LASTEXITCODE -ne 0) { Fail 'The download is not a valid archive.' }
		$src = $unpacked
		if (Test-Path (Join-Path $src 'helper')) { $src = Join-Path $src 'helper' }
		if (-not (Test-Path (Join-Path $src 'host.mjs'))) { Fail 'The archive does not contain the helper (host.mjs missing).' }
		if ($releaseVersion -and -not (Test-Path (Join-Path $src 'VERSION'))) { Set-Content -Path (Join-Path $src 'VERSION') -Value $releaseVersion -Encoding Ascii }

		New-Item -ItemType Directory -Force -Path $AppDir, $BinDir, $LogDir | Out-Null
		$newDir = Join-Path $AppDir 'helper.new'; $oldDir = Join-Path $AppDir 'helper.old'
		foreach ($d in @($newDir, $oldDir)) { if (Test-Path $d) { Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue } }
		Move-Item -LiteralPath $src -Destination $newDir
		$moved = $false
		try {
			if (Test-Path $HelperDir) { Move-Item -LiteralPath $HelperDir -Destination $oldDir }
			Move-Item -LiteralPath $newDir -Destination $HelperDir
			$moved = $true
		} catch {
			# A running helper can hold the folder: copy over it instead (robocopy /MIR also removes stale files).
			if ((Test-Path $oldDir) -and -not (Test-Path $HelperDir)) { Move-Item -LiteralPath $oldDir -Destination $HelperDir }
			& robocopy.exe $newDir $HelperDir /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
			if ($LASTEXITCODE -ge 8) { Fail "Could not replace $HelperDir (robocopy exit $LASTEXITCODE). Quit Zen and run this again." }
			Remove-Item -Recurse -Force $newDir -ErrorAction SilentlyContinue
		}
		if (Test-Path $oldDir) { Remove-Item -Recurse -Force $oldDir -ErrorAction SilentlyContinue }

		# The launcher Zen starts. It lives in bin\, not in helper\, so a running
		# helper's working folder never blocks the next update. stderr goes to
		# helper-stderr.log (a crash before the helper's own log starts); the
		# helper writes helper.log itself (ENSO_LOG_NO_ECHO: not twice).
		$hostMjs = Join-Path $HelperDir 'host.mjs'
		$runCmd = Join-Path $BinDir 'run.cmd'
		$runLines = @(
			'@echo off',
			'rem Started by Zen/Firefox through native messaging. Written by install.ps1.',
			"set `"NODE=$nodeBin`"",
			"set `"HOST=$hostMjs`"",
			"set `"LOG_DIR=$LogDir`"",
			'if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" 2>nul',
			'if not exist "%NODE%" (',
			"  echo %DATE% %TIME% run.cmd: Node.js is not at %NODE% any more. Run the installer again: irm $Site/install.ps1 ^| iex>>`"%LOG_DIR%\helper.log`"",
			'  exit /b 127',
			')',
			'set "ENSO_LOG_DIR=%LOG_DIR%"',
			'set "ENSO_LOG_NO_ECHO=1"',
			'"%NODE%" "%HOST%" %* 2>"%LOG_DIR%\helper-stderr.log"'
		)
		[IO.File]::WriteAllText($runCmd, (($runLines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
		$versionNow = ''
		if (Test-Path (Join-Path $HelperDir 'VERSION')) { $versionNow = (Get-Content (Join-Path $HelperDir 'VERSION') -Raw).Trim() }
		Info "Helper $versionNow installed; it runs with $nodeBin"

		# The `enso` command (enso mcp, enso doctor, enso update...).
		$ensoCmd = Join-Path $BinDir 'enso.cmd'
		$ensoLines = @('@echo off', 'rem The enso command. Written by install.ps1.', "`"$nodeBin`" `"$(Join-Path $HelperDir 'bin\enso.mjs')`" %*")
		[IO.File]::WriteAllText($ensoCmd, (($ensoLines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
		Info "Command: $ensoCmd"
		$pathNote = $null
		if ($env:ENSO_NO_PATH -ne '1') {
			$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
			$parts = @(); if ($userPath) { $parts = $userPath.Split(';') | Where-Object { $_ } }
			if ($parts -notcontains $BinDir) {
				[Environment]::SetEnvironmentVariable('Path', (($parts + $BinDir) -join ';'), 'User')
				$pathNote = 'Added to your PATH: open a new terminal to use `enso`.'
				Info "Added $BinDir to your user PATH (new terminals pick it up)."
			}
		} else {
			$pathNote = "Not added to PATH (ENSO_NO_PATH=1): run $ensoCmd, or add $BinDir to PATH."
		}
		if (Test-Path (Join-Path $AppDir 'config.local.json')) { Info 'Your config.local.json is kept as it is.' }

		# 6. Register with Zen and Firefox. Both read HKCU\Software\Mozilla\NativeMessagingHosts.
		Step 'Registering with Zen and Firefox'
		$manifestFile = Join-Path $AppDir "$HostName.json"
		$manifest = [ordered]@{ name = $HostName; description = "$Enso helper"; path = $runCmd; type = 'stdio'; allowed_extensions = @($ExtensionId) }
		[IO.File]::WriteAllText($manifestFile, (($manifest | ConvertTo-Json -Depth 3) + "`n"), (New-Object Text.UTF8Encoding $false))
		Info "Wrote $manifestFile"
		$regKey = "HKCU:\Software\Mozilla\NativeMessagingHosts\$HostName"
		New-Item -Path $regKey -Force | Out-Null
		Set-Item -Path $regKey -Value $manifestFile
		Info "Registry: HKCU\Software\Mozilla\NativeMessagingHosts\$HostName -> $manifestFile"

		# 7. ENSO_REGISTER_MCP=1 lets Claude Code use Zen right away (otherwise: Setup in Enso).
		if ($env:ENSO_REGISTER_MCP -eq '1' -and $claudeBin) {
			Step 'Claude Code and Zen'
			& $nodeBin (Join-Path $HelperDir 'bin\enso.mjs') mcp install --client claude *> $null
			if ($LASTEXITCODE -eq 0) { Info 'Added zen-browser to Claude Code.' } else { Warn 'Claude Code did not accept the server; turn it on later in Enso > Settings > Setup.' }
		}

		# Versions and paths for Setup (no secrets).
		$install = [ordered]@{
			version = $(if ($versionNow) { $versionNow } else { $null })
			installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
			site = $Site
			node = [ordered]@{ path = $nodeBin; version = $nodeVersionNow; source = $nodeSource }
			claude = $(if ($claudeBin) { [ordered]@{ path = $claudeBin; version = $claudeVersion } } else { $null })
		}
		[IO.File]::WriteAllText((Join-Path $AppDir 'install.json'), (($install | ConvertTo-Json -Depth 4) + "`n"), (New-Object Text.UTF8Encoding $false))

		# 8. The extension: open it in Zen, unless a profile already has it.
		$profiles = @((Join-Path $env:APPDATA 'zen\Profiles'), (Join-Path $env:APPDATA 'Mozilla\Firefox\Profiles'))
		$hasIt = $false
		foreach ($p in $profiles) {
			if (Test-Path $p) {
				foreach ($f in (Get-ChildItem -Path $p -Directory -ErrorAction SilentlyContinue)) {
					$ej = Join-Path $f.FullName 'extensions.json'
					if ((Test-Path $ej) -and (Select-String -Path $ej -SimpleMatch "`"$ExtensionId`"" -Quiet)) { $hasIt = $true }
				}
			}
		}
		# A test run with a temporary USERPROFILE / APPDATA never opens the real Zen.
		$realProfile = $null
		try {
			$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
			$realProfile = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid" -ErrorAction Stop).ProfileImagePath
		} catch {}
		$isReal = (-not $realProfile) -or (($env:USERPROFILE.TrimEnd('\') -eq $realProfile.TrimEnd('\')) -and $env:APPDATA.StartsWith($realProfile, [StringComparison]::OrdinalIgnoreCase))
		$zenExe = @((Join-Path $env:ProgramFiles 'Zen Browser\zen.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Zen Browser\zen.exe')) | Where-Object { Test-Path $_ } | Select-Object -First 1
		if ($hasIt) { $extState = 'installed' }
		elseif ($env:ENSO_NO_OPEN -eq '1' -or -not $isReal) { $extState = 'skipped' }
		elseif ($zenExe) { Start-Process -FilePath $zenExe -ArgumentList $XpiUrl; $extState = 'opened' }
		else { $extState = 'no-zen' }

		Write-Host ""
		Write-Host "Done. $Enso $versionNow is installed."
		Info "Helper   $HelperDir"
		$privateNote = ''; if ($nodeSource -eq 'private') { $privateNote = " ($Enso's own copy)" }
		Info "Node     $nodeVersionNow$privateNote"
		if ($claudeBin) { Info "Claude   $claudeVersion" } else { Info 'Claude   not installed yet (optional: Settings > Setup in Enso)' }
		if ($pathNote) { Info "Command  $pathNote" }
		switch ($extState) {
			'installed' { Info "Next     Go back to Zen: $Enso connects by itself within a few seconds." }
			'opened' { Info "Next     Zen is asking to add $Enso $xpiVersion`: click Add, then press Ctrl+E." }
			'skipped' { Info "Next     Add the extension from $Site if you haven't, then press Ctrl+E in Zen." }
			'no-zen' { Warn "Zen was not found. Install it from https://zen-browser.app, then add $Enso from $Site." }
		}
		Info "Then finish in $Enso > Settings > Setup. Docs: $Site/docs/install"
	} finally {
		Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
	}
}
