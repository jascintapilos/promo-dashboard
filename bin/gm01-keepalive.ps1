$Root    = Split-Path $PSScriptRoot -Parent
$Log     = Join-Path $Root "captures\gm01-keepalive.log"
$Session = Join-Path $Root "gm01-storage-state.local.json"
$Node    = "C:\Program Files\nodejs\node.exe"
$Script  = Join-Path $Root "bin\gm01-keepalive.mjs"

$ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")

if (-not (Test-Path $Session)) {
    Add-Content $Log "[$ts] No session file found. Run gm01-session-capture.mjs to log in first."
    exit 1
}

Add-Content $Log "[$ts] Starting keepalive daemon..."
& $Node $Script --interval=5 2>&1 | Tee-Object -Append -FilePath $Log
$code = $LASTEXITCODE
Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] Keepalive exited with code $code."
exit $code
