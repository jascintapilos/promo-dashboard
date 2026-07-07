@echo off
REM Telegram bot message poller — captures new messages from the configured
REM group into captures/telegram/messages.jsonl for the MCP server to search.
REM Bot API has no history endpoint, so this must run on a schedule to avoid
REM gaps — Telegram buffers unfetched updates for ~24h server-side.
REM
REM Task Scheduler setup (run once from an admin prompt):
REM   schtasks /create /tn "TG Bot Poll" /tr "\"C:\Users\vdiuser\Downloads\promo-automation\promo-automation\bin\tg-poll-keepalive.bat\"" /sc minute /mo 15 /f
REM
REM To delete:   schtasks /delete /tn "TG Bot Poll" /f
REM To run now:  schtasks /run /tn "TG Bot Poll"

cd /d "%~dp0.."
node bin/tg-bot-poll.mjs >> logs\tg-poll.log 2>&1
exit /b %ERRORLEVEL%
