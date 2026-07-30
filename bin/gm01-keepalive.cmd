@echo off
cd /d "%~dp0.."
set ROOT=%~dp0..
set LOG=%ROOT%\captures\gm01-keepalive.log

if not exist "%ROOT%\gm01-storage-state.local.json" (
    echo [%date% %time%] No session file found. Run gm01-session-capture.mjs to log in first. >> "%LOG%"
    exit /b 1
)

echo [%date% %time%] Starting keepalive daemon... >> "%LOG%"
"C:\Program Files\nodejs\node.exe" "%ROOT%\bin\gm01-keepalive.mjs" --interval=5 >> "%LOG%" 2>&1
echo [%date% %time%] Keepalive exited with code %ERRORLEVEL%. >> "%LOG%"
exit /b %ERRORLEVEL%
