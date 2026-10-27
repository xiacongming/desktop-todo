@echo off
rem üúLb*þ0 docs\screens5 W®¤ + " + ÍÐ’nB + 0¹*E
rem (ìËpnîU°0ž…žpn
cd /d "%~dp0.."
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
set "STICKY_SHOTS=%CD%\docs\screens"
"node_modules\electron\dist\electron.exe" --disable-gpu --no-sandbox --user-data-dir="%TEMP%\sticky-shot-ud" .
echo exit=%ERRORLEVEL%
