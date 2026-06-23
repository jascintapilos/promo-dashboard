#!/usr/bin/env node
/**
 * V55 — Hot-patch hardcoded __RPT_DATA fallback values for W15 + W16.
 *
 * W15 (13–17 Apr) was wrong because earlier retry accidentally read W16's
 * spreadsheet ID. Corrected from live sheet:
 *   W15: p=50→49, b=2→19, c=194→0, g=0 (already correct)
 *   W16: g=1→0 (live sheet shows 0 now)
 *
 * Once the Drive sync flow works (V54 auth pending), the cache will
 * automatically overwrite this with whatever the live sheets say.
 */
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID     = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';

const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// Replace W15 row
const OLD_W15 = `{w:'W15',d:'13–17 Apr',mo:'Apr',s:'2026-04-13',e:'2026-04-17',p:50,b:2,c:194,g:0},`;
const NEW_W15 = `{w:'W15',d:'13–17 Apr',mo:'Apr',s:'2026-04-13',e:'2026-04-17',p:49,b:19,c:0,g:0},`;

if (!dash.includes(OLD_W15)) { console.error('✗ W15 row anchor not found'); process.exit(1); }
dash = dash.replace(OLD_W15, NEW_W15);
console.log('✓ W15: 50/2/194/0 → 49/19/0/0');

// Replace W16 row
const OLD_W16 = `{w:'W16',d:'20–24 Apr',mo:'Apr',s:'2026-04-20',e:'2026-04-24',p:50,b:2,c:194,g:1},`;
const NEW_W16 = `{w:'W16',d:'20–24 Apr',mo:'Apr',s:'2026-04-20',e:'2026-04-24',p:50,b:2,c:194,g:0},`;

if (!dash.includes(OLD_W16)) { console.error('✗ W16 row anchor not found'); process.exit(1); }
dash = dash.replace(OLD_W16, NEW_W16);
console.log('✓ W16 games: 1 → 0');

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V55: fix W15 + W16 hardcoded values to match live sheets ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V55: W15/W16 data fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nNew YTD totals:');
console.log('  Promo Codes: 1,374 (was 1,375)');
console.log('  Banners:       404 (was 387)');
console.log('  CRM:           608 (was 802)');
console.log('  New Games:     152 (was 153)');
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
