# GM01 Weekly Cashback Submission - Windows Task Scheduler setup
# Run once on Gaby's machine to register the Monday task.
#   .\bin\gm01-cashback-weekly-setup.ps1
# ASCII only - keep it parseable under Windows PowerShell 5.1.

$Root          = Split-Path $PSScriptRoot -Parent
$TaskName      = 'GM01-CashbackWeekly'
$WrapperScript = Join-Path $PSScriptRoot "gm01-cashback-weekly.ps1"
$WorkDir       = $Root
$LogFile       = Join-Path $Root "captures\gm01-cashback-weekly.log"
$User          = "$env:COMPUTERNAME\$env:USERNAME"

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}

$action = New-ScheduledTaskAction `
    -Execute    'powershell.exe' `
    -Argument   "-NonInteractive -ExecutionPolicy Bypass -File `"$WrapperScript`"" `
    -WorkingDirectory $WorkDir

# Weekly, Mondays at 10:30 AM - 30 min after the daily turnover task (10:00),
# so the session is already warmed up and only one CAPTCHA prompt is needed.
# StartWhenAvailable means it fires on login if the machine was off at 10:30.
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '10:30AM'

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
    -Description 'Submits GM01/UNTUNG28 weekly cashback on Mondays (all levels, API+FISH, previous Mon-Sun).' `
    -Force

Write-Host ""
Write-Host "Task '$TaskName' registered - runs Mondays at 10:30 AM."
Write-Host ""
Write-Host "To test immediately (submits LAST week's cashback):"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To check last run status:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Logs: $LogFile"
