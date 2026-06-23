#!/usr/bin/env node
/**
 * Create a BRAND NEW deployment of the same script. New deployment ID,
 * new /exec URL. Use this when the existing deployment's auth state is
 * corrupted and reverting code doesn't fix it.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

// Find latest version
const versions = await api('GET', `/projects/${SCRIPT_ID}/versions?pageSize=10`);
const latest = (versions.versions || [])
  .map(v => Number(v.versionNumber))
  .sort((a, b) => b - a)[0];
console.log('Latest version:', latest);

// Create new deployment
const dep = await api('POST', `/projects/${SCRIPT_ID}/deployments`, {
  versionNumber: latest,
  manifestFileName: 'appsscript',
  description: 'Fresh deployment (parallel to AKfycbx-Hy_OF) — ' + new Date().toISOString(),
});

console.log('\n✓ New deployment created');
console.log('  Deployment ID:', dep.deploymentId);
const exec = (dep.entryPoints || []).find(e => e.entryPointType === 'WEB_APP');
if (exec) {
  console.log('  Web app URL:  ', exec.webApp.url);
} else {
  console.log('  Entry points:', JSON.stringify(dep.entryPoints, null, 2));
}
console.log('\nAll deployments:');
const all = await api('GET', `/projects/${SCRIPT_ID}/deployments?pageSize=20`);
(all.deployments || []).forEach(d => {
  const url = (d.entryPoints || []).find(e => e.entryPointType === 'WEB_APP')?.webApp?.url || '(no web app)';
  console.log(`  • ${d.deploymentId.slice(0, 30)}...  V${d.deploymentConfig?.versionNumber || '?'}`);
  console.log(`    ${url}`);
});
