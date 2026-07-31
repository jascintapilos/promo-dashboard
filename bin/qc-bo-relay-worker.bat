@echo off
:: BO Relay worker startup wrapper.
::
:: IMPORTANT: this file MUST NEVER contain the RELAY_SECRET value.
:: The secret lives outside the repo in one of these two places:
::   1. An environment variable RELAY_SECRET (recommended for local dev).
::   2. An external file at %USERPROFILE%\.qc-relay\relay-secret
::      (recommended for the always-on VDI so Task Scheduler can start the
::      worker without seeing the secret).
::
:: The worker reads whichever is present. If neither is set, it exits with
:: code 2 and logs the reason WITHOUT echoing any value.
::
:: Usage:
::   1. One-time setup:
::        mkdir "%USERPROFILE%\.qc-relay"
::        notepad "%USERPROFILE%\.qc-relay\relay-secret"
::      Paste the ≥ 32-byte secret and save. NEVER commit this file.
::   2. Point the worker at the company Hub (default: production URL):
::        setx QC_HUB_URL "https://qc-dashboard.zoom66.xyz"
::   3. Register with Task Scheduler (see docs/plans/qc-bo-relay.md).
::   4. Or run manually:  bin\qc-bo-relay-worker.bat

setlocal
if "%QC_HUB_URL%"=="" set QC_HUB_URL=https://qc-dashboard.zoom66.xyz
set QC_RELAY_WORKER_ID=vdi-%COMPUTERNAME%-%USERNAME%
cd /d "%~dp0.."
node bin\qc-bo-relay-worker.mjs
endlocal
