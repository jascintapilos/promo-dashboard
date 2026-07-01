@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value 2^>nul') do set LDATE=%%I
set LOG=logs\nightly-pull-%LDATE:~0,8%.txt
if not exist logs mkdir logs
echo === Nightly BO pull started %DATE% %TIME% === > %LOG%

echo [1/12] YTD promo backfill (QPRO+QP2+WS1/WS2, rewrites Promo Code Log)... >> %LOG%
node bin\pull-bo-ytd.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs bo-ytd "BO Promos (YTD)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs bo-ytd "BO Promos (YTD)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo YTD PROMO PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [2/12] Pulling QPRO/QP2 banners directly into Banner Log... >> %LOG%
node bin\pull-bo-banners-to-sheet.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs bo-banners "BO Banners (QPRO+QP2)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs bo-banners "BO Banners (QPRO+QP2)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo BANNER PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [3/12] Pulling WS1/WS2 CMS banners into Banner Log... >> %LOG%
node bin\pull-cms-banners.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs cms-banners "CMS Banners (WS1/WS2)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs cms-banners "CMS Banners (WS1/WS2)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo CMS BANNER PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [4/12] Syncing New Games from working sheet... >> %LOG%
node bin\pull-new-games.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs new-games "New Games" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs new-games "New Games" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo NEW GAMES PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [5/12] Pulling team utilisation into Weekly Report... >> %LOG%
node bin\pull-utilisation.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs utilisation "Utilisation" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs utilisation "Utilisation" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo UTILISATION PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [6/12] Refreshing Smartico session (headless auto-login)... >> %LOG%
node bin\capture-smartico-session.mjs >> %LOG% 2>&1
if %ERRORLEVEL% neq 0 echo   WARNING: Smartico session capture failed - pull will attempt with existing token >> %LOG%

echo [6b/12] Pulling Smartico CRM segments + activities into CRM Assignment Log... >> %LOG%
node bin\pull-smartico-campaigns.mjs --write --no-preserve >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs smartico "Smartico CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs smartico "Smartico CRM" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo SMARTICO PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [7/12] Pulling FastTrack WS1 CRM segments (via AdsPower browser relay)... >> %LOG%
echo   REQUIRES: AdsPower open with logged-in FT tab for mb8.ft-crm.com >> %LOG%
node bin\pull-ft-via-browser.mjs --instance=ws1 --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-ws1 "FT WS1/WS2 CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-ws1 "FT WS1/WS2 CRM" FAILED "exit %ERRORLEVEL% - open AdsPower FT tab and log in" >> %LOG% 2>&1 & echo FT WS1 PULL FAILED >> %LOG%)

echo [8/12] Pulling FastTrack QPRO1 CRM segments (via AdsPower browser relay)... >> %LOG%
echo   REQUIRES: AdsPower open with logged-in FT tab for alpha-iota-qp1.ft-crm.com >> %LOG%
node bin\pull-ft-via-browser.mjs --instance=qpro1 --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-qpro1 "FT QPRO1 CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-qpro1 "FT QPRO1 CRM" FAILED "exit %ERRORLEVEL% - open AdsPower FT tab and log in" >> %LOG% 2>&1 & echo FT QPRO1 PULL FAILED >> %LOG%)

echo [9/12] Pulling FastTrack QP2 CRM segments (via AdsPower browser relay)... >> %LOG%
echo   REQUIRES: AdsPower open with logged-in FT tab for alpha-iota-qp2.ft-crm.com >> %LOG%
node bin\pull-ft-via-browser.mjs --instance=qp2 --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-qp2 "FT QP2A-D CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-qp2 "FT QP2A-D CRM" FAILED "exit %ERRORLEVEL% - open AdsPower FT tab and log in" >> %LOG% 2>&1 & echo FT QP2 PULL FAILED >> %LOG%)

echo [10/12] Pulling adhoc tasks from Slack into Adhoc Tasks tab... >> %LOG%
node bin\pull-adhoc-tasks.mjs --commit >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs adhoc-tasks "Adhoc Tasks" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs adhoc-tasks "Adhoc Tasks" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo ADHOC TASKS PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [11/12] Running banner health check (writes findings to Banner Health tab + dashboard)... >> %LOG%
node bin\banner-health-check.mjs --dashboard >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs banner-health "Banner Health Check" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs banner-health "Banner Health Check" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo BANNER HEALTH FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [12/12] Sorting all tabs by date descending (latest on top)... >> %LOG%
node bin\sort-sheet-tabs.mjs >> %LOG% 2>&1
if %ERRORLEVEL% neq 0 echo SORT FAILED (exit %ERRORLEVEL%) >> %LOG%

echo === Done %TIME% === >> %LOG%
type %LOG%
