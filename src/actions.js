import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { env, paths } from './config.js';
import { childLogger } from './logger.js';
import { appendJsonl } from './store.js';

const log = childLogger('actions');
const execAsync = promisify(exec);

export function render(template, ctx) {
  if (template == null) return '';
  const map = {
    // valori lasciati dalle azioni precedenti della stessa regola (es. {{assist}})
    ...(ctx.outputs || {}),
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
    fileName: ctx.msg.fileName || '',
    seconds: ctx.msg.seconds ?? '',
    date: new Date().toISOString(),
  };

  // gruppi di cattura della regex: {{1}} {{2}} e i gruppi con nome {{stanza}}
  if (ctx.captures) {
    ctx.captures.list.forEach((v, i) => { map[String(i + 1)] = v; });
    Object.assign(map, ctx.captures.named);
  }

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

async function postJson(url, body, headers = {}, method = 'POST', limit = 500) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(env.actionTimeoutMs),
  });
  // `limit` is for the error message: an answer we mean to use as data (Assist)
  // must not arrive truncated.
  const text = (await res.text()).slice(0, limit);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return text;
}

/** Chiamata a un servizio di Home Assistant. */
async function haCall(pathSuffix, body) {
  if (!env.haUrl || !env.haToken) {
    throw new Error('HA_URL or HA_TOKEN missing in .env (see the Home Assistant section of the docs)');
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
    log[String(a.level || 'info')]({ rule: ctx.rule.id }, render(a.message, ctx) || 'log action');
  },

  'notify.console': async (a, ctx) => {
    log.info(`\n🔔 [${ctx.rule.name}] ${render(a.message, ctx) || ctx.text}\n`);
  },

  'notify.telegram': async (a, ctx) => {
    const token = a.token || env.telegramToken;
    const chatId = a.chatId || env.telegramChatId;
    if (!token || !chatId) throw new Error('telegram not configured (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID)');
    const text = render(a.message, ctx) || `[${ctx.rule.name}] ${ctx.text}`;
    await postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: a.parseMode || 'Markdown',
      disable_web_page_preview: true,
    });
  },

  webhook: async (a, ctx) => {
    if (!a.url) throw new Error('webhook without "url"');
    const body = a.body ? renderDeep(a.body, ctx) : payload(ctx);
    await postJson(render(a.url, ctx), body, renderDeep(a.headers || {}, ctx), a.method || 'POST');
  },

  'ha.webhook': async (a, ctx) => {
    const id = a.webhookId || env.haWebhookId;
    if (!env.haUrl || !id) throw new Error('HA_URL/HA_WEBHOOK_ID not configured');
    await postJson(`${env.haUrl}/api/webhook/${id}`, a.body ? renderDeep(a.body, ctx) : payload(ctx));
  },

  // --- Home Assistant -----------------------------------------------------
  // Tutte queste passano da /api/services/<domain>/<service> con il token
  // long-lived in HA_TOKEN. Vedi la sezione "Home Assistant" del README.

  'ha.service': async (a, ctx) => {
    if (!a.domain || !a.service) throw new Error('ha.service requires "domain" and "service"');
    const data = { ...renderDeep(a.data || {}, ctx) };
    if (a.entityId) data.entity_id = renderDeep(a.entityId, ctx);
    const qs = a.returnResponse ? '?return_response=true' : '';
    await haCall(`${a.domain}/${a.service}${qs}`, data);
  },

  /** Azione generica su una entità: es. "light", "switch", "media_player". */
  'ha.action': async (a, ctx) => {
    const target = renderDeep(a.entityId || a.entity, ctx);
    if (!target) throw new Error('ha.action requires "entityId" (e.g. light.living_room)');
    if (!a.action) throw new Error('ha.action requires "action" (e.g. turn_on, toggle)');
    const [domain] = String(target).split('.');
    const data = { ...renderDeep(a.data || {}, ctx), entity_id: target };
    const qs = a.returnResponse ? '?return_response=true' : '';
    await haCall(`${a.domain || domain}/${a.action}${qs}`, data);
  },

  /** Premere un button (o più di uno). */
  'ha.button': async (a, ctx) => {
    const target = renderDeep(a.button || a.entityId, ctx);
    if (!target) throw new Error('ha.button requires "button" (e.g. button.doorbell)');
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
    const target = renderDeep(a.script || a.entityId, ctx);
    if (!target) throw new Error('ha.script requires "script" (e.g. script.notify_order)');
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
    const target = renderDeep(a.automation || a.entityId, ctx);
    if (!target) throw new Error('ha.automation requires "automation" (e.g. automation.gate)');
    const id = String(target).includes('.') ? String(target) : `automation.${target}`;
    await haCall('automation/trigger', { entity_id: id });
  },

  /** Scorciatoia per notify.<servizio> — il caso più comune. */
  'ha.notify': async (a, ctx) => {
    const service = renderDeep(a.service || a.target, ctx);
    if (!service) throw new Error('ha.notify requires "service" (e.g. mobile_app_my_phone)');
    const body = {
      message: render(a.message ?? '{{content}}', ctx),
      ...(a.title ? { title: render(a.title, ctx) } : {}),
      ...(a.data ? { data: renderDeep(a.data, ctx) } : {}),
    };
    await haCall(`notify/${String(service).replace(/^notify\./, '')}`, body);
  },

  /**
   * Talk to the Home Assistant **Assist** conversation agent.
   *
   * The text goes to /api/conversation/process and the answer is left in
   * `{{assist}}`, ready for the *next* action of the same rule:
   *
   *   - type: ha.assist
   *     text: "{{q}}"
   *   - type: notify.telegram
   *     message: "🤖 {{assist}}"
   *
   * The answer is **not** sent back into the chat: this program never writes
   * into a chat (see the README). It goes wherever you point it — Telegram, a
   * phone notification, the log, a file.
   */
  'ha.assist': async (a, ctx) => {
    if (!env.haUrl || !env.haToken) {
      throw new Error('HA_URL or HA_TOKEN missing in .env (see the Home Assistant section of the docs)');
    }
    const text = render(a.text ?? '{{content}}', ctx).trim();
    if (!text) throw new Error('ha.assist without "text"');

    const body = { text };
    if (a.language) body.language = render(a.language, ctx);
    const agent = a.agentId || a.agent;
    if (agent) body.agent_id = render(agent, ctx);

    const raw = await postJson(
      `${env.haUrl}/api/conversation/process`,
      body,
      { Authorization: `Bearer ${env.haToken}` },
      'POST',
      200000,
    );

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`assist: the answer is not JSON: ${raw.slice(0, 200)}`);
    }

    // { response: { response_type, speech: { plain: { speech: "..." } } } }
    const risposta = parsed?.response || {};
    const answer = risposta.speech?.plain?.speech || risposta.speech?.plain?.text || '';
    ctx.outputs.assist = answer;
    ctx.outputs.assistSpeech = answer;
    if (!answer) log.warn({ rule: ctx.rule.id, type: risposta.response_type }, 'assist answered with an empty text');
  },

  appendJsonl: async (a, ctx) => {
    if (!a.file) throw new Error('appendJsonl without "file"');
    const record = a.fields ? renderDeep(a.fields, ctx) : payload(ctx);
    appendJsonl(a.file, record);
  },

  reply: async (a, ctx) => {
    if (!ctx.settings.allowReply) {
      throw new Error('"reply" action disabled: the project is in read-only mode (settings.readOnly)');
    }
    const text = render(a.text, ctx);
    if (!text) throw new Error('reply without "text"');
    if (!ctx.send) throw new Error('reply: no active WhatsApp connection');
    await ctx.send(ctx.msg.chatJid, { text }, { quoted: ctx.msg.raw });
  },

  shell: async (a, ctx) => {
    if (!ctx.settings.allowShell) throw new Error('"shell" action disabled (settings.allowShell=false)');
    if (!a.command) throw new Error('shell without "command"');
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

/** Segnaposto riconosciuti da render(): usati da `--check` per scoprire i refusi.
 *  Oltre a questi valgono {{1}}, {{2}}... e i gruppi con nome delle regex. */
export const PLACEHOLDERS = [
  'content', 'text', 'transcript', 'chat', 'chatJid', 'sender', 'senderJid',
  'rule', 'ruleName', 'type', 'label', 'confidence', 'fileName', 'seconds', 'date',
  // lasciati dalle azioni precedenti: ha.assist
  'assist', 'assistSpeech',
];

/**
 * Esegue le azioni di una regola in sequenza.
 * Ritorna { ok, results:[{type, ok, error?}] }.
 */
export async function runActions(actions, ctx) {
  const results = [];
  // valore che un'azione lascia a quelle che seguono (es. {{assist}})
  ctx.outputs ||= {};
  for (const action of actions) {
    const type = action.type;
    const handler = HANDLERS[type];
    if (!handler) {
      results.push({ type, ok: false, error: `unknown action type: ${type}` });
      log.error({ type, rule: ctx.rule.id }, 'unknown action');
      continue;
    }
    try {
      if (ctx.dryRun) {
        log.info(`[dry-run] action "${type}" on rule "${ctx.rule.id}"${action.file ? ` -> ${action.file}` : ''}${action.url ? ` -> ${action.url}` : ''}`);
        results.push({ type, ok: true, dryRun: true });
        continue;
      }
      await handler(action, ctx);
      results.push({ type, ok: true });
      // Utile con LOG_LEVEL=debug per vedere quali azioni sono davvero partite.
      log.debug({ rule: ctx.rule.id, type }, 'action executed');
    } catch (err) {
      results.push({ type, ok: false, error: err.message });
      log.error({ type, rule: ctx.rule.id, err: err.message }, 'action failed');
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
