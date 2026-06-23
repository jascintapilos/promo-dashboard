#!/usr/bin/env node
/**
 * V54 — Add aaa_authorize() helper function for the deployer to run once.
 *
 * Apps Script with executeAs: USER_DEPLOYING runs as the deployer's auth.
 * The deployer must accept the OAuth prompt for each scope ONCE in the
 * editor; users hitting the web URL never see that prompt.
 *
 * aaa_authorize() touches DriveApp, SpreadsheetApp, and UrlFetchApp so a
 * single run from the editor authorizes everything the dashboard needs.
 *
 * The "aaa_" prefix makes it sort to the top of the function dropdown.
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
const codeIdx = proj.files.findIndex(f => f.name === 'Code');
let code = proj.files[codeIdx].source;

const AUTH_FN = `
// ─────────────────────────────────────────────────────────────────────────────
// aaa_authorize — RUN THIS ONCE FROM THE EDITOR TO ACCEPT ALL SCOPES
// Click ▶ Run, then accept "Review permissions" → choose your account →
// "Advanced" → "Go to … (unsafe)" → "Allow". After that, the dashboard
// Sync button + Weekly Files tab will work for all users.
// ─────────────────────────────────────────────────────────────────────────────
function aaa_authorize() {
  var report = [];

  // 1. DriveApp — needed for serverGetWeeklyReports + serverSyncWeeklyReportData
  try {
    var folder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    report.push('✓ DriveApp.getFolderById: ' + folder.getName());
    var monthIt = folder.getFolders();
    var n = 0; while (monthIt.hasNext()) { monthIt.next(); n++; }
    report.push('✓ DriveApp.getFolders: ' + n + ' subfolders');
  } catch (e) {
    report.push('✗ DriveApp FAILED: ' + e.message);
  }

  // 2. SpreadsheetApp — needed to read each weekly sheet
  try {
    var ss = SpreadsheetApp.openById(SS_ID);
    report.push('✓ SpreadsheetApp.openById: ' + ss.getName());
  } catch (e) {
    report.push('✗ SpreadsheetApp FAILED: ' + e.message);
  }

  // 3. UrlFetchApp + ScriptApp.getOAuthToken — for Drive REST fallback
  try {
    var token = ScriptApp.getOAuthToken();
    var res = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    report.push('✓ UrlFetchApp + Drive REST: ' + res.getResponseCode());
  } catch (e) {
    report.push('✗ UrlFetchApp FAILED: ' + e.message);
  }

  // 4. PropertiesService — for caching weekly report data
  try {
    PropertiesService.getScriptProperties().setProperty('aaa_authorize_test', new Date().toISOString());
    report.push('✓ PropertiesService write OK');
  } catch (e) {
    report.push('✗ PropertiesService FAILED: ' + e.message);
  }

  // 5. Session.getActiveUser — for serverGetCurrentUser
  try {
    var email = Session.getActiveUser().getEmail();
    report.push('✓ Session.getActiveUser: ' + email);
  } catch (e) {
    report.push('✗ Session FAILED: ' + e.message);
  }

  var summary = report.join('\\n');
  Logger.log(summary);
  return summary;
}
`;

if (!code.includes('function aaa_authorize')) {
  // Insert near the top of Code.gs, right after constants
  const insertAfter = code.indexOf('const WEEKLY_REPORT_FOLDER_ID');
  const newlineAfter = code.indexOf('\n', insertAfter);
  if (newlineAfter < 0) {
    code = code + '\n' + AUTH_FN;
  } else {
    code = code.slice(0, newlineAfter+1) + AUTH_FN + code.slice(newlineAfter+1);
  }
  console.log('✓ aaa_authorize() helper added at top of Code.gs');
} else {
  console.log('… aaa_authorize already present, skipping');
}

proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V54: add aaa_authorize helper for one-time deployer auth ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V54: auth helper',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('NEXT STEP (one-time, 60 seconds):');
console.log('1. Open: https://script.google.com/d/' + SCRIPT_ID + '/edit');
console.log('2. In the function dropdown (top), select: aaa_authorize');
console.log('3. Click ▶ Run');
console.log('4. Click "Review permissions" → choose your Google account');
console.log('5. Click "Advanced" → "Go to (unsafe)" → "Allow"');
console.log('6. Reload the dashboard and click Sync.');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
