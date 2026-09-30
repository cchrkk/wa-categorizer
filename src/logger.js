import pino from 'pino';
import { Writable } from 'node:stream';

const level = process.env.LOG_LEVEL || 'info';
const pretty = String(process.env.LOG_PRETTY ?? 'true') !== 'false';

/**
 * Le ultime righe di log, tenute in memoria.
 *
 * Servono a due cose: leggere i log dal pannello invece che solo da
 * `docker logs`, e mostrare cosa ha scritto il programma durante un test a
 * vuoto — che altrimenti finisce solo nel terminale, dove non lo guarda
 * nessuno.
 */
const RING_MAX = 500;
const ring = [];

function voce(chunk) {
  const testo = String(chunk).trimEnd();
  if (!testo) return null;
  // pino scrive JSON: si tiene l'oggetto, così il pannello può mostrare i campi
  try {
    return JSON.parse(testo);
  } catch {
    return { msg: testo };
  }
}

const ringStream = new Writable({
  write(chunk, _enc, cb) {
    for (const line of String(chunk).split('\n')) {
      const v = voce(line);
      if (v) ring.push(v);
    }
    while (ring.length > RING_MAX) ring.shift();
    cb();
  },
});

/** Segnaposto: le righe scritte DA QUI in poi sono quelle di un test. */
export function markLogs() {
  return ring.length;
}

/** Le righe scritte dopo il segnaposto. */
export function logsSince(mark) {
  const quante = ring.length - mark;
  if (quante <= 0) return [];
  return ring.slice(-quante);
}

/** Le ultime `n` righe. */
export function recentLogs(n = 200) {
  return ring.slice(-Math.max(1, Math.min(RING_MAX, n)));
}

/**
 * Dove finisce il log. In modalità "pretty" una riga per evento, senza pid e
 * hostname — che a chi legge non dicono niente — e senza colori se l'output non
 * è un terminale: nel log di un container gli escape ANSI sono solo rumore.
 */
function destination() {
  if (!pretty) return process.stdout;
  try {
    return pino.transport({
      target: 'pino-pretty',
      options: {
        colorize: Boolean(process.stdout.isTTY),
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
      },
    });
  } catch {
    return process.stdout;
  }
}

export const logger = pino(
  { level },
  pino.multistream([{ stream: destination() }, { stream: ringStream }]),
);

/** Logger silenzioso per Baileys (evita il rumore di default). */
export const silentLogger = pino({ level: 'silent' });

/**
 * Il logger che si passa a Baileys.
 *
 * Normalmente deve tacere: le sue righe di debug sono migliaia. Ma quando
 * qualcosa non torna — messaggi che non si decifrano, retry, sessioni — quelle
 * righe sono l'unico modo per capire cosa sta succedendo, e senza di loro si
 * finisce a indovinare. Con LOG_LEVEL=debug passano.
 */
export const baileysLogger = level === 'debug' ? logger : silentLogger;

export function childLogger(name) {
  return logger.child({ mod: name });
}
