// Test del motore di match: confini unicode e trappola del \b con gli accenti.
//
//   node tools/rules-test.mjs
import { ruleMatches, auditRegexes } from '../src/rules.js';

let falliti = 0;
function check(nome, fn) {
  try {
    fn();
    console.log(`  ✓ ${nome}`);
  } catch (err) {
    falliti += 1;
    console.log(`  ✗ ${nome}\n      ${err.message}`);
  }
}
function eq(avuto, atteso, msg = '') {
  if (JSON.stringify(avuto) !== JSON.stringify(atteso)) {
    throw new Error(`${msg}\n      atteso: ${JSON.stringify(atteso)}\n      avuto : ${JSON.stringify(avuto)}`);
  }
}

const regola = (textMatch) => ({ id: 'r', name: 'r', match: { textMatch }, classify: null, transcribe: true, actions: [] });
const msg = { chatJid: 'x@s.whatsapp.net', chatName: 'x', senderJid: 'y@s.whatsapp.net', senderName: 'y', isGroup: false, type: 'audio' };
const matcha = (textMatch, testo) => ruleMatches(regola(textMatch), msg, testo).ok;

console.log('\nmodalità contains\n');

check('trova una parola accentata', () => {
  eq(matcha({ mode: 'contains', patterns: ['città'] }, 'andiamo in città domani'), true);
});

check('è case-insensitive', () => {
  eq(matcha({ mode: 'contains', patterns: ['Città'] }, 'andiamo in città'), true);
});

check('non trova quello che non c è', () => {
  eq(matcha({ mode: 'contains', patterns: ['zucchero'] }, 'due casse di vino'), false);
});

check('contains non ha confini: "oro" entra in "lavoro"', () => {
  eq(matcha({ mode: 'contains', patterns: ['oro'] }, 'il mio lavoro'), true);
});

console.log('\nmodalità regex: la trappola del \\b\n');

check('\\bcittà\\b NON matcha (\\b conosce solo [A-Za-z0-9_])', () => {
  eq(matcha({ mode: 'regex', patterns: ['\\bcittà\\b'] }, 'andiamo in città'), false);
});

check('"città" senza \\b matcha', () => {
  eq(matcha({ mode: 'regex', patterns: ['città'] }, 'andiamo in città'), true);
});

check('i confini unicode con flags iu matchano', () => {
  eq(matcha({ mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])città(?![\\p{L}\\p{N}])'] }, 'andiamo in città'), true);
});

check('i confini unicode non si lasciano ingannare dalle sottostringhe', () => {
  const pat = { mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])oro(?![\\p{L}\\p{N}])'] };
  eq(matcha(pat, 'il mio lavoro'), false, 'ha matchato "oro" dentro "lavoro"');
  eq(matcha(pat, 'portare un oro bianco'), true, 'non ha matchato "oro" da solo');
});

check('senza flags restano i \\w ASCII (comportamento di prima)', () => {
  eq(matcha({ mode: 'regex', patterns: ['\\d+'] }, '3 casse'), true);
});

check('un flag inventato non rompe niente', () => {
  eq(matcha({ mode: 'regex', flags: 'i zzz', patterns: ['città'] }, 'in città'), true);
});

console.log('\ncontrollo automatico delle regex\n');

check('segnala \\b con una parola accentata', () => {
  const p = auditRegexes([regola({ mode: 'regex', patterns: ['\\b(cartone|città)\\b'] })]);
  eq(p.length, 1);
});

check('segnala anche quando il \\b non è attaccato alla parola', () => {
  const p = auditRegexes([regola({ mode: 'regex', patterns: ['\\b\\d+\\s*(cartone|città|zucchero)\\b'] })]);
  eq(p.length, 1, 'non ha visto il caso reale, che è quello che conta');
});

check('non segnala se non ci sono accenti', () => {
  const p = auditRegexes([regola({ mode: 'regex', patterns: ['\\b(cartone|cartoni|kg)\\b'] })]);
  eq(p.length, 0);
});

check('non segnala se non c è \\b', () => {
  const p = auditRegexes([regola({ mode: 'regex', flags: 'iu', patterns: ['(?<![\\p{L}\\p{N}])città(?![\\p{L}\\p{N}])'] })]);
  eq(p.length, 0);
});

check('non guarda le regole in modalità contains', () => {
  const p = auditRegexes([regola({ mode: 'contains', patterns: ['città'] })]);
  eq(p.length, 0);
});

console.log(falliti ? `\n✗ ${falliti} test falliti\n` : '\n✓ regole ok\n');
process.exit(falliti ? 1 : 0);
