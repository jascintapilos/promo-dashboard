# GM01 daily commission submission wrapper for Task Scheduler.
# Runs gm01-commission-submit.mjs with default args (yesterday, all levels, API+FISH).
# Logs all output to captures/gm01-submit-daily.log.

$Root   = Split-Path $PSScriptRoot -Parent
$Log    = Join-Path $Root "captures\gm01-submit-daily.log"
$Node   = "C:\Program Files\nodejs\node.exe"
$Script = Join-Path $Root "bin\gm01-commission-submit.mjs"

$null = New-Item -ItemType Directory -Force -Path (Split-Path $Log)

$ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
Add-Content $Log "[$ts] Starting daily commission submission..."

& $Node $Script 2>&1 | Tee-Object -Append -FilePath $Log

$code = $LASTEXITCODE
Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Exited with code $code."
exit $code
