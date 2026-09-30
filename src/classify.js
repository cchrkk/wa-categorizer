import { env } from './config.js';
import { childLogger } from './logger.js';

const log = childLogger('classify');

/**
 * Classificazione opzionale via LLM.
 * Ritorna { label, confidence, reason } oppure null se non configurato.
 */
export async function classify({ text, labels, model, context = '' }) {
  if (!text || !labels?.length) return null;
  if (!env.openaiKey) {
    log.warn('rule.classify requested but OPENAI_API_KEY is empty: skipping classification');
    return null;
  }

  const prompt = [
    'You are a WhatsApp message classifier. Reply with valid JSON only.',
    `Possible labels: ${labels.join(', ')}.`,
    'If no label fits, use "none".',
    'Format: {"label":"...","confidence":0.0-1.0,"reason":"short"}',
    context ? `Context: ${context}` : '',
    `Message: """${text.slice(0, 4000)}"""`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await requestClassification({ text, labels, model, prompt });
    log.info(result, 'classification');
    return result;
  } catch (err) {
    log.warn({ err: err.message }, 'classification failed, the rule does not filter');
    return null;
  }
}

async function requestClassification({ model, prompt }) {
  // Il JSON mode non è supportato da tutti i modelli/endpoint: se rifiutato, riprovo senza.
  const payload = (jsonMode) => ({
    model: model || env.openaiClassifyModel,
    temperature: 0,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [{ role: 'user', content: prompt }],
  });

  const call = (body) =>
    fetch(`${env.openaiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.actionTimeoutMs * 2),
    });

  let res = await call(payload(true));
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    log.debug('JSON mode rifiutato, riprovo senza');
    res = await call(payload(false));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = parseJsonLoose(content);
  return {
    label: String(parsed.label || 'none').toLowerCase(),
    confidence: Number(parsed.confidence ?? 0.5),
    reason: parsed.reason || '',
  };
}

/** Accetta JSON puro oppure JSON dentro del testo/markdown. */
function parseJsonLoose(content) {
  try {
    return JSON.parse(content);
  } catch { /* provo a estrarre */ }
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`response is not JSON: ${String(content).slice(0, 120)}`);
  return JSON.parse(match[0]);
}
