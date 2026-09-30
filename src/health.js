import fs from 'node:fs';
import path from 'node:path';
import { env, paths } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('health');

/**
 * Salute del programma, in un file che anche un altro processo può leggere.
 *
 * Serve al caso che ci ha fatto perdere un pomeriggio: WhatsApp consegna
 * messaggi che non riusciamo a decifrare (sessione Signal disallineata), e da
 * fuori sembra tutto a posto — container verde, processo vivo — mentre il
 * programma è sordo su quel canale. Qui i fallimenti vengono contati, e
 * `--health` (che è anche l'HEALTHCHECK del container) li trasforma in un
 * giudizio: se non leggiamo, non siamo sani.
 */
const FILE = path.join(paths.data, 'health.json');

/** La finestra con cui si giudica, e la soglia oltre la quale non stiamo leggendo. */
export const WINDOW_MS = 10 * 60 * 1000;
export const UNHEALTHY_FAILURES = 10;
/** Se il file non viene aggiornato da cosi' tanto, il processo è bloccato. */
export const STALE_MS = 2 * 60 * 1000;
/** Un alert, se le cose restano rotte, al massimo ogni ora. */
const ALERT_EVERY_MS = 60 * 60 * 1000;
const TICK_MS = 30 * 1000;

const state = {
  startedAt: new Date().toISOString(),
  connected: false,
  connectedSince: null,
  lastMessageAt: null,
  messages: 0,
  failures: [],          // timestamp dei fallimenti dentro la finestra
  totalFailures: 0,
  lastFailureAt: null,
  lastAddress: '',
  lastAlertAt: 0,
  lastBurstLog: 0,
};

function recentFailures(now = Date.now()) {
  const cut = now - WINDOW_MS;
  while (state.failures.length && state.failures[0] < cut) state.failures.shift();
  return state.failures.length;
}

function paired() {
  try {
    return fs.existsSync(path.join(paths.auth, 'creds.json'));
  } catch {
    return false;
  }
}

/** Fotografia dei fatti: nessun giudizio, quello lo dà classify(). */
export function snapshot(now = Date.now()) {
  return {
    updatedAt: new Date(now).toISOString(),
    startedAt: state.startedAt,
    pid: process.pid,
    paired: paired(),
    connected: state.connected,
    connectedSince: state.connectedSince,
    lastMessageAt: state.lastMessageAt,
    messages: state.messages,
    decrypt: {
      total: state.totalFailures,
      recent10m: recentFailures(now),
      lastAt: state.lastFailureAt,
      lastAddress: state.lastAddress,
    },
  };
}

/**
 * Il giudizio. Separato dalla scrittura perche' lo usa anche `--health`, che
 * legge il file da un altro processo.
 */
export function classify(snap, now = Date.now()) {
  const reasons = [];
  if (!snap || !snap.updatedAt) {
    reasons.push('no health snapshot: the app has never written one');
    return { ok: false, reasons };
  }
  const eta = now - Date.parse(snap.updatedAt);
  if (eta > STALE_MS) {
    reasons.push(`the snapshot is ${Math.round(eta / 1000)}s old: the app looks stuck`);
  }
  if (!snap.connected && snap.paired) {
    reasons.push('not connected to WhatsApp');
  }
  if (snap.decrypt && snap.decrypt.recent10m >= UNHEALTHY_FAILURES) {
    const dove = snap.decrypt.lastAddress ? ` (session ${snap.decrypt.lastAddress})` : '';
    reasons.push(`${snap.decrypt.recent10m} messages could not be decrypted in the last 10 minutes${dove}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function readSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return null;
  }
}

/** Riga per `--health`: la usa l'HEALTHCHECK del container. */
export function runHealth() {
  const snap = readSnapshot();
  const { ok, reasons } = classify(snap);
  const out = ok ? 'healthy' : 'UNHEALTHY';
  const pezzi = [];
  if (snap) {
    pezzi.push(`connected=${snap.connected}`);
    pezzi.push(`paired=${snap.paired}`);
    pezzi.push(`messages=${snap.messages}`);
    pezzi.push(`undecryptable(10m)=${snap.decrypt.recent10m}`);
    if (snap.lastMessageAt) pezzi.push(`last message=${snap.lastMessageAt}`);
  }
  console.log(`wa-categorizer: ${out} — ${pezzi.join(' ') || 'no data'}`);
  for (const r of reasons) console.log(`  - ${r}`);
  return ok ? 0 : 1;
}

async function alertOnce(reasons, count) {
  if (!env.healthNotify || !env.telegramToken || !env.telegramChatId) return;
  const now = Date.now();
  if (now - state.lastAlertAt < ALERT_EVERY_MS) return;
  state.lastAlertAt = now;
  const testo = [
    '⚠️ wa-categorizer is not well',
    ...reasons.map((r) => `• ${r}`),
    '',
    count > 0 ? 'WhatsApp is delivering messages this instance cannot decrypt. It is not reading them.' : '',
    'On the server:  docker compose exec wa-categorizer node src/index.js --health',
  ].filter(Boolean).join('\n');
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.telegramChatId, text: testo, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(env.actionTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log.info('health alert sent to Telegram');
  } catch (err) {
    log.warn({ err: err.message }, 'could not send the health alert');
  }
}

let lastWrite = 0;
export function writeHealth(force = false) {
  const now = Date.now();
  if (!force && now - lastWrite < 5000) return;
  lastWrite = now;
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(snapshot(now), null, 1));
  } catch (err) {
    log.warn({ err: err.message }, 'could not write the health snapshot');
  }
}

export function markConnected(on, why = '') {
  const now = Date.now();
  if (on && !state.connected) state.connectedSince = new Date(now).toISOString();
  state.connected = Boolean(on);
  log.debug({ connected: state.connected, why }, 'health: connection state');
  writeHealth(true);
}

export function markMessage() {
  state.messages += 1;
  state.lastMessageAt = new Date().toISOString();
  writeHealth();
}

/**
 * Un messaggio che non siamo riusciti a decifrare.
 *
 * Non si logga uno per uno: se ne arrivano cento in due minuti, cento righe non
 * dicono niente che non dica un numero. Si tiene il conto e si scrive una riga
 * ogni mezzo minuto, con la sessione coinvolta.
 */
export function recordDecryptFailure(address = '') {
  const now = Date.now();
  state.failures.push(now);
  state.totalFailures += 1;
  state.lastFailureAt = new Date(now).toISOString();
  if (address) state.lastAddress = address;
  recentFailures(now);

  if (now - state.lastBurstLog > 30000) {
    state.lastBurstLog = now;
    log.warn(
      { undecryptable: state.failures.length, window: '10m', session: state.lastAddress || undefined },
      'messages arriving that cannot be decrypted: this instance is not reading them',
    );
  }
  writeHealth();
  void maybeCheck(now);
}

async function maybeCheck(now) {
  const recent = recentFailures(now);
  if (recent < UNHEALTHY_FAILURES) return;
  const { reasons } = classify(snapshot(now), now);
  await alertOnce(reasons, recent);
}

/**
 * libsignal stampa gli errori di decifratura con console.error diretto: passa
 * sopra il logger (e sopra LOG_LEVEL), quindi riempie i log di stack trace che
 * nessuno puo' filtrare. Qui li intercettiamo, li contiamo e lasciamo passare
 * tutto il resto.
 */
export function installDecryptWatcher() {
  if (installDecryptWatcher.done) return;
  installDecryptWatcher.done = true;

  const originale = console.error;
  console.error = (...args) => {
    const righe = args.map((a) => (a && a.stack ? a.stack : String(a)));
    const testo = righe.join(' ');
    if (/Failed to decrypt message with any known session|Decrypted message with closed session/i.test(testo)) {
      return; // la riga di contesto: il conteggio lo fa quella con lo stack
    }
    if (/Session error|MessageCounterError|Bad MAC/i.test(testo)) {
      const m = testo.match(/(\d{5,}\.\d+)\s*\[as awaitable\]/);
      recordDecryptFailure(m ? m[1] : '');
      return;
    }
    originale.apply(console, args);
  };
}

/** Installato una volta sola, all'avvio. */
export function startHealth() {
  installDecryptWatcher();
  writeHealth(true);
  const t = setInterval(() => writeHealth(true), TICK_MS);
  t.unref?.();
  return t;
}
