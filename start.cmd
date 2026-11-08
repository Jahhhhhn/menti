@echo off
rem Menti starten (Windows). Optional: Port als Argument, z. B. start.cmd 9000
cd /d "%~dp0"
java src\Menti.java %*
pause
