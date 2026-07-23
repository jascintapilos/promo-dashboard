$ErrorActionPreference = "Stop"

$cloudflared = Join-Path $PSScriptRoot "bin\cloudflared.exe"
$hostname = "https://chdb-pzqgvmxrwfnjkstd.enigmagames.cc"
$listener = "127.0.0.1:8223"
$logDirectory = Join-Path $PSScriptRoot "logs"
$logFile = Join-Path $logDirectory "csir-cloudflared.log"

if (-not (Test-Path -LiteralPath $cloudflared)) {
    throw "cloudflared.exe was not found at $cloudflared"
}

$existingListener = Get-NetTCPConnection `
    -LocalAddress "127.0.0.1" `
    -LocalPort 8223 `
    -State Listen `
    -ErrorAction SilentlyContinue

if ($existingListener) {
    Write-Host "CSIR tunnel is already listening on 127.0.0.1:8223." -ForegroundColor Green
    exit 0
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

Write-Host "Starting the CSIR ClickHouse tunnel..." -ForegroundColor Cyan
Write-Host "Complete the Cloudflare sign-in in your browser if prompted."
Write-Host "Keep this window open while using ClickHouse." -ForegroundColor Yellow
Write-Host ""

& $cloudflared access tcp `
    --hostname $hostname `
    --listener $listener `
    --logfile $logFile `
    --log-level info
