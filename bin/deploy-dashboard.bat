@echo off
REM Deploy dashboard.html to GitHub Pages (jascintapilos/promo-dashboard)
REM Run this any time dashboard.html is updated.

set DIST=C:\Users\vdiuser\Downloads\promo-automation\dist
set SRC=C:\Users\vdiuser\Downloads\promo-automation\dashboard.html

echo Copying dashboard.html to dist...
copy /Y "%SRC%" "%DIST%\dashboard.html" >nul

echo Committing and pushing to GitHub Pages...
git -C "%DIST%" add -A
git -C "%DIST%" diff --cached --quiet && (echo No changes to deploy.) || (git -C "%DIST%" commit -m "dashboard update" && git -C "%DIST%" push origin main && echo Done. Live at: https://jascintapilos.github.io/promo-dashboard/dashboard.html)
