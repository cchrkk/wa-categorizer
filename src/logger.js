import pino from 'pino';

const level = process.env.LOG_LEVEL || 'info';
const pretty = String(process.env.LOG_PRETTY ?? 'true') !== 'false';

let transport;
if (pretty) {
  try {
    transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };
  } catch {
    transport = undefined;
  }
}

export const logger = pino({ level, transport });

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
