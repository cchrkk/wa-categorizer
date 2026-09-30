import fs from 'node:fs';
import path from 'node:path';
import { paths } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('contacts');

const FILE = path.join(paths.data, 'contacts.json');

/**
 * WhatsApp sta migrando le chat agli identificatori LID (@lid), che sono anonimi e
 * NON contengono il numero di telefono. Lo stesso contatto quindi può comparire come:
 *
 *   393331234567@s.whatsapp.net   (numero di telefono)
 *   223344556677889@lid           (identificatore anonimo, può cambiare)
 *
 * Questa rubrica tiene la corrispondenza tra le due forme e i nomi, così le regole
 * possono usare il numero che conosci tu senza sapere nulla di LID.
 */
const state = {
  lidToJid: {},   // 223344556677889@lid -> 393331234567@s.whatsapp.net
  jidToLid: {},   // 393331234567@s.whatsapp.net -> 223344556677889@lid
  names: {},      // jid (in entrambe le forme) -> nome
  me: null,       // { id, lid, jid, name } del tuo account
};

let dirty = false;
let saveTimer = null;

export function normalizeJid(jid) {
  return jid ? String(jid).replace(/:\d+@/, '@') : '';
}

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    Object.assign(state.lidToJid, raw.lidToJid || {});
    Object.assign(state.jidToLid, raw.jidToLid || {});
    Object.assign(state.names, raw.names || {});
    if (raw.me) state.me = raw.me;
    log.debug({ contatti: Object.keys(state.names).length }, 'rubrica caricata');
  } catch (err) {
    if (err.code !== 'ENOENT') log.warn({ err: err.message }, 'rubrica non leggibile, riparto da zero');
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushContacts();
  }, 3000);
  saveTimer.unref?.();
}

export function flushContacts() {
  if (!dirty) return;
  try {
    fs.mkdirSync(paths.data, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 1));
    dirty = false;
  } catch (err) {
    log.warn({ err: err.message }, 'impossibile salvare la rubrica');
  }
}

/** Registra/aggiorna un contatto proveniente da contacts.upsert / contacts.update. */
export function rememberContact(c) {
  if (!c) return;
  const id = normalizeJid(c.id || '');
  let lid = normalizeJid(c.lid || '');
  let jid = normalizeJid(c.jid || '');

  if (!lid && id.endsWith('@lid')) lid = id;
  if (!jid && (id.endsWith('@s.whatsapp.net') || id.endsWith('@c.us'))) jid = id;

  if (lid && jid) {
    state.lidToJid[lid] = jid;
    state.jidToLid[jid] = lid;
    scheduleSave();
  }

  // "name" = come l'hai salvato tu, "notify" = come si chiama lui su WhatsApp
  const name = c.name || c.notify || c.verifiedName;
  if (name) {
    if (lid) state.names[lid] = name;
    if (jid) state.names[jid] = name;
    if (id) state.names[id] = name;
    scheduleSave();
  }
}

/** Nome di una chat/gruppo proveniente da chats.upsert / chats.update. */
export function rememberChat(c) {
  if (!c?.id || !c.name) return;
  state.names[normalizeJid(c.id)] = c.name;
  scheduleSave();
}

/** Salva l'identità del tuo account (da sock.user). */
export function setSelf(user) {
  if (!user?.id) return;
  const id = normalizeJid(user.id);
  const prev = state.me || {};
  const nuovo = {
    id,
    lid: id.endsWith('@lid') ? id : (user.lid ? normalizeJid(user.lid) : prev.lid || ''),
    jid: id.endsWith('@s.whatsapp.net') ? id : (prev.jid || ''),
    name: user.name || user.verifiedName || prev.name || '',
  };
  state.me = nuovo;

  // A ogni riconnessione WhatsApp ripresenta la stessa identità: loggarla e
  // riscriverla ogni volta riempie i log di righe identiche.
  const cambiata = prev.id !== nuovo.id || prev.lid !== nuovo.lid || prev.jid !== nuovo.jid || prev.name !== nuovo.name;
  if (!cambiata) {
    log.debug({ me: nuovo }, 'identità account invariata');
    return;
  }

  if (nuovo.lid && nuovo.jid) {
    state.lidToJid[nuovo.lid] = nuovo.jid;
    state.jidToLid[nuovo.jid] = nuovo.lid;
  }
  if (nuovo.name) state.names[id] = nuovo.name;
  log.info({ me: nuovo }, 'identità account salvata');
  scheduleSave();
}

/** L'altra forma dello stesso jid (lid -> numero, numero -> lid), se la conosciamo. */
export function alternateJid(jid) {
  const j = normalizeJid(jid);
  return state.lidToJid[j] || state.jidToLid[j] || '';
}

/** Tutti i jid con cui possiamo identificare il tuo account. */
export function selfJids() {
  if (!state.me) return [];
  return [state.me.id, state.me.lid, state.me.jid].filter(Boolean);
}

/** Primo nome disponibile tra i jid passati. */
export function nameFor(...jids) {
  for (const j of jids) {
    const n = state.names[normalizeJid(j)];
    if (n) return n;
  }
  return '';
}

/** true se il jid (o la sua forma alternativa) è il tuo account. */
export function isSelf(jid) {
  const j = normalizeJid(jid);
  if (!j) return false;
  const mine = selfJids();
  if (mine.includes(j)) return true;
  const alt = alternateJid(j);
  return Boolean(alt && mine.includes(alt));
}

export function directory() {
  const rows = Object.entries(state.names)
    .filter(([jid]) => !jid.endsWith('@g.us'))
    .map(([jid, name]) => ({ jid, name, alt: alternateJid(jid) || '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { me: state.me, rows, total: Object.keys(state.names).length };
}

export const _state = state;
load();
