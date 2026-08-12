# GM01 Daily Commission Submission - Windows Task Scheduler setup
# Run once per machine to register the daily submit task.
#   .\bin\gm01-submit-daily-setup.ps1                    # primary  - 10:00 AM (Gaby's VDI)
#   .\bin\gm01-submit-daily-setup.ps1 -Time "10:30AM"    # backup   - 10:30 AM (Jascinta's VDI)
param(
    [string]$Time = '10:00AM'
)

$Root          = Split-Path $PSScriptRoot -Parent
$TaskName      = 'GM01-DailySubmit'
$WrapperScript = Join-Path $PSScriptRoot "gm01-submit-daily.ps1"
$WorkDir       = $Root
$LogFile       = Join-Path $Root "captures\gm01-submit-daily.log"
$User          = "$env:COMPUTERNAME\$env:USERNAME"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}

$action = New-ScheduledTaskAction `
    -Execute    'powershell.exe' `
    -Argument   "-NonInteractive -ExecutionPolicy Bypass -File `"$WrapperScript`"" `
    -WorkingDirectory $WorkDir

# Daily at 10:00 AM. StartWhenAvailable means it fires on login if the machine
# was off at 10 AM (e.g. Gaby logs on at 10:05 - task still runs that day).
# 60s delay gives the keepalive time to establish the session before submitting.
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$trigger.Delay = 'PT60S'

# Retry 3x at 5-min intervals - gives the keepalive time to warm up the session
# in the unlikely event the machine just booted.
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId    $User `
    -LogonType Interactive `
    -RunLevel  Limited

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -Principal  $principal `
    -Description 'Submits GM01/UNTUNG28 daily commissions at 10 AM (all levels, API+FISH, yesterday).' `
    -Force

Write-Host ""
Write-Host "Task '$TaskName' registered - runs daily at $Time."
Write-Host ""
Write-Host "To test immediately (without waiting for 10 AM):"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To check last run status:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Logs: $LogFile"
