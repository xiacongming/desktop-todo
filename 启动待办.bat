@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
if exist "dist\win-unpacked\StickyTodo.exe" goto pdist
if exist "release-1.1.0\win-unpacked\StickyTodo.exe" goto p110
if exist "release-out\win-unpacked\StickyTodo.exe" goto pout
if exist "release\win-unpacked\StickyTodo.exe" goto pdef
if exist "node_modules\electron\dist\electron.exe" goto dev
goto norun

:pdist
start "" "dist\win-unpacked\StickyTodo.exe"
exit /b 0

:p110
start "" "release-1.1.0\win-unpacked\StickyTodo.exe"
exit /b 0

:pout
start "" "release-out\win-unpacked\StickyTodo.exe"
exit /b 0

:pdef
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
