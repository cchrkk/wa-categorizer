// Avvia SOLO il pannello web, senza WhatsApp: serve a lavorare sulla UI o a
// modificare le regole senza aprire una connessione.
//
//   node tools/web-dev.mjs            -> http://127.0.0.1:8198  token "dev"
//   PORT=9000 TOKEN=xxx node tools/web-dev.mjs
//   RULES=fixtures/altro.yaml node tools/web-dev.mjs   (per provare altre regole)
//
// Usa lo stesso motore del programma vero: quello che vedi è quello che otterrai.
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { startWeb } from '../src/web.js';

const port = Number(process.env.PORT || 8198);
const token = process.env.TOKEN || 'dev';

// RULES punta a un altro file: comodo per provare la UI su regole di esempio
// senza toccare le proprie.
if (process.env.RULES) {
  const f = process.env.RULES;
  paths.rulesFile = path.isAbsolute(f) ? f : path.join(paths.root, f);
}

let config = loadConfig();
console.log(`\nfile regole: ${path.relative(paths.root, paths.rulesFile)}`);
console.log(`regole caricate: ${config.rules.length}`);
console.log(`apri http://127.0.0.1:${port} e inserisci il token "${token}"\n`);

await startWeb({
  port,
  host: process.env.HOST || '127.0.0.1',
  token,
  getConfig: () => config,
  reload: async () => {
    config = loadConfig();
    return config;
  },
});
