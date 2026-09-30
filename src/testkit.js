import path from 'node:path';
import { paths } from './config.js';
import { alternateJid } from './contacts.js';

/**
 * Costruisce un messaggio normalizzato finto, con la stessa forma di quelli
 * veri di whatsapp.js. Usato da `--simulate` e dal pannello web: entrambi
 * passano dal vero motore delle regole, non da una sua imitazione.
 */
export function buildTestMessage(partial = {}) {
  const chatJid = partial.chatJid || '390000000000@s.whatsapp.net';
  const senderJid = partial.senderJid || '390000000001@s.whatsapp.net';
  const type = partial.type || 'text';

  const mediaFile = partial.mediaFile
    ? (path.isAbsolute(partial.mediaFile) ? partial.mediaFile : path.join(paths.root, partial.mediaFile))
    : null;

  return {
    id: partial.id || `test-${Date.now()}`,
    raw: { key: { id: partial.id || 'test', remoteJid: chatJid } },
    chatJid,
    chatJidAlt: alternateJid(chatJid) || undefined,
    chatName: partial.chatName || 'Test chat',
    isGroup: Boolean(partial.isGroup),
    senderJid,
    senderJidAlt: alternateJid(senderJid) || undefined,
    senderName: partial.senderName || 'Test sender',
    fromMe: Boolean(partial.fromMe),
    type,
    text: partial.text || '',
    ptt: Boolean(partial.ptt),
    mediaMimetype: partial.mediaMimetype || (type === 'audio' ? 'audio/ogg; codecs=opus' : undefined),
    mediaFile,
    timestamp: Date.now(),
  };
}
