import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { env, paths } from './config.js';
import { childLogger } from './logger.js';
import { appendJsonl } from './store.js';

const log = childLogger('actions');
const execAsync = promisify(exec);

function render(template, ctx) {
  if (template == null) return '';
  const map = {
    // contenuto utile: il testo scritto, oppure la trascrizione del vocale
    content: ctx.text || ctx.transcript || '',
    text: ctx.text || '',
    transcript: ctx.transcript || '',
    chat: ctx.msg.chatName || '',
    chatJid: ctx.msg.chatJid || '',
    sender: ctx.msg.senderName || '',
    senderJid: ctx.msg.senderJid || '',
    rule: ctx.rule.id,
    ruleName: ctx.rule.name,
    type: ctx.msg.type,
    label: ctx.classification?.label || '',
    confidence: ctx.classification?.confidence ?? '',
    date: new Date().toISOString(),
  };
  return String(template).replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
}

/** Applica i segnaposto anche dentro oggetti e array (body, data, variables, ...). */
function renderDeep(value, ctx) {
  if (typeof value === 'string') return render(value, ctx);
  if (Array.isArray(value)) return value.map((v) => renderDeep(v, ctx));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderDeep(v, ctx)]));
  }
  return value;
}

async function postJson(url, body, headers = {}, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(env.actionTimeoutMs),
  });
  const text = (await res.text()).slice(0, 500);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

/** Chiamata a un servizio di Home Assistant. */
async function haCall(pathSuffix, body) {
  if (!env.haUrl || !env.haToken) {
    throw new Error('HA_URL o HA_TOKEN mancanti in .env (vedi la sezione Home Assistant del README)');
  }
  return postJson(`${env.haUrl}/api/services/${pathSuffix}`, body, {
    Authorization: `Bearer ${env.haToken}`,
  });
}

/** Payload standard mandato in giro alle azioni. */
function payload(ctx) {
  return {
    ts: new Date().toISOString(),
    rule: { id: ctx.rule.id, name: ctx.rule.name },
    chat: { jid: ctx.msg.chatJid, name: ctx.msg.chatName, isGroup: ctx.msg.isGroup },
    sender: { jid: ctx.msg.senderJid, name: ctx.msg.senderName },
    message: {
      id: ctx.msg.id,
      type: ctx.msg.type,
      timestamp: ctx.msg.timestamp,
      text: ctx.msg.text || '',
      caption: ctx.msg.caption || '',
      ptt: ctx.msg.ptt || false,
    },
    transcript: ctx.transcript || null,
    content: ctx.text || ctx.transcript || '',
    classification: ctx.classification || null,
    mediaFile: ctx.mediaFile || null,
  };
}

const HANDLERS = {
  log: async (a, ctx) => {
    log[String(a.level || 'info')]({ rule: ctx.rule.id }, render(a.message, ctx) || 'azione log');
  },

  'notify.console': async (a, ctx) => {
    log.info(`\n🔔 [${ctx.rule.name}] ${render(a.message, ctx) || ctx.text}\n`);
  },

  'notify.telegram': async (a, ctx) => {
    const token = a.token || env.telegramToken;
    const chatId = a.chatId || env.telegramChatId;
    if (!token || !chatId) throw new Error('telegram non configurato (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)');
    const text = render(a.message, ctx) || `[${ctx.rule.name}] ${ctx.text}`;
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: a.parseMode || 'Markdown',
      disable_web_page_preview: true,
    });
  },

  webhook: async (a, ctx) => {
    if (!a.url) throw new Error('webhook senza "url"');
    const body = a.body ? renderDeep(a.body, ctx) : payload(ctx);
    await postJson(render(a.url, ctx), body, renderDeep(a.headers || {}, ctx), a.method || 'POST');
  },

  'ha.webhook': async (a, ctx) => {
    const id = a.webhookId || env.haWebhookId;
    if (!env.haUrl || !id) throw new Error('HA_URL/HA_WEBHOOK_ID non configurati');
    await postJson(`${env.haUrl}/api/webhook/${id}`, a.body ? renderDeep(a.body, ctx) : payload(ctx));
  },

  // --- Home Assistant -----------------------------------------------------
  // Tutte queste passano da /api/services/<domain>/<service> con il token
  // long-lived in HA_TOKEN. Vedi la sezione "Home Assistant" del README.

  'ha.service': async (a, ctx) => {
    if (!a.domain || !a.service) throw new Error('ha.service richiede "domain" e "service"');
    const data = { ...renderDeep(a.data || {}, ctx) };
    if (a.entityId) data.entity_id = renderDeep(a.entityId, ctx);
    const qs = a.returnResponse ? '?return_response=true' : '';
    await haCall(`${a.domain}/${a.service}${qs}`, data);
  },

  /** Azione generica su una entità: es. "light", "switch", "media_player". */
  'ha.action': async (a, ctx) => {
    const target = a.entityId || a.entity;
    if (!target) throw new Error('ha.action richiede "entityId" (es. light.salotto)');
    if (!a.action) throw new Error('ha.action richiede "action" (es. turn_on, toggle)');
    const [domain] = String(target).split('.');
    const data = { ...renderDeep(a.data || {}, ctx), entity_id: target };
    const qs = a.returnResponse ? '?return_response=true' : '';
    await haCall(`${a.domain || domain}/${a.action}${qs}`, data);
  },

  /** Premere un button (o più di uno). */
  'ha.button': async (a, ctx) => {
    const target = a.button || a.entityId;
    if (!target) throw new Error('ha.button richiede "button" (es. button.campanello)');
    const ids = [].concat(target).map((t) => (String(t).includes('.') ? String(t) : `button.${t}`));
    await haCall('button/press', { entity_id: ids.length === 1 ? ids[0] : ids });
  },

  /**
   * Eseguire uno script, passando variabili.
   *   wait: true  → POST /api/services/script/<id>?return_response=true
   *                 (aspetta la fine e la chiave `response:` dello script)
   *   wait assente → script.turn_on, non aspetta
   */
  'ha.script': async (a, ctx) => {
    const target = a.script || a.entityId;
    if (!target) throw new Error('ha.script richiede "script" (es. script.notifica_ordine)');
    const id = String(target).replace(/^script\./, '');
    const variables = renderDeep(a.variables || a.data || {}, ctx);
    if (a.wait) {
      await haCall(`script/${id}?return_response=true`, { variables });
    } else {
      await haCall('script/turn_on', { entity_id: `script.${id}`, variables });
    }
  },

  /** Attivare un'automazione. */
  'ha.automation': async (a, ctx) => {
    const target = a.automation || a.entityId;
    if (!target) throw new Error('ha.automation richiede "automation" (es. automation.cancello)');
    const id = String(target).includes('.') ? String(target) : `automation.${target}`;
    await haCall('automation/trigger', { entity_id: id });
  },

  /** Scorciatoia per notify.<servizio> — il caso più comune. */
  'ha.notify': async (a, ctx) => {
    const service = a.service || a.target;
    if (!service) throw new Error('ha.notify richiede "service" (es. mobile_app_il_mio_telefono)');
    const body = {
      message: render(a.message ?? '{{content}}', ctx),
      ...(a.title ? { title: render(a.title, ctx) } : {}),
      ...(a.data ? { data: renderDeep(a.data, ctx) } : {}),
    };
    await haCall(`notify/${String(service).replace(/^notify\./, '')}`, body);
  },

  appendJsonl: async (a, ctx) => {
    if (!a.file) throw new Error('appendJsonl senza "file"');
    const record = a.fields ? renderDeep(a.fields, ctx) : payload(ctx);
    appendJsonl(a.file, record);
  },

  reply: async (a, ctx) => {
    if (!ctx.settings.allowReply) {
      throw new Error('azione "reply" disabilitata: il progetto è in modalità solo lettura (settings.readOnly)');
    }
    const text = render(a.text, ctx);
    if (!text) throw new Error('reply senza "text"');
    if (!ctx.send) throw new Error('reply: nessuna connessione WhatsApp attiva');
    await ctx.send(ctx.msg.chatJid, { text }, { quoted: ctx.msg.raw });
  },

  shell: async (a, ctx) => {
    if (!ctx.settings.allowShell) throw new Error('azione "shell" disabilitata (settings.allowShell=false)');
    if (!a.command) throw new Error('shell senza "command"');
    const cmd = render(a.command, ctx);
    const { stdout } = await execAsync(cmd, {
      timeout: a.timeoutMs || 30000,
      cwd: a.cwd ? render(a.cwd, ctx) : paths.root,
      env: { ...process.env, WA_TEXT: ctx.text || '', WA_CHAT: ctx.msg.chatJid, WA_SENDER: ctx.msg.senderJid },
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    log.info({ rule: ctx.rule.id, out: stdout.slice(0, 300) }, 'shell eseguito');
  },
};

export const ACTION_TYPES = Object.keys(HANDLERS);

/** Segnaposto riconosciuti da render(): usati da `--check` per scoprire i refusi. */
export const PLACEHOLDERS = [
  'content', 'text', 'transcript', 'chat', 'chatJid', 'sender', 'senderJid',
  'rule', 'ruleName', 'type', 'label', 'confidence', 'date',
];

/**
 * Esegue le azioni di una regola in sequenza.
 * Ritorna { ok, results:[{type, ok, error?}] }.
 */
export async function runActions(actions, ctx) {
  const results = [];
  for (const action of actions) {
    const type = action.type;
    const handler = HANDLERS[type];
    if (!handler) {
      results.push({ type, ok: false, error: `tipo di azione sconosciuto: ${type}` });
      log.error({ type, rule: ctx.rule.id }, 'azione sconosciuta');
      continue;
    }
    try {
      if (ctx.dryRun) {
        log.info(`[dry-run] azione "${type}" su regola "${ctx.rule.id}"${action.file ? ` -> ${action.file}` : ''}${action.url ? ` -> ${action.url}` : ''}`);
        results.push({ type, ok: true, dryRun: true });
        continue;
      }
      await handler(action, ctx);
      results.push({ type, ok: true });
      // Utile con LOG_LEVEL=debug per vedere quali azioni sono davvero partite.
      log.debug({ rule: ctx.rule.id, type }, 'azione eseguita');
    } catch (err) {
      results.push({ type, ok: false, error: err.message });
      log.error({ type, rule: ctx.rule.id, err: err.message }, 'azione fallita');
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
