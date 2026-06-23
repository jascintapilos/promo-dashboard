@echo off
REM Capture FastTrack CRM sessions for all 3 instances — headless + Gmail OTP.
REM No manual login needed. OTP codes are read automatically from Gmail.
REM
REM Prerequisite (one-time): run node bin/sheets-oauth.mjs to re-consent
REM with the gmail.readonly scope, then enable Gmail API in GCP:
REM   https://console.cloud.google.com/apis/library/gmail.googleapis.com
REM
REM Use --manual flag if auto-OTP fails for any instance.

cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"

echo ================================================
echo  FastTrack CRM Session Capture (all 3 instances)
echo  Mode: AUTO (headless + Gmail OTP)
echo ================================================
echo.

echo Step 1/3: WS1 (mb8.ft-crm.com)
node bin\capture-ft-session.mjs --instance=ws1
if %ERRORLEVEL% neq 0 ( echo WS1 FAILED. & pause & exit /b 1 )
echo WS1 OK.
echo.

echo Step 2/3: QPRO1 (alpha-iota-qp1.ft-crm.com)
node bin\capture-ft-session.mjs --instance=qpro1
if %ERRORLEVEL% neq 0 ( echo QPRO1 FAILED. & pause & exit /b 1 )
echo QPRO1 OK.
echo.

echo Step 3/3: QP2 (alpha-iota-qp2.ft-crm.com)
node bin\capture-ft-session.mjs --instance=qp2
if %ERRORLEVEL% neq 0 ( echo QP2 FAILED. & pause & exit /b 1 )
echo QP2 OK.
echo.

echo All sessions captured.
pause
