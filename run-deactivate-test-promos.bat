@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting deactivate-test-promos >> logs\deactivate-test-promos.log
"C:\Program Files\nodejs\node.exe" bin\deactivate-test-promos.mjs >> logs\deactivate-test-promos.log 2>&1
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\deactivate-test-promos.log
