#!/usr/bin/env node
/**
 * V45 — Weekly Report auto-sync from Drive
 *
 * Adds two new server functions in Code.gs:
 *   - serverSyncWeeklyReportData()  — scans Drive folder, parses each
 *     weekly Sheet (both grid + log formats), saves to script properties.
 *   - serverGetWeeklyReportData()   — returns cached data + syncedAt.
 *
 * Dashboard changes:
 *   - On Reports load, fetches server data and uses it (falls back to
 *     hardcoded __RPT_DATA if empty / sync never run).
 *   - Header gains a "↻ Sync" button + last-synced timestamp.
 *   - Click sync → spinner → resyncs → re-renders.
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

// ─── 1. Add Code.gs functions ────────────────────────────────────────────────
const NEW_CODE_FNS = `
// ─────────────────────────────────────────────────────────────────────────────
// WEEKLY REPORT DATA SYNC (V45)
// ─────────────────────────────────────────────────────────────────────────────

function serverSyncWeeklyReportData() {
  try {
    var t0 = Date.now();
    var rootFolder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    var monthIt = rootFolder.getFolders();
    var allWeeks = [];
    var errors = [];

    while (monthIt.hasNext()) {
      var mf = monthIt.next();
      var fIt = mf.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (fIt.hasNext()) {
        var f = fIt.next();
        try {
          var data = parseWeeklySheet_(f.getId(), f.getName());
          if (data) allWeeks.push(data);
        } catch (e) {
          errors.push(f.getName() + ': ' + e.message);
        }
      }
    }

    // Dedup by start date (in case of mis-classified copies), keep most recent modified
    var byStart = {};
    allWeeks.forEach(function(w){
      if (!byStart[w.s] || (w.modifiedTime || '') > (byStart[w.s].modifiedTime || '')) {
        byStart[w.s] = w;
      }
    });
    var uniqueWeeks = Object.keys(byStart).sort().map(function(k){ return byStart[k]; });

    // Re-number weeks chronologically
    uniqueWeeks.forEach(function(w, i){
      w.w = 'W' + (i+1 < 10 ? '0'+(i+1) : (i+1));
      delete w.modifiedTime;
    });

    var payload = {
      weeks: uniqueWeeks,
      syncedAt: new Date().toISOString(),
      elapsedMs: Date.now() - t0,
      errors: errors,
    };
    PropertiesService.getScriptProperties().setProperty('WEEKLY_REPORT_CACHE', JSON.stringify(payload));
    return { success: true, count: uniqueWeeks.length, syncedAt: payload.syncedAt, elapsedMs: payload.elapsedMs, errors: errors };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function parseWeeklySheet_(ssId, fileName) {
  // Filename like: "Weekly Report 12/5/26-18/5/26"
  var m = fileName.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})\\s*[-–]\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})/);
  if (!m) return null;
  function pad(n){ return n.length === 1 ? '0'+n : n; }
  function iso(d, mm, y){ if (y.length === 2) y = '20'+y; return y + '-' + pad(mm) + '-' + pad(d); }
  var startDate = iso(m[1], m[2], m[3]);
  var endDate   = iso(m[4], m[5], m[6]);

  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var sm = parseInt(m[2], 10), em = parseInt(m[5], 10);
  var sd = parseInt(m[1], 10), ed = parseInt(m[4], 10);
  var moLabel = months[sm-1];
  var dLabel  = (sm === em)
    ? sd + '–' + ed + ' ' + months[sm-1]
    : sd + ' ' + months[sm-1] + '–' + (ed < 10 ? '0'+ed : ed) + ' ' + months[em-1];

  var ss = SpreadsheetApp.openById(ssId);
  var sheets = ss.getSheets();

  function findTab(patterns) {
    for (var i = 0; i < patterns.length; i++) {
      for (var j = 0; j < sheets.length; j++) {
        if (sheets[j].getName().toLowerCase().indexOf(patterns[i]) >= 0) return sheets[j];
      }
    }
    return null;
  }

  function count(sheet) {
    if (!sheet) return 0;
    var name = sheet.getName().toLowerCase();
    var lr = sheet.getLastRow();
    var lc = Math.min(sheet.getLastColumn() || 1, 10);
    if (lr < 2) return 0;
    var vals = sheet.getRange(1, 1, Math.min(lr, 2000), lc).getValues();
    if (name.indexOf('log') >= 0) {
      // Log format: count non-empty data rows
      var c = 0;
      for (var i = 1; i < vals.length; i++) {
        for (var j = 0; j < vals[i].length; j++) {
          if (vals[i][j] !== '' && vals[i][j] != null && String(vals[i][j]).trim() !== '') { c++; break; }
        }
      }
      return c;
    } else {
      // Grid format: find "Total" row, col B has the number
      for (var k = 0; k < vals.length; k++) {
        if (String(vals[k][0] || '').trim().toLowerCase() === 'total') {
          return parseInt(String(vals[k][1] || '0').replace(/,/g, ''), 10) || 0;
        }
      }
      return 0;
    }
  }

  var promoTab  = findTab(['promo code log','promo code','promo']);
  var bannerTab = findTab(['banner log','banner']);
  var crmTab    = findTab(['crm assignment','crm']);
  var gamesTab  = findTab(['new games','games']);

  return {
    d: dLabel,
    mo: moLabel,
    s: startDate,
    e: endDate,
    p: count(promoTab),
    b: count(bannerTab),
    c: count(crmTab),
    g: count(gamesTab),
  };
}

function serverGetWeeklyReportData() {
  var cached = PropertiesService.getScriptProperties().getProperty('WEEKLY_REPORT_CACHE');
  if (!cached) return { weeks: [], syncedAt: null };
  try { return JSON.parse(cached); }
  catch (e) { return { weeks: [], syncedAt: null }; }
}

`;

// Insert before "// ─── Promo Requests" or similar section marker — just append near end of Code.gs.
// Simpler: insert immediately before serverGetWeeklyReports().
const ANCHOR_BEFORE = `function serverGetWeeklyReports() {`;
if (!code.includes(ANCHOR_BEFORE)) {
  console.error('✗ serverGetWeeklyReports anchor not found');
  process.exit(1);
}
if (code.includes('function serverSyncWeeklyReportData')) {
  console.log('… serverSyncWeeklyReportData already present, skipping insertion');
} else {
  code = code.replace(ANCHOR_BEFORE, NEW_CODE_FNS + ANCHOR_BEFORE);
  console.log('✓ Code.gs: added serverSyncWeeklyReportData + serverGetWeeklyReportData');
}

// ─── 2. Dashboard: wire up sync button + load data from server ───────────────
// Find the renderReports function (entry point)
const OLD_RENDER_REPORTS = `function renderReports() {
  __rptTab = 'analysis';
  renderReports_analysis_();
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  }
}`;

const NEW_RENDER_REPORTS = `var __rptSyncedAt = null;
var __rptSyncing  = false;

function renderReports() {
  __rptTab = 'analysis';
  // Try to load cached server data first; if empty, keep hardcoded __RPT_DATA
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();
    // Also kick off file-list load in background
    google.script.run
      .withSuccessHandler(function(f){ __cachedRptFiles = f; })
      .withFailureHandler(function(){   __cachedRptFiles = []; })
      .serverGetWeeklyReports();
  } else {
    renderReports_analysis_();
  }
}

function __rptSync_() {
  if (__rptSyncing) return;
  __rptSyncing = true;
  // Show spinner toast
  if (typeof toast === 'function') toast('Syncing weekly reports from Drive… this may take 1–2 min');
  var btn = document.getElementById('rpt-sync-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Syncing…'; }
  if (typeof google === 'undefined') { __rptSyncing = false; if (btn) btn.disabled = false; return; }
  google.script.run
    .withSuccessHandler(function(r){
      __rptSyncing = false;
      if (r && r.success) {
        if (typeof toast === 'function') toast('✓ Synced ' + r.count + ' weeks in ' + Math.round(r.elapsedMs/1000) + 's');
        renderReports();  // reload data + re-render
      } else {
        if (typeof toast === 'function') toast('✗ Sync failed: ' + (r && r.error || 'unknown'));
        if (btn) { btn.disabled = false; btn.innerHTML = '↻ Sync'; }
      }
    })
    .withFailureHandler(function(e){
      __rptSyncing = false;
      if (typeof toast === 'function') toast('✗ Sync failed: ' + (e && e.message || e));
      if (btn) { btn.disabled = false; btn.innerHTML = '↻ Sync'; }
    })
    .serverSyncWeeklyReportData();
}`;

if (dash.includes(OLD_RENDER_REPORTS)) {
  dash = dash.replace(OLD_RENDER_REPORTS, NEW_RENDER_REPORTS);
  console.log('✓ Dashboard: renderReports now loads server data + sync helper added');
} else {
  console.error('✗ renderReports anchor not found');
  process.exit(1);
}

// ─── 3. Header: replace Schedule/Export with Sync button + synced timestamp ──
const OLD_HEADER_BTNS = `    +'<div style="display:flex;gap:6px;align-items:center">'
      +'<button class="btn" onclick="alert(\\'Schedule report feature coming soon\\')" style="font-size:11px;padding:6px 10px">📅 Schedule</button>'
      +'<a class="btn" href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="text-decoration:none;font-size:11px;padding:6px 10px">↓ Export</a>'
      +'<button class="btn" onclick="__rptNav_(\\'files\\')" style="font-size:11px;padding:6px 10px;background:var(--accent);color:#fff;border:none">📤 Share Report</button>'
    +'</div>'`;

const NEW_HEADER_BTNS = `    +'<div style="display:flex;gap:6px;align-items:center">'
      +'<div style="font-size:10px;color:var(--muted);margin-right:6px">'+(__rptSyncedAt ? '🕒 Synced ' + __rptSyncedAt.slice(0,10) + ' ' + __rptSyncedAt.slice(11,16) + ' UTC' : '⚠ Using cached data — click Sync')+'</div>'
      +'<button class="btn" id="rpt-sync-btn" onclick="__rptSync_()" style="font-size:11px;padding:6px 10px;background:var(--accent);color:#fff;border:none">↻ Sync from Drive</button>'
      +'<a class="btn" href="https://drive.google.com/drive/folders/1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P" target="_blank" style="text-decoration:none;font-size:11px;padding:6px 10px">↗ Drive Folder</a>'
    +'</div>'`;

if (dash.includes(OLD_HEADER_BTNS)) {
  dash = dash.replace(OLD_HEADER_BTNS, NEW_HEADER_BTNS);
  console.log('✓ Dashboard: header now shows Sync button + last-synced time');
} else {
  console.error('✗ Header buttons anchor not found');
  process.exit(1);
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V45: Weekly Report auto-sync from Drive ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V45: weekly sync',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
