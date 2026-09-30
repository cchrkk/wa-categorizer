// Logica dell'editor, separata dalla pagina per poterla testare davvero:
// l'evidenziazione e il rientro non dipendono dal DOM.

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// L'ordine nell'alternanza conta poco: il motore prende sempre la
// corrispondenza più a sinistra, quindi un # dentro una stringa resta
// dentro la stringa e non diventa un commento.
const TOKEN = /(?<com>#[^\n]*)|(?<dq>"(?:[^"\\]|\\.)*")|(?<sq>'(?:[^']|'')*')|(?<ph>\{\{[^}]*\}\})|(?<bool>\b(?:true|false|yes|no|null|~)\b)|(?<num>-?\b\d+(?:\.\d+)?\b)/g;

function highlightValue(testo) {
  let out = '';
  let ultimo = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(testo)) !== null) {
    if (m[0] === '') { TOKEN.lastIndex += 1; continue; }
    out += escapeHtml(testo.slice(ultimo, m.index));
    const g = m.groups;
    const cls = g.com ? 't-com' : (g.dq || g.sq) ? 't-str' : g.ph ? 't-ph' : (g.bool || g.num) ? 't-num' : '';
    out += cls ? `<span class="${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
    ultimo = m.index + m[0].length;
  }
  return out + escapeHtml(testo.slice(ultimo));
}

/**
 * Colora un documento YAML. Ritorna l'HTML e la colonna dei numeri di riga.
 *
 * Ogni riga è un <div>: serve a conoscerne l'altezza reale, perché con il
 * testo a capo una riga lunga occupa più righe visive e i numeri di riga
 * devono seguirla (altrimenti si disallineano appena una riga va a capo).
 */
export function highlight(yaml) {
  const righe = String(yaml || '').split('\n');
  const html = [];
  const numeri = [];
  let dentroBlocco = false;
  let indentPadre = -1;

  for (let i = 0; i < righe.length; i++) {
    const riga = righe[i];
    numeri.push(i + 1);
    const indent = (riga.match(/^ */) || [''])[0].length;
    const t = riga.trim();

    // dentro un blocco | o > : tutto ciò che è più indentato è stringa
    if (dentroBlocco && (t === '' || indent > indentPadre)) {
      html.push('<div class="riga">' + (t === '' ? '' : escapeHtml(riga.slice(0, indent)) + `<span class="t-block">${escapeHtml(riga.slice(indent))}</span>`) + '</div>');
      continue;
    }
    dentroBlocco = false;

    if (t === '') { html.push('<div class="riga"></div>'); continue; }
    if (t.startsWith('#')) {
      html.push('<div class="riga">' + escapeHtml(riga.slice(0, indent)) + `<span class="t-com">${escapeHtml(riga.slice(indent))}</span>` + '</div>');
      continue;
    }

    let out = escapeHtml(riga.slice(0, indent));
    let pos = indent;

    const dopoIndent = riga.slice(pos);
    if (dopoIndent === '-' || dopoIndent.startsWith('- ')) {
      out += '<span class="t-dash">-</span>';
      pos += 1;
      const sp = (riga.slice(pos).match(/^ */) || [''])[0];
      out += escapeHtml(sp);
      pos += sp.length;
    }

    const resto = riga.slice(pos);
    const chiave = resto.match(/^([^:\s#][^:]*):(?=\s|$)/);
    if (chiave) {
      out += `<span class="t-key">${escapeHtml(chiave[1])}</span>:`;
      pos += chiave[1].length + 1;
      const sp = (riga.slice(pos).match(/^ */) || [''])[0];
      out += escapeHtml(sp);
      pos += sp.length;
      const valore = riga.slice(pos);
      if (/^[|>][+-]?\d*$/.test(valore)) {
        out += `<span class="t-bool">${escapeHtml(valore)}</span>`;
        dentroBlocco = true;
        indentPadre = indent;
      } else {
        out += highlightValue(valore);
      }
    } else {
      out += highlightValue(resto);
    }
    html.push('<div class="riga">' + out + '</div>');
  }

  // NIENTE separatori fra i div: dentro un contenitore con white-space
  // pre-wrap un \n fra due blocchi genera una riga vuota in più, e le due
  // copie finiscono con altezze diverse (il testo poi scorre rispetto alla
  // selezione). I blocchi bastano da soli a separare le righe.
  return { html: html.join(''), gutter: numeri.join('\n') };
}

/**
 * Rientro di blocco, come in un editor serio.
 * Ritorna { testo, da, a } con il nuovo testo e la nuova selezione,
 * oppure null se non cambia niente.
 *
 * @param {string} valore testo completo
 * @param {number} selDa  inizio selezione
 * @param {number} selA   fine selezione
 * @param {1|-1} direzione +1 indenta, -1 toglie il rientro
 */
export function indentBlock(valore, selDa, selA, direzione) {
  const v = String(valore ?? '');
  const s = Math.max(0, Math.min(selDa, v.length));
  const e = Math.max(s, Math.min(selA, v.length));

  const inizio = v.lastIndexOf('\n', s - 1) + 1;
  let fine = v.indexOf('\n', e);
  if (fine === -1) fine = v.length;
  // se la selezione finisce proprio a inizio riga, quella riga non si tocca
  if (e > s && v[e - 1] === '\n') fine = e - 1;

  const blocco = v.slice(inizio, fine);
  const righe = blocco.split('\n');

  const nuove = direzione > 0
    ? righe.map((r) => (r === '' ? r : `  ${r}`))
    : righe.map((r) => r.replace(/^ {1,2}/, ''));

  const nuovo = nuove.join('\n');
  if (nuovo === blocco) return null;

  let da;
  let a;
  if (s === e) {
    // cursore semplice: resta dov'era, spostato di quanto è cambiato il rientro
    const delta = direzione > 0 ? 2 : nuove[0].length - righe[0].length;
    const pos = Math.max(inizio, s + delta);
    da = pos;
    a = pos;
  } else {
    da = inizio;
    a = inizio + nuovo.length;
  }

  return { testo: v.slice(0, inizio) + nuovo + v.slice(fine), da, a };
}

/**
 * Rientro automatico sull'Invio: dentro una mappa si scende di due spazi,
 * dopo una voce di lista si resta allo stesso livello per aggiungere un fratello.
 */
export function autoIndentRiga(riga) {
  const t = String(riga ?? '').trim();
  const rientro = (String(riga ?? '').match(/^ */) || [''])[0];
  if (t.endsWith(':')) return `${rientro}  `;
  return rientro;
}
