@echo off
:: Installs user-level Claude Code skills to %USERPROFILE%\.claude\skills\
:: Run once after cloning this repo.

set SKILLS_SRC=%~dp0user-skills
set SKILLS_DEST=%USERPROFILE%\.claude\skills

if not exist "%SKILLS_DEST%" (
    mkdir "%SKILLS_DEST%"
)

echo Installing promo-translation-html...
xcopy /E /I /Y "%SKILLS_SRC%\promo-translation-html" "%SKILLS_DEST%\promo-translation-html\" >nul

echo Installing promo-troubleshoot...
xcopy /E /I /Y "%SKILLS_SRC%\promo-troubleshoot" "%SKILLS_DEST%\promo-troubleshoot\" >nul

echo Installing update-tracker...
xcopy /E /I /Y "%SKILLS_SRC%\update-tracker" "%SKILLS_DEST%\update-tracker\" >nul

echo.
echo Done! Skills installed to %SKILLS_DEST%
echo Restart Claude Code to load the new skills.
