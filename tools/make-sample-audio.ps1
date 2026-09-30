# Generates a fake WhatsApp voice note in data/samples/note.ogg using the
# Windows voice plus ffmpeg, so you can test transcription without waiting
# for a real voice note.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-sample-audio.ps1
#   node src/index.js --simulate fixtures/sample-audio.json --live

param(
  [string]$Text = "Hi, we need three boxes of red and two cartons of white for tomorrow morning.",
  [string]$Out = "data\samples\note.ogg"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $root $Out
$wavPath = [System.IO.Path]::ChangeExtension($outPath, ".wav")

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outPath) | Out-Null

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

$voice = $synth.GetInstalledVoices() |
  Where-Object { $_.VoiceInfo.Culture.Name -like "it-*" } |
  Select-Object -First 1 |
  ForEach-Object { $_.VoiceInfo.Name }

if (-not $voice) {
  $voice = $synth.GetInstalledVoices() | Select-Object -First 1 -ExpandProperty VoiceInfo | Select-Object -ExpandProperty Name
  Write-Warning "No Italian voice installed: using '$voice'. The transcript may come out in another language."
} else {
  Write-Host "Using voice: $voice"
}

$synth.SelectVoice($voice)
$synth.SetOutputToWaveFile($wavPath)
$synth.Speak($Text)
$synth.Dispose()
Write-Host "WAV created: $wavPath"

# WhatsApp sends voice notes as ogg/opus: convert so the real format is tested
ffmpeg -hide_banner -loglevel error -y -i $wavPath -c:a libopus -b:a 32k -ar 48000 -ac 1 $outPath
Remove-Item $wavPath -Force

Write-Host "Sample voice note ready: $outPath"
Write-Host "Test:  node src/index.js --simulate fixtures/sample-audio.json --live"
