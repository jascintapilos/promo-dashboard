@echo off
:: Promo report refresh worker startup wrapper (clones bin\qc-bo-relay-worker.bat).
::
:: IMPORTANT: this file MUST NEVER contain the RELAY_SECRET value. The secret lives
:: outside the repo, in one of:
::   1. env RELAY_SECRET, or
::   2. %USERPROFILE%\.qc-relay\relay-secret  — the SAME file the BO relay worker
::      already uses on the VDI, so no new secret setup is needed.
:: The worker reads whichever is present; if neither, it exits code 2 without echoing
:: any value.
::
:: Deploy on the always-on, firewall-allowlisted VDI (same as the BO relay worker):
::   Task Scheduler -> General : Run only when user is logged on
::                  -> Triggers: At log on, delay 30s
::                  -> Actions : bin\promo-refresh-worker.bat
:: Or run manually:  bin\promo-refresh-worker.bat

setlocal
if "%QC_HUB_URL%"=="" set QC_HUB_URL=https://qc-dashboard.zoom66.xyz
set QC_RELAY_WORKER_ID=vdi-promo-refresh-%COMPUTERNAME%
:: Where the OUTER report pipeline repo lives (the build-driver runs with this as cwd).
if "%PROMO_OUTER_DIR%"=="" set PROMO_OUTER_DIR=C:\Users\vdiuser\Downloads\promo-automation
cd /d "%~dp0.."
node bin\promo-refresh-worker.mjs
endlocal
