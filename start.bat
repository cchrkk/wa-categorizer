@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH. Install Node 20+ from https://nodejs.org
  pause
  exit /b 1
)

if not exist ".env" (
  echo [!] No .env file: creating it from .env.example
  copy /y ".env.example" ".env" >nul
  echo [!] Open it and fill in the values before going to production.
)

if not exist "node_modules" (
  echo [i] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed
    pause
    exit /b 1
  )
)

echo [i] Starting wafflow... (Ctrl+C to stop)
node src/index.js %*
endlocal
pause
