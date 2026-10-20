@echo off
REM Hourly Promo Codes refresh: read the CEE / Sales / CRM code sheets, check
REM every code on BO (read-only), upload the list to the dashboard with the
REM Promo Codes key, and write a readable copy to the Ops sheet "Promo Codes" tab.
REM WS1 MY / WS2 sessions are refreshed by the script itself, only when they fail;
REM WS1 SG never triggers a login. Runs from the folder this file is in (the VDI
REM checkout that holds the BO / Google credentials). See docs/plans/promo-codes-tab.md.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting promo-codes refresh >> logs\promo-codes.log
"C:\Program Files\nodejs\node.exe" bin\push-promo-codes.mjs >> logs\promo-codes.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\promo-codes.log
