#!/usr/bin/env node
/**
 * V61 — Replace Task_Master-based utilization with real "Work Hours
 *       Utilisation Tracker" sheets in folder 1CUBHs_q9hS5sTjNd_i0vHGCTSPm8yKVi.
 *
 *   Server side (Code.gs):
 *     • WORK_HOURS_FOLDER_ID constant.
 *     • serverSyncUtilizationData() — scans folder, reads each "… - <Name>"
 *       sheet, parses every monthly tab, extracts Date + Duration per row,
 *       builds { person: { hoursByDate: {YYYY-MM-DD: hours} } }, caches in
 *       PropertiesService.
 *     • serverGetUtilizationData() — returns cached payload.
 *     • aaa_authorize gains a new probe of the work-hours folder.
 *
 *   Dashboard side:
 *     • __utilizationStats_ + renderReports_utilization_ refactored to read
 *       from the new cache. Task_Master Owner counting removed entirely
 *       for utilization purposes.
 *     • Sync button now also triggers utilization sync.
 *     • Compact Utilization card + full Utilization view both reflect real
 *       logged hours instead of (tasks × 1.5h estimate).
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

// ─── 1. Add WORK_HOURS_FOLDER_ID constant ────────────────────────────────────
if (!code.includes('WORK_HOURS_FOLDER_ID')) {
  const anchor = `const WEEKLY_REPORT_FOLDER_ID = '1SvTyOPxDCVnPjmYU-XjMlOupQ2M1T_8P';`;
  const insert = anchor + `\nconst WORK_HOURS_FOLDER_ID    = '1CUBHs_q9hS5sTjNd_i0vHGCTSPm8yKVi';  // Work Hours Utilisation Tracker folder`;
  code = code.replace(anchor, insert);
  console.log('✓ Added WORK_HOURS_FOLDER_ID constant');
}

// ─── 2. Add serverSyncUtilizationData + serverGetUtilizationData ─────────────
const UTIL_SERVER = `
// ─────────────────────────────────────────────────────────────────────────────
// WORK HOURS UTILISATION SYNC (V61)
// ─────────────────────────────────────────────────────────────────────────────

function serverSyncUtilizationData() {
  var t0 = Date.now();
  var errors = [];

  // Warm-up scopes
  try { DriveApp.getFolderById(WORK_HOURS_FOLDER_ID).getName(); }
  catch (e) { return { success: false, error: 'Drive access failed: ' + e.message }; }

  var people = {};
  var processed = 0, parsed = 0;

  try {
    var folder = DriveApp.getFolderById(WORK_HOURS_FOLDER_ID);
    var fIt = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (fIt.hasNext()) {
      if (Date.now() - t0 > 280000) { errors.push('TIMEOUT after ' + processed + ' files'); break; }
      var f = fIt.next();
      processed++;
      var fname = f.getName();
      // Extract person name: filename ends with "- <Name>"
      var nameMatch = fname.match(/-\\s*([A-Za-z][A-Za-z\\s]*?)\\s*$/);
      if (!nameMatch) { errors.push(fname + ': cannot extract person name'); continue; }
      var person = nameMatch[1].trim();
      try {
        var data = parseUtilTracker_(f.getId());
        if (data && Object.keys(data.hoursByDate).length) {
          people[person] = data;
          parsed++;
        } else {
          errors.push(fname + ': no hours data found');
        }
      } catch (e) {
        errors.push(fname + ': ' + e.message);
      }
    }
  } catch (mainErr) {
    return { success: false, error: 'Sync loop crashed: ' + mainErr.message, processed: processed, parsed: parsed };
  }

  var payload = {
    people: people,
    syncedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    errors: errors,
    processed: processed,
    parsed: parsed,
  };
  try {
    PropertiesService.getScriptProperties().setProperty('WORK_HOURS_CACHE', JSON.stringify(payload));
  } catch (cacheErr) {
    return { success: false, error: 'Cache save failed: ' + cacheErr.message, errors: errors };
  }
  return {
    success: true,
    count: Object.keys(people).length,
    syncedAt: payload.syncedAt,
    elapsedMs: payload.elapsedMs,
    processed: processed, parsed: parsed,
    errors: errors,
  };
}

function parseUtilTracker_(ssId) {
  var ss = SpreadsheetApp.openById(ssId);
  var sheets = ss.getSheets();
  var hoursByDate = {};
  var monthTabPattern = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{4}/i;

  sheets.forEach(function(sh) {
    var tabName = sh.getName();
    if (!monthTabPattern.test(tabName)) return;  // skip non-month tabs (e.g. TRAINING LOG)
    var lr = sh.getLastRow();
    if (lr < 2) return;
    var vals = sh.getRange(1, 1, lr, 8).getValues();
    var currentDate = null;
    for (var i = 1; i < vals.length; i++) {
      var dRaw = vals[i][0];
      var hours = parseFloat(vals[i][3]);

      // Skip WEEK header rows (e.g. "WEEK 1")
      if (typeof dRaw === 'string' && /^\\s*WEEK\\s+\\d+/i.test(dRaw)) continue;

      // Parse date if present
      if (dRaw) {
        var iso = utilParseDate_(dRaw);
        if (iso) currentDate = iso;
      }
      if (currentDate && !isNaN(hours) && hours > 0) {
        hoursByDate[currentDate] = Math.round(((hoursByDate[currentDate] || 0) + hours) * 100) / 100;
      }
    }
  });

  return { hoursByDate: hoursByDate };
}

function utilParseDate_(cell) {
  if (cell instanceof Date) {
    // JS Date — format as ISO yyyy-mm-dd (UTC)
    var y = cell.getFullYear(), m = cell.getMonth() + 1, d = cell.getDate();
    return y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
  }
  if (typeof cell === 'string') {
    var m = cell.match(/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})/);
    if (m) {
      var y = m[3]; if (y.length === 2) y = '20' + y;
      return y + '-' + (m[2].length === 1 ? '0' + m[2] : m[2]) + '-' + (m[1].length === 1 ? '0' + m[1] : m[1]);
    }
  }
  return null;
}

function serverGetUtilizationData() {
  var cached = PropertiesService.getScriptProperties().getProperty('WORK_HOURS_CACHE');
  if (!cached) return { people: {}, syncedAt: null };
  try { return JSON.parse(cached); }
  catch (e) { return { people: {}, syncedAt: null }; }
}
`;

if (!code.includes('function serverSyncUtilizationData')) {
  // Insert before serverSyncWeeklyReportData
  const anchor = `function serverSyncWeeklyReportData()`;
  code = code.replace(anchor, UTIL_SERVER + '\n' + anchor);
  console.log('✓ Added serverSyncUtilizationData + parseUtilTracker_ + serverGetUtilizationData');
}

// ─── 3. Update aaa_authorize to probe the work hours folder too ──────────────
const OLD_AUTH_DRIVE = `  try {
    var folder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    report.push('✓ DriveApp.getFolderById: ' + folder.getName());
    var monthIt = folder.getFolders();
    var n = 0; while (monthIt.hasNext()) { monthIt.next(); n++; }
    report.push('✓ DriveApp.getFolders: ' + n + ' subfolders');
  } catch (e) {
    report.push('✗ DriveApp FAILED: ' + e.message);
  }`;

const NEW_AUTH_DRIVE = `  try {
    var folder = DriveApp.getFolderById(WEEKLY_REPORT_FOLDER_ID);
    report.push('✓ DriveApp weekly folder: ' + folder.getName());
  } catch (e) {
    report.push('✗ DriveApp weekly FAILED: ' + e.message);
  }
  try {
    var whFolder = DriveApp.getFolderById(WORK_HOURS_FOLDER_ID);
    var fIt = whFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
    var n = 0; while (fIt.hasNext()) { fIt.next(); n++; }
    report.push('✓ DriveApp work-hours folder: ' + whFolder.getName() + ' (' + n + ' trackers)');
  } catch (e) {
    report.push('✗ DriveApp work-hours FAILED: ' + e.message);
  }`;

if (code.includes(OLD_AUTH_DRIVE)) {
  code = code.replace(OLD_AUTH_DRIVE, NEW_AUTH_DRIVE);
  console.log('✓ aaa_authorize now probes work-hours folder too');
}

// ─── 4. Dashboard: load util data on render + add to sync handler ────────────
const OLD_RENDER_REPORTS = `function renderReports() {
  __rptTab = 'analysis';
  // Ensure tasks loaded (needed for utilization + automation cards)
  if ((!S.tasks || !S.tasks.length) && typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(t){ S.tasks = t || []; })
      .withFailureHandler(function(){ S.tasks = S.tasks || []; })
      .serverGetTasks();
  }
  // Try to load cached server data first; if empty, keep hardcoded __RPT_DATA
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();
    google.script.run
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

const NEW_RENDER_REPORTS = `var __WORK_HOURS_DATA = null;   // { people: { Name: { hoursByDate: {} } }, syncedAt }
var __workHoursSyncedAt = null;

function renderReports() {
  __rptTab = 'analysis';
  if ((!S.tasks || !S.tasks.length) && typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(t){ S.tasks = t || []; })
      .withFailureHandler(function(){ S.tasks = S.tasks || []; })
      .serverGetTasks();
  }
  if (typeof google !== 'undefined') {
    google.script.run
      .withSuccessHandler(function(d){
        if (d && d.weeks && d.weeks.length) { __RPT_DATA.weeks = d.weeks; __rptSyncedAt = d.syncedAt; }
        renderReports_analysis_();
      })
      .withFailureHandler(function(){ renderReports_analysis_(); })
      .serverGetWeeklyReportData();
    google.script.run
      .withSuccessHandler(function(f){
        if (f && f.files) { __cachedRptFiles = f.files; __cachedRptError = f.error || null; }
        else if (Array.isArray(f)) { __cachedRptFiles = f; __cachedRptError = null; }
        else { __cachedRptFiles = []; }
      })
      .withFailureHandler(function(){ __cachedRptFiles = []; })
      .serverGetWeeklyReports();
    // NEW V61: load work-hours utilisation data
    google.script.run
      .withSuccessHandler(function(d){
        __WORK_HOURS_DATA = d || null;
        __workHoursSyncedAt = d && d.syncedAt || null;
        if (__rptTab === 'analysis' || __rptTab === 'utilization') {
          if (__rptTab === 'utilization') renderReports_utilization_();
          else renderReports_analysis_();
        }
      })
      .withFailureHandler(function(){ __WORK_HOURS_DATA = null; })
      .serverGetUtilizationData();
  } else {
    renderReports_analysis_();
  }
}`;

if (!dash.includes(OLD_RENDER_REPORTS)) {
  console.error('✗ renderReports anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_RENDER_REPORTS, NEW_RENDER_REPORTS);
console.log('✓ renderReports now also loads work-hours data on render');

// ─── 5. Update __rptSync_ to ALSO sync utilization ──────────────────────────
const OLD_SYNC = `function __rptSync_() {
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
}`;

const NEW_SYNC = `function __rptSync_() {
  if (__rptSyncing) return;
  __rptSyncing = true;
  __rptLastSyncResult = null;
  if (typeof toast === 'function') toast('🔄 Syncing weekly reports + work hours from Drive… 2–4 min');
  var btn = document.getElementById('rpt-sync-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Syncing…'; }
  if (typeof google === 'undefined') { __rptSyncing = false; if (btn) btn.disabled = false; return; }

  // Sync weekly reports first
  google.script.run
    .withSuccessHandler(function(rw){
      __rptLastSyncResult = rw || {};
      // Then sync utilisation trackers
      google.script.run
        .withSuccessHandler(function(ru){
          __rptSyncing = false;
          var msgParts = [];
          if (rw && rw.success) msgParts.push('weekly ' + rw.count + 'w');
          if (ru && ru.success) msgParts.push('hours ' + ru.count + 'p');
          var msg = msgParts.length ? '✓ Synced ' + msgParts.join(' · ') : '✗ Sync had issues';
          if (typeof toast === 'function') toast(msg);
          if (ru && !ru.success) __rptLastSyncResult = ru;  // surface util error if weekly was ok
          renderReports();
        })
        .withFailureHandler(function(e){
          __rptSyncing = false;
          __rptLastSyncResult = { success: false, error: 'Util sync failed: ' + ((e && e.message) || String(e)) };
          if (typeof toast === 'function') toast('✗ Util sync failed');
          renderReports();
        })
        .serverSyncUtilizationData();
    })
    .withFailureHandler(function(e){
      __rptSyncing = false;
      __rptLastSyncResult = { success: false, error: (e && e.message) || String(e) };
      if (typeof toast === 'function') toast('✗ Sync failed: ' + (e && e.message || 'permission denied'));
      if (btn) { btn.disabled = false; btn.innerHTML = '↻ Sync from Drive'; }
      renderReports();
    })
    .serverSyncWeeklyReportData();
}`;

if (!dash.includes(OLD_SYNC)) {
  console.error('✗ __rptSync_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_SYNC, NEW_SYNC);
console.log('✓ Sync button now syncs BOTH weekly reports AND work hours');

// ─── 6. Replace __utilizationStats_ to use work-hours data ──────────────────
const OLD_UTIL_STATS_PATTERN = /function __utilizationStats_\(\) \{[\s\S]*?\n\}/;
const NEW_UTIL_STATS = `function __utilizationStats_() {
  // V61: Real logged hours from Work Hours Utilisation Tracker (per-person sheets).
  // Filtered by __rptFilter date range. Replaces previous Task_Master-based estimation.
  var from = __rptFilter.from, to = __rptFilter.to;
  var weeks = Math.max(1, __rptFilteredWeeks_().length);
  var CAPACITY_PER_WEEK = 40; // target hours per person per week

  var people = (__WORK_HOURS_DATA && __WORK_HOURS_DATA.people) || {};
  var personArr = [];

  Object.keys(people).forEach(function(name){
    var hbd = people[name].hoursByDate || {};
    var logged = 0;
    Object.keys(hbd).forEach(function(d){
      if (d >= from && d <= to) logged += (parseFloat(hbd[d]) || 0);
    });
    logged = Math.round(logged * 10) / 10;
    var capacity = weeks * CAPACITY_PER_WEEK;
    var util = capacity > 0 ? Math.round(logged / capacity * 100) : 0;
    personArr.push({
      name: name,
      logged: logged,
      capacity: capacity,
      utilization: Math.min(100, util),
      workload: util >= 70 ? 'High' : util >= 40 ? 'Medium' : 'Low',
    });
  });

  // Team-wide aggregates
  var totalLogged = personArr.reduce(function(s,p){return s+p.logged;},0);
  var totalCapacity = personArr.length * weeks * CAPACITY_PER_WEEK;
  var utilizationPct = totalCapacity > 0 ? Math.round(totalLogged / totalCapacity * 100) : 0;

  // Build byOwner for backward-compat with other code paths
  var byOwner = {};
  personArr.forEach(function(p){ byOwner[p.name] = p.logged; });

  // Module workload — derive from S.tasks (real owner data is hours, not module)
  // Still uses Task_Master for module distribution since trackers don't categorize
  var byModule = {};
  var tasks = __tasksInRange_();
  tasks.forEach(function(t){
    var m = String(t.Module || 'Other');
    byModule[m] = (byModule[m] || 0) + 1;
  });

  return {
    total: Math.round(totalLogged * 10) / 10,
    capacity: totalCapacity,
    utilization: utilizationPct,
    byModule: byModule,
    byOwner: byOwner,
    weeks: weeks,
    rosterSize: personArr.length || (S.roster && S.roster.length) || 8,
    people: personArr,
    source: __WORK_HOURS_DATA ? 'work_hours' : 'none',
    syncedAt: __workHoursSyncedAt,
  };
}`;

if (!OLD_UTIL_STATS_PATTERN.test(dash)) {
  console.error('✗ __utilizationStats_ anchor not found');
  process.exit(1);
}
dash = dash.replace(OLD_UTIL_STATS_PATTERN, NEW_UTIL_STATS);
console.log('✓ __utilizationStats_ rewired to Work Hours Tracker data');

// ─── 7. Rewrite per-person table in renderReports_utilization_ ──────────────
// The big "owners = Object.keys(byOwner).filter(...).map(...)" block
const OLD_OWNERS_BUILD = /var byOwner = \{\};\n  tasks\.forEach\(function\(t\)\{[\s\S]*?\.sort\(function\(a,b\)\{ return b\.utilization - a\.utilization; \}\);/;

const NEW_OWNERS_BUILD = `var owners = (function(){
    var stats = __utilizationStats_();
    return (stats.people || []).map(function(p){
      var rosterEntry = (typeof __findInRoster_==='function') ? __findInRoster_(p.name) : null;
      // Skip leadership & exclude list
      if (rosterEntry && typeof __isExcludedOwner_==='function' && __isExcludedOwner_(p.name, rosterEntry)) return null;
      if (typeof __isExcludedOwner_==='function' && __isExcludedOwner_(p.name, null)) return null;
      var teamLabel = (rosterEntry && rosterEntry.position) ? rosterEntry.position
                    : (rosterEntry && rosterEntry.fullName && rosterEntry.fullName !== p.name) ? rosterEntry.fullName
                    : 'Team';
      var displayName = (rosterEntry && rosterEntry.name) ? rosterEntry.name : p.name;
      var prevLogged = 0;  // compute from prev period
      var prevHbd = (__WORK_HOURS_DATA && __WORK_HOURS_DATA.people && __WORK_HOURS_DATA.people[p.name] && __WORK_HOURS_DATA.people[p.name].hoursByDate) || {};
      Object.keys(prevHbd).forEach(function(d){ if (d >= prev.from && d <= prev.to) prevLogged += (parseFloat(prevHbd[d])||0); });
      prevLogged = Math.round(prevLogged * 10) / 10;
      return {
        name: displayName,
        team: teamLabel,
        tasks: Math.round(p.logged / 1.5),
        logged: p.logged,
        capacity: p.capacity,
        utilization: p.utilization,
        workload: p.workload,
        delta: __delta_(p.logged, prevLogged),
        modules: {},
      };
    }).filter(Boolean).sort(function(a,b){ return b.utilization - a.utilization; });
  })();`;

if (!OLD_OWNERS_BUILD.test(dash)) {
  console.error('✗ owners build anchor not found in renderReports_utilization_');
  process.exit(1);
}
// We need to also remove the OLD aggregate building (tasks, prevTasks, byOwner) which is now in __utilizationStats_
// Replace from "var tasks = __tasksInRange_();" down to the .sort() line
const OLD_FULL_AGGREGATE = /  \/\/ Aggregate by owner\n  var tasks = __tasksInRange_\(\);[\s\S]*?\.sort\(function\(a,b\)\{ return b\.utilization - a\.utilization; \}\);/;
const NEW_FULL_AGGREGATE = `  // V61: Owners come from Work Hours Tracker data (via __utilizationStats_)\n  ` + NEW_OWNERS_BUILD;

if (!OLD_FULL_AGGREGATE.test(dash)) {
  console.error('✗ full aggregate block not found');
  process.exit(1);
}
dash = dash.replace(OLD_FULL_AGGREGATE, NEW_FULL_AGGREGATE);
console.log('✓ renderReports_utilization_ owners list now sourced from work-hours data');

// ─── 8. Update Team Utilization header subtitle ─────────────────────────────
const OLD_TEAM_HDR_SUB = `'Owner column in Task_Master × Directory roster · hours = tasks × 1.5h estimate'`;
const NEW_TEAM_HDR_SUB = `'Real logged hours from Work Hours Utilisation Tracker · synced from Drive · capacity = 40h/week'`;
if (dash.includes(OLD_TEAM_HDR_SUB)) {
  dash = dash.replace(OLD_TEAM_HDR_SUB, NEW_TEAM_HDR_SUB);
  console.log('✓ Team Utilization header subtitle updated');
}

// ─── Push & promote ──────────────────────────────────────────────────────────
proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Content pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V61: utilization uses Work Hours Tracker, Task_Master source removed ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);

const dep = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: {
    scriptId: SCRIPT_ID,
    versionNumber: v.versionNumber,
    manifestFileName: 'appsscript',
    description: 'V61: work hours utilization',
  },
});
console.log(`✓ Deployed V${dep.deploymentConfig.versionNumber}`);
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('NEXT STEPS:');
console.log('1. Open editor → Run aaa_authorize (it now probes the work-hours folder too)');
console.log('   https://script.google.com/d/' + SCRIPT_ID + '/edit');
console.log('2. Reload dashboard → click ↻ Sync from Drive');
console.log('   (now syncs BOTH weekly reports AND work-hours trackers — ~3 min total)');
console.log('3. Open Utilization tab → see real logged hours per person');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
