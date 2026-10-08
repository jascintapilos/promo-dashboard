# QC BO Relay worker launcher: keep-awake + crash-relaunch loop.
# Registered as scheduled task 'QC BO Relay' by bin/qc-bo-relay-setup.ps1.
$Root   = Split-Path $PSScriptRoot -Parent
$Node   = 'C:\Program Files\nodejs\node.exe'
$Script = Join-Path $Root 'bin\qc-bo-relay-worker.mjs'
$Log    = Join-Path $env:USERPROFILE '.qc-relay\qc-bo-relay-worker.log'
if (-not $env:QC_HUB_URL) { $env:QC_HUB_URL = 'https://qc-dashboard.zoom66.xyz' }
$env:QC_RELAY_WORKER_ID = "vdi-$env:COMPUTERNAME-$env:USERNAME"
Set-Location $Root
try {
    $sig = '[DllImport("kernel32.dll", SetLastError=true)] public static extern uint SetThreadExecutionState(uint esFlags);'
    $pwr = Add-Type -MemberDefinition $sig -Name 'QcRelayPower' -Namespace 'Win32' -PassThru
    [void]$pwr::SetThreadExecutionState([uint32]0x80000001)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] keep-awake armed"
} catch { Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] keep-awake FAILED: $($_.Exception.Message)" }
$backoff = 5
while ($true) {
    $started = Get-Date
    Add-Content $Log "[$($started.ToString('yyyy-MM-dd HH:mm:ss'))] launching worker (hub=$env:QC_HUB_URL id=$env:QC_RELAY_WORKER_ID)"
    & $Node $Script
    $code = $LASTEXITCODE
    $ranSec = [int]((Get-Date) - $started).TotalSeconds
    if ($ranSec -ge 120) { $backoff = 5 } else { $backoff = [Math]::Min(60, $backoff * 2) }
    Add-Content $Log "[$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss'))] worker exited code $code after ${ranSec}s; relaunch in ${backoff}s"
    Start-Sleep -Seconds $backoff
}
