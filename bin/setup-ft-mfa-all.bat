@echo off
cd /d "C:\Users\vdiuser\Downloads\promo-automation\promo-automation"

echo ================================================
echo  FT MFA Setup - Extract TOTP Secrets
echo ================================================
echo.
echo For each instance a Chrome window will open.
echo Complete the login, navigate to Account Security,
echo add a new authenticator and show the QR code.
echo The script extracts the secret automatically.
echo.
echo === Step 1/3: WS1 ===
node bin\setup-ft-mfa.mjs --instance=ws1
if %ERRORLEVEL% neq 0 ( echo WS1 FAILED & pause & exit /b 1 )
echo WS1 done.
echo.

echo === Step 2/3: QPRO1 ===
node bin\setup-ft-mfa.mjs --instance=qpro1
if %ERRORLEVEL% neq 0 ( echo QPRO1 FAILED & pause & exit /b 1 )
echo QPRO1 done.
echo.

echo === Step 3/3: QP2 ===
node bin\setup-ft-mfa.mjs --instance=qp2
if %ERRORLEVEL% neq 0 ( echo QP2 FAILED & pause & exit /b 1 )
echo QP2 done.
echo.

echo All TOTP secrets saved.
echo Testing auto-capture for all 3 instances...
node bin\capture-ft-session.mjs --instance=ws1
node bin\capture-ft-session.mjs --instance=qpro1
node bin\capture-ft-session.mjs --instance=qp2
echo.
echo Done. FT logins are now fully automatic.
pause
