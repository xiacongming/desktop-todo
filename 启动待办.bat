@echo off
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
if exist "release\win-unpacked\StickyTodo.exe" goto packaged
if exist "node_modules\electron\dist\electron.exe" goto dev
goto norun

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
echo   2) Use release\StickyTodo 1.0.0.exe directly.
echo.
pause
exit /b 1
