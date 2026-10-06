// publish-store-a.mjs — ship the nightly Store A (money rollup) to the Hub, which atomic-swaps it into
// data/promo/ws1/store_a.json (powers the instant Brands-overview). Mirrors the refresh worker's relay auth.
//   secret: %USERPROFILE%\.qc-relay\relay-secret (or env RELAY_SECRET); hub: env QC_HUB_URL.
// Usage: node bin/publish-store-a.mjs <path/to/store_a.json>   (or env PROMO_STORE_A_PATH)
import { readFile } from 'node:fs/promises';
import { readWorkerRelaySecret, buildSignedHeaders, MAX_REPORT_BUILD_BYTES } from '../src/qc-dashboard/relay-auth.js';

const HUB_URL = process.env.QC_HUB_URL || 'http://localhost:4321';
const WORKER_ID = process.env.QC_RELAY_WORKER_ID || `vdi-store-publish-${process.pid}`;
const ROUTE = '/api/relay/promo/ws1/store-build';
const STORE = process.env.PROMO_STORE_A_PATH || process.argv[2];

async function main() {
  if (!STORE) { console.error('usage: node bin/publish-store-a.mjs <store_a.json>  (or PROMO_STORE_A_PATH)'); process.exit(2); }
  const s = readWorkerRelaySecret();
  if (!s.present) { console.error('relay secret unavailable:', s.reason); process.exit(2); }
  const body = await readFile(STORE);
  if (body.length < 10 * 1024) { console.error('store_a.json looks too small — refusing to publish'); process.exit(2); }
  const { headers } = buildSignedHeaders({ method: 'POST', path: ROUTE, bodyBuffer: body, secret: s.secret, workerId: WORKER_ID, maxBytes: MAX_REPORT_BUILD_BYTES });
  headers['content-type'] = 'application/json';
  const r = await fetch(HUB_URL + ROUTE, { method: 'POST', headers, body });
  const t = await r.text();
  console.log(`store-build -> ${r.status} ${t.slice(0, 200)}`);
  process.exit(r.ok ? 0 : 1);
}
main().catch(e => { console.error('publish failed:', e.message); process.exit(1); });
