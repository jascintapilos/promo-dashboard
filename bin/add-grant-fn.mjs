#!/usr/bin/env node
/**
 * Add aaa_grantScopes function to the new project's Code.gs.
 * Jascinta runs this from the editor to trigger Apps Script's consent
 * prompt for all manifest scopes.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const NEW_SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
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

const proj = await api('GET', `/projects/${NEW_SCRIPT_ID}/content`);
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let code = proj.files[codeIdx].source;

const grantFn = `
// === AUTH GRANT ===
// Run this once from the editor (▶ Run) so Google prompts you to approve
// the manifest scopes. After clicking Allow, the dashboard works for you.
function aaa_grantScopes() {
  // Touch each scope so Apps Script's permission check sees the requirement
  var out = {};
  try { out.activeUser = Session.getActiveUser().getEmail(); } catch (e) { out.activeUser = 'ERR: ' + e.message; }
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    out.sheetTitle = ss.getName();
    var sheet = ss.getSheetByName('Task_Master');
    out.taskRows = sheet ? sheet.getLastRow() : 0;
  } catch (e) { out.sheetErr = e.message; }
  try {
    var f = DriveApp.getFileById(SS_ID);
    out.driveName = f.getName();
  } catch (e) { out.driveErr = e.message; }
  Logger.log(JSON.stringify(out, null, 2));
  return out;
}
// === END AUTH GRANT ===
`;

if (!code.includes('function aaa_grantScopes')) {
  code = code.replace(`function doGet(e) {`, grantFn + '\nfunction doGet(e) {');
  console.log('✓ aaa_grantScopes added');
}

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${NEW_SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed to HEAD');
console.log('\nNext: Jascinta opens this URL, picks aaa_grantScopes, clicks ▶ Run:');
console.log('https://script.google.com/d/' + NEW_SCRIPT_ID + '/edit?function=aaa_grantScopes');
