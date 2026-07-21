# GM01 Keepalive — Windows Task Scheduler setup
# Run once as Administrator to register the task.
#   Right-click PowerShell → "Run as administrator"
#   .\bin\gm01-keepalive-setup.ps1

$TaskName   = 'GM01-Keepalive'
$NodeExe    = 'C:\Program Files\nodejs\node.exe'
$ScriptPath = 'C:\Users\vdiuser\Downloads\promo-automation\promo-automation\bin\gm01-keepalive.mjs'
$WorkDir    = 'C:\Users\vdiuser\Downloads\promo-automation\promo-automation'
$LogFile    = 'C:\Users\vdiuser\Downloads\promo-automation\promo-automation\captures\gm01-keepalive.log'
$User       = 'VDI-14142\vdiuser'

# Remove existing task if present
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}

# Action: run the wrapper batch file (handles logging and session-missing guard)
$WrapperScript = 'C:\Users\vdiuser\Downloads\promo-automation\promo-automation\bin\gm01-keepalive.cmd'
$action = New-ScheduledTaskAction `
    -Execute 'cmd.exe' `
    -Argument "/c `"$WrapperScript`"" `
    -WorkingDirectory $WorkDir

# Trigger 1: on user logon
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $User

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
    -Trigger    $triggerLogon `
    -Settings   $settings `
    -Principal  $principal `
    -Description 'Keeps the GM01/UNTUNG28 BO session alive so commission submission runs without CAPTCHA.' `
    -Force

Write-Host ""
Write-Host "Task '$TaskName' registered successfully."
Write-Host "It will auto-start on next logon and restart automatically if it crashes."
Write-Host ""
Write-Host "To start it now without logging off:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ""
Write-Host "To check its status:"
Write-Host "  Get-ScheduledTask -TaskName '$TaskName' | Get-ScheduledTaskInfo"
Write-Host ""
Write-Host "Logs are written to:"
Write-Host "  $LogFile"
