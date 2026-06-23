@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting sync-promo-codes >> logs\sync-promo-codes.log
"C:\Program Files\nodejs\node.exe" bin\sync-promo-codes.js >> logs\sync-promo-codes.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\sync-promo-codes.log
