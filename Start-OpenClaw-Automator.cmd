@echo off
setlocal EnableExtensions

set "SCRIPT=%~dp0Start-OpenClaw-Automator.ps1"

if not exist "%SCRIPT%" (
  echo ERROR: "%SCRIPT%" was not found.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
