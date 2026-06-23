#!/usr/bin/env node
/**
 * V53 — Fix the "Sync from Drive" permission issue.
 *
 * Same root cause as V51: Apps Script auto-detects scopes from the code
 * actually called. serverSyncWeeklyReportData uses DriveApp (drive scope
 * triggers automatically) but the inner parseWeeklySheet_() uses
 * SpreadsheetApp.openById(). Sometimes Apps Script's scope detector
 * doesn't pick up cross-function calls reliably — token comes back
 * without spreadsheets scope → 403 on .openById().
 *
 * Fix:
 *   1. Warm up BOTH DriveApp + SpreadsheetApp scope at the top of
 *      serverSyncWeeklyReportData (reference each before using).
 *   2. Catch per-sheet errors more granularly and report them.
 *   3. Surface the actual error to the dashboard (no more generic
 *      "Sync failed: undefined").
 *   4. Dashboard: persist sync errors in a banner card on Analysis tab
 *      so the user sees what failed without dismissing the toast.
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

// ─── 1. Replace serverSyncWeeklyReportData with scope warm-up version ───────
const OLD_SYNC_FN_PATTERN = /function serverSyncWeeklyReportData\(\) \{[\s\S]*?\n\}/;

const NEW_SYNC_FN = `function serverSyncWeeklyReportData() {
  var t0 = Date.now();
  var errors = [];

  // ── Warm up scopes — force Apps Script to include drive + spreadsheets ──
  try {
    // drive.readonly trigger
    DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID).getName();
  } catch (driveErr) {
    return { success: false, error: 'Drive access failed: ' + driveErr.message };
  }
  try {
    // spreadsheets trigger — open the known Task_Master sheet
    SpreadsheetApp.openById(SS_ID).getName();
  } catch (ssErr) {
    return { success: false, error: 'SpreadsheetApp access failed: ' + ssErr.message };
  }

  // ── Main sync ──
  var allWeeks = [];
  var processed = 0, parsed = 0;
  try {
    var rootFolder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    var monthIt = rootFolder.getFolders();
    while (monthIt.hasNext()) {
      // Check elapsed time — bail before 5min Apps Script limit
      if (Date.now() - t0 > 280000) {
        errors.push('TIMEOUT: ran for 4m40s, ' + processed + ' sheets processed, stopping');
        break;
      }
      var mf;
      try { mf = monthIt.next(); } catch (mErr) { errors.push('month iter: ' + mErr.message); continue; }
      var fIt;
      try { fIt = mf.getFilesByType(MimeType.GOOGLE_SHEETS); }
      catch (fErr) { errors.push(mf.getName() + ' getFiles: ' + fErr.message); continue; }
      while (fIt.hasNext()) {
        var f;
        try { f = fIt.next(); } catch (fnErr) { errors.push('file iter: ' + fnErr.message); continue; }
        processed++;
        try {
          var data = parseWeeklySheet_(f.getId(), f.getName());
          if (data) { allWeeks.push(data); parsed++; }
          else errors.push(f.getName() + ': filename does not match expected date pattern');
        } catch (parseErr) {
          errors.push(f.getName() + ': ' + parseErr.message);
        }
      }
    }
  } catch (mainErr) {
    return { success: false, error: 'Sync loop crashed: ' + mainErr.message, processed: processed, parsed: parsed };
  }

  // Dedup by start date — keep most recent modified
  var byStart = {};
  allWeeks.forEach(function(w){
    if (!byStart[w.s] || (w.modifiedTime || '') > (byStart[w.s].modifiedTime || '')) byStart[w.s] = w;
  });
  var uniqueWeeks = Object.keys(byStart).sort().map(function(k){ return byStart[k]; });

  // Re-number chronologically
  uniqueWeeks.forEach(function(w, i){
    w.w = 'W' + (i+1 < 10 ? '0'+(i+1) : (i+1));
    delete w.modifiedTime;
  });

  var payload = {
    weeks: uniqueWeeks,
    syncedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    errors: errors,
    processed: processed,
    parsed: parsed,
  };
  try {
    PropertiesService.getScriptProperties().setProperty('WEEKLY_REPORT_CACHE', JSON.stringify(payload));
  } catch (cacheErr) {
    return { success: false, error: 'Cache save failed: ' + cacheErr.message, count: uniqueWeeks.length, errors: errors };
  }
  return {
    success: true,
    count: uniqueWeeks.length,
    syncedAt: payload.syncedAt,
    elapsedMs: payload.elapsedMs,
    processed: processed,
    parsed: parsed,
    errors: errors,
  };
}`;

if (!OLD_SYNC_FN_PATTERN.test(code)) {
  console.error('✗ serverSyncWeeklyReportData anchor not found');
  process.exit(1);
}
code = code.replace(OLD_SYNC_FN_PATTERN, NEW_SYNC_FN);
console.log('✓ serverSyncWeeklyReportData: scope warm-up + granular errors + timeout guard');

// ─── 2. Dashboard: persist sync error banner on Analysis tab ────────────────
// Add __rptLastSyncResult state + show banner if there's an error
const OLD_SYNC_HELPER = `function __rptSync_() {
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

const NEW_SYNC_HELPER = `var __rptLastSyncResult = null; // { success, count, syncedAt, errors[], error, processed, parsed }

function __rptSync_() {
  if (__rptSyncing) return;
  __rptSyncing = true;
  __rptLastSyncResult = null;
  if (typeof toast === 'function') toast('🔄 Syncing weekly reports from Drive… 1–2 min');
  var btn = document.getElementById('rpt-sync-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Syncing…'; }
  if (typeof google === 'undefined') { __rptSyncing = false; if (btn) btn.disabled = false; return; }
  google.script.run
    .withSuccessHandler(function(r){
      __rptSyncing = false;
      __rptLastSyncResult = r || {};
      if (r && r.success) {
        if (typeof toast === 'function') toast('✓ Synced ' + r.count + ' weeks (' + r.parsed + ' parsed, ' + (r.errors?r.errors.length:0) + ' errors) in ' + Math.round(r.elapsedMs/1000) + 's');
      } else {
        if (typeof toast === 'function') toast('✗ Sync failed: ' + (r && r.error || 'unknown — see banner'));
      }
      renderReports();
    })
    .withFailureHandler(function(e){
      __rptSyncing = false;
      __rptLastSyncResult = { success: false, error: (e && e.message) || String(e) };
      if (typeof toast === 'function') toast('✗ Sync failed: ' + (e && e.message || 'permission denied'));
      if (btn) { btn.disabled = false; btn.innerHTML = '↻ Sync from Drive'; }
      renderReports();
    })
    .serverSyncWeeklyReportData();
}

function __rptSyncBanner_() {
  var r = __rptLastSyncResult;
  if (!r) return '';
  if (r.success && (!r.errors || r.errors.length === 0)) {
    return '<div class="card card-flat" style="padding:10px 14px;margin:0 0 14px 0;background:rgba(16,185,129,.08);border:1px solid rgba(16,185,129,.3)">'
      +'<div style="display:flex;align-items:center;gap:8px;font-size:12px"><span style="color:#10b981">✓</span><span style="color:var(--text)"><strong>Sync complete</strong> · ' + r.count + ' weeks loaded · ' + r.parsed + ' parsed · ' + Math.round((r.elapsedMs||0)/1000) + 's</span><button onclick="__rptLastSyncResult=null;renderReports()" style="margin-left:auto;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px">×</button></div>'
      +'</div>';
  }
  if (r.success && r.errors && r.errors.length) {
    var errorsHtml = r.errors.slice(0, 8).map(function(e){
      return '<div style="font-family:monospace;font-size:10px;color:var(--muted);padding:2px 0">• ' + esc(e) + '</div>';
    }).join('');
    if (r.errors.length > 8) errorsHtml += '<div style="font-size:10px;color:var(--muted)">… and ' + (r.errors.length-8) + ' more</div>';
    return '<div class="card card-flat" style="padding:12px 14px;margin:0 0 14px 0;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3)">'
      +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:6px"><span style="color:#f59e0b">⚠</span><span style="color:var(--text)"><strong>Sync complete with warnings</strong> · ' + r.count + ' weeks loaded · ' + r.errors.length + ' errors</span><button onclick="__rptLastSyncResult=null;renderReports()" style="margin-left:auto;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px">×</button></div>'
      +errorsHtml
      +'</div>';
  }
  // Failure
  return '<div class="card card-flat" style="padding:12px 14px;margin:0 0 14px 0;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3)">'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:4px"><span style="color:#ef4444">✗</span><span style="color:var(--text)"><strong>Sync failed</strong></span><button onclick="__rptLastSyncResult=null;renderReports()" style="margin-left:auto;background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:14px">×</button></div>'
    +'<div style="font-family:monospace;font-size:10px;color:#ef4444;background:rgba(0,0,0,.2);border-radius:4px;padding:6px 10px;margin-top:4px">' + esc(r.error || 'Unknown error') + '</div>'
    +(r.processed ? '<div style="font-size:10px;color:var(--muted);margin-top:6px">Processed ' + r.processed + ' files, parsed ' + (r.parsed||0) + ' before failure</div>' : '')
    +'</div>';
}`;

if (!dash.includes(OLD_SYNC_HELPER)) {
  console.error('✗ __rptSync_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_SYNC_HELPER, NEW_SYNC_HELPER);
console.log('✓ __rptSync_ + __rptSyncBanner_ rewired with error banner');

// ─── 3. Render the sync banner in the analysis view ─────────────────────────
const OLD_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + __utilizationCard_()
    + trendsRow
    + __automationCard_()
    + insights
  );`;

const NEW_CONTENT_CALL = `  content(
    __rptHeader_(weeks, prev)
    + __rptTabBar_('analysis')
    + __rptSyncBanner_()
    + __rptFilterBar_(weeks)
    + kpis
    + moduleGrid
    + __utilizationCard_()
    + trendsRow
    + __automationCard_()
    + insights
  );`;

if (!dash.includes(OLD_CONTENT_CALL)) {
  console.error('✗ content() call anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_CONTENT_CALL, NEW_CONTENT_CALL);
console.log('✓ Sync banner slotted into analysis layout');

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V53: fix sync permissions (scope warm-up + error banner) ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V53: sync permissions fix',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('\nhttps://script.google.com/macros/s/AKfycbz8wysv66dtQuh4JsWiguglcsZUcsmLMd1N3ELdJQ9sYuXhoBsOuu9R6BeTjiIcAMYJPQ/exec');
