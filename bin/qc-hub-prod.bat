@echo off
:: qc-hub-prod.bat — Production startup script for QC Hub
::
:: REQUIRED before running:
::   Set GOOGLE_CLIENT_ID as a persistent system environment variable.
::   Run this once in an elevated command prompt (replace <client_id>):
::     setx GOOGLE_CLIENT_ID "<client_id>.apps.googleusercontent.com" /M
::   Then open a new terminal — setx /M applies to new processes only.
::
:: SESSION_SECRET is optional.
::   If omitted, falls back to qc-dashboard-session-secret.local.json.
::   To use an env var instead: setx SESSION_SECRET "<hex-secret>" /M
::
:: PORT defaults to 4321 if not set.
::
:: NEVER hardcode real values in this file. All secrets come from env vars
:: or local gitignored files — never from committed source.

setlocal

:: ── Default port ──────────────────────────────────────────────────────────────
if not defined PORT set PORT=4321

:: ── Guard: GOOGLE_CLIENT_ID must be present ───────────────────────────────────
if "%GOOGLE_CLIENT_ID%"=="" (
  echo.
  echo ERROR: GOOGLE_CLIENT_ID is not set.
  echo.
  echo   Set it with ^(elevated cmd, replace ^<client_id^>^):
  echo     setx GOOGLE_CLIENT_ID "^<client_id^>.apps.googleusercontent.com" /M
  echo.
  echo   Then open a new terminal and re-run this script.
  echo.
  exit /b 1
)

:: ── Guard: dev mode must not be active ───────────────────────────────────────
if /i "%AUTH_MODE%"=="dev" (
  echo.
  echo ERROR: AUTH_MODE=dev is set. This disables Google Sign-In.
  echo   Unset AUTH_MODE before starting in production:
  echo     set AUTH_MODE=
  echo   Or remove it from your system environment variables.
  echo.
  exit /b 1
)

:: ── Start ─────────────────────────────────────────────────────────────────────
cd /d "%~dp0.."
echo QC Hub starting on port %PORT% ...
echo GOOGLE_CLIENT_ID is configured.
echo.

node bin/qc-dashboard.mjs
set NODE_EXIT=%errorlevel%

if %NODE_EXIT% neq 0 (
  echo.
  echo ERROR: QC Hub exited with code %NODE_EXIT%.
  echo   If GOOGLE_CLIENT_ID was recently set via setx, open a new terminal first.
  echo   Check the output above for the specific startup failure.
  echo.
  exit /b %NODE_EXIT%
)

endlocal
