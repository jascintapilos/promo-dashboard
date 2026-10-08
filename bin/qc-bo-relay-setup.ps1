# QC BO Relay - Windows Task Scheduler setup (run once; no admin rights).
#   powershell -ExecutionPolicy Bypass -File bin\qc-bo-relay-setup.ps1
$Root          = Split-Path $PSScriptRoot -Parent
$TaskName      = 'QC BO Relay'
$WrapperScript = Join-Path $PSScriptRoot 'qc-bo-relay-worker.ps1'
$User          = "$env:COMPUTERNAME\$env:USERNAME"
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed existing task: $TaskName"
}
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WrapperScript`"" -WorkingDirectory $Root
$triggerLogon = New-ScheduledTaskTrigger -AtLogOn -User $User
$triggerLogon.Delay = 'PT30S'
$triggerWatchdog = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 60) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($triggerLogon, $triggerWatchdog) -Settings $settings -Principal $principal -Description 'Starts the QC BO Relay worker at logon, keeps the VDI awake, and self-heals on crash so the QC Hub can read QPRO1/QPRO5 live.' -Force
Write-Host "Task '$TaskName' registered. Start now: Start-ScheduledTask -TaskName '$TaskName'"
