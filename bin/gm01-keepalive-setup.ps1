# GM01 Keepalive — Windows Task Scheduler setup
# Run once to register the task. No admin rights required.
#   .\bin\gm01-keepalive-setup.ps1

$Root          = Split-Path $PSScriptRoot -Parent
$TaskName      = 'GM01-Keepalive'
$WrapperScript = Join-Path $PSScriptRoot "gm01-keepalive.ps1"
$WorkDir       = $Root
$LogFile       = Join-Path $Root "captures\gm01-keepalive.log"
$User          = "$env:COMPUTERNAME\$env:USERNAME"

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}

# Action: PowerShell wrapper (reliable $PSScriptRoot path resolution)
$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NonInteractive -ExecutionPolicy Bypass -File `"$WrapperScript`"" `
    -WorkingDirectory $WorkDir

# Trigger 1: on user logon (primary start)
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $User

# Trigger 2: hourly watchdog — if keepalive died mid-session, this revives it.
# MultipleInstances=IgnoreNew (below) means a healthy running instance is untouched.
$triggerWatchdog = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 60) `
    -RepetitionDuration ([TimeSpan]::MaxValue)

# Settings: restart up to 10 times if the process exits, 1 min apart
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 10 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable

$principal = New-ScheduledTaskPrincipal `
    -UserId $User `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $action `
    -Trigger    @($triggerLogon, $triggerWatchdog) `
    -Settings   $settings `
    -Principal  $principal `
    -Description 'Keeps the GM01/UNTUNG28 BO session alive so commission submission runs without CAPTCHA.' `
    -Force

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "It will auto-start on next logon, retry on crash, and self-heal hourly."
Write-Host ""
Write-Host "To start it now without logging off:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To check its status:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Logs are written to:"
Write-Host "  $LogFile"
