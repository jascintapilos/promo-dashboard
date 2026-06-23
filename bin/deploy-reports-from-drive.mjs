#!/usr/bin/env node
/**
 * Replace task-generated Reports with Drive-folder file browser.
 * Lists weekly reports from the Shared Drive folder, embeds the selected
 * Google Sheet in an iframe.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1Zw5W9LjmYL5hzFpHXdr0G_Q7oFRVCAGqZVTBmQCjiOmZIO2R7M6h8l6O';
const DEPLOYMENT_ID = 'AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ';
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
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let code = proj.files[codeIdx].source;
let dash = proj.files[dashIdx].source;

// ─── 1. Add serverGetWeeklyReports to Code.gs ────────────────────────────────
const reportsServerFn = `

const WEEKLY_REPORT_FOLDER_ID = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';

function serverGetWeeklyReports() {
  // Lists all weekly report Sheet files inside the monthly subfolders.
  // Uses Drive REST API via UrlFetchApp because it's in a Shared Drive
  // (Apps Script's DriveApp doesn't always handle shared drives well).
  function fetch_(url) {
    var token = ScriptApp.getOAuthToken();
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return JSON.parse(res.getContentText());
  }
  function listChildren(parentId, mimeFilter) {
    var q = "'" + parentId + "' in parents and trashed=false";
    if (mimeFilter) q += " and mimeType='" + mimeFilter + "'";
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?q=' + encodeURIComponent(q)
      + '&fields=' + encodeURIComponent('files(id,name,mimeType,modifiedTime)')
      + '&orderBy=modifiedTime+desc'
      + '&pageSize=100'
      + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
    var data = fetch_(url);
    return (data && data.files) || [];
  }
  try {
    var all = [];
    // 1. List monthly subfolders
    var months = listChildren(WEEKLY_REPORT_FOLDER_ID, 'application/vnd.google-apps.folder');
    // 2. For each month, list weekly sheet files
    months.forEach(function(m){
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
    });
    // Sort all by modifiedTime desc
    all.sort(function(a,b){ return String(b.modifiedTime).localeCompare(String(a.modifiedTime)); });
    return all;
  } catch (e) {
    Logger.log('serverGetWeeklyReports error: ' + e.message);
    return [];
  }
}
`;

if (!code.includes('function serverGetWeeklyReports')) {
  // Append to end of Code.gs
  code = code.trimEnd() + '\n' + reportsServerFn;
  console.log('✓ Code.gs: added serverGetWeeklyReports');
}

// ─── 2. Replace renderReports in Dashboard.html with Drive viewer ───────────
// Find the existing reports block (added in V38) and replace it
const startMarker = '// ============================================================================\n// REPORTS — date-filterable weekly view';
const endMarker = '// ============================================================================\n// SETTINGS';

const startIdx = dash.indexOf(startMarker);
const endIdx = dash.indexOf(endMarker);

if (startIdx >= 0 && endIdx > startIdx) {
  const newReports = `// ============================================================================
// REPORTS — Weekly Report files from Drive
// ============================================================================
var __selectedReportId = null;

function renderReports() {
  loading();
  if (typeof google === 'undefined') { renderReportsData([]); return; }
  google.script.run
    .withSuccessHandler(renderReportsData)
    .withFailureHandler(function(){ renderReportsData([]); })
    .serverGetWeeklyReports();
}

function renderReportsData(files) {
  if (!files.length) {
    content('<div class="empty">📭 No weekly reports found in Drive folder.<br><a href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="color:var(--accent)">Open Weekly Report folder →</a></div>');
    return;
  }
  // Group files by month
  var byMonth = {};
  files.forEach(function(f){
    var m = f.month || 'Other';
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(f);
  });

  // Default selected: most recent file
  if (!__selectedReportId || !files.find(function(f){ return f.id === __selectedReportId; })) {
    __selectedReportId = files[0].id;
  }
  var selected = files.find(function(f){ return f.id === __selectedReportId; });

  var sidebar = '<div style="display:flex;flex-direction:column;gap:12px">';
  Object.keys(byMonth).forEach(function(month){
    sidebar += '<div>' +
      '<div style="font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.06em;padding:6px 10px">' + esc(month) + '</div>';
    byMonth[month].forEach(function(f){
      var on = f.id === __selectedReportId;
      var modDate = String(f.modifiedTime || '').slice(0,10);
      sidebar += '<div onclick="selectReport(\\'' + esc(f.id) + '\\')" style="padding:8px 10px;border-radius:6px;cursor:pointer;font-size:11px;background:' + (on ? 'var(--pill-bg)' : 'transparent') + ';color:' + (on ? 'var(--accent)' : 'var(--text)') + ';border-left:3px solid ' + (on ? 'var(--accent)' : 'transparent') + ';margin-bottom:2px">' +
        '<div style="font-weight:600;margin-bottom:2px">' + esc(f.name) + '</div>' +
        '<div style="font-size:10px;color:var(--muted)">Modified ' + modDate + '</div>' +
        '</div>';
    });
    sidebar += '</div>';
  });
  sidebar += '</div>';

  var html = '<div class="card" style="margin:0;height:calc(100vh - 100px);display:flex;flex-direction:column">' +
    '<div class="card-hdr" style="flex-shrink:0">' +
      '<h3>📊 ' + esc(selected.name) + '</h3>' +
      '<div style="display:flex;gap:8px">' +
        '<a class="btn" href="' + esc(selected.openUrl) + '" target="_blank" style="text-decoration:none">↗ Open in new tab</a>' +
        '<button class="btn" onclick="renderReports()">↻ Refresh list</button>' +
      '</div>' +
    '</div>' +
    '<div style="display:flex;flex:1;overflow:hidden">' +
      '<div style="width:260px;border-right:1px solid var(--border);overflow-y:auto;padding:10px;flex-shrink:0">' + sidebar + '</div>' +
      '<div style="flex:1;background:#fff;overflow:hidden">' +
        '<iframe src="' + esc(selected.embedUrl) + '" style="width:100%;height:100%;border:0" allow="autoplay"></iframe>' +
      '</div>' +
    '</div>' +
    '</div>';
  content(html);
}

function selectReport(id) {
  __selectedReportId = id;
  // Re-render without re-fetching (use cached file list if we have it)
  if (typeof google !== 'undefined') {
    google.script.run.withSuccessHandler(renderReportsData).serverGetWeeklyReports();
  }
}

// ============================================================================
// SETTINGS`;

  dash = dash.slice(0, startIdx) + newReports + dash.slice(endIdx + endMarker.length - '// SETTINGS'.length);
  console.log('✓ Dashboard: Reports replaced with Drive file browser + iframe embed');
}

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V39 + Drive-folder Reports ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Drive Reports' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
