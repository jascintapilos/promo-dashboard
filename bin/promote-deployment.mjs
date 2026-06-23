#!/usr/bin/env node
/**
 * Promote a specific version to the live deployment via Apps Script REST API.
 *
 * Usage:
 *   node bin/promote-deployment.mjs <versionNumber>   # promote a specific version
 *   node bin/promote-deployment.mjs latest            # auto-detect + promote highest
 *   node bin/promote-deployment.mjs                   # alias for "latest"
 *
 * Requires the OAuth token to have the script.deployments scope. Re-run
 * `node bin/sheets-oauth.mjs` if you get a 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const DEPLOYMENT_ID = 'AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ';

const arg = (process.argv[2] || 'latest').toLowerCase();

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

// Resolve target version
let versionNumber;
if (arg === 'latest' || arg === '') {
  const versions = await api('GET', `/projects/${SCRIPT_ID}/versions?pageSize=10`);
  const latest = (versions.versions || [])
    .map(v => Number(v.versionNumber))
    .sort((a, b) => b - a)[0];
  if (!latest) { console.error('No versions found'); process.exit(1); }
  versionNumber = latest;
  console.log('Resolved latest version → V' + versionNumber);
} else {
  versionNumber = Number(arg);
  if (!versionNumber) {
    console.error('Usage: node bin/promote-deployment.mjs [<version>|latest]');
    process.exit(1);
  }
}

// Get current deployment state for the before/after summary
const deps = await api('GET', `/projects/${SCRIPT_ID}/deployments?pageSize=20`);
const dep = (deps.deployments || []).find(d => d.deploymentId === DEPLOYMENT_ID);
if (!dep) {
  console.error('Deployment not found. Available deployments:');
  (deps.deployments || []).forEach(d => console.error('  • ' + d.deploymentId + ' (v' + d.deploymentConfig.versionNumber + ')'));
  process.exit(1);
}

const currentVersion = dep.deploymentConfig.versionNumber;
if (currentVersion === versionNumber) {
  console.log('Already on V' + versionNumber + ' — nothing to do.');
  process.exit(0);
}

console.log('Promoting V' + currentVersion + ' → V' + versionNumber + ' …');

const result = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber,
    manifestFileName: 'appsscript',
    description: 'Promoted to V' + versionNumber + ' via API — ' + new Date().toISOString(),
  },
});

console.log('✓ Now serving V' + result.deploymentConfig.versionNumber);
console.log('  ' + (result.deploymentConfig.description || ''));
console.log('  https://script.google.com/a/macros/thebrandingpeople.co/s/' + DEPLOYMENT_ID + '/exec');
