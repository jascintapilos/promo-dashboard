#!/usr/bin/env node
// Push the built per-code player files (PII: usernames) to the report server over
// the relay — HMAC server-to-server, NEVER git. This is the repeatable refresh step:
// after rebuilding the player files from the warehouse, run this to sync the server.
// The server writes them into its gitignored players dir (which survives deploys)
// and prunes stale codes, so it mirrors exactly what you just built.
//
// Reuses the existing worker relay secret (~/.qc-relay/relay-secret or RELAY_SECRET).
//
//   node bin/push-promo-players.mjs <project>
//   env: QC_HUB_URL (default https://qc-dashboard.zoom66.xyz), QC_RELAY_WORKER_ID
//
// Exit 0 on success; non-zero (with a message, never the secret) on failure.

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readWorkerRelaySecret, buildSignedHeaders } from '../src/qc-dashboard/relay-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HUB = (process.env.QC_HUB_URL || 'https://qc-dashboard.zoom66.xyz').replace(/\/+$/, '');
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `promo-push-${process.pid}`;
const MAX_PUSH_BYTES = 24 * 1024 * 1024;

const die = (msg) => { console.error(`push-promo-players: ${msg}`); process.exit(1); };

const project = String(process.argv[2] || '').trim().toLowerCase();
if (!/^[a-z0-9-]{1,40}$/.test(project)) die('usage: node bin/push-promo-players.mjs <project>');

const secret = readWorkerRelaySecret();
if (!secret.present) die(`relay secret unavailable — ${secret.reason}`);

const base = path.join(ROOT, 'data', 'promo', project, 'players');
if (!existsSync(base)) die(`no player data built at data/promo/${project}/players`);

// Bundle: { "<market>/<filename>.json": "<file text>" } — file text kept verbatim
// so the server writes exactly what serve() expects to read.
const bundle = {};
let files = 0;
for (const market of readdirSync(base)) {
  const mdir = path.join(base, market);
  let entries;
  try { if (!statSync(mdir).isDirectory()) continue; entries = readdirSync(mdir); } catch { continue; }
  for (const f of entries) {
    if (!f.endsWith('.json')) continue;
    bundle[`${market}/${f}`] = readFileSync(path.join(mdir, f), 'utf8');
    files += 1;
  }
}
if (!files) die(`no .json player files under data/promo/${project}/players`);

const gz = gzipSync(Buffer.from(JSON.stringify(bundle), 'utf8'));
if (gz.length > MAX_PUSH_BYTES) die(`bundle too large (${(gz.length / 1048576).toFixed(1)}MB gzip > ${MAX_PUSH_BYTES / 1048576}MB)`);

const relPath = `/api/relay/promo/${project}/players`;
const { headers, bodyBuffer } = buildSignedHeaders({
  method: 'POST', path: relPath, bodyBuffer: gz, secret: secret.secret, workerId: WORKER_ID, maxBytes: MAX_PUSH_BYTES,
});
headers['content-type'] = 'application/gzip';

const resp = await fetch(`${HUB}${relPath}`, { method: 'POST', headers, body: bodyBuffer });
const text = await resp.text();
if (!resp.ok) die(`server rejected push (${resp.status}): ${text}`);
console.log(`pushed ${files} player files (${(gz.length / 1024).toFixed(0)} KB gzip) to ${HUB} → ${text}`);
