@echo off
title Hearts of Iron IV - Standalone
cd /d "%~dp0"

echo =======================================================================
echo          HEARTS OF IRON IV - STANDALONE DESKTOP ENGINE
echo =======================================================================
echo [1/2] Verificando servidor local do jogo...

netstat -ano | findstr ":8080" | findstr "LISTENING" >nul
if %errorlevel% neq 0 (
    echo [*] Iniciando servidor do Clausewitz Engine...
    start /b "" node server\server.js
    timeout /t 2 /nobreak >nul
) else (
    echo [*] Servidor do jogo ja esta ativo na porta 8080.
)

echo [2/2] Abrindo cliente 3D standalone em tela cheia...
where msedge >nul 2>&1
if %errorlevel% equ 0 (
    start "" msedge.exe --app="http://localhost:8080" --start-fullscreen
    goto :done
)

where chrome >nul 2>&1
if %errorlevel% equ 0 (
    start "" chrome.exe --app="http://localhost:8080" --start-fullscreen
    goto :done
)

start "" http://localhost:8080

:done
echo [*] Hearts of Iron IV iniciado com sucesso!
exit /b 0
