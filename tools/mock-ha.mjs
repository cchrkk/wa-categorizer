// Mock minimo di Home Assistant: registra le chiamate ricevute e risponde.
// Serve a provare le regole con azioni HA senza toccare la casa vera.
//
//   node tools/mock-ha.mjs [porta]        (default 8123)
//
// Poi nel .env:  HA_URL=http://127.0.0.1:8123   HA_TOKEN=qualunque
import http from 'node:http';

const port = Number(process.argv[2] || 8123);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    console.log(`\n${req.method} ${req.url}`);
    console.log(`  auth: ${auth ? `${auth.slice(0, 16)}…` : '(assente)'}`);
    if (body) console.log(`  body: ${body}`);

    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/config')) {
      res.end(JSON.stringify({ location_name: 'Casa (mock)', version: '2026.9.0' }));
      return;
    }
    res.end(JSON.stringify([{ entity_id: 'mock.cambiato', state: 'on' }]));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock Home Assistant in ascolto su http://127.0.0.1:${port}`);
});
