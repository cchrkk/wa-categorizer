// Tests for the editor logic (src/web/editor.js). No browser needed:
// highlighting, indentation and auto-indent are pure functions.
//
//   node tools/editor-test.mjs
import { highlight, indentBlock, autoIndentRiga } from '../src/web/editor.js';

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
  if (actual !== expected) {
    throw new Error(`${msg}\n      expected: ${JSON.stringify(expected)}\n      actual  : ${JSON.stringify(actual)}`);
  }
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\nYAML highlighting\n');

check('key, value and comment end up in distinct spans', () => {
  const { html } = highlight('name: value  # note');
  ok(html.includes('<span class="t-key">name</span>'), 'the key is missing');
  ok(html.includes('<span class="t-com"># note</span>'), 'the comment is missing');
});

check('booleans, numbers and placeholders', () => {
  const { html } = highlight('a: true\nb: 42\nc: "{{transcript}}"');
  ok(html.includes('<span class="t-num">true</span>'), 'the boolean is missing');
  ok(html.includes('<span class="t-num">42</span>'), 'the number is missing');
  // quotes are escaped to &quot;, so the raw text is not compared
  ok(/<span class="t-str">[^<]*\{\{transcript\}\}[^<]*<\/span>/.test(html), 'the string with the placeholder is missing');
});

check('a # inside a string is NOT a comment', () => {
  const { html } = highlight(`a: 'value #not a comment'`);
  ok(html.includes('t-str'), 'the string was not recognised');
  ok(!html.includes('t-com'), 'it mistook the # for a comment');
});

check('a list item has a highlighted dash', () => {
  const { html } = highlight('rules:\n  - id: x');
  ok(html.includes('<span class="t-dash">-</span>'), 'the dash is missing');
  ok(html.includes('<span class="t-key">id</span>'), 'the item key is missing');
});

check('| blocks are treated as strings', () => {
  const { html } = highlight('message: |\n  line one\n  line two\nnext: 1');
  // the <div>s have no separators between them: split on the closing tag
  const inside = html.split('</div>');
  ok(inside[1].includes('t-block'), 'the first line of the block is not coloured as a string');
  ok(inside[2].includes('t-block'), 'the second line of the block is not coloured as a string');
  ok(inside[3].includes('t-key'), 'the line after the block did not go back to normal');
});

check('there are NO newlines between the blocks', () => {
  // a \n between two divs inside a pre-wrap container adds an extra empty
  // line and desynchronises the two copies: that was the bug that made the
  // selection scroll out of place
  const { html } = highlight('a: 1\nb: 2\nc: 3');
  ok(!html.includes('\n'), 'there is a newline between the blocks');
});

check('a full-line comment is recognised even when indented', () => {
  const { html } = highlight('    # just a comment');
  ok(html.includes('<span class="t-com"># just a comment</span>'), 'comment not recognised');
});

check('HTML is neutralised, no injection', () => {
  const { html } = highlight('a: "<img src=x onerror=alert(1)>"');
  ok(!html.includes('<img'), 'the tag went through raw');
  ok(html.includes('&lt;img'), 'it was not escaped');
});

check('line numbers follow the lines', () => {
  const { gutter } = highlight('a: 1\nb: 2\nc: 3');
  eq(gutter, '1\n2\n3');
});

console.log('\nTab indentation\n');

check('Tab adds two spaces', () => {
  const r = indentBlock('name: value', 0, 0, 1);
  eq(r.testo, '  name: value');
});

check('the caret moves with the text', () => {
  const r = indentBlock('name: value', 5, 5, 1);
  eq(r.testo, '  name: value');
  eq(r.da, 7, 'the caret did not stay where it was');
});

check('Shift+Tab removes the indentation', () => {
  const r = indentBlock('    name: value', 6, 6, -1);
  eq(r.testo, '  name: value');
});

check('Shift+Tab on an unindented line changes nothing', () => {
  eq(indentBlock('name: value', 0, 0, -1), null);
});

check('with several lines selected it indents them all', () => {
  const text = 'a: 1\nb: 2\nc: 3';
  const r = indentBlock(text, 0, text.length, 1);
  eq(r.testo, '  a: 1\n  b: 2\n  c: 3');
  eq(r.da, 0);
  eq(r.a, r.testo.length, 'the selection does not cover the block');
});

check('if the selection ends at a line start, that line is untouched', () => {
  const text = 'a: 1\nb: 2\nc: 3';
  const r = indentBlock(text, 0, 5, 1); // selection = "a: 1\n"
  eq(r.testo, '  a: 1\nb: 2\nc: 3');
});

check('empty lines are not indented', () => {
  const r = indentBlock('a: 1\n\nb: 2', 0, 10, 1);
  eq(r.testo, '  a: 1\n\n  b: 2');
});

check('with several lines selected it unindents them all', () => {
  const text = '  a: 1\n  b: 2';
  const r = indentBlock(text, 0, text.length, -1);
  eq(r.testo, 'a: 1\nb: 2');
});

console.log('\nauto-indent on Enter\n');

check('after a key it goes down two spaces', () => {
  eq(autoIndentRiga('  match:'), '    ');
});

check('after a list item it stays at the same level', () => {
  eq(autoIndentRiga('  - id: x'), '  ');
});

check('inside a | block it keeps the same indentation', () => {
  eq(autoIndentRiga('    normal text'), '    ');
});

console.log(failed ? `\n✗ ${failed} tests failed\n` : '\n✓ editor ok\n');
process.exit(failed ? 1 : 0);
