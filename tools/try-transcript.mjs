// Runs a rule against a hand-written transcript, without needing a real
// voice note: useful to understand why a rule does not fire.
//
//   node tools/try-transcript.mjs "we need three boxes of red" "Orders" "Mario"
//
// It goes through the real engine (precomputedTranscript avoids transcribing
// twice).
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { handleMessage } from '../src/pipeline.js';
import { buildTestMessage } from '../src/testkit.js';

const [transcript, chat, sender] = process.argv.slice(2);
if (!transcript) {
  console.log('usage: node tools/try-transcript.mjs "transcript" ["chat"] ["sender"]');
  process.exit(1);
}
if (process.env.RULES) {
  paths.rulesFile = path.isAbsolute(process.env.RULES) ? process.env.RULES : path.join(paths.root, process.env.RULES);
}

const config = loadConfig();
const msg = buildTestMessage({
  chatName: chat || 'Test chat',
  senderName: sender || 'Test sender',
  type: 'audio',
  ptt: true,
  mediaFile: 'data/samples/note.ogg',
});

const res = await handleMessage({ config, msg, dryRun: true, precomputedTranscript: transcript });

console.log(`\nrules file   : ${path.relative(paths.root, paths.rulesFile)}`);
console.log(`transcript   : ${transcript}`);
console.log(`rules fired  : ${res.matched.length ? res.matched.join(', ') : '(none)'}`);
for (const r of res.actions) console.log(`  action ${r.ok ? 'ok ' : 'KO '} ${r.rule} -> ${r.type}${r.error ? ` (${r.error})` : ''}`);
console.log();
