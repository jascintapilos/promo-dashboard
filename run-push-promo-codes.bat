@echo off
REM Daily 9AM Promo Codes refresh: read the CEE / Sales / CRM code sheets, check
REM every code on BO (read-only), push to the Promo Codes tab on the QC Hub.
REM Runs from the folder this file is in (the VDI checkout that holds the BO /
REM Google credentials). See docs/plans/promo-codes-tab.md.
cd /d "%~dp0"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting promo-codes refresh >> logs\promo-codes.log
REM WS1/WS2 sessions expire; refresh them first (best effort - a failure only
REM leaves those brands "Not checked" on the page, it does not stop the run).
"C:\Program Files\nodejs\node.exe" bin\refresh-igmp-sessions.mjs >> logs\promo-codes.log 2>&1
"C:\Program Files\nodejs\node.exe" bin\push-promo-codes.mjs >> logs\promo-codes.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\promo-codes.log
