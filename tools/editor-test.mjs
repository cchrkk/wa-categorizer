// Test della logica dell'editor (src/web/editor.js). Non serve un browser:
// evidenziazione, rientro e rientro automatico sono funzioni pure.
//
//   node tools/editor-test.mjs
import { highlight, indentBlock, autoIndentRiga } from '../src/web/editor.js';

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
  if (avuto !== atteso) {
    throw new Error(`${msg}\n      atteso: ${JSON.stringify(atteso)}\n      avuto : ${JSON.stringify(avuto)}`);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\nevidnziazione YAML\n'.replace('evidnziazione', 'evidenziazione'));

check('chiave, valore e commento finiscono in span distinti', () => {
  const { html } = highlight('nome: valore  # nota');
  ok(html.includes('<span class="t-key">nome</span>'), 'manca la chiave');
  ok(html.includes('<span class="t-com"># nota</span>'), 'manca il commento');
});

check('booleani, numeri e segnaposto', () => {
  const { html } = highlight('a: true\nb: 42\nc: "{{transcript}}"');
  ok(html.includes('<span class="t-num">true</span>'), 'manca il booleano');
  ok(html.includes('<span class="t-num">42</span>'), 'manca il numero');
  // le virgolette vengono escapate in &quot;, quindi non si confronta il testo grezzo
  ok(/<span class="t-str">[^<]*\{\{transcript\}\}[^<]*<\/span>/.test(html), 'manca la stringa col segnaposto');
});

check('un # dentro una stringa NON è un commento', () => {
  const { html } = highlight(`a: 'valore #non commento'`);
  ok(html.includes('t-str'), 'la stringa non è stata riconosciuta');
  ok(!html.includes('t-com'), 'ha scambiato il # per un commento');
});

check('la voce di lista ha il dash colorato', () => {
  const { html } = highlight('rules:\n  - id: x');
  ok(html.includes('<span class="t-dash">-</span>'), 'manca il dash');
  ok(html.includes('<span class="t-key">id</span>'), 'manca la chiave della voce');
});

check('i blocchi | sono trattati come stringhe', () => {
  const { html } = highlight('message: |\n  riga uno\n  riga due\nnext: 1');
  // i <div> non hanno separatori fra loro: si spezza sulla chiusura
  const dentro = html.split('</div>');
  ok(dentro[1].includes('t-block'), 'la prima riga del blocco non è colorata come stringa');
  ok(dentro[2].includes('t-block'), 'la seconda riga del blocco non è colorata come stringa');
  ok(dentro[3].includes('t-key'), 'la riga dopo il blocco non è tornata normale');
});

check('fra i blocchi NON ci sono ritorni a capo', () => {
  // un \n fra due div dentro un pre-wrap crea una riga vuota in più e
  // disallinea le due copie: è il bug che faceva scorrere la selezione
  const { html } = highlight('a: 1\nb: 2\nc: 3');
  ok(!html.includes('\n'), 'c\'è un ritorno a capo fra i blocchi');
});

check('il commento intero è riconosciuto anche indentato', () => {
  const { html } = highlight('    # solo un commento');
  ok(html.includes('<span class="t-com"># solo un commento</span>'), 'commento non riconosciuto');
});

check('l HTML viene neutralizzato, niente injection', () => {
  const { html } = highlight('a: "<img src=x onerror=alert(1)>"');
  ok(!html.includes('<img'), 'il tag è passato grezzo');
  ok(html.includes('&lt;img'), 'non è stato escapato');
});

check('i numeri di riga seguono le righe', () => {
  const { gutter } = highlight('a: 1\nb: 2\nc: 3');
  eq(gutter, '1\n2\n3');
});

console.log('\nrientro con Tab\n');

check('Tab aggiunge due spazi', () => {
  const r = indentBlock('nome: valore', 0, 0, 1);
  eq(r.testo, '  nome: valore');
});

check('il cursore si sposta con il testo', () => {
  const r = indentBlock('nome: valore', 5, 5, 1);
  eq(r.testo, '  nome: valore');
  eq(r.da, 7, 'il cursore non è rimasto dov\'era');
});

check('Shift+Tab toglie il rientro', () => {
  const r = indentBlock('    nome: valore', 6, 6, -1);
  eq(r.testo, '  nome: valore');
});

check('Shift+Tab su riga non indentata non cambia niente', () => {
  eq(indentBlock('nome: valore', 0, 0, -1), null);
});

check('con più righe selezionate le indenta tutte', () => {
  const testo = 'a: 1\nb: 2\nc: 3';
  const r = indentBlock(testo, 0, testo.length, 1);
  eq(r.testo, '  a: 1\n  b: 2\n  c: 3');
  eq(r.da, 0);
  eq(r.a, r.testo.length, 'la selezione non copre il blocco');
});

check('se la selezione finisce a inizio riga, quella riga non si tocca', () => {
  const testo = 'a: 1\nb: 2\nc: 3';
  const r = indentBlock(testo, 0, 5, 1); // selezione = "a: 1\n"
  eq(r.testo, '  a: 1\nb: 2\nc: 3');
});

check('le righe vuote non vengono indentate', () => {
  const r = indentBlock('a: 1\n\nb: 2', 0, 10, 1);
  eq(r.testo, '  a: 1\n\n  b: 2');
});

check('con più righe selezionate toglie il rientro a tutte', () => {
  const testo = '  a: 1\n  b: 2';
  const r = indentBlock(testo, 0, testo.length, -1);
  eq(r.testo, 'a: 1\nb: 2');
});

console.log('\nrientro automatico sull\'Invio\n');

check('dopo una chiave scende di due spazi', () => {
  eq(autoIndentRiga('  match:'), '    ');
});

check('dopo una voce di lista resta allo stesso livello', () => {
  eq(autoIndentRiga('  - id: x'), '  ');
});

check('dentro un blocco | mantiene lo stesso rientro', () => {
  eq(autoIndentRiga('    testo normale'), '    ');
});

console.log(falliti ? `\n✗ ${falliti} test falliti\n` : '\n✓ editor ok\n');
process.exit(falliti ? 1 : 0);
