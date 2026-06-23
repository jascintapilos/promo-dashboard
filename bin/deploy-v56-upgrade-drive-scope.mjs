#!/usr/bin/env node
/**
 * V56 — Swap drive.readonly → drive (full) to force fresh re-auth.
 *
 * Stuck state: the user's OAuth grant for this script includes some
 * scopes (spreadsheets, urlfetch) but NOT drive.readonly, AND Apps
 * Script won't re-prompt because it thinks "user has a grant already".
 *
 * Fix: introduce a brand-new scope by swapping drive.readonly with
 * https://www.googleapis.com/auth/drive (full Drive). This is:
 *   • A NEW scope the user hasn't seen → forces re-auth prompt
 *   • Strictly a superset (read + write) but the dashboard still only
 *     reads — no behavior change other than fixing the bug
 *   • The reliable scope for DriveApp + Shared Drives
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
const manifestIdx = proj.files.findIndex(f => f.name === 'appsscript');
let manifestSource = proj.files[manifestIdx].source;

console.log('=== BEFORE ===');
console.log(manifestSource);

const manifest = JSON.parse(manifestSource);
const before = manifest.oauthScopes ? manifest.oauthScopes.slice() : [];

// Remove drive.readonly (if present), add drive (if not present)
manifest.oauthScopes = (manifest.oauthScopes || []).filter(s => s !== 'https://www.googleapis.com/auth/drive.readonly');
if (!manifest.oauthScopes.includes('https://www.googleapis.com/auth/drive')) {
  manifest.oauthScopes.push('https://www.googleapis.com/auth/drive');
}

manifestSource = JSON.stringify(manifest, null, 2);
console.log('\n=== AFTER ===');
console.log(manifestSource);

proj.files[manifestIdx].source = manifestSource;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('\n✓ Manifest updated');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V56: swap drive.readonly → drive (force re-auth) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V56: full drive scope',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('NEXT STEP — should now show a FRESH permission prompt:');
console.log('');
console.log('1. Open the editor (already open in your screenshot):');
console.log('   https://script.google.com/d/' + SCRIPT_ID + '/edit');
console.log('');
console.log('2. The editor may show a yellow banner saying "Permissions');
console.log('   updated" or similar — click "Review" if so.');
console.log('');
console.log('3. Function dropdown → select: aaa_authorize → ▶ Run');
console.log('');
console.log('4. NEW prompt should appear: "See, edit, create, and delete');
console.log('   all your Google Drive files." → Allow');
console.log('');
console.log('5. Execution log should show ✓ DriveApp.getFolderById this time.');
console.log('');
console.log('6. Reload dashboard → click ↻ Sync from Drive.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
