#!/usr/bin/env node
// Add `script.external_request` scope to the Apps Script manifest so the
// deployment is pre-authorized to call Slack's API. Then bump deployment.
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';

const { client } = await getGoogleAuth();
const accessToken = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const res = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const manifestIdx = proj.files.findIndex(f => f.name === 'appsscript');
const manifest = JSON.parse(proj.files[manifestIdx].source);

const REQUIRED = [
  'https://www.googleapis.com/auth/script.external_request',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.scriptapp',
  'https://www.googleapis.com/auth/userinfo.email',
];

manifest.oauthScopes = Array.from(new Set([...(manifest.oauthScopes || []), ...REQUIRED]));
proj.files[manifestIdx].source = JSON.stringify(manifest, null, 2);

console.log('Manifest oauthScopes:', manifest.oauthScopes);

await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Manifest updated');

// Create new version
const version = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Add external_request scope — ' + new Date().toISOString(),
});
console.log(`✓ Version ${version.versionNumber} created`);
console.log('\nNow update the deployment to point to version ' + version.versionNumber + ' via the Apps Script editor.');
