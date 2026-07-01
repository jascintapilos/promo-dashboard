@echo off
:: Installs user-level Claude Code skills + agents to %USERPROFILE%\.claude\
:: Run once after cloning this repo.

set SKILLS_SRC=%~dp0user-skills
set SKILLS_DEST=%USERPROFILE%\.claude\skills
set AGENTS_SRC=%~dp0.claude\agents
set AGENTS_DEST=%USERPROFILE%\.claude\agents

if not exist "%SKILLS_DEST%" (
    mkdir "%SKILLS_DEST%"
)

if not exist "%AGENTS_DEST%" (
    mkdir "%AGENTS_DEST%"
)

echo Installing promo-translation-html...
xcopy /E /I /Y "%SKILLS_SRC%\promo-translation-html" "%SKILLS_DEST%\promo-translation-html\" >nul

echo Installing promo-troubleshoot...
xcopy /E /I /Y "%SKILLS_SRC%\promo-troubleshoot" "%SKILLS_DEST%\promo-troubleshoot\" >nul

echo Installing update-tracker...
xcopy /E /I /Y "%SKILLS_SRC%\update-tracker" "%SKILLS_DEST%\update-tracker\" >nul

echo Installing agents (sentinel, promo-qc, promo-qc-engine, banner-pre-qc, banner-deep-qc, strategic-design-advisor)...
copy /Y "%AGENTS_SRC%\sentinel.md"                  "%AGENTS_DEST%\sentinel.md" >nul
copy /Y "%AGENTS_SRC%\promo-qc.md"                  "%AGENTS_DEST%\promo-qc.md" >nul
copy /Y "%AGENTS_SRC%\promo-qc-engine.md"            "%AGENTS_DEST%\promo-qc-engine.md" >nul
copy /Y "%AGENTS_SRC%\banner-pre-qc.md"              "%AGENTS_DEST%\banner-pre-qc.md" >nul
copy /Y "%AGENTS_SRC%\banner-deep-qc.md"             "%AGENTS_DEST%\banner-deep-qc.md" >nul
copy /Y "%AGENTS_SRC%\strategic-design-advisor.md"   "%AGENTS_DEST%\strategic-design-advisor.md" >nul

echo.
echo Done! Skills installed to %SKILLS_DEST%
echo       Agents installed to %AGENTS_DEST%
echo Restart Claude Code to load the new skills and agents.
