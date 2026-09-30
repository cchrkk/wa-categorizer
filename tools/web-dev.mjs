// Starts ONLY the web panel, with no WhatsApp connection: for working on the
// UI, or for editing rules without opening a connection.
//
//   node tools/web-dev.mjs            -> http://127.0.0.1:8198  token "dev"
//   PORT=9000 TOKEN=xxx node tools/web-dev.mjs
//   RULES=fixtures/other.yaml node tools/web-dev.mjs   (to try other rules)
//
// It uses the same engine as the real program: what you see is what you get.
import path from 'node:path';
import { paths, loadConfig } from '../src/config.js';
import { startWeb } from '../src/web.js';

const port = Number(process.env.PORT || 8198);
const token = process.env.TOKEN || 'dev';

// RULES points at another file: handy to try the UI on example rules
// without touching your own.
if (process.env.RULES) {
  const f = process.env.RULES;
  paths.rulesFile = path.isAbsolute(f) ? f : path.join(paths.root, f);
}

let config = loadConfig();
console.log(`\nrules file: ${path.relative(paths.root, paths.rulesFile)}`);
console.log(`rules loaded: ${config.rules.length}`);
console.log(`open http://127.0.0.1:${port} and enter the token "${token}"\n`);

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
