import fs from 'node:fs';
import path from 'node:path';
import { env, paths, VERSION } from './config.js';
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
const TICK_MS = 30 * 1000;
/**
 * Dopo tanto silenzio una sessione conta come "nuova": se si rompe ancora, si
 * avvisa di nuovo. Serve a non trasformare un guasto che dura giorni in un
 * messaggio ogni mezz'ora.
 */
export const FORGET_QUIET_MS = 30 * 60 * 1000;

const state = {
  startedAt: new Date().toISOString(),
  connected: false,
  connectedSince: null,
  lastMessageAt: null,
  messages: 0,
  failures: [],          // timestamp dei fallimenti dentro la finestra
  sessions: new Map(),   // sessione -> { count, firstAt, lastAt, alerted }
  totalFailures: 0,
  lastFailureAt: null,
  lastAddress: '',
};

/**
 * Conta un fallimento per sessione e dice se è il momento di avvisare.
 *
 * **Un avviso per sessione, non a raffica**: il primo che arriva racconta il
 * problema, il resto resta nei contatori. Se una sessione tace per mezz'ora
 * viene dimenticata, così un guasto nuovo torna a farsi sentire.
 *
 * Pura apposta: si testa senza mandare messaggi a nessuno.
 */
export function countFailureBySession(sessions, address, now, soglia = UNHEALTHY_FAILURES) {
  const chiave = address || 'unknown';
  const s = sessions.get(chiave) || { count: 0, firstAt: now, lastAt: now, alerted: false };
  s.count += 1;
  s.lastAt = now;
  const alert = !s.alerted && s.count >= soglia;
  if (alert) s.alerted = true;
  sessions.set(chiave, s);
  return { address: chiave, session: s, alert };
}

/** Dimentica le sessioni silenziose da un pezzo. Ritorna quante ne ha tolte. */
export function forgetQuietSessions(sessions, now, quietMs = FORGET_QUIET_MS) {
  let dimenticate = 0;
  for (const [chiave, s] of sessions) {
    if (now - s.lastAt > quietMs) {
      sessions.delete(chiave);
      dimenticate += 1;
    }
  }
  return dimenticate;
}

/**
 * Riprende le sessioni già segnalate dalla fotografia precedente.
 *
 * Senza questo, ogni riavvio ripartirebbe da zero e — siccome WhatsApp
 * riconsegna i messaggi su cui ha già fallito — **ogni deploy manderebbe un
 * avviso sulla stessa sessione**, che è la raffica che si voleva evitare, solo
 * spalmata nel tempo. Una sessione che taceva da mezz'ora invece si riascolta:
 * quello è un guasto nuovo.
 *
 * Pura anche questa, così si testa senza toccare il disco.
 */
export function restoreSessions(sessions, snap, now, quietMs = FORGET_QUIET_MS) {
  const salvate = snap && snap.decrypt && Array.isArray(snap.decrypt.sessions) ? snap.decrypt.sessions : [];
  let riprese = 0;
  for (const s of salvate) {
    const quando = Date.parse(s.lastAt);
    if (!s.address || !Number.isFinite(quando) || now - quando > quietMs) continue;
    sessions.set(s.address, {
      count: Number(s.count) || 0,
      firstAt: quando,
      lastAt: quando,
      alerted: Boolean(s.alerted),
    });
    riprese += 1;
  }
  return riprese;
}

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
    version: VERSION,
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
      sessions: [...state.sessions.entries()]
        .map(([address, s]) => ({ address, count: s.count, lastAt: new Date(s.lastAt).toISOString(), alerted: s.alerted }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
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
    if (snap.version) pezzi.push(`v${snap.version}`);
    pezzi.push(`connected=${snap.connected}`);
    pezzi.push(`paired=${snap.paired}`);
    pezzi.push(`messages=${snap.messages}`);
    pezzi.push(`undecryptable(10m)=${snap.decrypt.recent10m}`);
    if (snap.decrypt.sessions && snap.decrypt.sessions.length) {
      pezzi.push(`sessions=${snap.decrypt.sessions.map((s) => `${s.address}(${s.count}${s.alerted ? ',alerted' : ''})`).join(',')}`);
    }
    if (snap.lastMessageAt) pezzi.push(`last message=${snap.lastMessageAt}`);
  }
  console.log(`wa-categorizer: ${out} — ${pezzi.join(' ') || 'no data'}`);
  for (const r of reasons) console.log(`  - ${r}`);
  return ok ? 0 : 1;
}

/**
 * Un avviso, e uno solo per sessione: quando ci si è accorti del problema.
 * Sta zitto finché quella sessione non tace per mezz'ora e si rompe di nuovo.
 */
async function sendAlert(address, count) {
  if (!env.healthNotify || !env.telegramToken || !env.telegramChatId) return;
  const testo = [
    '⚠️ wa-categorizer is not decrypting',
    `• session ${address}: ${count} messages so far`,
    'WhatsApp is delivering messages this instance cannot read. It is not reading them.',
    'On the server:  docker compose exec wa-categorizer node src/index.js --health',
  ].join('\n');
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.telegramChatId, text: testo, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(env.actionTimeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    log.info({ session: address }, 'health alert sent to Telegram');
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
/**
 * Un messaggio che non siamo riusciti a decifrare.
 *
 * Non se ne logga uno per uno — cento righe non dicono niente che non dica un
 * numero — e non si avvisa a raffica: **un avviso per sessione**, la prima volta
 * che supera la soglia. Il resto sta nei contatori di `data/health.json`, che
 * `--health` legge.
 */
export function recordDecryptFailure(address = '') {
  const now = Date.now();
  state.failures.push(now);
  state.totalFailures += 1;
  state.lastFailureAt = new Date(now).toISOString();
  if (address) state.lastAddress = address;
  recentFailures(now);

  const { session, alert, address: chiave } = countFailureBySession(state.sessions, address, now);
  if (alert) {
    log.warn(
      { session: chiave, undecryptable: session.count },
      'a session is delivering messages that cannot be decrypted: this instance is not reading them',
    );
    void sendAlert(chiave, session.count);
  }
  writeHealth();
}

/**
 * libsignal stampa i suoi guai con console.* diretto: passa sopra il logger (e
 * sopra LOG_LEVEL), quindi riempie i log di stack trace che nessuno puo'
 * filtrare. Peggio: quattro di quelle stampe buttano dentro l'intera sessione,
 * **chiavi private comprese** — succede quando si invia, non dipende da
 * LOG_LEVEL, e finisce nei log del container.
 *
 * Qui si intercettano: i fallimenti di decifratura si contano (vedi
 * recordDecryptFailure), i dump di sessione si buttano — l'evento resta, il
 * materiale no — e tutto il resto passa intatto.
 */
const SESSION_DUMP = /^(Closing session|Opening session|Removing old closed session|Session already closed)/;
const BENIGN = /^(Decrypted message with closed session\.|Closing open session in favor of incoming prekey bundle)/;
const DECRYPT_CONTEXT = /Failed to decrypt message with any known session/;
const DECRYPT_ERROR = /Session error|MessageCounterError|Bad MAC/i;

/**
 * Cosa fare di una riga che arriva da console.*:
 *   {action:'drop'}            rumore noto — o un dump di sessione (chiavi comprese)
 *   {action:'count', address}  un fallimento di decifratura: si conta, non si stampa
 *   {action:'pass'}            tutto il resto
 *
 * È una funzione pura apposta: i test la interrogano direttamente, invece di
 * sostituire i console del processo che li sta eseguendo (cosa che, quando l'ho
 * fatta, ha ingoiato l'output del test stesso — e avrebbe ingoiato anche la
 * stampa di un'eccezione non gestita).
 */
export function classifyConsoleLine(args) {
  const primo = typeof args[0] === 'string' ? args[0] : '';
  const testo = args.map((a) => (a && a.stack ? a.stack : String(a))).join(' ');

  if (SESSION_DUMP.test(primo)) {
    return { action: 'drop', dump: true, event: primo.replace(/:$/, '') };
  }
  if (BENIGN.test(primo)) return { action: 'drop' };
  if (DECRYPT_CONTEXT.test(testo)) return { action: 'drop' }; // la riga di contesto: il conto lo fa quella con lo stack
  if (DECRYPT_ERROR.test(testo)) {
    const m = testo.match(/(\d{5,}\.\d+)\s*\[as awaitable\]/);
    return { action: 'count', address: m ? m[1] : '' };
  }
  return { action: 'pass' };
}

export function installLibsignalGuard() {
  if (installLibsignalGuard.done) return;
  installLibsignalGuard.done = true;

  for (const livello of ['log', 'info', 'warn', 'error']) {
    const originale = console[livello].bind(console);
    console[livello] = (...args) => {
      const v = classifyConsoleLine(args);
      if (v.action === 'drop') {
        // l'evento si vede a LOG_LEVEL=debug; le chiavi no, mai
        if (v.dump) log.debug({ libsignal: v.event }, 'session event (the dump carried private keys, dropped)');
        return;
      }
      if (v.action === 'count') {
        recordDecryptFailure(v.address);
        return;
      }
      originale(...args);
    };
  }
}

/** Installato una volta sola, all'avvio. */
export function startHealth() {
  installLibsignalGuard();
  // le sessioni già segnalate prima del riavvio restano segnalate: il backlog
  // che si ripresenta al reconnect non deve far ripartire l'avviso
  const riprese = restoreSessions(state.sessions, readSnapshot(), Date.now());
  if (riprese) log.debug({ riprese }, 'sessions already reported before the restart');
  writeHealth(true);
  const t = setInterval(() => {
    // le sessioni silenziose da mezz'ora si dimenticano: se si rompono di nuovo,
    // l'avviso torna a farsi sentire
    forgetQuietSessions(state.sessions, Date.now());
    writeHealth(true);
  }, TICK_MS);
  t.unref?.();
  return t;
}
