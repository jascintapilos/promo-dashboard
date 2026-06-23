#!/usr/bin/env node
/**
 * Clone the Promo Control Tower script to a brand new Apps Script project.
 * Same V69 content; fresh project ID, fresh deployment, fresh auth state.
 *
 * Use this as recovery when the existing project's auth grant is corrupted
 * and revoking via myaccount.google.com/permissions isn't an option.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const OLD_SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

// 1. Fetch V69 content from old project
console.log('Step 1: Fetch V69 content from old project…');
const v69 = await api('GET', `/projects/${OLD_SCRIPT_ID}/content?versionNumber=69`);
console.log('  Files:', v69.files.map(f => `${f.name} (${f.source.length} chars)`).join(', '));

// 2. Create a new project
console.log('\nStep 2: Create new Apps Script project…');
const newProj = await api('POST', `/projects`, {
  title: 'Promo Control Tower 2026 (Clone)',
});
const NEW_SCRIPT_ID = newProj.scriptId;
console.log('  New scriptId:', NEW_SCRIPT_ID);

// 3. Push V69 content (Code.gs, Dashboard.html, appsscript.json)
console.log('\nStep 3: Push V69 content to new project…');
await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, { files: v69.files });
console.log('  ✓ Content pushed');

// 4. Create a version
console.log('\nStep 4: Create initial version…');
const v = await api('POST', `/projects/${NEW_SCRIPT_ID}/versions`, {
  description: 'V1 — clone of old project V69 — ' + new Date().toISOString(),
});
console.log(`  ✓ Version ${v.versionNumber} created`);

// 5. Deploy as web app
console.log('\nStep 5: Deploy as web app…');
const dep = await api('POST', `/projects/${NEW_SCRIPT_ID}/deployments`, {
  versionNumber: v.versionNumber,
  manifestFileName: 'appsscript',
  description: 'Initial deployment of cloned project',
});
const exec = (dep.entryPoints || []).find(e => e.entryPointType === 'WEB_APP');
console.log('  ✓ Deployment ID:', dep.deploymentId);
console.log('  ✓ Web App URL: ', exec?.webApp?.url || '(none — check entry points)');

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SUMMARY');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('New script ID:    ' + NEW_SCRIPT_ID);
console.log('New deployment:   ' + dep.deploymentId);
console.log('New web app URL:  ' + exec?.webApp?.url);
console.log('\nFor Jascinta:');
console.log('  Open the URL above in incognito.');
console.log('  Click through the consent prompt (Continue → Allow).');
console.log('  Dashboard should load normally.');
console.log('\nFor next deploy:');
console.log('  Update SCRIPT_ID + DEPLOYMENT_ID in bin/deploy-vNN-*.mjs to the new values above.');
