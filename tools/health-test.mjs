// Tests for the health snapshot and for the libsignal watcher.
//
//   node tools/health-test.mjs
import {
  classify,
  installDecryptWatcher,
  readSnapshot,
  runHealth,
  snapshot,
  writeHealth,
  STALE_MS,
  UNHEALTHY_FAILURES,
} from '../src/health.js';

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
function eq(actual, expected, msg = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}\n      expected: ${JSON.stringify(expected)}\n      actual  : ${JSON.stringify(actual)}`);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

const adesso = Date.now();
const sano = (extra = {}) => ({
  updatedAt: new Date(adesso).toISOString(),
  paired: true,
  connected: true,
  lastMessageAt: new Date(adesso).toISOString(),
  messages: 10,
  decrypt: { total: 0, recent10m: 0, lastAt: null, lastAddress: '' },
  ...extra,
});

console.log('\nclassify(): when the instance is healthy\n');

check('connected and reading: healthy', () => {
  eq(classify(sano(), adesso), { ok: true, reasons: [] });
});

check('never paired (still waiting for the QR): healthy, it is not supposed to be online', () => {
  const s = sano({ connected: false, paired: false });
  eq(classify(s, adesso).ok, true);
});

console.log('\nclassify(): when it is not\n');

check('paired but not connected: not healthy', () => {
  const v = classify(sano({ connected: false }), adesso);
  eq(v.ok, false);
  ok(v.reasons.some((r) => /not connected/.test(r)), `unclear reason: ${v.reasons}`);
});

check('a stale snapshot means the process is stuck', () => {
  const v = classify(sano({ updatedAt: new Date(adesso - STALE_MS - 1000).toISOString() }), adesso);
  eq(v.ok, false);
  ok(v.reasons.some((r) => /stuck|old/.test(r)), `unclear reason: ${v.reasons}`);
});

check('no snapshot at all: not healthy', () => {
  eq(classify(null, adesso).ok, false);
});

check(`${UNHEALTHY_FAILURES} undecryptable messages: not healthy, and it says which session`, () => {
  const v = classify(sano({ decrypt: { total: 44, recent10m: UNHEALTHY_FAILURES, lastAt: null, lastAddress: '198264414552088.0' } }), adesso);
  eq(v.ok, false);
  ok(v.reasons.some((r) => r.includes('198264414552088.0')), `the reason does not name the session: ${v.reasons}`);
  ok(v.reasons.some((r) => /could not be decrypted/.test(r)), `unclear reason: ${v.reasons}`);
});

check('one failure is not a crisis', () => {
  eq(classify(sano({ decrypt: { total: 1, recent10m: 1, lastAt: null, lastAddress: 'x.0' } }), adesso).ok, true);
});

console.log('\nthe libsignal watcher\n');

check('it counts the failure, names the session, and swallows the stack trace', () => {
  const printed = [];
  const vero = console.error;
  console.error = (...a) => printed.push(a.join(' ')); // il watcher cattura QUESTO come "originale"
  installDecryptWatcher();
  try {
    // le due righe esatte di libsignal/src/session_cipher.js
    console.error('Failed to decrypt message with any known session...');
    console.error('Session error:Error: Bad MAC Error: Bad MAC', '    at async 198264414552088.0 [as awaitable] (session_cipher.js:171:28)');
    // e una riga normale, che deve continuare a passare
    console.error('this one is a real error and must be visible');
  } finally {
    console.error = vero;
  }

  eq(printed, ['this one is a real error and must be visible'], 'only the unrelated line should have been printed');
  const s = snapshot();
  eq(s.decrypt.total, 1, 'the failure was not counted');
  eq(s.decrypt.lastAddress, '198264414552088.0', 'the session was not recorded');
  ok(s.decrypt.recent10m >= 1, 'it does not show up in the recent window');
});

console.log('\nthe snapshot on disk (what --health reads)\n');

check('write, read back, and the round trip survives', () => {
  writeHealth(true);
  const letto = readSnapshot();
  ok(letto && letto.updatedAt, 'the file was not written or cannot be read');
  ok(typeof letto.decrypt.recent10m === 'number', 'the decrypt counters are missing');
});

check('--health answers with a number: 0 healthy, 1 not', () => {
  const code = runHealth();
  ok(code === 0 || code === 1, `it returned ${code}`);
});

console.log(failed ? `\n✗ ${failed} tests failed\n` : '\n✓ health ok\n');
process.exit(failed ? 1 : 0);
