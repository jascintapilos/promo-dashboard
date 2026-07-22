@echo off
cd /d "C:\Users\vdiuser\promo-automation"

if not exist "gm01-storage-state.local.json" (
    echo [%date% %time%] No session file found. Run gm01-session-capture.mjs to log in first. >> "captures\gm01-keepalive.log"
    exit /b 1
)

echo [%date% %time%] Starting keepalive daemon... >> "captures\gm01-keepalive.log"
"C:\Program Files\nodejs\node.exe" "bin\gm01-keepalive.mjs" --interval=5 >> "captures\gm01-keepalive.log" 2>&1
echo [%date% %time%] Keepalive exited with code %ERRORLEVEL%. >> "captures\gm01-keepalive.log"
exit /b %ERRORLEVEL%
