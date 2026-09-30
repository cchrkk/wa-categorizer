import path from 'node:path';
import { paths } from './config.js';
import { alternateJid, selfJids } from './contacts.js';

/**
 * In the rules `"@me"` means your own account, and it must work here too.
 * Otherwise the panel could not test exactly the rules the documentation
 * tells you to write — `senderJid: "@me"` in the notes-to-yourself and home
 * command examples — and the test bench would report a failure that does not
 * exist in real life.
 *
 * Resolves to the real jid so that the comparison inside matchesJid() has
 * something to compare: it expands "@me" through selfJids(), it does not treat
 * the literal string as a jid.
 */
function resolveJid(value, where) {
  if (typeof value !== 'string') return value;
  if (value.trim().toLowerCase() !== '@me') return value;

  const mine = selfJids();
  if (!mine.length) {
    const err = new Error(
      `"@me" (${where}): this instance has not paired with WhatsApp yet, so it does not know ` +
      'which account is yours. Pair it once, or put the real jid — `npm run contacts` prints it.',
    );
    err.status = 400;
    throw err;
  }
  return mine[0];
}

/**
 * Costruisce un messaggio normalizzato finto, con la stessa forma di quelli
 * veri di whatsapp.js. Usato da `--simulate` e dal pannello web: entrambi
 * passano dal vero motore delle regole, non da una sua imitazione.
 */
export function buildTestMessage(partial = {}) {
  const chatJid = resolveJid(partial.chatJid, 'chatJid') || '390000000000@s.whatsapp.net';
  const senderJid = resolveJid(partial.senderJid, 'senderJid') || '390000000001@s.whatsapp.net';
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
