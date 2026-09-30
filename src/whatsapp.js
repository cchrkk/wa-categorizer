import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  getContentType,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'node:fs';
import { paths } from './config.js';
import { baileysLogger, childLogger } from './logger.js';
import { extFromMimetype, saveBuffer } from './media.js';
import {
  alternateJid,
  flushContacts,
  nameFor,
  rememberChat,
  rememberContact,
  setSelf,
} from './contacts.js';

const log = childLogger('wa');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPE_MAP = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
  contactMessage: 'contact',
  contactsArrayMessage: 'contact',
  locationMessage: 'location',
  liveLocationMessage: 'location',
  reactionMessage: 'reaction',
  protocolMessage: 'protocol',
  pollCreationMessage: 'poll',
  pollCreationMessageV2: 'poll',
  pollCreationMessageV3: 'poll',
  ptvMessage: 'video',
  eventMessage: 'event',
};

const WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
];

/** Srotola i wrapper (effimeri, view-once, ...) fino al contenuto reale. */
export function unwrapMessage(message) {
  let current = message;
  let guard = 0;
  while (current && guard++ < 10) {
    const key = WRAPPER_KEYS.find((k) => current[k]?.message);
    if (!key) break;
    current = current[key].message;
  }
  return current;
}

function extractText(inner, type) {
  switch (type) {
    case 'text':
      return inner.conversation ?? inner.extendedTextMessage?.text ?? '';
    case 'image':
    case 'video':
      return inner.imageMessage?.caption ?? inner.videoMessage?.caption ?? '';
    case 'document':
      return inner.documentMessage?.caption ?? inner.documentWithCaptionMessage?.message?.documentMessage?.caption ?? '';
    default:
      return inner.conversation ?? inner.extendedTextMessage?.text ?? '';
  }
}

function extractMimetype(inner, type) {
  switch (type) {
    case 'audio':
      return inner.audioMessage?.mimetype;
    case 'image':
      return inner.imageMessage?.mimetype;
    case 'video':
      return inner.videoMessage?.mimetype;
    case 'document':
      return inner.documentMessage?.mimetype ?? inner.documentWithCaptionMessage?.message?.documentMessage?.mimetype;
    case 'sticker':
      return inner.stickerMessage?.mimetype;
    default:
      return undefined;
  }
}

/**
 * Trasforma il messaggio Baileys in una forma normalizzata e stabile.
 *
 * `chatJidAlt` / `senderJidAlt` portano la forma alternativa dello stesso contatto
 * (numero di telefono <-> LID @lid), quando la rubrica la conosce: le regole possono
 * così usare indifferentemente il numero che conosci tu.
 */
export function normalizeMessage(raw, { chatName = '', senderName = '', chatJidAlt = '', senderJidAlt = '' } = {}) {
  const key = raw.key || {};
  const inner = unwrapMessage(raw.message) || {};
  const contentType = getContentType(inner);
  const type = TYPE_MAP[contentType] || (contentType ? 'other' : 'empty');
  const chatJid = key.remoteJid || '';
  const isGroup = chatJid.endsWith('@g.us');
  const senderJid = (isGroup ? key.participant : key.remoteJid) || '';

  const audioMessage = inner.audioMessage || {};
  const docMessage = inner.documentMessage || inner.documentWithCaptionMessage?.message?.documentMessage;
  const displayName = senderName || raw.pushName || '';

  return {
    id: key.id,
    raw,
    chatJid,
    chatJidAlt: chatJidAlt || alternateJid(chatJid),
    chatName: chatName || nameFor(chatJid, alternateJid(chatJid)) || (isGroup ? chatJid : chatJid.split('@')[0]),
    isGroup,
    senderJid,
    senderJidAlt: senderJidAlt || alternateJid(senderJid),
    senderName: displayName,
    fromMe: Boolean(key.fromMe),
    type,
    contentType,
    text: extractText(inner, type),
    caption: '',
    mediaMimetype: extractMimetype(inner, type),
    ptt: Boolean(audioMessage.ptt),
    fileName: docMessage?.fileName || undefined,
    seconds: audioMessage.seconds || undefined,
    timestamp: Number(raw.messageTimestamp || 0) * 1000 || Date.now(),
  };
}

const MEDIA_TYPES = new Set(['audio', 'image', 'video', 'document', 'sticker']);

/**
 * Garanzia di sola lettura: rende irraggiungibili i metodi che scrivono su WhatsApp
 * o che rivelano la tua presenza. È una rete di sicurezza in più oltre a non
 * chiamare mai questi metodi nel codice dell'app.
 */
export function enforceReadOnly(sock, { allowReply }) {
  const blocked = (what) => async () => {
    throw new Error(`read-only mode: ${what} bloccato`);
  };
  // Nessuna ricevuta di lettura, mai.
  sock.readMessages = blocked('readMessages()');
  // Nessuna presenza inviata (online / typing / last seen lato tuo).
  sock.sendPresenceUpdate = async (...args) => {
    log.debug({ presence: args[0] }, 'presence blocked (read-only)');
    return undefined;
  };
  // Nessun invio di messaggi, a meno che non sia esplicitamente consentito.
  if (!allowReply) sock.sendMessage = blocked('sending messages');
  return sock;
}

/**
 * Avvia il client WhatsApp con riconnessione automatica.
 * onMessage(msgNormalizzato, { sock, downloadMedia }) viene chiamato per ogni messaggio in arrivo.
 *
 * Modalità solo lettura: markOnlineOnConnect=false (nessuna presenza all'avvio),
 * nessuna ricevuta di lettura, nessuna presenza inviata.
 */
export function startWhatsApp({ onMessage, onQr, onState = () => {}, allowReply = false }) {
  let sock = null;
  let stopped = false;
  const groupNames = new Map();
  let resolveReady;
  const ready = new Promise((r) => { resolveReady = r; });

  async function resolveChatName(jid, isGroup, msg) {
    if (!isGroup) {
      return nameFor(jid, alternateJid(jid)) || msg?.pushName || jid.split('@')[0];
    }
    if (groupNames.has(jid)) return groupNames.get(jid);
    try {
      const meta = await sock.groupMetadata(jid);
      groupNames.set(jid, meta.subject);
      setTimeout(() => groupNames.delete(jid), 30 * 60 * 1000).unref?.();
      return meta.subject;
    } catch {
      groupNames.set(jid, nameFor(jid) || jid);
      return groupNames.get(jid);
    }
  }

  async function handleUpsert({ messages, type }) {
    if (type !== 'notify') return; // 'append' = cronologia, la ignoriamo
    for (const raw of messages) {
      try {
        if (!raw.message || raw.key?.remoteJid === 'status@broadcast') continue;
        const inner = unwrapMessage(raw.message);
        if (!inner || Object.keys(inner).length === 0) continue;
        const contentType = getContentType(inner);
        if (!contentType || contentType === 'protocolMessage' || contentType === 'reactionMessage') continue;

        const isGroup = String(raw.key?.remoteJid || '').endsWith('@g.us');
        const chatName = await resolveChatName(raw.key.remoteJid, isGroup, raw);
        const senderJid = (isGroup ? raw.key.participant : raw.key.remoteJid) || '';
        const msg = normalizeMessage(raw, {
          chatName,
          senderName: nameFor(senderJid) || raw.pushName || '',
        });

        const downloadMedia = async () => {
          if (!MEDIA_TYPES.has(msg.type)) return null;
          const buffer = await downloadMediaMessage(raw, 'buffer', {}, {
            logger: baileysLogger,
            reuploadRequest: sock.updateMediaMessage,
          });
          return saveBuffer(buffer, {
            subdir: msg.type,
            basename: `${msg.type}-${msg.id}`,
            extension: extFromMimetype(msg.mediaMimetype, msg.type === 'audio' ? 'ogg' : 'bin'),
          });
        };

        await onMessage(msg, { sock, downloadMedia });
      } catch (err) {
        log.error({ err: err.message, id: raw.key?.id }, 'error while handling the message');
      }
    }
  }

  /**
   * Chiude DAVVERO il socket precedente.
   * Senza questo il vecchio socket resta vivo, WhatsApp vede due connessioni con le
   * stesse credenziali e le sostituisce a vicenda all'infinito (errore 440).
   */
  function teardown() {
    const old = sock;
    sock = null;
    if (!old) return;
    try {
      old.ev.removeAllListeners('connection.update');
      old.ev.removeAllListeners('messages.upsert');
      old.ev.removeAllListeners('creds.update');
      old.ev.removeAllListeners('groups.update');
      old.ev.removeAllListeners('contacts.upsert');
      old.ev.removeAllListeners('contacts.update');
      old.ev.removeAllListeners('chats.upsert');
      old.ev.removeAllListeners('chats.update');
      old.ev.removeAllListeners('messaging-history.set');
    } catch { /* ignore */ }
    try { old.end(undefined); } catch { /* ignore */ }
    try { old.ws?.close(); } catch { /* ignore */ }
  }

  async function connectOnce() {
    teardown(); // mai due socket vivi insieme sulle stesse credenziali
    if (!fs.existsSync(paths.auth)) fs.mkdirSync(paths.auth, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(paths.auth);
    const { version } = await fetchLatestBaileysVersion();

    const s = makeWASocket({
      version,
      auth: state,
      logger: baileysLogger,
      browser: Browsers.macOS('Chrome'),
      // SOLO LETTURA: non ci si dichiara online alla connessione.
      // Con questo false Baileys non invia nessuno stanza di presenza:
      // per WhatsApp resti "offline" come se non avessi aperto l'app.
      markOnlineOnConnect: false,
      // Non scarica la cronologia: scarica solo i messaggi che arrivano da ora.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });

    sock = s;
    enforceReadOnly(s, { allowReply });

    s.ev.on('creds.update', saveCreds);
    s.ev.on('messages.upsert', handleUpsert);
    s.ev.on('groups.update', (updates) => {
      for (const u of updates) if (u.id && u.subject) groupNames.set(u.id, u.subject);
    });

    // Rubrica: tiene insieme LID <-> numero di telefono <-> nome.
    s.ev.on('contacts.upsert', (list) => list.forEach(rememberContact));
    s.ev.on('contacts.update', (list) => list.forEach(rememberContact));
    s.ev.on('chats.upsert', (list) => list.forEach(rememberChat));
    s.ev.on('chats.update', (list) => list.forEach(rememberChat));
    s.ev.on('messaging-history.set', ({ contacts = [], chats = [] } = {}) => {
      contacts.forEach(rememberContact);
      chats.forEach(rememberChat);
    });

    // La promise si risolve quando la connessione SI CHIUDE, non quando si apre:
    // altrimenti il loop riaprirebbe subito un secondo socket sulle stesse credenziali.
    return new Promise((resolve) => {
      let opened = false;
      s.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          log.info('scansiona il QR con WhatsApp > Dispositivi collegati');
          qrcode.generate(qr, { small: true });
          onQr?.(qr);
        }
        if (connection === 'open') {
          // Solo la prima connessione merita una riga: le riconnessioni si
          // vedono già dal "connessione persa" che le precede.
          if (!opened) {
            opened = true;
            log.info('connected to WhatsApp');
            resolveReady();
          } else {
            log.debug('connection restored');
          }
          setSelf(s.user);
          onState('open');
        }
        if (connection === 'close') {
          const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          onState(loggedOut ? 'loggedOut' : 'close', statusCode);
          resolve({ statusCode, loggedOut, opened });
        }
      });
    });
  }

  const { connectionReplaced, restartRequired, connectionLost, connectionClosed, timedOut, unavailableService } = DisconnectReason;

  // Cadute che WhatsApp fa da solo quando ricicla la connessione: capitano ogni
  // tanto e si risolvono da sole. Merita una riga, non un allarme.
  const CADUTE_BANALI = new Set([connectionClosed, connectionLost, timedOut, unavailableService]);

  function backoffMs(statusCode, attempt) {
    // 440 = un'altra sessione con le stesse credenziali: insistere subito fa solo
    // ripartire la guerra tra le due, quindi attesa lunga.
    if (statusCode === connectionReplaced) return Math.min(120000, 15000 * 2 ** Math.min(attempt - 1, 3));
    // 515 = riavvio richiesto dal server: riconnessione immediata, è normale.
    if (statusCode === restartRequired) return 250;
    if ([connectionLost, connectionClosed, timedOut].includes(statusCode)) {
      return Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
    }
    return Math.min(30000, 2000 * 2 ** Math.min(attempt, 5));
  }

  async function loop() {
    let attempt = 0;
    let replacedStrikes = 0;

    while (!stopped) {
      try {
        const { statusCode, loggedOut, opened } = await connectOnce();

        if (loggedOut) {
          stopped = true;
          onState('fatal');
          log.error(`session closed by WhatsApp (loggedOut). Delete the folder "${paths.auth}" and restart to pair again.`);
          return;
        }

        if (statusCode === connectionReplaced) {
          replacedStrikes += 1;
          log.error(
            `connection replaced (440, attempt ${replacedStrikes}/4): another session is using ` +
            `the same credentials in "${paths.auth}".`,
          );
          if (replacedStrikes > 3) {
            stopped = true;
            onState('fatal');
            log.error(
              'repeated 440: close the other instance of this program (or the WhatsApp Web session opened ' +
              'with the same number) and restart. No other process may use the same auth/ folder.',
            );
            return;
          }
        } else {
          replacedStrikes = 0;
        }

        // attempt riparte da 0 dopo una connessione sana: non è un contatore
        // di tentativi "veri", quindi non va mostrato (prima stampava
        // "tentativo 0", che non voleva dire niente).
        attempt = opened ? 0 : attempt + 1;
        const delay = backoffMs(statusCode, attempt);
        const line = `connection lost (code ${statusCode}), retrying in ${(delay / 1000).toFixed(1)}s`;
        if (CADUTE_BANALI.has(statusCode)) log.info(line);
        else log.warn(line);
        await sleep(delay);
      } catch (err) {
        attempt += 1;
        const delay = backoffMs(0, attempt);
        log.warn(`reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${attempt}): ${err.message}`);
        await sleep(delay);
      }
    }
  }

  const run = loop();

  return {
    get sock() { return sock; },
    ready,
    run,
    stop() { stopped = true; teardown(); },
  };
}
