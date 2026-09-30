#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, describeRule, resolveRulesFile, paths, env } from './config.js';
import { logger } from './logger.js';
import { handleMessage } from './pipeline.js';
import { startWhatsApp } from './whatsapp.js';
import { assertTranscribeReady, transcribeBackendName } from './transcribe.js';
import { ACTION_TYPES, PLACEHOLDERS } from './actions.js';
import { auditRegexes } from './rules.js';
import { flush, getStats } from './store.js';
import { directory, flushContacts } from './contacts.js';
import { sweepMedia } from './media.js';
import { startWeb } from './web.js';
import { buildTestMessage } from './testkit.js';

const argv = process.argv.slice(2);
const hasFlag = (f) => argv.includes(f);
const flagValue = (f) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

const HELP = `
wa-categorizer — categorizza i messaggi WhatsApp e scatena azioni

Uso:
  npm start                     connette WhatsApp (QR al primo avvio) e resta in ascolto
  npm start -- --login          come sopra, esplicito
  npm start -- --check          valida config/rules.yaml e l'ambiente, poi esce
  npm run contacts              mostra jid, LID e nomi dei contatti conosciuti
  npm start -- --simulate FILE  fa passare un messaggio finto dal motore di regole (dry-run)
  npm start -- --simulate FILE --live   come sopra ma esegue davvero le azioni

Opzioni:
  --config FILE   usa un file di regole diverso da config/rules.json
  --dry           connette ma non esegue nessuna azione
  --help          questo testo
`.trim();

function banner(config) {
  logger.info('─'.repeat(72));
  logger.info('🔒 modalità SOLO LETTURA — nessuna spunta blu, nessuna presenza online');
  logger.info(`wa-categorizer · trascrizione: ${transcribeBackendName()}`);
  const files = config.ruleFiles || [path.relative(paths.root, paths.rulesFile)];
  logger.info(`config: ${files.join(' + ')}`);
  logger.info(`regole attive: ${config.rules.length}`);
  for (const r of config.rules) {
    const da = r.from ? ` [${r.from}]` : '';
    logger.info(`  • [${String(r.priority).padStart(3)}] ${r.id.padEnd(22)} ${describeRule(r)}${da}`);
  }
  logger.info('─'.repeat(72));
}

/** Chiamata di sola lettura a Home Assistant, per verificare URL e token. */
async function haApi(pathname) {
  const res = await fetch(`${env.haUrl}${pathname}`, {
    headers: { Authorization: `Bearer ${env.haToken}` },
    signal: AbortSignal.timeout(env.actionTimeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json();
}

async function telegramApi(method, params = {}) {  const res = await fetch(`https://api.telegram.org/bot${env.telegramToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(env.actionTimeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return data.result;
}

async function runCheck(config) {
  let ok = true;
  logger.info('▶ controllo configurazione…');
  logger.info('  ✓ solo lettura: readMessages() e presenza disattivati a livello di client');
  if (config.settings.allowReply) {
    logger.warn('  ! allowReply attivo: le regole possono scrivere nelle chat');
  }
  const wantsReply = config.rules.some((r) => r.actions.some((a) => a.type === 'reply'));
  if (wantsReply && !config.settings.allowReply) {
    logger.warn('  ! azione "reply" usata ma bloccata dalla modalità solo lettura');
  }

  try {
    const backend = assertTranscribeReady();
    logger.info(`  ✓ trascrizione: ${backend}${backend === 'command' ? ` (${env.transcribeCommand})` : ''}`);
  } catch (err) {
    ok = false;
    logger.error(`  ✗ trascrizione: ${err.message}`);
  }

  const usedTypes = new Set(config.rules.flatMap((r) => r.actions.map((a) => a.type)));
  for (const t of usedTypes) {
    if (!ACTION_TYPES.includes(t)) {
      ok = false;
      logger.error(`  ✗ azione sconosciuta: ${t} (disponibili: ${ACTION_TYPES.join(', ')})`);
    }
  }
  logger.info(`  ✓ ${usedTypes.size} tipi di azione usati, tutti riconosciuti`);

  const ret = config.settings.mediaRetentionDays;
  const retLabel = ret < 0 ? 'mai' : ret === 0 ? 'cancellati a fine elaborazione' : `${ret} giorni`;
  logger.info(`  ✓ media in data/out: conservati ${retLabel}${ret >= 0 ? ' (tmp/ sempre svuotata)' : ''}`);

  if (env.webEnabled) {
    const dove = ['127.0.0.1', 'localhost'].includes(env.webBind) ? 'solo questa macchina' : `LAN (${env.webBind})`;
    logger.info(`  ✓ pannello web: porta ${env.webPort}, ${dove}, ${env.webToken ? 'token da .env' : 'token generato in data/web-token.txt'}`);
  } else {
    logger.info('  · pannello web disattivato (WEB_ENABLED=true per attivarlo)');
  }

  // Segnaposto scritti male: {{transcriptt}} non esplode, ma esce vuoto o letterale.
  // Sono validi anche i gruppi di cattura delle regex: {{1}} e {{nome}}.
  const gruppiConNome = new Set();
  for (const r of config.rules) {
    const tm = r.match?.textMatch;
    if (!tm || typeof tm !== 'object' || Array.isArray(tm)) continue;
    for (const p of [].concat(tm.patterns ?? tm.value ?? [])) {
      for (const g of String(p).matchAll(/\(\?<([A-Za-z]\w*)>/g)) gruppiConNome.add(g[1]);
    }
  }

  const raw = JSON.stringify(config.rules);
  const unknowns = new Set();
  for (const [, name] of raw.matchAll(/\{\{(\w+)\}\}/g)) {
    if (PLACEHOLDERS.includes(name)) continue;
    if (/^\d+$/.test(name)) continue;            // {{1}}, {{2}}: gruppi di cattura
    if (gruppiConNome.has(name)) continue;        // {{stanza}}: gruppo con nome
    unknowns.add(name);
  }
  if (unknowns.size) {
    ok = false;
    logger.error(`  ✗ segnaposto sconosciuti: ${[...unknowns].join(', ')}`);
    logger.error(`     disponibili: ${PLACEHOLDERS.join(', ')}, {{1}}, {{nomeGruppo}}`);
  } else {
    logger.info(`  ✓ tutti i segnaposto {{...}} sono validi${gruppiConNome.size ? ` (gruppi: ${[...gruppiConNome].join(', ')})` : ''}`);
  }

  if (usedTypes.has('notify.telegram')) {
    if (!env.telegramToken || !env.telegramChatId) {
      ok = false;
      logger.error('  ✗ notify.telegram usato ma TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID mancano');
    } else {
      try {
        const me = await telegramApi('getMe');
        const chat = await telegramApi('getChat', { chat_id: env.telegramChatId });
        const name = chat.title || chat.username || [chat.first_name, chat.last_name].filter(Boolean).join(' ');
        logger.info(`  ✓ telegram: @${me.username} → chat "${name}" (id ${chat.id})`);
      } catch (err) {
        ok = false;
        logger.error(`  ✗ telegram: ${err.message}`);
        logger.error(`     → apri https://t.me/${(process.env.TELEGRAM_BOT_USERNAME || 'il_tuo_bot')} e premi Start, poi riprova`);
      }
    }
  }
  const HA_ACTIONS = ['ha.webhook', 'ha.service', 'ha.action', 'ha.button', 'ha.script', 'ha.automation', 'ha.notify'];
  if (HA_ACTIONS.some((t) => usedTypes.has(t))) {
    if (!env.haUrl) {
      logger.warn('  ! azioni Home Assistant usate ma HA_URL manca in .env');
    } else if (!env.haToken) {
      logger.warn('  ! azioni Home Assistant usate ma HA_TOKEN manca in .env');
    } else {
      try {
        const cfg = await haApi('/api/config');
        logger.info(`  ✓ home assistant: ${cfg.location_name || 'casa'} · HA ${cfg.version} · ${env.haUrl}`);
      } catch (err) {
        ok = false;
        logger.error(`  ✗ home assistant (${env.haUrl}): ${err.message}`);
        logger.error('     → controlla HA_URL e crea un token long-lived: Profilo → Sicurezza → Token di accesso a lunga durata');
      }
    }
  }
  if (usedTypes.has('shell') && !config.settings.allowShell) {
    logger.warn('  ! azione shell usata ma settings.allowShell=false: fallirà a runtime');
  }

  // Trappola classica: \b accanto a una lettera accentata. Sembra scritto
  // giusto e non matcha mai, perché \b per JavaScript conosce solo [A-Za-z0-9_].
  const trappole = auditRegexes(config.rules);
  if (trappole.length) {
    ok = false;
    for (const t of trappole) {
      logger.error(`  ✗ regola "${t.rule}": usi \\b con una parola accentata — su quella parola non matcherà MAI`);
      logger.error(`     ${t.pattern}`);
    }
    logger.error('     \\b conosce solo [A-Za-z0-9_], quindi non c\'è confine accanto a è, à, ò...');
    logger.error('     → confini unicode:   flags: iu   e   (?<![\\p{L}\\p{N}])parola(?![\\p{L}\\p{N}])');
    logger.error('     → oppure, per una lista di parole chiave, basta   mode: contains');
  } else {
    logger.info('  ✓ nessun \\b accanto a parole accentate');
  }
  if (!fs.existsSync(paths.rulesFile)) {
    logger.warn(`  ! ${path.relative(paths.root, paths.rulesFile)} non esiste: copia config/rules.example.yaml`);
  }

  logger.info(`  ✓ config: ${(config.ruleFiles || []).join(' + ')}`);
  for (const w of config.warnings || []) logger.warn(`  ! rules.d: ${w}`);

  logger.info(ok ? '✓ configurazione valida' : '✗ configurazione con errori');
  return ok ? 0 : 1;
}

async function runSimulate(config, file, live) {
  const abs = path.isAbsolute(file) ? file : path.join(paths.root, file);
  const sample = JSON.parse(fs.readFileSync(abs, 'utf8'));

  // Stessa fabbrica di messaggi del pannello web: un solo posto da tenere allineato.
  const msg = buildTestMessage(sample);

  logger.info({ dryRun: !live, sample: path.basename(abs) }, '▶ simulazione');
  const res = await handleMessage({
    config,
    msg,
    dryRun: !live,
    downloadMedia: async () => msg.mediaFile,
    send: live && config.settings.allowReply
      ? async (jid, content) => logger.info({ jid, content }, '[simulazione] invio WhatsApp (allowReply)')
      : null,
  });

  logger.info('— risultato —');
  logger.info(`  regole attivate: ${res.matched?.length ? res.matched.join(', ') : '(nessuna)'}`);
  logger.info(`  trascrizione:    ${res.transcript ? JSON.stringify(res.transcript) : '(nessuna)'}`);
  for (const a of res.actions || []) {
    logger.info(`  azione ${a.ok ? '✓' : '✗'} ${a.rule} → ${a.type}${a.error ? ` (${a.error})` : ''}`);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Elenca jid e nomi che il programma conosce (rubrica lid <-> numero). */
function printContacts() {
  const { me, rows, total } = directory();
  console.log('\nRUBRICA (data/contacts.json)\n');
  if (me) {
    console.log('  Tu:');
    console.log(`    nome        ${me.name || '(sconosciuto)'}`);
    console.log(`    jid         ${me.jid || '(non noto)'}`);
    console.log(`    lid         ${me.lid || '(non noto)'}`);
    console.log('');
  } else {
    console.log('  Tu: ancora sconosciuto (avvia il programma almeno una volta)\n');
  }
  if (!rows.length) {
    console.log('  Nessun contatto salvato: i nomi arrivano dopo la prima connessione.\n');
    return;
  }
  for (const r of rows) {
    const alt = r.alt ? `  <->  ${r.alt}` : '';
    console.log(`  ${r.name.padEnd(24)} ${r.jid}${alt}`);
  }
  console.log(`\n  ${total} voci totali (inclusi i gruppi)\n`);
}

/**
 * Impedisce che due istanze usino la stessa cartella auth/: sarebbe la causa
 * numero uno dell'errore 440 (connessione sostituita a vicenda).
 */
function acquireInstanceLock() {
  const file = path.join(paths.data, 'instance.lock');
  fs.mkdirSync(paths.data, { recursive: true });

  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (prev.pid && prev.pid !== process.pid) {
      try {
        process.kill(prev.pid, 0); // il processo è vivo?
        logger.error(`un'altra istanza è già attiva (pid ${prev.pid}, avviata ${prev.startedAt}). Chiudila prima di riavviare.`);
        process.exit(1);
      } catch (err) {
        if (err.code !== 'ESRCH') throw err;
        logger.warn(`lock orfano del pid ${prev.pid}, lo sovrascrivo`);
      }
    }
  } catch (err) {
    if (err instanceof SyntaxError || err.code === 'ENOENT') { /* niente lock o lock illeggibile */ }
    else throw err;
  }

  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));

  process.on('exit', () => {
    try {
      const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cur.pid === process.pid) fs.unlinkSync(file);
    } catch { /* ignore */ }
  });
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(HELP);
    return;
  }

  // --config: file di regole alternativo (yaml o json)
  paths.rulesFile = resolveRulesFile(flagValue('--config'));

  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (hasFlag('--check')) {
      logger.error(`✗ configurazione non valida: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  if (hasFlag('--check')) process.exit(await runCheck(config));

  if (hasFlag('--contacts')) {
    printContacts();
    return;
  }

  if (hasFlag('--simulate')) {
    const file = flagValue('--simulate') || 'fixtures/sample-text.json';
    await runSimulate(config, file, hasFlag('--live'));
    return;
  }

  banner(config);
  const dry = hasFlag('--dry');

  acquireInstanceLock();

  // Se ci sono azioni Home Assistant, verifica subito che HA risponda: un URL
  // sbagliato si scopre all'avvio invece che al primo ordine che arriva.
  const HA_ACTION_TYPES = new Set(['ha.webhook', 'ha.service', 'ha.action', 'ha.button', 'ha.script', 'ha.automation', 'ha.notify']);
  const haUsed = config.rules.some((r) => r.actions.some((a) => HA_ACTION_TYPES.has(a.type)));
  if (haUsed) {
    if (!env.haUrl || !env.haToken) {
      logger.warn('azioni Home Assistant configurate, ma HA_URL/HA_TOKEN mancano in .env: falliranno');
    } else {
      try {
        const cfg = await haApi('/api/config');
        logger.info(`Home Assistant: ${cfg.location_name || 'casa'} · HA ${cfg.version} · ${env.haUrl}`);
      } catch (err) {
        logger.error(`Home Assistant NON raggiungibile (${env.haUrl}): ${err.message}`);
        logger.error('finché non sistemi HA_URL o la rete, le azioni ha.* falliscono senza fare nulla');
      }
    }
  }

  // Pulizia dei media: all'avvio e poi ogni 6 ore. La soglia si rilegge ogni
  // volta, così cambiarla in rules.yaml vale subito senza riavviare.
  const retention = () => config.settings.mediaRetentionDays;
  try {
    sweepMedia(retention());
  } catch (err) {
    logger.warn(`pulizia media all'avvio fallita: ${err.message}`);
  }
  setInterval(() => {
    try {
      sweepMedia(retention());
    } catch (err) {
      logger.warn(`pulizia media fallita: ${err.message}`);
    }
  }, 6 * 60 * 60 * 1000).unref();

  // ricarica le regole se il file cambia (senza riavviare)
  let watcher;
  let configBrokenSince = null;
  try {
    watcher = fs.watch(paths.rulesFile, { persistent: false }, () => {
      setTimeout(() => {
        try {
          config = loadConfig();
          configBrokenSince = null;
          logger.info(`♻ regole ricaricate (${config.rules.length} attive)`);
        } catch (err) {
          configBrokenSince = configBrokenSince || Date.now();
          logger.error(`ricarica regole fallita, tengo le vecchie: ${err.message}`);
        }
      }, 300);
    });
  } catch { /* il file può non esistere ancora */ }

  // Se la config è rotta l'app continua con le regole di prima: se non lo
  // ripetessi, un errore di battitura passerebbe inosservato per ore.
  setInterval(() => {
    if (!configBrokenSince) return;
    const minuti = Math.round((Date.now() - configBrokenSince) / 60000);
    logger.error(
      `config/rules.yaml NON valida da ${minuti} min: sto usando le ${config.rules.length} regole di prima. ` +
      'Controlla con: npm run check',
    );
  }, 2 * 60 * 1000).unref();

  // Pannello web, facoltativo. Non può mandare messaggi: passa sempre da
  // handleMessage({dryRun:true}), quindi l'invariante di sola lettura regge
  // anche se il pannello avesse un bug.
  if (env.webEnabled) {
    try {
      await startWeb({
        port: env.webPort,
        host: env.webBind,
        token: env.webToken,
        getConfig: () => config,
        reload: async () => {
          config = loadConfig();
          configBrokenSince = null;
          logger.info(`♻ regole ricaricate dal pannello (${config.rules.length} attive)`);
          return config;
        },
      });
    } catch (err) {
      logger.error(`pannello web non avviato: ${err.message}`);
    }
  } else {
    logger.info('pannello web disattivato (WEB_ENABLED=true per attivarlo)');
  }

  const client = startWhatsApp({
    allowReply: config.settings.allowReply,
    onState: (s, code) => {
      // 'open' e 'close' sono già raccontati da whatsapp.js: qui solo il resto,
      // e i casi gravi, per non avere tre righe per ogni caduta di rete.
      if (s === 'loggedOut' || s === 'fatal') logger.error({ code }, 'connessione: sessione chiusa da WhatsApp');
      else logger.debug({ state: s, code }, 'stato connessione');
    },
    onMessage: async (msg, { sock, downloadMedia }) => {
      await handleMessage({
        config,
        msg,
        downloadMedia,
        // null in modalità solo lettura: l'azione "reply" non ha modo di scrivere
        send: config.settings.allowReply
          ? (jid, content, opts) => sock.sendMessage(jid, content, opts)
          : null,
        dryRun: dry,
      });
    },
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} ricevuto, chiudo…`);
    watcher?.close();
    flush();
    flushContacts();
    logger.info({ stats: getStats() }, 'statistiche');
    client.stop();
    await sleep(300);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => logger.error({ err: String(err) }, 'promise non gestita'));

  process.on('exit', () => flush());
  setInterval(flush, 30000).unref();

  client.ready.then(() => logger.info('✅ operativo: in ascolto dei messaggi in arrivo'));

  await client.run;
}

main().catch((err) => {
  logger.error({ err: err.message, stack: err.stack }, 'avvio fallito');
  process.exit(1);
});
