@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"
set LOG=logs\nightly-pull-%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%.txt
if not exist logs mkdir logs
echo === Nightly BO pull started %DATE% %TIME% === > %LOG%

echo [1/11] YTD promo backfill (QPRO+QP2+WS1/WS2, rewrites Promo Code Log)... >> %LOG%
node bin\pull-bo-ytd.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs bo-ytd "BO Promos (YTD)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs bo-ytd "BO Promos (YTD)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo YTD PROMO PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [2/11] Pulling QPRO/QP2 banners directly into Banner Log... >> %LOG%
node bin\pull-bo-banners-to-sheet.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs bo-banners "BO Banners (QPRO+QP2)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs bo-banners "BO Banners (QPRO+QP2)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo BANNER PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [3/11] Pulling WS1/WS2 CMS banners into Banner Log... >> %LOG%
node bin\pull-cms-banners.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs cms-banners "CMS Banners (WS1/WS2)" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs cms-banners "CMS Banners (WS1/WS2)" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo CMS BANNER PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [4/11] Syncing New Games from working sheet... >> %LOG%
node bin\pull-new-games.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs new-games "New Games" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs new-games "New Games" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo NEW GAMES PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [5/11] Pulling team utilisation into Weekly Report... >> %LOG%
node bin\pull-utilisation.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs utilisation "Utilisation" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs utilisation "Utilisation" FAILED "exit %ERRORLEVEL%" >> %LOG% 2>&1 & echo UTILISATION PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [6/11] Pulling Smartico CRM segments into CRM Assignment Log... >> %LOG%
node bin\pull-smartico-campaigns.mjs --write >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs smartico "Smartico CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs smartico "Smartico CRM" FAILED "exit %ERRORLEVEL% - capture new session" >> %LOG% 2>&1 & echo SMARTICO PULL FAILED (exit %ERRORLEVEL%) >> %LOG%)

echo [7/11] Refreshing FastTrack sessions silently (headless - no login needed)... >> %LOG%
node bin\refresh-ft-sessions.mjs >> %LOG% 2>&1
if %ERRORLEVEL% neq 0 echo FT SESSION REFRESH FAILED - check log; re-run capture-ft-sessions-all.bat if needed >> %LOG%

echo [8/11] Pulling FastTrack WS1 CRM segments... >> %LOG%
node bin\pull-ft-campaigns.mjs --instance=ws1 --write --append >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-ws1 "FT WS1/WS2 CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-ws1 "FT WS1/WS2 CRM" FAILED "exit %ERRORLEVEL% - re-capture session" >> %LOG% 2>&1 & echo FT WS1 PULL FAILED - session may have expired, re-run capture-ft-session.mjs --instance=ws1 >> %LOG%)

echo [9/11] Pulling FastTrack QPRO1 CRM segments... >> %LOG%
node bin\pull-ft-campaigns.mjs --instance=qpro1 --write --append >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-qpro1 "FT QPRO1 CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-qpro1 "FT QPRO1 CRM" FAILED "exit %ERRORLEVEL% - re-capture session" >> %LOG% 2>&1 & echo FT QPRO1 PULL FAILED - session may have expired, re-run capture-ft-session.mjs --instance=qpro1 >> %LOG%)

echo [10/11] Pulling FastTrack QP2 CRM segments... >> %LOG%
node bin\pull-ft-campaigns.mjs --instance=qp2 --write --append >> %LOG% 2>&1
if %ERRORLEVEL% equ 0 (node bin\record-pull-status.mjs ft-qp2 "FT QP2A-D CRM" OK >> %LOG% 2>&1) else (node bin\record-pull-status.mjs ft-qp2 "FT QP2A-D CRM" FAILED "exit %ERRORLEVEL% - re-capture session" >> %LOG% 2>&1 & echo FT QP2 PULL FAILED - session may have expired, re-run capture-ft-session.mjs --instance=qp2 >> %LOG%)

echo [11/11] Sorting all tabs by date descending (latest on top)... >> %LOG%
node bin\sort-sheet-tabs.mjs >> %LOG% 2>&1
if %ERRORLEVEL% neq 0 echo SORT FAILED (exit %ERRORLEVEL%) >> %LOG%

echo === Done %TIME% === >> %LOG%
type %LOG%
