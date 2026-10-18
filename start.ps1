param(
  [switch]$SkipInstall,
  [switch]$SkipDbPush,
  [switch]$SkipSeed
)

$ErrorActionPreference = "Stop"

# --- Prerequisites ------------------------------------------------
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) { Write-Error "Node.js is required (20+). Install from https://nodejs.org"; exit 1 }
Write-Host "Node $nodeVersion" -ForegroundColor Green

$pnpmVersion = pnpm -v 2>$null
if (-not $pnpmVersion) { Write-Error "pnpm is required (10+). Run: npm install -g pnpm"; exit 1 }
Write-Host "pnpm $pnpmVersion" -ForegroundColor Green

# --- .env ---------------------------------------------------------
if (-not (Test-Path -LiteralPath ".env")) {
  if (Test-Path -LiteralPath ".env.example") {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Created .env from .env.example -- edit it with your keys before continuing." -ForegroundColor Yellow
    exit 0
  } else {
    Write-Error ".env not found and no .env.example to copy from."
    exit 1
  }
}

# --- Load .env ----------------------------------------------------
Get-Content -LiteralPath ".env" | ForEach-Object {
  if ($_ -match '^\s*([^#=]+?)\s*=\s*(.+?)\s*$') {
    $name = $matches[1]
    $value = $matches[2] -replace '^"(.*)"$', '$1'
    Set-Item -Path "env:$name" -Value $value
  }
}

# --- Install ------------------------------------------------------
if (-not $SkipInstall) {
  Write-Host "`nInstalling dependencies..." -ForegroundColor Cyan
  pnpm install
  if (-not $?) { exit 1 }
}

# --- DB Push ------------------------------------------------------
if (-not $SkipDbPush) {
  Write-Host "`nPushing database schema..." -ForegroundColor Cyan
  pnpm --filter @workspace/db push-force
  if (-not $?) { exit 1 }
}

# --- Seed ---------------------------------------------------------
if (-not $SkipSeed) {
  Write-Host "`nSeeding database..." -ForegroundColor Cyan
  pnpm --filter @workspace/scripts seed
  if (-not $?) { exit 1 }
}

# --- Start --------------------------------------------------------
Write-Host "`nStarting API server (port 5001) and frontend (port 5000)..." -ForegroundColor Cyan
Write-Host "  API:     http://localhost:5001" -ForegroundColor Green
Write-Host "  Frontend: http://localhost:5000" -ForegroundColor Green
Write-Host "`nPress Ctrl+C to stop both.`n" -ForegroundColor Gray

$env:PORT=5001
$job1 = Start-Job -ScriptBlock {
  Set-Location -LiteralPath $using:PWD
  $env:PORT=5001
  pnpm --filter @workspace/api-server dev
}

$env:PORT=5000
$env:BASE_PATH="/"
$job2 = Start-Job -ScriptBlock {
  Set-Location -LiteralPath $using:PWD
  $env:PORT=5000
  $env:BASE_PATH="/"
  pnpm --filter @workspace/founder-os dev
}

try {
  $job1 | Wait-Job -Any | Out-Null
  $job2 | Wait-Job -Any | Out-Null
} finally {
  $job1, $job2 | Stop-Job -PassThru | Remove-Job
}
