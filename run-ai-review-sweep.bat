@echo off
REM STATUS 2026-07-08: uses the official npm-installed Claude Code CLI
REM npm install -g @anthropic-ai/claude-code, NOT the copy bundled inside
REM the Claude desktop app folder under AppData\Roaming\Claude\claude-code -
REM that path turned out to only be reachable from a different, separate
REM automation execution context on this VDI and was never actually usable
REM from the real interactive user session, despite showing the same
REM username. The npm-installed copy resolves normally on PATH from a
REM plain Command Prompt window for this user, which is what Task
REM Scheduler will use, and does not need any version-folder resolution.
REM
REM Auth: unattended use needs CLAUDE_CODE_OAUTH_TOKEN set as a persistent
REM Windows USER environment variable - setx CLAUDE_CODE_OAUTH_TOKEN "...",
REM generated once via claude setup-token, valid 1 year. Never store that
REM token in this file or anywhere under version control.
REM
REM IMPORTANT: never put a literal parenthesis character inside any echoed
REM text that lives inside an if or for block in this file. Root-caused
REM 2026-07-07: cmd.exe counts parens inside echoed strings, even quoted
REM ones, when matching a block's closing paren, so a stray parenthesized
REM phrase in an echo inside a structural block caused that block's exit
REM to fire unconditionally, regardless of the real if-condition result.
REM Use a comma or dash instead of parens in any text inside such a block.
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting ai-review-sweep, Wave 5 capped AI judgment layer >> logs\ai-review-sweep.log

where claude >> logs\ai-review-sweep.log 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] FAILED - claude not found on PATH >> logs\ai-review-sweep.log
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs ai-review-sweep "AI Review Sweep 5pm" FAILED "claude not found on PATH - was it uninstalled or PATH changed" >> logs\ai-review-sweep.log 2>&1
  echo [%DATE% %TIME%] Finished, exit 2 >> logs\ai-review-sweep.log
  exit /b 2
)

claude -p "/ai-review-sweep" --dangerously-skip-permissions >> logs\ai-review-sweep.log 2>&1
set "CLAUDE_EXIT=%ERRORLEVEL%"
REM Capture immediately. The record-pull-status.mjs call below would
REM otherwise overwrite ERRORLEVEL with its own exit code before we get to
REM report claude's real result. Bug found and fixed 2026-07-07: the
REM first hand run of this script silently reported exit 0 to Task
REM Scheduler despite claude having actually failed on Not logged in.

if not %CLAUDE_EXIT%==0 (
  echo [%DATE% %TIME%] FAILED, exit %CLAUDE_EXIT% >> logs\ai-review-sweep.log
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs ai-review-sweep "AI Review Sweep 5pm" FAILED "exit %CLAUDE_EXIT%, see logs\ai-review-sweep.log" >> logs\ai-review-sweep.log 2>&1
)
echo [%DATE% %TIME%] Finished, exit %CLAUDE_EXIT% >> logs\ai-review-sweep.log
exit /b %CLAUDE_EXIT%
