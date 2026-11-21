@echo off
setlocal
title EcoBI Intelligence — Plataforma Corporativa Local

echo =======================================================
echo  Iniciando EcoBI Intelligence (Release Piloto Windows)
echo =======================================================

cd /d "%~dp0\.."

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_ecobi.ps1" %*

if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao iniciar o EcoBI Intelligence. Verifique os logs em data\logs\ecobi.log.
    pause
    exit /b 1
)

endlocal
