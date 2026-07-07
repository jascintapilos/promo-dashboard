@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting brand-watch (daily 5pm estate pass) >> logs\brand-watch.log
REM --dashboard appends a delta digest to the PromoOps Control Layer
REM Notifications feed (unified dashboard). To also alert Slack, append:
REM   --slack --slack-channel=C07KKVD1GTE
"C:\Program Files\nodejs\node.exe" bin\brand-watch.mjs --commit --dashboard >> logs\brand-watch.log 2>&1
if %ERRORLEVEL% neq 0 (
  echo [%DATE% %TIME%] FAILED (exit %ERRORLEVEL%) >> logs\brand-watch.log
  REM brand-watch records its own OK/PARTIAL heartbeat on success; this covers crashes.
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs brand-watch "Brand Watch (5pm)" FAILED "exit %ERRORLEVEL% - see logs\brand-watch.log" >> logs\brand-watch.log 2>&1
)
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\brand-watch.log
