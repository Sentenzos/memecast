@echo off
cd /d "%~dp0"
node app.mjs
if errorlevel 1 pause
