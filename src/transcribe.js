import fs from 'node:fs';
import path from 'node:path';
import { execFile, exec } from 'node:child_process';
import { promisify } from 'node:util';
import { env, paths } from './config.js';
import { childLogger } from './logger.js';
import { tmpPath } from './media.js';

const log = childLogger('transcribe');
const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = Number(process.env.TRANSCRIBE_TIMEOUT_MS || 180000);

export function transcribeBackendName() {
  return env.transcribeBackend;
}

export function assertTranscribeReady() {
  const b = env.transcribeBackend;
  if (b === 'none') return 'none';
  if (b === 'openai') {
    if (!env.openaiKey) throw new Error('TRANSCRIBE_BACKEND=openai ma OPENAI_API_KEY è vuota');
    return b;
  }
  if (b === 'command') {
    if (!env.transcribeCommand) throw new Error('TRANSCRIBE_BACKEND=command ma TRANSCRIBE_COMMAND è vuoto');
    return b;
  }
  throw new Error(`TRANSCRIBE_BACKEND sconosciuto: "${b}" (usa none|openai|command)`);
}

/** Converte in wav 16kHz mono con ffmpeg. Ritorna il percorso del wav. */
async function toWav(inputFile) {
  const out = tmpPath(`conv-${path.basename(inputFile, path.extname(inputFile))}`, 'wav');
  await execFileAsync(
    env.ffmpegBin,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', inputFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
    { timeout: COMMAND_TIMEOUT_MS, windowsHide: true },
  );
  return out;
}

async function transcribeCommand(inputFile) {
  const needsWav = env.transcribeCommand.includes('{wav}') && !inputFile.endsWith('.wav');
  let wav = '';
  if (needsWav) {
    try {
      wav = await toWav(inputFile);
    } catch (err) {
      log.warn({ err: err.message }, 'ffmpeg non disponibile o conversione fallita: passo il file originale');
      wav = inputFile;
    }
  }
  const cmd = env.transcribeCommand
    .replaceAll('{input}', `"${inputFile}"`)
    .replaceAll('{wav}', `"${wav || inputFile}"`)
    .replaceAll('{language}', env.language || 'auto');

  const { stdout, stderr } = await execAsync(cmd, {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (stderr && !stdout.trim()) {
    log.debug({ stderr: stderr.slice(0, 500) }, 'stderr del comando di trascrizione');
  }
  return cleanTranscript(stdout);
}

async function transcribeOpenAI(inputFile) {
  const buffer = fs.readFileSync(inputFile);
  const form = new FormData();
  form.append('file', new Blob([buffer]), path.basename(inputFile));
  form.append('model', env.openaiTranscribeModel);
  form.append('response_format', 'json');
  if (env.language) form.append('language', env.language);

  const res = await fetch(`${env.openaiBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`trascrizione HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return cleanTranscript(data.text || '');
}

function cleanTranscript(raw) {
  return String(raw || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[\d:.\->\s]+\]$/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Trascrive un file audio. Ritorna { text, backend, ms } oppure null se backend=none.
 */
export async function transcribe(file) {
  if (env.transcribeBackend === 'none') {
    log.info('trascrizione disattivata (TRANSCRIBE_BACKEND=none)');
    return null;
  }
  if (!file || !fs.existsSync(file)) throw new Error(`file audio non trovato: ${file}`);

  const started = Date.now();
  const text =
    env.transcribeBackend === 'openai'
      ? await transcribeOpenAI(file)
      : await transcribeCommand(file);
  const ms = Date.now() - started;
  log.info({ ms, chars: text.length, backend: env.transcribeBackend }, 'vocale trascritto');
  if (!text) return { text: '', backend: env.transcribeBackend, ms };
  return { text, backend: env.transcribeBackend, ms };
}

export const _internals = { cleanTranscript, paths };
