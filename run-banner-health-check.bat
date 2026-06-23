@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting banner-health-check >> logs\banner-health-check.log
REM --dashboard appends a digest row to the PromoOps Control Layer Notifications
REM feed (shows in the unified dashboard). To also alert Slack, append:
REM   --slack --slack-channel=C07KKVD1GTE
"C:\Program Files\nodejs\node.exe" bin\banner-health-check.mjs --dashboard >> logs\banner-health-check.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\banner-health-check.log
