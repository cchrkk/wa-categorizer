// Prova una regola su una trascrizione scritta a mano, senza passare da un
// vocale vero: utile per capire perché una regola non scatta.
//
//   node tools/prova-trascrizione.mjs "Servono tre cartoni di rosso" "Ordini" "Mario"
//
// Passa dal motore vero (precomputedTranscript evita una seconda trascrizione).
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { handleMessage } from '../src/pipeline.js';
import { buildTestMessage } from '../src/testkit.js';

const [trascrizione, chat, mittente] = process.argv.slice(2);
if (!trascrizione) {
  console.log('uso: node tools/prova-trascrizione.mjs "trascrizione" ["chat"] ["mittente"]');
  process.exit(1);
}
if (process.env.RULES) {
  paths.rulesFile = path.isAbsolute(process.env.RULES) ? process.env.RULES : path.join(paths.root, process.env.RULES);
}

const config = loadConfig();
const msg = buildTestMessage({
  chatName: chat || 'Chat di prova',
  senderName: mittente || 'Mittente di prova',
  type: 'audio',
  ptt: true,
  mediaFile: 'data/samples/nota.ogg',
});

const res = await handleMessage({ config, msg, dryRun: true, precomputedTranscript: trascrizione });

console.log(`\nfile regole  : ${path.relative(paths.root, paths.rulesFile)}`);
console.log(`trascrizione : ${trascrizione}`);
console.log(`regole       : ${res.matched.length ? res.matched.join(', ') : '(nessuna)'}`);
for (const r of res.actions) console.log(`  azione ${r.ok ? 'ok ' : 'KO '} ${r.rule} -> ${r.type}${r.error ? ` (${r.error})` : ''}`);
console.log();
