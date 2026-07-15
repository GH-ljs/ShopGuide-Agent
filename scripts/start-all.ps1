param(
  [int]$AppPort = 5174,
  [int]$QdrantPort = 6333
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$nodeDir = Join-Path $repoRoot ".tools\node-v22.23.1-win-x64"
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCli = Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js"
$qdrantExe = Join-Path $repoRoot ".tools\qdrant-v1.12.6-windows\qdrant.exe"
$qdrantStorage = Join-Path $repoRoot "qdrant_storage"
$serverDir = Join-Path $repoRoot "server"
$appDir = Join-Path $repoRoot "app"
$tmpDir = Join-Path $repoRoot ".tools\tmp"

function Test-HttpOk {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Wait-HttpOk {
  param(
    [string]$Url,
    [string]$Name,
    [int]$Seconds = 20
  )

  for ($i = 0; $i -lt $Seconds; $i++) {
    if (Test-HttpOk $Url) {
      Write-Host "$Name ready: $Url"
      return
    }
    Start-Sleep -Seconds 1
  }

  throw "$Name did not become ready: $Url"
}

if (!(Test-Path $nodeExe) -or !(Test-Path $npmCli)) {
  throw "Node runtime not found: $nodeDir"
}

if (!(Test-Path $qdrantExe)) {
  throw "Qdrant executable not found: $qdrantExe"
}

New-Item -ItemType Directory -Force $tmpDir | Out-Null
New-Item -ItemType Directory -Force $qdrantStorage | Out-Null

$env:TEMP = $tmpDir
$env:TMP = $tmpDir
$env:NO_UPDATE_NOTIFIER = "1"
$env:PATH = "$nodeDir;$env:PATH"

if (!(Test-HttpOk "http://localhost:$QdrantPort/healthz")) {
  Write-Host "Starting Qdrant..."
  $escapedStorage = $qdrantStorage -replace "'", "''"
  $escapedQdrant = $qdrantExe -replace "'", "''"
  $qdrantCommand = '$env:QDRANT__STORAGE__STORAGE_PATH=''{0}''; $env:QDRANT__SERVICE__HTTP_PORT=''{1}''; & ''{2}''' -f $escapedStorage, $QdrantPort, $escapedQdrant
  Start-Process -FilePath powershell -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $qdrantCommand) -WorkingDirectory $repoRoot -WindowStyle Hidden
}
Wait-HttpOk "http://localhost:$QdrantPort/healthz" "Qdrant"

if (!(Test-HttpOk "http://localhost:3001/api/health")) {
  Write-Host "Starting backend..."
  Start-Process -FilePath $nodeExe -ArgumentList @("src\index.js") -WorkingDirectory $serverDir -WindowStyle Hidden
}
Wait-HttpOk "http://localhost:3001/api/health" "Backend"

if (Test-Path $appDir) {
  if (!(Test-Path (Join-Path $appDir "node_modules"))) {
    Write-Host "Installing app dependencies..."
    Push-Location $appDir
    try {
      & $nodeExe $npmCli install --registry=https://registry.npmmirror.com --no-audit --no-fund
    } finally {
      Pop-Location
    }
  }

  if (!(Test-HttpOk "http://127.0.0.1:$AppPort")) {
    Write-Host "Starting app H5..."
    Start-Process -FilePath $nodeExe -ArgumentList @($npmCli, "run", "dev:h5") -WorkingDirectory $appDir -WindowStyle Hidden
  }
  Wait-HttpOk "http://127.0.0.1:$AppPort" "App H5" 120
}

Write-Host ""
Write-Host "ShopGuide Agent is ready."
Write-Host "App H5:  http://127.0.0.1:$AppPort"
Write-Host "Backend: http://localhost:3001"
Write-Host "Qdrant:  http://localhost:$QdrantPort"
