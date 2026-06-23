#!/usr/bin/env node
/**
 * V73 — Add aaa_resetAuth + bump appsscript.json with a harmless new scope
 * (Drive write) that forces Apps Script to surface the permission dialog
 * the next time Jascinta visits the web app or runs anything in the editor.
 *
 * Sequence for Jascinta:
 *   1. Wait for V73 to promote (this script does it).
 *   2. Open the editor — Apps Script will pop a "Permissions required" yellow
 *      banner. Click "Review permissions" → Allow → done.
 *   3. Re-open /exec — login overlay should auto-advance to dashboard.
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

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
const manifestIdx = proj.files.findIndex(f => f.name === 'appsscript');
let code = proj.files[codeIdx].source;
let manifestRaw = proj.files[manifestIdx].source;

// 1. Add aaa_resetAuth function (idempotent — only insert if missing)
if (!code.includes('function aaa_resetAuth')) {
  const block = `
// === AUTH RESET ===
// Run this from the editor when login is stuck. It invalidates the current
// auth grant — next time you (or anyone) opens the web app, Apps Script will
// prompt you to re-grant all required scopes. Once you "Allow", things work.
function aaa_resetAuth() {
  try {
    ScriptApp.invalidateAuth();
    Logger.log('✓ Auth invalidated. Open the web app /exec URL — Apps Script will prompt for permissions.');
    return 'OK — open the /exec URL now and accept the permissions prompt.';
  } catch (e) {
    Logger.log('✗ ' + e.message);
    return 'ERR: ' + e.message;
  }
}
// === END AUTH RESET ===

`;
  code = code.replace(
    `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';`,
    `const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';\n${block}`
  );
  console.log('✓ aaa_resetAuth inserted');
} else {
  console.log('aaa_resetAuth already present');
}

// 2. Bump manifest scopes — Apps Script will only re-prompt if it sees a
//    NEW scope. Add `drive` (write) which we'll genuinely need for KB writes
//    in V74. This is the official "force re-consent" trick.
const manifest = JSON.parse(manifestRaw);
const NEW_SCOPE = 'https://www.googleapis.com/auth/drive';
if (!manifest.oauthScopes.includes(NEW_SCOPE)) {
  manifest.oauthScopes.push(NEW_SCOPE);
  console.log('✓ Added drive (write) scope to manifest');
} else {
  console.log('drive scope already present');
}

proj.files[codeIdx].source = code;
proj.files[manifestIdx].source = JSON.stringify(manifest, null, 2);

await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed to HEAD');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V73 — aaa_resetAuth + drive scope (forces re-consent) — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V73 force re-auth — ' + new Date().toISOString(),
  },
});
console.log(`✓ Promoted V${promo.deploymentConfig.versionNumber}`);

console.log('\nNext steps for Jascinta:');
console.log('  1. Open the Apps Script editor (it may auto-show a yellow "Authorization required" banner)');
console.log('     URL: https://script.google.com/d/' + SCRIPT_ID + '/edit');
console.log('  2. If banner appears → click "Review permissions" → pick work account → "Allow"');
console.log('  3. If NO banner appears → in the function dropdown, select "aaa_resetAuth" → click Run');
console.log('  4. Then open /exec URL fresh — dashboard should load normally now.');
