# Genera un finto vocale WhatsApp in data/samples/nota.ogg usando la voce di Windows
# + ffmpeg, così puoi testare la trascrizione senza aspettare un vocale vero.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-sample-audio.ps1
#   node src/index.js --simulate data/sample-audio.json --live

param(
  [string]$Text = "Ciao, servono tre casse di vino rosso e due cartoni di bianco per domani mattina.",
  [string]$Out = "data\samples\nota.ogg"
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
  Write-Warning "Nessuna voce italiana installata: uso '$voice'. La trascrizione potrebbe uscire in un'altra lingua."
} else {
  Write-Host "Voce usata: $voice"
}

$synth.SelectVoice($voice)
$synth.SetOutputToWaveFile($wavPath)
$synth.Speak($Text)
$synth.Dispose()
Write-Host "WAV creato: $wavPath"

# WhatsApp manda i vocali in ogg/opus: convertiamo per testare il formato reale
ffmpeg -hide_banner -loglevel error -y -i $wavPath -c:a libopus -b:a 32k -ar 48000 -ac 1 $outPath
Remove-Item $wavPath -Force

Write-Host "Vocale di prova pronto: $outPath"
Write-Host "Test:  node src/index.js --simulate data/sample-audio.json --live"
