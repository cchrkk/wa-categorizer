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

  /**
   * Invio su WhatsApp: spento di default. Si accende SOLO da qui, mai da
   * rules.yaml — il pannello web può riscrivere le regole, quindi un file di
   * regole non deve poter accendere l'invio.
   * Le spunte di lettura e la presenza restano spente in ogni caso.
   */
  allowReply: String(process.env.ALLOW_REPLY ?? 'false').toLowerCase() === 'true',

  webEnabled: String(process.env.WEB_ENABLED ?? 'false').toLowerCase() === 'true',
  webPort: Number(process.env.WEB_PORT || 8099),
  webBind: process.env.WEB_BIND || '127.0.0.1',
  webToken: process.env.WEB_TOKEN || '',

  actionTimeoutMs: Number(process.env.ACTION_TIMEOUT_MS || 15000),
};

const DEFAULT_SETTINGS = {
  /**
   * MODALITÀ SOLO LETTURA (imposta dal progetto): riguarda le **spie**.
   * Con readOnly=true il client non invia ricevute di lettura e non invia
   * presenza/online. È un'invariante: non si spegne da nessun file di
   * configurazione.
   * L'invio è l'unica eccezione, e sta in allowReply (che arriva da .env).
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
  /**
   * Invio su WhatsApp (azione "reply"). Fonte di verità: ALLOW_REPLY in .env.
   * Questo valore è solo la copia in memoria, e loadConfig() lo riscrive sempre
   * con quello che arriva dall'ambiente.
   */
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

  // Un pattern vuoto non vuol dire "nessun filtro": in mode contains
  // `includes('')` è sempre vero, quindi la regola matcha OGNI messaggio di quel
  // tipo, in ogni chat e da chiunque. Ci si arriva scrivendo "- !parola": YAML
  // lo legge come un tag e lo trasforma in "". È un errore che non si vede —
  // in produzione ha aperto un cancello a ogni messaggio — quindi meglio non
  // caricare la configurazione che lasciarla girare.
  const textMatch = rule.match?.textMatch;
  if (textMatch && typeof textMatch === 'object' && !Array.isArray(textMatch)) {
    const patterns = [].concat(textMatch.patterns ?? textMatch.value ?? []);
    if (patterns.some((p) => p == null || String(p) === '')) {
      errors.push(
        `rule "${id}": textMatch has an empty pattern — it matches EVERY message. ` +
        'A pattern written as "- !word" is a YAML tag, not a string: YAML turns it into "". ' +
        'Write it without the "!", or wrap it in quotes.',
      );
    }
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
      out.warnings.push(`rules.d/${nome}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(conf.rules)) {
      if (conf.rules !== undefined) out.warnings.push(`rules.d/${nome}: "rules" deve essere una lista, ignored`);
      continue;
    }
    if (conf.settings) out.warnings.push(`rules.d/${nome}: "settings" viene ignorato (sta solo nel file principale)`);
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

  // Non si accendono da nessun file: sono la ragione per cui il progetto
  // esiste. L'invio invece è un'eccezione esplicita, e arriva solo da .env.
  const settings = { ...DEFAULT_SETTINGS, ...(fileConf.settings || {}) };
  settings.readOnly = true;
  settings.allowReply = env.allowReply === true;

  const warnings = [...sparse.warnings];
  // Il caso "invio acceso" lo annunciano il banner all'avvio e `npm run check`:
  // qui basta dirlo quando qualcuno ha provato ad accenderlo dal file sbagliato.
  if (!settings.allowReply && (fileConf.settings || {}).allowReply === true) {
    warnings.push(
      '"settings.allowReply: true" is ignored: sending is enabled only by ALLOW_REPLY=true in .env ' +
      '(the panel can rewrite the rules, not the .env)',
    );
  }

  return {
    settings,
    rules,
    paths,
    env,
    ruleFiles: [path.basename(file), ...sparse.files],
    warnings,
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
