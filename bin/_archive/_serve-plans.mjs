// One-off local server that serves the per-RN plan JSONs so the browser
// can pull each body, then POST it to the IGMP /PM/AddBonus endpoint
// under the logged-in HttpOnly session. CORS-open for any origin.
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 17891);
const DIR  = path.resolve(process.env.PLANS_DIR || 'tmp-plans');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const m = req.url.match(/^\/plans\/([A-Za-z0-9_-]+\.json)$/);
  if (!m) { res.writeHead(404); res.end('not found'); return; }
  const file = path.join(DIR, m[1]);
  if (!existsSync(file)) { res.writeHead(404); res.end('no file: ' + m[1]); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(readFileSync(file));
});

server.listen(PORT, '127.0.0.1', () => {
  console.error(`[serve-plans] http://127.0.0.1:${PORT}/plans/<RN>-<site>.json from ${DIR}`);
});
