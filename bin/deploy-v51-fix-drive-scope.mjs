#!/usr/bin/env node
/**
 * V51 — Fix Drive 403 "Insufficient Permission".
 *
 * Root cause: Apps Script only includes scopes in ScriptApp.getOAuthToken()
 * that it detects are USED in the code. Since serverGetWeeklyReports hits
 * the Drive REST API via UrlFetchApp (no DriveApp call), the token came
 * back without drive.readonly even though the manifest declares it.
 *
 * Fix: Add a no-op DriveApp.getFolderById(...).getName() at the top of
 * serverGetWeeklyReports. This forces Apps Script to include drive.readonly
 * in the token returned by getOAuthToken(), and the REST API call succeeds.
 *
 * No manifest change → users do NOT need to re-authorize.
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

// Find the serverGetWeeklyReports function and inject a DriveApp warm-up.
// We do TWO things:
//   1. At the very top of the function, call DriveApp.getFolderById(...).getName()
//      to trigger scope auto-detection.
//   2. Try DriveApp-based listing first; fall back to REST API if it fails or returns empty.

const OLD_FN_START = `function serverGetWeeklyReports() {
  // Drive REST API via UrlFetchApp — DriveApp.getFolders() is unreliable on
  // Shared Drives. We pass supportsAllDrives + includeItemsFromAllDrives.`;

const NEW_FN_START = `function serverGetWeeklyReports() {
  // V51: Force drive.readonly scope into ScriptApp.getOAuthToken() by
  // referencing DriveApp here. Without this, the REST API call gets 403
  // because Apps Script doesn't auto-detect Drive scope from UrlFetchApp.
  var __folderName = '';
  try {
    __folderName = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID).getName();
  } catch (e) {
    return { files: [], error: 'DriveApp cannot access folder: ' + e.message };
  }

  // Try DriveApp listing first — it natively supports Shared Drives.
  try {
    var driveAppFiles = [];
    var rootFolder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    var monthIt = rootFolder.getFolders();
    while (monthIt.hasNext()) {
      var mf = monthIt.next();
      var mName = mf.getName();
      var fIt = mf.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (fIt.hasNext()) {
        var f = fIt.next();
        driveAppFiles.push({
          id: f.getId(),
          name: f.getName(),
          month: mName,
          modifiedTime: f.getLastUpdated().toISOString(),
          openUrl: 'https://docs.google.com/spreadsheets/d/' + f.getId() + '/edit',
          embedUrl: 'https://docs.google.com/spreadsheets/d/' + f.getId() + '/preview',
        });
      }
    }
    if (driveAppFiles.length > 0) {
      driveAppFiles.sort(function(a,b){ return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
      return { files: driveAppFiles, error: null };
    }
    // DriveApp returned empty — fall through to REST API
  } catch (driveAppErr) {
    Logger.log('DriveApp listing failed, falling back to REST: ' + driveAppErr.message);
  }

  // Fallback: Drive REST API via UrlFetchApp. With DriveApp called above,
  // the token now has drive.readonly scope.`;

if (!code.includes(OLD_FN_START)) {
  console.error('✗ serverGetWeeklyReports anchor not found');
  process.exit(1);
}
code = code.replace(OLD_FN_START, NEW_FN_START);
console.log('✓ DriveApp warm-up + native listing fallback added');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V51: fix Drive 403 (force scope detection + DriveApp fallback) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V51: drive scope fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
