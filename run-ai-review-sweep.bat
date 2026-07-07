@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
if not exist logs mkdir logs
echo [%DATE% %TIME%] Starting ai-review-sweep (Wave 5, capped AI judgment layer) >> logs\ai-review-sweep.log

REM ── NOT YET SCHEDULED — verify this line manually before enabling ─────────
REM This line invokes headless Claude Code to run the /ai-review-sweep skill,
REM which needs the Agent tool (to spawn Sentinel + brand-watch-reviewer) and
REM Bash (to run bin/find-ai-review-candidates.mjs, bin/log-qc-results-batch.mjs,
REM bin/mark-ai-reviewed.mjs, bin/record-pull-status.mjs) with no one present
REM to click through permission prompts. --dangerously-skip-permissions is the
REM correct trust model here (same as nightly-pull.bat running with stored BO/
REM Google credentials unattended) but this exact flag name/behavior was not
REM verified from this session (no `claude` CLI available to test against).
REM RUN THIS LINE BY HAND ONCE, confirm it completes without hanging on a
REM prompt and that captures/ai-review-candidates.json + a QC Results Log
REM write actually happen, THEN register the PromoBot-AiReviewSweep scheduled
REM task (see docs/promo-monitoring-system-proposal.md Wave 5 notes).
claude -p "/ai-review-sweep" --dangerously-skip-permissions >> logs\ai-review-sweep.log 2>&1

if %ERRORLEVEL% neq 0 (
  echo [%DATE% %TIME%] FAILED (exit %ERRORLEVEL%) >> logs\ai-review-sweep.log
  "C:\Program Files\nodejs\node.exe" bin\record-pull-status.mjs ai-review-sweep "AI Review Sweep (5pm)" FAILED "exit %ERRORLEVEL% - see logs\ai-review-sweep.log" >> logs\ai-review-sweep.log 2>&1
)
echo [%DATE% %TIME%] Finished (exit %ERRORLEVEL%) >> logs\ai-review-sweep.log
