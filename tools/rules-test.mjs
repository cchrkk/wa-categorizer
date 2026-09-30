// Tests for the matching engine: Unicode boundaries and the \b trap with
// accented characters.
//
//   node tools/rules-test.mjs
import { ruleMatches, auditRegexes, extractCaptures } from '../src/rules.js';
import { render, runActions } from '../src/actions.js';

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

const rule = (textMatch) => ({ id: 'r', name: 'r', match: { textMatch }, classify: null, transcribe: true, actions: [] });
const msg = { chatJid: 'x@s.whatsapp.net', chatName: 'x', senderJid: 'y@s.whatsapp.net', senderName: 'y', isGroup: false, type: 'audio' };
const matches = (textMatch, text) => ruleMatches(rule(textMatch), msg, text).ok;

console.log('\ncontains mode\n');

check('finds an accented word', () => {
  eq(matches({ mode: 'contains', patterns: ['città'] }, 'we go to the città tomorrow'), true);
});

check('is case-insensitive', () => {
  eq(matches({ mode: 'contains', patterns: ['Città'] }, 'we go to the città'), true);
});

check('does not find what is not there', () => {
  eq(matches({ mode: 'contains', patterns: ['sugar'] }, 'two boxes of wine'), false);
});

check('contains has no boundaries: "oro" matches inside "lavoro"', () => {
  eq(matches({ mode: 'contains', patterns: ['oro'] }, 'il mio lavoro'), true);
});

console.log('\nregex mode: the \\b trap\n');

check('\\bcittà\\b does NOT match (\\b only knows [A-Za-z0-9_])', () => {
  eq(matches({ mode: 'regex', patterns: ['\\bcittà\\b'] }, 'we go to the città'), false);
});

check('"città" without \\b matches', () => {
  eq(matches({ mode: 'regex', patterns: ['città'] }, 'we go to the città'), true);
});

check('Unicode boundaries with flags iu match', () => {
  eq(matches({ mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])città(?![\\p{L}\\p{N}])'] }, 'we go to the città'), true);
});

check('Unicode boundaries are not fooled by substrings', () => {
  const pat = { mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])oro(?![\\p{L}\\p{N}])'] };
  eq(matches(pat, 'il mio lavoro'), false, 'it matched "oro" inside "lavoro"');
  eq(matches(pat, 'bring a white oro'), true, 'it did not match "oro" on its own');
});

check('without flags, \\w stays ASCII (previous behaviour)', () => {
  eq(matches({ mode: 'regex', patterns: ['\\d+'] }, '3 boxes'), true);
});

check('an invented flag breaks nothing', () => {
  eq(matches({ mode: 'regex', flags: 'i zzz', patterns: ['città'] }, 'in città'), true);
});

console.log('\nautomatic regex audit\n');

check('flags \\b together with an accented word', () => {
  const p = auditRegexes([rule({ mode: 'regex', patterns: ['\\b(carton|città)\\b'] })]);
  eq(p.length, 1);
});

check('flags it even when the \\b is not attached to the word', () => {
  const p = auditRegexes([rule({ mode: 'regex', patterns: ['\\b\\d+\\s*(carton|città|sugar)\\b'] })]);
  eq(p.length, 1, 'it missed the real-world case, which is the one that matters');
});

check('does not flag when there are no accents', () => {
  const p = auditRegexes([rule({ mode: 'regex', patterns: ['\\b(carton|cartons|kg)\\b'] })]);
  eq(p.length, 0);
});

check('does not flag when there is no \\b', () => {
  const p = auditRegexes([rule({ mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])città(?![\\p{L}\\p{N}])'] })]);
  eq(p.length, 0);
});

check('ignores rules in contains mode', () => {
  const p = auditRegexes([rule({ mode: 'contains', patterns: ['città'] })]);
  eq(p.length, 0);
});

console.log('\ncapture groups (to reuse in actions)\n');

check('extracts a named group', () => {
  const r = extractCaptures(
    { id: 'r', match: { textMatch: { mode: 'regex', flags: 'iu', patterns: ['turn on the (?<room>[\\p{L}]+) light'] } } },
    'turn on the bedroom light',
  );
  eq(r.named.room, 'bedroom');
});

check('extracts numbered groups too', () => {
  const r = extractCaptures({ id: 'r', match: { textMatch: { mode: 'regex', patterns: ['(\\d+)\\s+(boxes)'] } } }, '3 boxes');
  eq(r.list, ['3', 'boxes']);
});

check('null when the mode is not regex', () => {
  eq(extractCaptures({ id: 'r', match: { textMatch: { mode: 'contains', patterns: ['boxes'] } } }, '3 boxes'), null);
});

check('null when the regex does not match', () => {
  eq(extractCaptures({ id: 'r', match: { textMatch: { mode: 'regex', patterns: ['(boxes)'] } } }, 'nothing here'), null);
});

check('{{room}} becomes the captured word', () => {
  const ctx = {
    rule: { id: 'home', name: 'home' },
    msg: { chatName: 'Home', senderName: 'Mario', type: 'text' },
    text: 'turn on the bedroom light',
    captures: { list: ['bedroom'], named: { room: 'bedroom' } },
  };
  eq(render('light.{{room}}', ctx), 'light.bedroom');
  eq(render('room {{1}}', ctx), 'room bedroom');
});

check('an unknown placeholder stays visible', () => {
  const ctx = { rule: { id: 'r', name: 'r' }, msg: {}, text: 'x' };
  eq(render('{{doesnotexist}}', ctx), '{{doesnotexist}}');
});

console.log('\nsending is opt-in (ALLOW_REPLY)\n');

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

const sendCtx = (allowReply) => ({
  rule: { id: 'r', name: 'r' },
  msg: { chatJid: 'x@s.whatsapp.net', senderJid: 'y@s.whatsapp.net' },
  settings: { allowReply },
  sent: [],
});

await checkAsync('the "reply" action is refused while sending is off', async () => {
  const ctx = sendCtx(false);
  ctx.send = async (...args) => ctx.sent.push(args);
  const res = await runActions([{ type: 'reply', text: 'hello' }], ctx);
  eq(res.results[0].ok, false, 'it did not fail');
  if (!/ALLOW_REPLY/.test(res.results[0].error)) {
    throw new Error(`the error does not say how to turn it on: ${res.results[0].error}`);
  }
  eq(ctx.sent.length, 0, 'it sent something anyway');
});

await checkAsync('with sending on, what ha.assist left is what gets sent', async () => {
  const ctx = sendCtx(true);
  ctx.outputs = { assist: 'the kitchen light is on' };
  ctx.send = async (jid, content) => ctx.sent.push({ jid, content });
  const res = await runActions([{ type: 'reply', text: '🤖 {{assist}}' }], ctx);
  eq(res.results[0].ok, true, `it failed: ${res.results[0].error}`);
  eq(ctx.sent.length, 1, 'nothing was sent');
  eq(ctx.sent[0].jid, 'x@s.whatsapp.net');
  eq(ctx.sent[0].content.text, '🤖 the kitchen light is on');
});

console.log(failed ? `\n✗ ${failed} tests failed\n` : '\n✓ rules ok\n');
process.exit(failed ? 1 : 0);
