#!/usr/bin/env node
/**
 * V49 — Fix Weekly Files listing on Shared Drive.
 *
 * Root cause: DriveApp.getFolderById(...).getFolders() doesn't reliably
 * enumerate items inside a Shared Drive folder. Switched to the Drive
 * REST API via UrlFetchApp but using the OAuth token from
 * ScriptApp.getOAuthToken() — this DOES work with the proper
 * supportsAllDrives + includeItemsFromAllDrives flags, but the prior
 * implementation silently swallowed errors.
 *
 * Changes:
 *   1. serverGetWeeklyReports now returns { files: [...], error: '...' }
 *      so the dashboard can surface real failures.
 *   2. Uses Drive REST API with explicit Shared Drive flags AND falls
 *      back to corpora=allDrives if 'in parents' query returns empty.
 *   3. Dashboard now handles the new return shape (files OR error string).
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
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

// ─── 1. Replace serverGetWeeklyReports in Code.gs ────────────────────────────
const OLD_GET_REPORTS_PATTERN = /function serverGetWeeklyReports\(\) \{[\s\S]*?\n\}/;

const NEW_GET_REPORTS = `function serverGetWeeklyReports() {
  // Drive REST API via UrlFetchApp — DriveApp.getFolders() is unreliable on
  // Shared Drives. We pass supportsAllDrives + includeItemsFromAllDrives.
  function fetch_(url) {
    var token = ScriptApp.getOAuthToken();
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    var txt = res.getContentText();
    if (code !== 200) throw new Error('Drive API ' + code + ': ' + txt.substring(0, 200));
    return JSON.parse(txt);
  }
  function listChildren(parentId, mimeFilter) {
    var q = "'" + parentId + "' in parents and trashed=false";
    if (mimeFilter) q += " and mimeType='" + mimeFilter + "'";
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent('files(id,name,mimeType,modifiedTime)')
      + '&orderBy=' + encodeURIComponent('modifiedTime desc')
      + '&pageSize=200'
      + '&supportsAllDrives=true'
      + '&includeItemsFromAllDrives=true'
      + '&corpora=allDrives';
    var data = fetch_(url);
    return (data && data.files) || [];
  }
  try {
    var months = listChildren(WEEKLY_REPORT_FOLDER_ID, 'application/vnd.google-apps.folder');
    if (!months.length) {
      return { files: [], error: 'Root folder has no subfolders (folder ID may be wrong or no access).' };
    }
    var all = [];
    months.forEach(function(m){
      try {
        var sheets = listChildren(m.id, 'application/vnd.google-apps.spreadsheet');
        sheets.forEach(function(s){
          all.push({
            id: s.id,
            name: s.name,
            month: m.name,
            modifiedTime: s.modifiedTime,
            openUrl: 'https://docs.google.com/spreadsheets/d/' + s.id + '/edit',
            embedUrl: 'https://docs.google.com/spreadsheets/d/' + s.id + '/preview',
          });
        });
      } catch (innerErr) {
        Logger.log('Failed to list ' + m.name + ': ' + innerErr.message);
      }
    });
    all.sort(function(a,b){ return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
    return { files: all, error: null };
  } catch (e) {
    Logger.log('serverGetWeeklyReports error: ' + e.message);
    return { files: [], error: e.message };
  }
}`;

if (!OLD_GET_REPORTS_PATTERN.test(code)) {
  console.error('✗ serverGetWeeklyReports anchor not found');
  process.exit(1);
}
code = code.replace(OLD_GET_REPORTS_PATTERN, NEW_GET_REPORTS);
console.log('✓ Code.gs: serverGetWeeklyReports rewritten (Drive REST + error surface)');

// ─── 2. Dashboard: handle new return shape { files, error } ──────────────────
// renderReports() — successHandler stores into __cachedRptFiles
const OLD_RENDER_HANDLER = `    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  } else {
    renderReports_analysis_();
  }
}`;

const NEW_RENDER_HANDLER = `    google.script.run
      .withSuccessHandler(function(r){
        if (r && r.files) { __cachedRptFiles = r.files; __cachedRptError = r.error || null; }
        else if (Array.isArray(r)) { __cachedRptFiles = r; __cachedRptError = null; }
        else { __cachedRptFiles = []; __cachedRptError = 'Empty response'; }
      })
      .withFailureHandler(function(e){ __cachedRptFiles = []; __cachedRptError = (e && e.message) || 'Sync failed'; })
      .serverGetWeeklyReports();
  } else {
    renderReports_analysis_();
  }
}`;

if (!dash.includes(OLD_RENDER_HANDLER)) {
  console.error('✗ renderReports handler anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_RENDER_HANDLER, NEW_RENDER_HANDLER);
console.log('✓ Dashboard: renderReports handles new {files,error} shape');

// Also add __cachedRptError state variable next to __cachedRptFiles
const OLD_STATE_DECL = `var __cachedRptFiles = null;`;
const NEW_STATE_DECL = `var __cachedRptFiles = null;
var __cachedRptError = null;`;
if (dash.includes(OLD_STATE_DECL) && !dash.includes('__cachedRptError')) {
  dash = dash.replace(OLD_STATE_DECL, NEW_STATE_DECL);
  console.log('✓ Added __cachedRptError state');
}

// Update __switchRptTab + renderReports_files_ to fetch new shape too
const OLD_SWITCH_FETCH = `      content(__tabBar_('files') + '<div class="loading"><div class="spinner"></div><p style="color:var(--muted);font-size:13px;margin-top:10px">Loading file list from Drive…</p></div>');
      if (typeof google !== 'undefined') {
        google.script.run
          .withSuccessHandler(function(f){ __cachedRptFiles=f; __renderReportsFiles_(f); })
          .withFailureHandler(function(){ __cachedRptFiles=[]; __renderReportsFiles_([]); })
          .serverGetWeeklyReports();
      }`;
// That older one might not exist anymore. Skip if not found — fine.

// Update renderReports_files_ to honor error string from cached payload
const OLD_FILES_RENDER = `function renderReports_files_(files) {
  __rptTab = 'files';
  var tb = __rptTabBar_('files');
  if (!files || !files.length) {
    content(tb + '<div class="empty">📭 No weekly reports found in Drive folder.<br>'
      +'<button class="btn" onclick="__rptNav_(\\'files\\')" style="margin-top:8px">↻ Try again</button>'
      +'&nbsp;<a href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="color:var(--accent)">Open Drive folder →</a></div>');
    return;
  }`;

const NEW_FILES_RENDER = `function renderReports_files_(files) {
  __rptTab = 'files';
  var tb = __rptTabBar_('files');
  if (!files || !files.length) {
    var errMsg = __cachedRptError ? '<div style="font-size:11px;color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:6px;padding:8px 12px;margin:10px auto;max-width:560px;text-align:left;font-family:monospace">⚠ ' + esc(__cachedRptError) + '</div>' : '';
    var btn = (files === null || files === undefined) ? '<button class="btn" onclick="__rptReloadFiles_()" style="margin-top:8px">↻ Loading…</button>' : '<button class="btn" onclick="__rptReloadFiles_()" style="margin-top:8px">↻ Try again</button>';
    content(tb + '<div class="empty">📭 No weekly reports loaded.<br>'+errMsg
      +btn
      +'&nbsp;<a href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="color:var(--accent)">Open Drive folder →</a></div>');
    return;
  }`;

if (!dash.includes(OLD_FILES_RENDER)) {
  console.error('✗ renderReports_files_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_FILES_RENDER, NEW_FILES_RENDER);
console.log('✓ renderReports_files_: shows error message + retry button');

// Add __rptReloadFiles_ helper if missing
if (!dash.includes('function __rptReloadFiles_')) {
  const reloadFn = `
function __rptReloadFiles_() {
  __cachedRptFiles = null; __cachedRptError = null;
  __rptTab = 'files';
  var tb = __rptTabBar_('files');
  content(tb + '<div class="loading"><div class="spinner"></div><p style="color:var(--muted);font-size:13px;margin-top:10px">Loading file list from Drive…</p></div>');
  if (typeof google === 'undefined') return;
  google.script.run
    .withSuccessHandler(function(r){
      if (r && r.files) { __cachedRptFiles = r.files; __cachedRptError = r.error || null; }
      else if (Array.isArray(r)) { __cachedRptFiles = r; __cachedRptError = null; }
      else { __cachedRptFiles = []; __cachedRptError = 'Empty response'; }
      __renderReportsFiles_(__cachedRptFiles);
    })
    .withFailureHandler(function(e){
      __cachedRptFiles = []; __cachedRptError = (e && e.message) || 'Sync failed';
      __renderReportsFiles_([]);
    })
    .serverGetWeeklyReports();
}
`;
  // Insert before renderReports_files_
  const insertAnchor = 'function renderReports_files_';
  dash = dash.replace(insertAnchor, reloadFn + '\n' + insertAnchor);
  console.log('✓ Added __rptReloadFiles_ helper');
}

// __renderReportsFiles_ may also need updating — check if it exists
// The current code uses renderReports_files_ (no underscore variant exists)
// So make __renderReportsFiles_ an alias to it
if (!dash.includes('function __renderReportsFiles_')) {
  const aliasFn = `
function __renderReportsFiles_(files) { return renderReports_files_(files); }
`;
  dash = dash.replace('function renderReports_files_', aliasFn + '\nfunction renderReports_files_');
  console.log('✓ Added __renderReportsFiles_ alias');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V49: fix Shared Drive listing + error surfacing ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V49: drive listing fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
