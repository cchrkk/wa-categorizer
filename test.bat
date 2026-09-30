@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Controllo configurazione ===
node src/index.js --check
echo.
echo === Simulazione messaggio di testo ===
node src/index.js --simulate fixtures/sample-text.json
echo.
echo === Simulazione vocale (con trascrizione Groq) ===
if not exist "data\samples\nota.ogg" (
  echo [i] Genero un vocale di prova con la voce di Windows...
  powershell -ExecutionPolicy Bypass -File tools\make-sample-audio.ps1
)
node src/index.js --simulate fixtures/sample-audio.json
echo.
echo === Prova live: azioni eseguite davvero ===
node src/index.js --simulate fixtures/sample-audio.json --live
endlocal
pause
