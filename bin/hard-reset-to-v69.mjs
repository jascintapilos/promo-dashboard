#!/usr/bin/env node
/**
 * Hard reset everything to V69 — Dashboard.html, Code.gs, AND appsscript.json.
 * Drops the auth helpers, drops the added drive scope, drops the patched
 * serverGetCurrentUser. Pure V69 state.
 *
 * Then version + promote so the live deployment matches.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const DEPLOYMENT_ID = 'AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const r = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

const v69 = await api('GET', `/projects/${SCRIPT_ID}/content?versionNumber=69`);
console.log('Fetched V69 content:');
v69.files.forEach(f => console.log(`  ${f.name}: ${f.source.length} chars`));

await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: v69.files });
console.log('✓ HEAD reset to V69 verbatim');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Hard reset to V69 verbatim — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Hard reset V69 — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);
console.log('\nJascinta: visit /exec — should be vanilla V69 with V69 manifest.');
