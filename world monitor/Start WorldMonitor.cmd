@echo off
setlocal
cd /d "%~dp0"
start "WorldMonitor server" /min cmd /c "node server.js"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:4173"
