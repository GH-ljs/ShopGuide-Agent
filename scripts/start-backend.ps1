param(
  [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$serverDir = Join-Path $repoRoot "server"
$localNode = Join-Path $repoRoot ".tools\node-v24.18.0-win-x64\node.exe"
$localNpmCli = Join-Path $repoRoot ".tools\node-v24.18.0-win-x64\node_modules\npm\bin\npm-cli.js"

if (Test-Path $localNode) {
  # 优先使用项目本地便携 Node，避免新电脑没有配置系统 PATH 时后端无法启动。
  $node = $localNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "未找到 Node.js。请先安装 Node.js LTS，或把便携 Node 放到 .tools\node-v24.18.0-win-x64。"
  }
  $node = $nodeCommand.Source
}

if ($InstallDependencies) {
  if (-not (Test-Path $localNpmCli)) {
    throw "未找到 npm 入口，无法安装依赖。请安装系统 Node.js LTS 后在 server 目录执行 npm install。"
  }

  Push-Location $serverDir
  try {
    # 依赖安装只在显式传入 -InstallDependencies 时执行，避免每次启动都访问网络。
    & $node $localNpmCli install
  } finally {
    Pop-Location
  }
}

Push-Location $serverDir
try {
  Write-Host "ShopGuide 后端启动中：http://localhost:3001"
  & $node "src\index.js"
} finally {
  Pop-Location
}
