$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = 'Tanaboonnnnn/Com-gu'
$Root = if ($env:COMGU_INSTALL_ROOT) { $env:COMGU_INSTALL_ROOT } else { Join-Path $env:LOCALAPPDATA 'ComGu\CLI' }
$BinDir = if ($env:COMGU_BIN_DIR) { $env:COMGU_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'ComGu\bin' }
$TestBase = $env:COMGU_INSTALLER_TEST_BASE_URL

function Fail([string]$Message) { throw "ComGu installer: $Message" }

$nodeVersion = & node -p "Number(process.versions.node.split('.')[0])" 2>$null
if ($LASTEXITCODE -ne 0 -or [int]$nodeVersion -lt 22) { Fail 'Node.js 22 or newer is required' }

$osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($osArch) {
  'x64' { $Arch = 'x64' }
  'arm64' { $Arch = 'arm64' }
  default { Fail "unsupported architecture: $osArch" }
}

if ($env:COMGU_VERSION) {
  $Version = $env:COMGU_VERSION.TrimStart('v')
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail 'COMGU_VERSION must be an exact version such as 3.2.0' }
  $Tag = "v$Version"
} else {
  if ($TestBase) { Fail 'COMGU_VERSION is required with the test release source' }
  $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'ComGu-Installer' } -Uri "https://api.github.com/repos/$Repo/releases/latest"
  $Tag = [string]$release.tag_name
  if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { Fail 'could not resolve a stable ComGu release' }
  $Version = $Tag.Substring(1)
}

$Asset = "ComGu-CLI-windows-$Arch.zip"
$Base = if ($TestBase) { "$($TestBase.TrimEnd('/'))/$Tag" } else { "https://github.com/$Repo/releases/download/$Tag" }
$Temp = Join-Path ([IO.Path]::GetTempPath()) ("comgu-install-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Temp | Out-Null

try {
  Write-Host "Installing ComGu CLI $Version for windows-$Arch..."
  $sumsPath = Join-Path $Temp 'SHA256SUMS.txt'
  $archivePath = Join-Path $Temp $Asset
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/SHA256SUMS.txt" -OutFile $sumsPath
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Asset" -OutFile $archivePath

  $entry = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match "^([a-fA-F0-9]{64})\s+\*?$([regex]::Escape($Asset))$" } | Select-Object -First 1
  if (-not $entry) { Fail "SHA256SUMS.txt has no valid entry for $Asset" }
  $expected = ([regex]::Match($entry, '^([a-fA-F0-9]{64})').Groups[1].Value).ToLowerInvariant()
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $archivePath).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { Fail "SHA-256 mismatch for $Asset" }

  $versionsDir = Join-Path $Root 'versions'
  New-Item -ItemType Directory -Force -Path $versionsDir, $BinDir | Out-Null
  $final = Join-Path $versionsDir $Version
  $launcher = Join-Path $final 'ComGu-CLI\comgu.cmd'
  if (-not (Test-Path -LiteralPath $launcher)) {
    $stage = Join-Path $Temp 'payload'
    Expand-Archive -LiteralPath $archivePath -DestinationPath $stage -Force
    $stagedLauncher = Join-Path $stage 'ComGu-CLI\comgu.cmd'
    if (-not (Test-Path -LiteralPath $stagedLauncher)) { Fail 'archive does not contain ComGu-CLI\comgu.cmd' }
    if (-not (Test-Path -LiteralPath $final)) { Move-Item -LiteralPath $stage -Destination $final }
  }

  $currentTmp = Join-Path $Root ("current.tmp." + $PID)
  Set-Content -LiteralPath $currentTmp -Value $Version -NoNewline
  Move-Item -Force -LiteralPath $currentTmp -Destination (Join-Path $Root 'current')

  $state = [ordered]@{ version=$Version; tag=$Tag; artifact=$Asset; sha256=$actual; channel='powershell'; platform='win32'; arch=$Arch }
  $stateTmp = Join-Path $Root ("install.json.tmp." + $PID)
  $state | ConvertTo-Json -Compress | Set-Content -LiteralPath $stateTmp -Encoding UTF8
  Move-Item -Force -LiteralPath $stateTmp -Destination (Join-Path $Root 'install.json')

  $cmd = @"
@echo off
setlocal
set "COMGU_ROOT=$Root"
if /I "%~1"=="update" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/Tanaboonnnnn/Com-gu/releases/latest/download/install.ps1 | iex"
  exit /b %ERRORLEVEL%
)
if /I "%~1"=="uninstall" (
  start "" /b powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 500; Remove-Item -LiteralPath '$Root' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '$BinDir\comgu.cmd' -Force -ErrorAction SilentlyContinue"
  echo ComGu CLI uninstall scheduled. Profile data will be preserved.
  exit /b 0
)
set /p COMGU_VERSION=<"$Root\current"
call "$Root\versions\%COMGU_VERSION%\ComGu-CLI\comgu.cmd" %*
exit /b %ERRORLEVEL%
"@
  Set-Content -LiteralPath (Join-Path $BinDir 'comgu.cmd') -Value $cmd -Encoding ASCII

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $parts = @($userPath -split ';' | Where-Object { $_ })
  if ($parts -notcontains $BinDir) {
    $newPath = (($parts + $BinDir) -join ';')
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  }
  if (($env:Path -split ';') -notcontains $BinDir) { $env:Path = "$env:Path;$BinDir" }
  Write-Host "ComGu CLI $Version installed. Open a new terminal and run: comgu setup"
}
finally {
  Remove-Item -LiteralPath $Temp -Recurse -Force -ErrorAction SilentlyContinue
}
