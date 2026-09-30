// Minimal Home Assistant mock: logs the calls it receives and answers.
// It exists so you can try rules with Home Assistant actions without touching
// the real house.
//
//   node tools/mock-ha.mjs [port]        (default 8123)
//
// Then in .env:  HA_URL=http://127.0.0.1:8123   HA_TOKEN=anything
import http from 'node:http';

const port = Number(process.argv[2] || 8123);

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const auth = req.headers.authorization || '';
    console.log(`\n${req.method} ${req.url}`);
    console.log(`  auth: ${auth ? `${auth.slice(0, 16)}…` : '(none)'}`);
    if (body) console.log(`  body: ${body}`);

    res.setHeader('Content-Type', 'application/json');
    if (req.url.startsWith('/api/config')) {
      res.end(JSON.stringify({ location_name: 'Home (mock)', version: '2026.9.3' }));
      return;
    }
    res.end(JSON.stringify([{ entity_id: 'mock.changed', state: 'on' }]));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`mock Home Assistant listening on http://127.0.0.1:${port}`);
});
