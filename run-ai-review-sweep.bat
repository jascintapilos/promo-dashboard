@echo off
REM STATUS 2026-07-07: mechanism fully verified by hand - path resolution,
REM invocation, log capture, and exit-code propagation to Task Scheduler
REM all confirmed correct. STILL BLOCKED: this claude.exe install returns
REM "Not logged in" for headless auth. Run once, interactively, as this
REM Windows user: claude setup-token - creates a long-lived token suitable
REM for unattended use; requires a Claude subscription and a one-time
REM browser approval. Re-run this .bat by hand after that and confirm it
REM reaches the actual /ai-review-sweep skill output before registering
REM the PromoBot-AiReviewSweep scheduled task.
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting ai-review-sweep, Wave 5 capped AI judgment layer >> logs\ai-review-sweep.log

REM claude is not on PATH on this VDI. The desktop app bundles its own
REM Claude Code CLI under a version-numbered folder with no stable current
REM symlink, confirmed 2026-07-07: only 2.1.187 and 2.1.197 exist side by
REM side, auto-updated by the desktop app. Resolve the newest one by
REM last-write time each run instead of hardcoding a version that goes stale.
REM IMPORTANT: never put a literal parenthesis character inside any echoed
REM text that lives inside an if or for block in this file. Root-caused
REM 2026-07-07: cmd.exe counts parens inside echoed strings, even quoted
REM ones, when matching a block's closing paren, so a stray parenthesized
REM phrase in an echo inside a structural block caused that block's exit
REM to fire unconditionally, regardless of the real if-condition result.
REM Use a comma or dash instead of parens in any text inside such a block.
set "CLAUDE_ROOT=C:\Users\vdiuser\AppData\Roaming\Claude\claude-code"
set "CLAUDE_EXE="
for /f "delims=" %%D in ('dir /b /ad /o-d "%CLAUDE_ROOT%" 2^>nul') do (
  if not defined CLAUDE_EXE if exist "%CLAUDE_ROOT%\%%D\claude.exe" (
    set "CLAUDE_EXE=%CLAUDE_ROOT%\%%D\claude.exe"
  )
)
if not defined CLAUDE_EXE (
  echo [%DATE% %TIME%] FAILED - no claude.exe found under %CLAUDE_ROOT% >> logs\ai-review-sweep.log
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs ai-review-sweep "AI Review Sweep 5pm" FAILED "claude.exe not found, Claude desktop app moved or uninstalled" >> logs\ai-review-sweep.log 2>&1
  echo [%DATE% %TIME%] Finished, exit 2 >> logs\ai-review-sweep.log
  exit /b 2
)
echo [%DATE% %TIME%] Using %CLAUDE_EXE% >> logs\ai-review-sweep.log

"%CLAUDE_EXE%" -p "/ai-review-sweep" --dangerously-skip-permissions >> logs\ai-review-sweep.log 2>&1
set "CLAUDE_EXIT=%ERRORLEVEL%"
REM Capture immediately. The record-pull-status.mjs call below would
REM otherwise overwrite ERRORLEVEL with its own exit code before we get to
REM report claude.exe's real result. Bug found and fixed 2026-07-07: the
REM first hand run of this script silently reported exit 0 to Task
REM Scheduler despite claude.exe having actually failed on Not logged in.

if not %CLAUDE_EXIT%==0 (
  echo [%DATE% %TIME%] FAILED, exit %CLAUDE_EXIT% >> logs\ai-review-sweep.log
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs ai-review-sweep "AI Review Sweep 5pm" FAILED "exit %CLAUDE_EXIT%, see logs\ai-review-sweep.log" >> logs\ai-review-sweep.log 2>&1
)
echo [%DATE% %TIME%] Finished, exit %CLAUDE_EXIT% >> logs\ai-review-sweep.log
exit /b %CLAUDE_EXIT%
