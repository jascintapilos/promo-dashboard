@echo off
rem Nightly Ops pull - the steps live in bin\nightly-pull.mjs (isolated steps, real exit code, dashboard push).
cd /d "%~dp0.."
node bin\nightly-pull.mjs %*
exit /b %ERRORLEVEL%
