// Tests for the health snapshot and for the libsignal watcher.
//
//   node tools/health-test.mjs
import {
  classify,
  classifyConsoleLine,
  countFailureBySession,
  forgetQuietSessions,
  readSnapshot,
  recordDecryptFailure,
  restoreSessions,
  runHealth,
  snapshot,
  writeHealth,
  FORGET_QUIET_MS,
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

console.log('\nthe libsignal guard\n');

check('a session dump is dropped: it carries private keys', () => {
  // le righe esatte di libsignal/src/session_record.js
  const chiusa = classifyConsoleLine(['Closing session:', { currentRatchet: { ephemeralKeyPair: { privKey: Buffer.from([1]) } } }]);
  eq(chiusa.action, 'drop');
  eq(chiusa.dump, true, 'it must be recognised as a key dump, not as ordinary noise');
  eq(classifyConsoleLine(['Opening session:', {}]).action, 'drop');
  eq(classifyConsoleLine(['Session already closed', {}]).action, 'drop');
  eq(classifyConsoleLine(['Removing old closed session:', {}]).action, 'drop');
});

check('the decryption noise: the context line is dropped, the error is counted with its session', () => {
  eq(classifyConsoleLine(['Failed to decrypt message with any known session...']).action, 'drop');
  const v = classifyConsoleLine(['Session error:Error: Bad MAC Error: Bad MAC', '    at async 198264414552088.0 [as awaitable] (session_cipher.js:171:28)']);
  eq(v.action, 'count');
  eq(v.address, '198264414552088.0');
  eq(classifyConsoleLine(['Decrypted message with closed session.']).action, 'drop');
  eq(classifyConsoleLine(['Closing open session in favor of incoming prekey bundle']).action, 'drop');
});

check('anything that is not libsignal noise passes through', () => {
  eq(classifyConsoleLine(['a real error']).action, 'pass');
  eq(classifyConsoleLine([new Error('boom')]).action, 'pass');
  eq(classifyConsoleLine(['Closing session:', {}]).action, 'drop'); // e questa no, per contrasto
});

check('a counted failure lands in the snapshot, once, with the session', () => {
  const prima = snapshot().decrypt.total;
  recordDecryptFailure('198264414552088.0');
  const s = snapshot();
  eq(s.decrypt.total - prima, 1, 'it was not counted exactly once');
  eq(s.decrypt.lastAddress, '198264414552088.0', 'the session was not recorded');
  ok(s.decrypt.recent10m >= 1, 'it does not show up in the recent window');
});

console.log('\none alert per session, not a barrage\n');

check('below the threshold it says nothing', () => {
  const sessions = new Map();
  let avvisi = 0;
  for (let i = 1; i < UNHEALTHY_FAILURES; i++) {
    if (countFailureBySession(sessions, 'x.0', adesso).alert) avvisi += 1;
  }
  eq(avvisi, 0, `it alerted before the threshold (${UNHEALTHY_FAILURES})`);
});

check('crossing the threshold alerts once, then it stays quiet', () => {
  const sessions = new Map();
  let avvisi = 0;
  for (let i = 0; i < UNHEALTHY_FAILURES * 5; i++) {
    if (countFailureBySession(sessions, 'x.0', adesso).alert) avvisi += 1;
  }
  eq(avvisi, 1, `it alerted ${avvisi} times instead of once`);
  eq(sessions.get('x.0').alerted, true, 'the session is not marked as already reported');
  eq(sessions.get('x.0').count, UNHEALTHY_FAILURES * 5, 'the counter is wrong');
});

check('a second session gets its own alert', () => {
  const sessions = new Map();
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) countFailureBySession(sessions, 'a.0', adesso);
  let avvisi = 0;
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) {
    if (countFailureBySession(sessions, 'b.0', adesso).alert) avvisi += 1;
  }
  eq(avvisi, 1, 'the second session went unreported');
});

check('a session that has been quiet is forgotten, so a new episode is heard', () => {
  const sessions = new Map();
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) countFailureBySession(sessions, 'x.0', adesso);
  eq(forgetQuietSessions(sessions, adesso + FORGET_QUIET_MS + 1000), 1, 'it did not forget it');
  eq(sessions.size, 0, 'the session is still there');
  let avvisi = 0;
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) {
    if (countFailureBySession(sessions, 'x.0', adesso + FORGET_QUIET_MS + 2000).alert) avvisi += 1;
  }
  eq(avvisi, 1, 'the new episode was not reported');
});

check('a session still busy is not forgotten', () => {
  const sessions = new Map();
  countFailureBySession(sessions, 'x.0', adesso);
  eq(forgetQuietSessions(sessions, adesso + 1000), 0);
  eq(sessions.size, 1);
});

check('a session already reported before a restart does not report again', () => {
  const sessions = new Map();
  const snap = { decrypt: { sessions: [{ address: 'x.0', count: 40, lastAt: new Date(adesso).toISOString(), alerted: true }] } };
  eq(restoreSessions(sessions, snap, adesso), 1, 'it did not restore the session');
  let avvisi = 0;
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) {
    if (countFailureBySession(sessions, 'x.0', adesso).alert) avvisi += 1;
  }
  eq(avvisi, 0, 'the backlog that came back after the restart made it alert again');
});

check('a session silent for half an hour is a new story', () => {
  const sessions = new Map();
  const vecchia = new Date(adesso - FORGET_QUIET_MS - 60000).toISOString();
  const snap = { decrypt: { sessions: [{ address: 'x.0', count: 40, lastAt: vecchia, alerted: true }] } };
  eq(restoreSessions(sessions, snap, adesso), 0, 'it restored a session that had been quiet for too long');
  let avvisi = 0;
  for (let i = 0; i < UNHEALTHY_FAILURES; i++) {
    if (countFailureBySession(sessions, 'x.0', adesso).alert) avvisi += 1;
  }
  eq(avvisi, 1, 'the new break was not reported');
});

check('nothing to restore is not an error', () => {
  eq(restoreSessions(new Map(), null, adesso), 0);
  eq(restoreSessions(new Map(), {}, adesso), 0);
  eq(restoreSessions(new Map(), { decrypt: {} }, adesso), 0);
  eq(restoreSessions(new Map(), { decrypt: { sessions: [{ address: '' }] } }, adesso), 0);
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
