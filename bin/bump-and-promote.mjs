#!/usr/bin/env node
/**
 * Create a fresh project version from current HEAD content (which is V69)
 * and promote it. This forces the Apps Script CDN to refresh its cached
 * /exec response — useful when a previous deploy got stuck.
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

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Cache-bust republish of V69 content — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created (V69 content)`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'Cache-bust V69 republish — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted live: V${promo.deploymentConfig.versionNumber}`);
console.log('\nThe Apps Script CDN should serve the fresh build within ~30s.');
