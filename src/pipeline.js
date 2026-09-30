import { ruleMatches, classifyAllows } from './rules.js';
import { classify } from './classify.js';
import { runActions } from './actions.js';
import { transcribe } from './transcribe.js';
import { deleteMedia } from './media.js';
import { childLogger } from './logger.js';
import { appendMessage, bump, hasSeen, markSeen } from './store.js';

const log = childLogger('pipeline');

const isMediaType = (t) => ['audio', 'image', 'video', 'document', 'sticker'].includes(t);

/**
 * Cuore dell'app: dato un messaggio normalizzato, decide quali regole scattano
 * e ne esegue le azioni.
 *
 * @param {object} opts
 * @param {object} opts.config      config caricata da loadConfig()
 * @param {object} opts.msg         messaggio normalizzato (src/whatsapp.js)
 * @param {Function} [opts.send]    funzione per inviare messaggi (solo azione "reply", off di default)
 * @param {Function} [opts.downloadMedia] async -> percorso file del media scaricato
 * @param {boolean} [opts.dryRun]   se true non esegue azioni reali
 *
 * NON invia mai ricevute di lettura: nessun percorso nel codice chiama readMessages().
 */
export async function handleMessage({ config, msg, send = null, downloadMedia = null, dryRun = false, precomputedTranscript = null }) {
  const { settings, rules } = config;

  if (msg.fromMe && !settings.processOwnMessages) {
    log.debug({ id: msg.id }, 'messaggio mio, ignorato');
    return { skipped: 'fromMe' };
  }
  if (settings.ignoreStatus && msg.chatJid === 'status@broadcast') {
    return { skipped: 'status' };
  }
  if (msg.type === 'empty' || msg.type === 'protocol' || msg.type === 'reaction') {
    return { skipped: msg.type };
  }
  if (!dryRun && msg.id && hasSeen(msg.id)) {
    log.debug({ id: msg.id }, 'già processato');
    return { skipped: 'duplicate' };
  }
  if (msg.id) markSeen(msg.id);

  const record = {
    ts: new Date().toISOString(),
    id: msg.id,
    chat: msg.chatName,
    chatJid: msg.chatJid,
    chatJidAlt: msg.chatJidAlt || undefined,
    sender: msg.senderName,
    senderJid: msg.senderJid,
    senderJidAlt: msg.senderJidAlt || undefined,
    fromMe: msg.fromMe || undefined,
    type: msg.type,
    text: msg.text,
    matched: [],
    transcript: null,
    actions: [],
  };

  // --- trascrizione pigra, una sola volta per messaggio ---
  // precomputedTranscript serve ai test: evita di pagare due volte la stessa
  // trascrizione quando chi chiama l'ha già ottenuta (es. pannello di debug).
  let transcript = precomputedTranscript;
  let transcriptDone = Boolean(precomputedTranscript);
  let mediaFile = msg.mediaFile || null;
  async function ensureTranscript() {
    if (transcriptDone) return transcript;
    transcriptDone = true;
    try {
      if (msg.type !== 'audio') return null;
      if (!settings.transcribeAudio) { log.debug('trascrizione disattivata dalle settings'); return null; }
      mediaFile = msg.mediaFile || (downloadMedia ? await downloadMedia() : null);
      if (!mediaFile) { log.warn({ id: msg.id }, 'nessun file audio disponibile'); return null; }
      const res = await transcribe(mediaFile);
      transcript = res?.text || null;
      record.transcript = transcript;
      bump('transcribed');
    } catch (err) {
      log.error({ err: err.message, id: msg.id }, 'trascrizione fallita');
      record.transcribeError = err.message;
    }
    return transcript;
  }

  const results = { matched: [], actions: [], classified: null };

  for (const rule of rules) {
    let text = msg.text || '';
    // se la regola filtra per testo ed è un vocale, trascrivo prima di valutare
    if (!text && msg.type === 'audio' && rule.match?.textMatch) {
      text = (await ensureTranscript()) || '';
    }
    if (rule.transcribe && msg.type === 'audio' && !text) {
      text = (await ensureTranscript()) || '';
    }

    const { ok } = ruleMatches(rule, msg, text);
    if (!ok) continue;

    let classification = null;
    if (rule.classify) {
      classification = await classify({
        text,
        labels: rule.classify.labels,
        model: rule.classify.model,
        context: `Chat: ${msg.chatName}${msg.senderName ? `, mittente: ${msg.senderName}` : ''}`,
      });
      results.classified = classification;
      record.classification = classification;
      if (!classifyAllows(rule, classification)) {
        log.info({ rule: rule.id, label: classification?.label }, 'regola scartata dalla classificazione');
        continue;
      }
    }

    log.info(
      { rule: rule.id, chat: msg.chatName, sender: msg.senderName, type: msg.type },
      `regola attivata: ${rule.name}`,
    );
    bump('ruleHits');

    const res = await runActions(rule.actions, {
      rule,
      msg,
      text,
      transcript,
      classification,
      mediaFile,
      settings,
      send,
      dryRun,
    });

    results.matched.push(rule.id);
    results.actions.push(...res.results.map((r) => ({ rule: rule.id, ...r })));
    record.matched.push(rule.id);
    record.actions.push(...res.results.map((r) => ({ rule: rule.id, ...r })));

    if (!rule.continue) break;
  }

  if (results.matched.length === 0) bump('unmatched');

  // retention a 0: il file audio ha già dato quello che serviva (la trascrizione).
  // Se la trascrizione è fallita lo teniamo, così si può riprovare.
  if (settings.mediaRetentionDays === 0 && mediaFile && !dryRun) {
    if (transcript) record.mediaDeleted = deleteMedia(mediaFile);
    else log.warn({ file: mediaFile }, 'trascrizione assente: tengo il file per riprovare');
  }

  if (settings.logMessages && !dryRun) appendMessage(record);
  return { ...results, transcript, mediaFile, record };
}
