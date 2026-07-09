param(
  [int]$Port = 6333
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$qdrantExe = Join-Path $repoRoot ".tools\qdrant-v1.12.6-windows\qdrant.exe"
$storageDir = Join-Path $repoRoot "qdrant_storage"

if (!(Test-Path $qdrantExe)) {
  throw "Qdrant executable not found: $qdrantExe"
}

New-Item -ItemType Directory -Force $storageDir | Out-Null

# Docker image pulls are unstable on this machine, so this script starts
# the local Windows Qdrant binary and pins storage to qdrant_storage.
$escapedStorage = $storageDir -replace "'", "''"
$escapedQdrant = $qdrantExe -replace "'", "''"
$command = '$env:QDRANT__STORAGE__STORAGE_PATH=''{0}''; $env:QDRANT__SERVICE__HTTP_PORT=''{1}''; & ''{2}''' -f $escapedStorage, $Port, $escapedQdrant

Start-Process `
  -FilePath powershell `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
  -WorkingDirectory $repoRoot `
  -WindowStyle Hidden

Start-Sleep -Seconds 3
Invoke-WebRequest -UseBasicParsing "http://localhost:$Port/healthz" | Select-Object StatusCode,Content
