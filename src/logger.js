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

export function childLogger(name) {
  return logger.child({ mod: name });
}
