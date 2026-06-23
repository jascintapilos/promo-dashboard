@echo off
REM FastTrack CRM session keepalive — runs refresh-ft-sessions.mjs silently.
REM Schedule this via Windows Task Scheduler every 6 hours to prevent portaltoken expiry.
REM
REM Task Scheduler setup (run once from an admin prompt):
REM   schtasks /create /tn "FT CRM Keepalive" /tr "\"C:\Users\vdiuser\Downloads\promo-automation\promo-automation\bin\ft-keepalive.bat\"" /sc hourly /mo 6 /st 08:00 /f
REM
REM To delete:   schtasks /delete /tn "FT CRM Keepalive" /f
REM To run now:  schtasks /run /tn "FT CRM Keepalive"

cd /d "%~dp0.."
node bin/refresh-ft-sessions.mjs >> logs\ft-keepalive.log 2>&1
node bin/write-ft-session-status.mjs >> logs\ft-keepalive.log 2>&1
exit /b %ERRORLEVEL%
