// Smoke test del pannello web: avvia il server su una porta di prova, lavorando
// su una COPIA delle regole (il file vero non viene toccato), esercita gli
// endpoint e stampa PASS/FAIL. Esce con codice 1 se qualcosa fallisce.
//
//   node tools/web-smoke.mjs
//
// Se OPENAI_API_KEY è configurata prova anche la trascrizione di un vocale.
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { startWeb } from '../src/web.js';

const PORT = Number(process.env.SMOKE_PORT || 8199);
const TOKEN = 'token-di-prova';
const base = `http://127.0.0.1:${PORT}`;
const H = { Authorization: `Bearer ${TOKEN}` };

let falliti = 0;
async function check(nome, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    falliti += 1;
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- si lavora su una copia: il file vero non si tocca mai ---
const dir = path.join(paths.data, 'out', 'smoke');
fs.mkdirSync(dir, { recursive: true });
const regole = path.join(dir, 'rules.smoke.yaml');
fs.copyFileSync(path.join(paths.root, 'config', 'rules.example.yaml'), regole);
paths.rulesFile = regole;

let config = loadConfig();
const web = await startWeb({
  port: PORT,
  host: '127.0.0.1',
  token: TOKEN,
  getConfig: () => config,
  reload: async () => {
    config = loadConfig();
    return config;
  },
});

const j = async (r) => ({ status: r.status, body: await r.json() });

try {
  console.log(`\npannello su ${base}\n`);

  await check('GET / serve la pagina', async () => {
    const r = await fetch(`${base}/`);
    const t = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(t.includes('wa-categorizer'), 'la pagina non contiene il titolo');
  });

  await check('senza token risponde 401', async () => {
    const { status } = await j(await fetch(`${base}/api/state`));
    assert(status === 401, `status ${status}`);
  });

  await check('GET /api/state elenca le regole', async () => {
    const { status, body } = await j(await fetch(`${base}/api/state`, { headers: H }));
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.rules), 'manca rules');
    assert(body.rules.length > 0, 'nessuna regola caricata');
    assert(typeof body.yaml === 'string' && body.yaml.length > 0, 'yaml vuoto');
  });

  await check('POST /api/test spiega il match', async () => {
    const { status, body } = await j(await fetch(`${base}/api/test`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatName: 'Ordini', senderName: 'Mario', text: 'servono 3 casse di rosso', type: 'text' }),
    }));
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.rules), 'manca la diagnostica per regola');
    assert(body.rules.every((r) => Array.isArray(r.failed)), 'manca il campo failed');
    assert(body.matched.length > 0, 'nessuna regola attivata su un ordine evidente');
  });

  await check('POST /api/test dice quale criterio fallisce', async () => {
    const { body } = await j(await fetch(`${base}/api/test`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatName: 'Chat sbagliata', text: 'ciao', type: 'text' }),
    }));
    const conFallimenti = body.rules.filter((r) => !r.matched && r.failed.length > 0);
    assert(conFallimenti.length > 0, 'nessuna regola riporta i criteri falliti');
    assert(body.matched.length === 0, 'non doveva attivare niente');
  });

  await check('PUT /api/rules RIFIUTA yaml rotto e non tocca il file', async () => {
    const prima = fs.readFileSync(regole, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: 'rules:\n  - id: x\n  zz: 1\n  zz: 2\n' }),
    }));
    assert(status === 400, `doveva rifiutare, status ${status}`);
    assert(/valido|unique|keys/i.test(body.error || ''), `errore poco chiaro: ${body.error}`);
    assert(fs.readFileSync(regole, 'utf8') === prima, 'il file su disco è cambiato!');
  });

  await check('GET /editor.js serve il modulo dell editor', async () => {
    const r = await fetch(`${base}/editor.js`);
    const t = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(t.includes('export function highlight'), 'il modulo non è quello giusto');
  });

  await check('PUT /api/rules con dryRun valida e NON scrive', async () => {
    const prima = fs.readFileSync(regole, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: prima, dryRun: true }),
    }));
    assert(status === 200, `status ${status}`);
    assert(body.validated === true, 'non ha segnalato la validazione');
    assert(fs.readFileSync(regole, 'utf8') === prima, 'ha scritto nonostante dryRun');
  });

  await check('PUT /api/rules accetta yaml valido', async () => {
    const buono = fs.readFileSync(regole, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: buono }),
    }));
    assert(status === 200, `status ${status}: ${body.error || ''}`);
    assert(body.rules > 0, 'nessuna regola attiva dopo il salvataggio');
  });

  if (process.env.OPENAI_API_KEY) {
    await check('POST /api/test-audio trascrive un vocale', async () => {
      const audio = path.join(paths.data, 'samples', 'nota.ogg');
      assert(fs.existsSync(audio), `serve ${audio} (crealo con tools/make-sample-audio.ps1)`);
      const r = await fetch(`${base}/api/test-audio?chatName=Ordini&senderName=Mario&ext=ogg`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' },
        body: fs.readFileSync(audio),
      });
      const body = await r.json();
      assert(r.status === 200, `status ${r.status}: ${body.error || ''}`);
      assert(body.transcript && body.transcript.length > 5, `trascrizione vuota: ${JSON.stringify(body.transcript)}`);
      console.log(`      → "${body.transcript}"`);
    });
  } else {
    console.log('  · salto la prova del vocale (OPENAI_API_KEY non configurata)');
  }
} finally {
  web.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(falliti ? `\n✗ ${falliti} test falliti\n` : '\n✓ pannello web ok\n');
process.exit(falliti ? 1 : 0);
