#!/usr/bin/env node
/**
 * deploy-dashboard.mjs
 *
 * Deploys apps-script/unified-dashboard/ to the v14 "Promotions Team Dashboard"
 * Apps Script project via the Apps Script REST API.
 *
 * Script ID (v14, owned by Jascinta):
 *   1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_
 *
 * Prerequisites:
 *   node bin/sheets-oauth.mjs   ← run once if token lacks script.projects scope
 *   node bin/build-unified.mjs  ← generates the source files
 *
 * What this script does:
 *   1. Reads the unified-dashboard/ source files
 *   2. Calls Apps Script REST API PUT /v1/projects/{scriptId}/content
 *   3. Prints the Apps Script editor URL for verification
 *
 * Note: This updates the HEAD (saved) content.
 * To publish a new web-app deployment, go to the Apps Script editor:
 *   Deploy → Manage deployments → New version
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGoogleAuth } from '../src/google-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SRC_DIR   = path.join(ROOT, 'apps-script', 'control-tower');

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const API_BASE  = 'https://script.googleapis.com';

// ── Verify source files exist ──────────────────────────────────────────────
const FILES = [
  { name: 'appsscript', type: 'JSON',      path: path.join(SRC_DIR, 'appsscript.json') },
  { name: 'Code',       type: 'SERVER_JS', path: path.join(SRC_DIR, 'Code.gs') },
  { name: 'Dashboard',  type: 'HTML',      path: path.join(SRC_DIR, 'Dashboard.html') },
];

for (const f of FILES) {
  if (!existsSync(f.path)) {
    console.error(`Missing: ${f.path}`);
    console.error('Run: node bin/build-unified.mjs first');
    process.exit(1);
  }
}

// ── Auth ───────────────────────────────────────────────────────────────────
console.log('Authenticating…');
let auth;
try {
  auth = await getGoogleAuth();
} catch (e) {
  console.error('Auth failed:', e.message);
  process.exit(1);
}
console.log(`  mode: ${auth.mode}  email: ${auth.email || '(unknown)'}`);

// Verify we have script.projects scope by checking the token
const token = await auth.client.getAccessToken();
const accessToken = token.token || token.res?.data?.access_token;
if (!accessToken) {
  console.error('Could not get access token. Run: node bin/sheets-oauth.mjs');
  process.exit(1);
}

// ── Build payload ──────────────────────────────────────────────────────────
const files = FILES.map(f => ({
  name:   f.name,
  type:   f.type,
  source: readFileSync(f.path, 'utf8'),
}));

console.log('\nFiles to deploy:');
files.forEach(f => console.log(`  ${f.name.padEnd(14)} ${f.type.padEnd(10)} ${f.source.length} chars`));

// ── PUT to Apps Script REST API ────────────────────────────────────────────
const url = `${API_BASE}/v1/projects/${SCRIPT_ID}/content`;
console.log(`\nPUT ${url}`);

let resp;
try {
  resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files }),
  });
} catch (e) {
  console.error('Network error:', e.message);
  process.exit(1);
}

const body = await resp.text();

if (!resp.ok) {
  console.error(`\nAPI error ${resp.status}:`);
  try { console.error(JSON.stringify(JSON.parse(body), null, 2)); }
  catch(_) { console.error(body.slice(0, 1000)); }

  if (resp.status === 403) {
    console.error('\n→ 403 usually means the OAuth token lacks the script.projects scope.');
    console.error('  Run: node bin/sheets-oauth.mjs   then retry.');
  }
  process.exit(1);
}

let result;
try { result = JSON.parse(body); } catch(_) { result = body; }
console.log('\n✓ Deployed successfully!');
console.log(`  Script ID: ${SCRIPT_ID}`);
console.log(`  Files updated: ${(result.files||[]).length}`);
console.log('\nEditor URL:');
console.log(`  https://script.google.com/d/${SCRIPT_ID}/edit`);
console.log('\nWeb app URL (existing deployment — same URL, new code):');
console.log('  https://script.google.com/macros/s/AKfycbx-Hy_OFd55Fbwdsf29LQxh0NxSLWwXWbVsEQ6AFoecWGgANAtsohO88pSJoCHCuHawzQ/exec');
console.log('\nTo publish a new deployment version:');
console.log('  Open editor URL → Deploy → Manage deployments → ⊕ New version');
