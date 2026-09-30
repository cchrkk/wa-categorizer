@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
echo === Configuration check ===
node src/index.js --check
echo.
echo === Simulate a text message ===
node src/index.js --simulate fixtures/sample-text.json
echo.
echo === Simulate a voice note (uses Groq transcription) ===
if not exist "data\samples\note.ogg" (
  echo [i] Generating a sample voice note with the Windows voice...
  powershell -ExecutionPolicy Bypass -File tools\make-sample-audio.ps1
)
node src/index.js --simulate fixtures/sample-audio.json
echo.
echo === Live run: actions really executed ===
node src/index.js --simulate fixtures/sample-audio.json --live
endlocal
pause
