@echo off
setlocal
cd /d "%~dp0"
call pnpm start
if errorlevel 1 pause
