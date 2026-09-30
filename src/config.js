import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CONFIG_DIR = path.join(ROOT, 'config');

/**
 * File delle regole: si usa rules.yaml se c'è, altrimenti rules.json (legacy).
 * Puoi forzarne uno con --config FILE.
 */
export function resolveRulesFile(explicit) {
  if (explicit) return path.isAbsolute(explicit) ? explicit : path.join(ROOT, explicit);
  const yamlFile = path.join(CONFIG_DIR, 'rules.yaml');
  const ymlFile = path.join(CONFIG_DIR, 'rules.yml');
  const jsonFile = path.join(CONFIG_DIR, 'rules.json');
  for (const f of [yamlFile, ymlFile, jsonFile]) if (fs.existsSync(f)) return f;
  return yamlFile; // default quando non esiste ancora nulla
}

export const paths = {
  root: ROOT,
  auth: path.resolve(ROOT, process.env.AUTH_DIR || 'auth'),
  data: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  config: CONFIG_DIR,
  rulesDir: path.join(CONFIG_DIR, 'rules.d'),
  rulesFile: resolveRulesFile(),
};

export const env = {
  logLevel: process.env.LOG_LEVEL || 'info',

  transcribeBackend: (process.env.TRANSCRIBE_BACKEND || 'none').toLowerCase(),
  transcribeCommand: process.env.TRANSCRIBE_COMMAND || '',
  ffmpegBin: process.env.TRANSCRIBE_FFMPEG || 'ffmpeg',
  language: process.env.TRANSCRIBE_LANGUAGE || '',

  openaiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
  openaiTranscribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
  openaiClassifyModel: process.env.OPENAI_CLASSIFY_MODEL || 'gpt-4o-mini',

  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',

  haUrl: (process.env.HA_URL || '').replace(/\/+$/, ''),
  haToken: process.env.HA_TOKEN || '',
  haWebhookId: process.env.HA_WEBHOOK_ID || '',

  webEnabled: String(process.env.WEB_ENABLED ?? 'false').toLowerCase() === 'true',
  webPort: Number(process.env.WEB_PORT || 8099),
  webBind: process.env.WEB_BIND || '127.0.0.1',
  webToken: process.env.WEB_TOKEN || '',

  actionTimeoutMs: Number(process.env.ACTION_TIMEOUT_MS || 15000),
};

const DEFAULT_SETTINGS = {
  /**
   * MODALITÀ SOLO LETTURA (imposta dal progetto).
   * Con readOnly=true il client non invia ricevute di lettura, non invia
   * presenza/online e blocca le azioni che scrivono su WhatsApp ("reply").
   * Non è disattivabile da rules.json: è una scelta architetturale.
   */
  readOnly: true,
  /** Se true i file vocali vengono scaricati e trascritti. */
  transcribeAudio: true,
  /** Salva un log di tutti i messaggi in data/messages.jsonl */
  logMessages: true,
  /**
   * Quanto tenere i media scaricati in data/out/ (giorni):
   *   > 0  li conserva N giorni, poi li cancella
   *   0    li cancella appena finita l'elaborazione
   *   -1   non li cancella mai
   * La cartella tmp/ (conversioni) viene comunque svuotata.
   */
  mediaRetentionDays: 7,
  /** Scarica anche i media non-audio delle regole (immagini/documenti) */
  downloadOtherMedia: false,
  /** Abilita l'azione "shell" (esegue comandi locali). Per sicurezza: off. */
  allowShell: false,
  /** Abilita l'azione "reply" (scrive nella chat). Richiede readOnly=false. */
  allowReply: false,
  /** Ignora i messaggi inviati da te (da me -> false = ignorali) */
  processOwnMessages: false,
  /** Ignora le chat "status@broadcast" */
  ignoreStatus: true,
};

function readJsonFile(file, fallback) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
  try {
    if (/\.ya?ml$/i.test(file)) return YAML.parse(raw) ?? fallback;
    return JSON.parse(raw);
  } catch (err) {
    const format = /\.ya?ml$/i.test(file) ? 'YAML' : 'JSON';
    throw new Error(`${path.basename(file)}: ${format} invalid → ${err.message}`);
  }
}

function normalizeRule(rule, index) {
  const id = rule.id || `rule-${index}`;
  const errors = [];
  if (!rule.match || typeof rule.match !== 'object') {
    errors.push(`rule "${id}": missing "match"`);
  }
  if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
    errors.push(`rule "${id}": missing "actions"`);
  }
  for (const [i, a] of (rule.actions || []).entries()) {
    if (!a || typeof a.type !== 'string') {
      errors.push(`rule "${id}": action #${i} without "type"`);
    }
  }
  if (rule.markRead === true) {
    errors.push(`rule "${id}": "markRead" is not supported — the project is in read-only mode`);
  }
  return {
    id,
    name: rule.name || id,
    enabled: rule.enabled !== false,
    priority: Number.isFinite(rule.priority) ? rule.priority : 100,
    from: rule._da || '',        // file di origine, se viene da rules.d/
    match: rule.match || {},
    transcribe: rule.transcribe === true,
    classify: rule.classify || null,
    continue: rule.continue === true,
    stopAfterMatch: rule.stopAfterMatch === true,
    actions: rule.actions || [],
    errors,
  };
}

/**
 * Regole sparse da `config/rules.d/*.yaml` (o .yml), in ordine alfabetico.
 * Ogni file contiene solo una lista `rules:` e contribuisce con le sue.
 * Serve a tenere separate le regole per argomento e a poter copiare dentro
 * un file dagli esempi senza incollare niente a mano.
 */
function loadRuleDir(dir) {
  const out = { rules: [], files: [], warnings: [] };
  if (!fs.existsSync(dir)) return out;

  for (const nome of fs.readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f)).sort()) {
    const pieno = path.join(dir, nome);
    let conf;
    try {
      conf = readJsonFile(pieno, {});
    } catch (err) {
      out.warnings.push(`${nome}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(conf.rules)) {
      if (conf.rules !== undefined) out.warnings.push(`${nome}: "rules" deve essere una lista, ignored`);
      continue;
    }
    if (conf.settings) out.warnings.push(`${nome}: "settings" viene ignorato (sta solo nel file principale)`);
    out.files.push(nome);
    out.rules.push(...conf.rules.map((r) => ({ ...r, _da: nome })));
  }
  return out;
}

export function loadConfig(file = paths.rulesFile) {
  const fileConf = readJsonFile(file, { settings: {}, rules: [] });
  if (!Array.isArray(fileConf.rules)) {
    throw new Error(`${path.basename(file)}: "rules" must be a list`);
  }

  const sparse = loadRuleDir(paths.rulesDir);

  const rules = [...fileConf.rules, ...sparse.rules]
    .map(normalizeRule)
    .filter((r) => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  const errors = rules.flatMap((r) => r.errors);
  if (errors.length) {
    throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  }

  // readOnly è una invariante: qualunque azione che scrive su WhatsApp è forzata off.
  const settings = { ...DEFAULT_SETTINGS, ...(fileConf.settings || {}) };
  settings.readOnly = true;
  if (settings.readOnly) settings.allowReply = false;

  return {
    settings,
    rules,
    paths,
    env,
    ruleFiles: [path.basename(file), ...sparse.files],
    warnings: sparse.warnings,
  };
}

/** Rende leggibile un campo di match, anche nella forma { mode, value|patterns }. */
function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'object' && !Array.isArray(v)) {
    const list = v.patterns ?? v.value ?? [];
    return `${v.mode || 'contains'}:${[].concat(list).map(String).join(' | ')}`;
  }
  return [].concat(v).map(String).join(' | ');
}

export function describeRule(rule) {
  const m = rule.match;
  const bits = [];
  if (m.chatName) bits.push(`chat~"${fmt(m.chatName)}"`);
  if (m.chatJid) bits.push(`chatJid=${fmt(m.chatJid)}`);
  if (m.senderName) bits.push(`da~"${fmt(m.senderName)}"`);
  if (m.senderJid) bits.push(`da=${fmt(m.senderJid)}`);
  if (m.self != null) bits.push(`self=${m.self}`);
  if (m.type) bits.push(`tipo=${fmt(m.type)}`);
  if (m.textMatch) bits.push(`testo~"${fmt(m.textMatch)}"`);
  return bits.join('  ') || '(matches everything)';
}
