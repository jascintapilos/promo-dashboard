#!/usr/bin/env node
// Add a function that LETS the permission error propagate so Apps Script
// pops the authorization dialog.
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
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
let code = proj.files[codeIdx].source;

// Add a raw function — no try/catch — so the scope error propagates and
// Apps Script's blue "Authorization required" dialog pops up.
const rawFn = `
// === RAW GRANT — no try/catch ===
function aaa_forceGrant() {
  // Force Apps Script to surface the consent dialog by accessing each scope
  // without catching the error.
  var ss = SpreadsheetApp.openById(SS_ID);
  var name = ss.getName();
  Logger.log('Sheet name: ' + name);
  var f = DriveApp.getFileById(SS_ID);
  Logger.log('Drive name: ' + f.getName());
  return 'ALL SCOPES GRANTED: ' + name + ' / ' + f.getName();
}
// === END RAW GRANT ===
`;
if (!code.includes('function aaa_forceGrant')) {
  code = code.replace(`function aaa_grantScopes()`, rawFn + '\nfunction aaa_grantScopes()');
}
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ aaa_forceGrant added — open editor and Run it:');
console.log('https://script.google.com/d/' + SCRIPT_ID + '/edit?function=aaa_forceGrant');
