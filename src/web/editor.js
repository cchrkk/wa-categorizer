// Editor logic, kept away from the page so it can actually be tested:
// highlighting, indentation and auto-indent do not depend on the DOM.

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Order in the alternation matters little: the engine always takes the
// leftmost match, so a # inside a string stays inside the string and does not
// become a comment.
const TOKEN = /(?<com>#[^\n]*)|(?<dq>"(?:[^"\\]|\\.)*")|(?<sq>'(?:[^']|'')*')|(?<ph>\{\{[^}]*\}\})|(?<bool>\b(?:true|false|yes|no|null|~)\b)|(?<num>-?\b\d+(?:\.\d+)?\b)/g;

function highlightValue(text) {
  let out = '';
  let last = 0;
  let m;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m[0] === '') { TOKEN.lastIndex += 1; continue; }
    out += escapeHtml(text.slice(last, m.index));
    const g = m.groups;
    const cls = g.com ? 't-com' : (g.dq || g.sq) ? 't-str' : g.ph ? 't-ph' : (g.bool || g.num) ? 't-num' : '';
    out += cls ? `<span class="${cls}">${escapeHtml(m[0])}</span>` : escapeHtml(m[0]);
    last = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

/**
 * Colours a YAML document. Returns the HTML and the line-number column.
 *
 * Each line is a <div>: that is needed to know its real height, because with
 * wrapping on, a long line occupies several visual rows and the line numbers
 * have to follow it (otherwise they drift as soon as a line wraps).
 */
export function highlight(yaml) {
  const lines = String(yaml || '').split('\n');
  const html = [];
  const numbers = [];
  let insideBlock = false;
  let blockIndent = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    numbers.push(i + 1);
    const indent = (line.match(/^ */) || [''])[0].length;
    const t = line.trim();

    // inside a | or > block: anything more indented is a string
    if (insideBlock && (t === '' || indent > blockIndent)) {
      html.push('<div class="line">' + (t === '' ? '' : escapeHtml(line.slice(0, indent)) + `<span class="t-block">${escapeHtml(line.slice(indent))}</span>`) + '</div>');
      continue;
    }
    insideBlock = false;

    if (t === '') { html.push('<div class="line"></div>'); continue; }
    if (t.startsWith('#')) {
      html.push('<div class="line">' + escapeHtml(line.slice(0, indent)) + `<span class="t-com">${escapeHtml(line.slice(indent))}</span>` + '</div>');
      continue;
    }

    let out = escapeHtml(line.slice(0, indent));
    let pos = indent;

    const afterIndent = line.slice(pos);
    if (afterIndent === '-' || afterIndent.startsWith('- ')) {
      out += '<span class="t-dash">-</span>';
      pos += 1;
      const sp = (line.slice(pos).match(/^ */) || [''])[0];
      out += escapeHtml(sp);
      pos += sp.length;
    }

    const rest = line.slice(pos);
    const key = rest.match(/^([^:\s#][^:]*):(?=\s|$)/);
    if (key) {
      out += `<span class="t-key">${escapeHtml(key[1])}</span>:`;
      pos += key[1].length + 1;
      const sp = (line.slice(pos).match(/^ */) || [''])[0];
      out += escapeHtml(sp);
      pos += sp.length;
      const value = line.slice(pos);
      if (/^[|>][+-]?\d*$/.test(value)) {
        out += `<span class="t-bool">${escapeHtml(value)}</span>`;
        insideBlock = true;
        blockIndent = indent;
      } else {
        out += highlightValue(value);
      }
    } else {
      out += highlightValue(rest);
    }
    html.push('<div class="line">' + out + '</div>');
  }

  // NO separators between the divs: inside a container with white-space
  // pre-wrap a \n between two blocks adds an extra empty line, and the two
  // copies end up with different heights (the text then scrolls out of step
  // with the selection). The blocks separate the lines on their own.
  return { html: html.join(''), gutter: numbers.join('\n') };
}

/**
 * Block indentation, like in a real editor.
 *
 * Returns `{ text, from, to, selectionStart, selectionEnd }`: `text` replaces
 * exactly `[from, to)` in the current value, and the selection then goes to
 * `[selectionStart, selectionEnd)`. Null when nothing changes.
 *
 * `text` being *only the block* is the point, not a detail: when it returned
 * the whole document while the caller replaced the selection, every Tab key
 * inserted a copy of the file at the caret — the document doubled each time
 * and the browser tab died after a few presses.
 *
 * @param {string} value   the whole text
 * @param {number} selFrom selection start
 * @param {number} selTo   selection end
 * @param {1|-1} direction +1 indent, -1 outdent
 */
export function indentBlock(value, selFrom, selTo, direction) {
  const v = String(value ?? '');
  const s = Math.max(0, Math.min(selFrom, v.length));
  const e = Math.max(s, Math.min(selTo, v.length));

  const start = v.lastIndexOf('\n', s - 1) + 1;
  let end = v.indexOf('\n', e);
  if (end === -1) end = v.length;
  // if the selection ends exactly at a line start, that line is left alone
  if (e > s && v[e - 1] === '\n') end = e - 1;

  const block = v.slice(start, end);
  const lines = block.split('\n');

  const updated = direction > 0
    ? lines.map((l) => (l === '' ? l : `  ${l}`))
    : lines.map((l) => l.replace(/^[ \t]{1,2}/, ''));

  const next = updated.join('\n');
  if (next === block) return null;

  let careta;
  let caretb;
  if (s === e) {
    // collapsed caret: it stays where it was, shifted by how much the
    // indentation of that line changed
    const delta = direction > 0 ? 2 : updated[0].length - lines[0].length;
    const pos = Math.max(start, s + delta);
    careta = pos;
    caretb = pos;
  } else {
    careta = start;
    caretb = start + next.length;
  }

  return { text: next, from: start, to: end, selectionStart: careta, selectionEnd: caretb };
}

/**
 * Auto-indent on Enter: inside a mapping it goes down two spaces, after a list
 * item it stays at the same level so you can add a sibling.
 */
export function autoIndentLine(line) {
  const t = String(line ?? '').trim();
  const indent = (String(line ?? '').match(/^ */) || [''])[0];
  if (t.endsWith(':')) return `${indent}  `;
  return indent;
}
