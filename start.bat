@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERRORE] Node.js non trovato nel PATH. Installa Node 20+ da https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo [!] File .env assente: lo creo copiando .env.example
  copy /y ".env.example" ".env" >nul
  echo [!] Aprilo e compila i valori prima di andare in produzione.
)

if not exist "node_modules" (
  echo [i] Installo le dipendenze...
  call npm install
  if errorlevel 1 (
    echo [ERRORE] npm install fallito
    pause
    exit /b 1
  )
)

echo [i] Avvio wa-categorizer... (Ctrl+C per fermare)
node src/index.js %*
endlocal
pause
