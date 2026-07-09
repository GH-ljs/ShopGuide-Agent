param(
  [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$serverDir = Join-Path $repoRoot "server"
$toolsDir = Join-Path $repoRoot ".tools"
$tempDir = Join-Path $env:LOCALAPPDATA "Temp"

if (Test-Path $tempDir) {
  $env:TEMP = $tempDir
  $env:TMP = $tempDir
}

$localNodeDir = Get-ChildItem $toolsDir -Directory -Filter "node-v*-win-x64" -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending |
  Select-Object -First 1
$localNode = if ($localNodeDir) { Join-Path $localNodeDir.FullName "node.exe" } else { "" }
$localNpmCli = if ($localNodeDir) { Join-Path $localNodeDir.FullName "node_modules\npm\bin\npm-cli.js" } else { "" }

if ($localNode -and (Test-Path $localNode)) {
  $node = $localNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found. Install Node.js LTS or put portable Node under .tools\node-v*-win-x64."
  }
  $node = $nodeCommand.Source
}

if ($InstallDependencies) {
  if (-not ($localNpmCli -and (Test-Path $localNpmCli))) {
    throw "npm entry was not found. Install system Node.js LTS or make sure portable Node includes npm."
  }

  Push-Location $serverDir
  try {
    & $node $localNpmCli install
  } finally {
    Pop-Location
  }
}

Push-Location $serverDir
try {
  Write-Host "ShopGuide backend: http://localhost:3001"
  & $node "src\index.js"
} finally {
  Pop-Location
}
