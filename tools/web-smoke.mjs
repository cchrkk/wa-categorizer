// Smoke test for the web panel: starts the server on a test port working on a
// COPY of the rules (the real file is never touched), exercises the endpoints
// and prints PASS/FAIL. Exits with code 1 if anything fails.
//
//   node tools/web-smoke.mjs
//
// If OPENAI_API_KEY is configured, it also tests transcribing a voice note.
import fs from 'node:fs';
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { startWeb } from '../src/web.js';
import { _state } from '../src/contacts.js';

const PORT = Number(process.env.SMOKE_PORT || 8199);
const TOKEN = 'smoke-test-token';
const base = `http://127.0.0.1:${PORT}`;
const H = { Authorization: `Bearer ${TOKEN}` };

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// --- everything happens on a copy: the real file is never touched ---
const dir = path.join(paths.data, 'out', 'smoke');
fs.mkdirSync(dir, { recursive: true });
const rules = path.join(dir, 'rules.smoke.yaml');

// The example, plus a rule that matches on the *jid* instead of the name and
// fires on your own messages. It is the case the test bench could not express
// at all, so it gets a regression test of its own.
const example = fs.readFileSync(path.join(paths.root, 'config', 'rules.example.yaml'), 'utf8');
fs.writeFileSync(rules, example.replace('processOwnMessages: false', 'processOwnMessages: true') + `
  - id: smoke-self
    name: "Smoke — my own messages"
    priority: 1
    enabled: true

    match:
      senderJid: "@me"
      type: [text, audio]

    actions:
      - type: notify.console
        message: "{{content}}"
`);

paths.rulesFile = rules;

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
  console.log(`\npanel on ${base}\n`);

  await check('GET / serves the page', async () => {
    const r = await fetch(`${base}/`);
    const t = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(t.includes('wa-categorizer'), 'the page does not contain the title');
  });

  await check('without a token it answers 401', async () => {
    const { status } = await j(await fetch(`${base}/api/state`));
    assert(status === 401, `status ${status}`);
  });

  await check('GET /api/state lists the rules', async () => {
    const { status, body } = await j(await fetch(`${base}/api/state`, { headers: H }));
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.rules), 'rules missing');
    assert(body.rules.length > 0, 'no rules loaded');
    assert(typeof body.yaml === 'string' && body.yaml.length > 0, 'empty yaml');
  });

  await check('POST /api/test explains the match', async () => {
    const { status, body } = await j(await fetch(`${base}/api/test`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatName: 'Orders', senderName: 'Mario', text: 'we need 3 boxes of red', type: 'text' }),
    }));
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(body.rules), 'per-rule diagnostics missing');
    assert(body.rules.every((r) => Array.isArray(r.failed)), 'the failed field is missing');
    assert(body.matched.length > 0, 'no rule fired on an obvious order');
  });

  await check('POST /api/test reports which criterion failed', async () => {
    const { body } = await j(await fetch(`${base}/api/test`, {
      method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatName: 'Wrong chat', text: 'hello', type: 'text' }),
    }));
    const withFailures = body.rules.filter((r) => !r.matched && r.failed.length > 0);
    assert(withFailures.length > 0, 'no rule reports failed criteria');
    assert(body.matched.length === 0, 'nothing should have fired');
  });

  await check('POST /api/test resolves @me to your real account', async () => {
    const prev = _state.me;
    _state.me = { id: '390000000009@s.whatsapp.net', lid: '111222333444555@lid', jid: '390000000009@s.whatsapp.net', name: 'Smoke' };
    try {
      const { status, body } = await j(await fetch(`${base}/api/test`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatName: 'Anything', senderJid: '@me', fromMe: true, text: 'hello', type: 'text' }),
      }));
      assert(status === 200, `status ${status}: ${body.error || ''}`);
      assert(body.matched.includes('smoke-self'), `the "@me" rule did not fire: ${JSON.stringify(body.matched)}`);
    } finally {
      _state.me = prev;
    }
  });

  await check('@me without a paired account is explained, not silently failed', async () => {
    const prev = _state.me;
    _state.me = null;
    try {
      const { status, body } = await j(await fetch(`${base}/api/test`, {
        method: 'POST',
        headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderJid: '@me', text: 'hello', type: 'text' }),
      }));
      assert(status === 400, `status ${status} (expected 400, not a silent match failure)`);
      assert(/@me/.test(body.error || ''), `the error does not mention @me: ${body.error}`);
    } finally {
      _state.me = prev;
    }
  });

  await check('PUT /api/rules REFUSES broken yaml and does not touch the file', async () => {
    const before = fs.readFileSync(rules, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: 'rules:\n  - id: x\n  zz: 1\n  zz: 2\n' }),
    }));
    assert(status === 400, `it should have refused, status ${status}`);
    assert(/valid|unique|keys/i.test(body.error || ''), `unclear error: ${body.error}`);
    assert(fs.readFileSync(rules, 'utf8') === before, 'the file on disk changed!');
  });

  await check('GET /editor.js serves the editor module', async () => {
    const r = await fetch(`${base}/editor.js`);
    const t = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(t.includes('export function highlight'), 'that is not the right module');
  });

  await check('GET /logo.svg serves the icon', async () => {
    const r = await fetch(`${base}/logo.svg`);
    const t = await r.text();
    assert(r.status === 200, `status ${r.status}`);
    assert(t.includes('<svg'), 'that is not an svg');
  });

  await check('PUT /api/rules with dryRun validates and does NOT write', async () => {
    const before = fs.readFileSync(rules, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: before, dryRun: true }),
    }));
    assert(status === 200, `status ${status}`);
    assert(body.validated === true, 'it did not report the validation');
    assert(fs.readFileSync(rules, 'utf8') === before, 'it wrote despite dryRun');
  });

  await check('PUT /api/rules accepts valid yaml', async () => {
    const good = fs.readFileSync(rules, 'utf8');
    const { status, body } = await j(await fetch(`${base}/api/rules`, {
      method: 'PUT',
      headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: good }),
    }));
    assert(status === 200, `status ${status}: ${body.error || ''}`);
    assert(body.rules > 0, 'no rules active after saving');
  });

  if (process.env.OPENAI_API_KEY) {
    await check('POST /api/test-audio transcribes a voice note', async () => {
      const audio = path.join(paths.data, 'samples', 'note.ogg');
      assert(fs.existsSync(audio), `${audio} is missing (create it with tools/make-sample-audio.ps1)`);
      const r = await fetch(`${base}/api/test-audio?chatName=Orders&senderName=Mario&ext=ogg`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' },
        body: fs.readFileSync(audio),
      });
      const body = await r.json();
      assert(r.status === 200, `status ${r.status}: ${body.error || ''}`);
      assert(body.transcript && body.transcript.length > 5, `empty transcript: ${JSON.stringify(body.transcript)}`);
      console.log(`      → "${body.transcript}"`);
    });
  } else {
    console.log('  · skipping the voice note test (OPENAI_API_KEY not configured)');
  }
} finally {
  web.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? `\n✗ ${failed} tests failed\n` : '\n✓ web panel ok\n');
process.exit(failed ? 1 : 0);
