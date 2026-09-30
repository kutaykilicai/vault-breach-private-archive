@echo off
chcp 65001 >nul
title V.A.U.L.T. // Obsidian beynini aktar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [HATA] Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun.
  pause
  exit /b 1
)

echo.
echo   Obsidian beynini kasaya aktarma
echo   ------------------------------------------------------------
echo   Obsidian tarafi SALT OKUNUR: hicbir dosyan degismez, silinmez.
echo.

set "KAYNAK=%~1"
if "%KAYNAK%"=="" set /p KAYNAK=Obsidian klasoru [I:\Obsidian_Vault\Claude_Vault]: 
if "%KAYNAK%"=="" set "KAYNAK=I:\Obsidian_Vault\Claude_Vault"

echo.
echo   1/2  ONIZLEME - hicbir sey yazilmayacak
echo   ------------------------------------------------------------
node scripts\obsidian-import.js --source "%KAYNAK%" --vault auto --dry-run
if errorlevel 2 (
  pause
  exit /b 1
)

echo.
set /p ONAY=Yukaridaki ozet dogru mu? Aktarmak icin E yazip Enter'a bas: 
if /i not "%ONAY%"=="E" (
  echo   Iptal edildi, hicbir sey yazilmadi.
  pause
  exit /b 0
)

echo.
echo   2/2  AKTARIM
echo   ------------------------------------------------------------
node scripts\obsidian-import.js --source "%KAYNAK%" --vault auto

echo.
echo   Bitti. Uygulamadaki Hafiza panelinde yeniden tarama dugmesine bas.
pause
