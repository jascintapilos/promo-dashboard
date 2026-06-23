#!/usr/bin/env node
// Adds a tiny `aaa_authorizeSlackSync` function near the top of Code.gs that
// just calls serverSyncSlackTasks. The "aaa_" prefix ensures it appears early
// in the Apps Script function dropdown for easy Run-from-editor.
import { getGoogleAuth } from '../src/google-auth.js';

const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function api(method, url, body) {
  const res = await fetch(`https://script.googleapis.com/v1${url}`, {
    method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

const proj = await api('GET', `/projects/${SCRIPT_ID}/content`);
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let src = proj.files[codeIdx].source;

// Strip any prior version
src = src.replace(/\/\/ === AUTH TRIGGER ===[\s\S]*?\/\/ === END AUTH TRIGGER ===\s*/g, '');

// Insert after the SS_ID constant
const block = `
// === AUTH TRIGGER ===
// Run this once from the editor to grant the Slack-sync OAuth scope.
function aaa_authorizeSlackSync() {
  // Force scope binding by touching each API the sync function uses.
  PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  const r = UrlFetchApp.fetch('https://slack.com/api/auth.test', {
    headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN') },
    muteHttpExceptions: true,
  });
  Logger.log(r.getContentText());
  // Now run the real sync
  const result = serverSyncSlackTasks();
  Logger.log(JSON.stringify(result));
  return result;
}
// === END AUTH TRIGGER ===

`;

src = src.replace(/(const SS_ID = '[^']+';\s*\n)/, '$1' + block);
proj.files[codeIdx].source = src;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Added aaa_authorizeSlackSync function');

// Create new version
const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'Add auth trigger fn — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
