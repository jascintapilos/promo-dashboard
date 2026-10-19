@echo off
REM Hourly Promo Codes refresh: read the CEE / Sales / CRM code sheets, check
REM every code on BO (read-only), write the result to the "Promo Codes" tab of
REM the Ops sheet, which the dashboard reads. No upload key is involved.
REM WS1/WS2 sessions are refreshed by the script itself, only when they fail.
REM Runs from the folder this file is in (the VDI checkout that holds the BO /
REM Google credentials). See docs/plans/promo-codes-tab.md.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting promo-codes refresh >> logs\promo-codes.log
"C:\Program Files\nodejs\node.exe" bin\push-promo-codes.mjs >> logs\promo-codes.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\promo-codes.log
