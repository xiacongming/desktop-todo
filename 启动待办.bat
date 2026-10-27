@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
if exist "release-out\win-unpacked\StickyTodo.exe" goto packagedout
if exist "release\win-unpacked\StickyTodo.exe" goto packaged
if exist "node_modules\electron\dist\electron.exe" goto dev
goto norun

:packagedout
start "" "release-out\win-unpacked\StickyTodo.exe"
exit /b 0

:packaged
start "" "release\win-unpacked\StickyTodo.exe"
exit /b 0

:dev
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:norun
echo.
echo   Runtime not found.
echo   1) Run "npm install" then "npm run build", or
echo   2) Download the installer from GitHub Releases.
echo.
pause
exit /b 1
