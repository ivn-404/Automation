@echo off
setlocal EnableExtensions
title SGAP setup
rem Served by the SGAP server at /agent/setup.cmd with the server and repository filled in.
set "SGAP_SERVER=__SGAP_SERVER__"
set "SGAP_REPO=__SGAP_REPO__"
set "SGAP_HOME=%USERPROFILE%\SGAP-Automation"

echo.
echo  SGAP setup - tests you start on %SGAP_SERVER% will run on this PC.
echo  Folder: %SGAP_HOME%
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo winget is missing. Install "App Installer" from the Microsoft Store, then run this file again.
  goto :fail
)

where git >nul 2>nul || call :install Git.Git "Git"
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" >nul 2>nul || call :install OpenJS.NodeJS.LTS "Node.js"
where java >nul 2>nul || call :install EclipseAdoptium.Temurin.17.JRE "Java (for Allure reports)"

rem Fresh installs are not on this window's PATH yet.
set "PATH=%ProgramFiles%\Git\cmd;%ProgramFiles%\nodejs;%PATH%"
for /d %%J in ("%ProgramFiles%\Eclipse Adoptium\jre-17*") do set "PATH=%%~J\bin;%PATH%"

where git >nul 2>nul || (echo Git is still missing. Restart the PC and run this file again. & goto :fail)
where node >nul 2>nul || (echo Node.js is still missing. Restart the PC and run this file again. & goto :fail)

if exist "%SGAP_HOME%\.git" (
  echo Updating the SGAP project...
  git -C "%SGAP_HOME%" pull --ff-only || goto :fail
) else (
  if exist "%SGAP_HOME%" (
    echo %SGAP_HOME% exists but is not the SGAP project. Rename or delete it, then run this file again.
    goto :fail
  )
  echo Downloading the SGAP project...
  git clone "%SGAP_REPO%" "%SGAP_HOME%" || goto :fail
)

cd /d "%SGAP_HOME%" || goto :fail
echo Installing packages (first time takes a few minutes)...
call npx --yes pnpm install || goto :fail
echo Installing the test browser...
call npx --yes playwright install chromium || goto :fail

echo.
node scripts\qa-agent.mjs setup --server "%SGAP_SERVER%" || goto :fail

echo.
echo  Done. Keep the "SGAP Agent" window open, then on the dashboard choose
echo  "Run on: My PC" and press Run. It starts by itself when you sign in to Windows.
echo.
pause
exit /b 0

:install
echo Installing %~2...
winget install -e --id %1 --accept-package-agreements --accept-source-agreements --silent
exit /b 0

:fail
echo.
echo  Setup did not finish. Send a screenshot of this window to your SGAP admin.
echo.
pause
exit /b 1
