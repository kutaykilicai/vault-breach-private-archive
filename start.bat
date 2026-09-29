@echo off
chcp 65001 >nul
title V.A.U.L.T. // B.R.E.A.C.H.
cd /d "%~dp0"

powershell -NoProfile -Command "try { Invoke-WebRequest http://127.0.0.1:7777/api/config -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  start "" "http://127.0.0.1:7777"
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)

set VB_OPEN=1
node server\index.js
if errorlevel 1 pause
