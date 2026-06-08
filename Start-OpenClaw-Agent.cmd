@echo off
setlocal EnableExtensions

set "SCRIPT=%~dp0Start-OpenClaw-Agent.ps1"

if not exist "%SCRIPT%" (
  echo ERROR: "%SCRIPT%" was not found.
  pause
  exit /b 1
)

fltmc >nul 2>nul
if errorlevel 1 (
  echo Requesting administrator privileges for OpenClaw Agent Gateway...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath PowerShell.exe -Verb RunAs -ArgumentList '-NoExit','-NoProfile','-ExecutionPolicy','Bypass','-File','\"%SCRIPT%\"'"
  exit /b
)

powershell -NoExit -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
