#!/usr/bin/env node
/** Add a Reports module with date-filterable weekly view. */
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
const dashIdx = proj.files.findIndex(f => f.name === 'Dashboard');
let dash = proj.files[dashIdx].source;

// ─── 1. Add "Reports" nav item under Manage section ────────────────────────
const navAnchor = `      <div class="nav-item" data-view="kb" data-section="manage" onclick="nav('kb')"><span class="nav-icon">📚</span>Knowledge Base</div>`;
const navWithReports = `      <div class="nav-item" data-view="kb" data-section="manage" onclick="nav('kb')"><span class="nav-icon">📚</span>Knowledge Base</div>
      <div class="nav-item" data-view="reports" data-section="manage" onclick="nav('reports')"><span class="nav-icon">📊</span>Reports</div>`;
if (dash.includes(navAnchor) && !dash.includes(`data-view="reports"`)) {
  dash = dash.replace(navAnchor, navWithReports);
  console.log('✓ Reports nav item added');
}

// ─── 2. Wire reports into nav() switch ────────────────────────────────────
const titlesAnchor = `kb:'Knowledge Base', settings:'Settings',`;
const titlesNew    = `kb:'Knowledge Base', reports:'Reports', settings:'Settings',`;
if (dash.includes(titlesAnchor)) {
  dash = dash.replace(titlesAnchor, titlesNew);
}
const subsAnchor = `kb:'SOPs &amp; reference docs', settings:'User &amp; preferences',`;
const subsNew    = `kb:'SOPs &amp; reference docs', reports:'Weekly + custom date range reports', settings:'User &amp; preferences',`;
if (dash.includes(subsAnchor)) {
  dash = dash.replace(subsAnchor, subsNew);
}
const rendererAnchor = `kb: renderKB, settings: renderSettings,`;
const rendererNew    = `kb: renderKB, reports: renderReports, settings: renderSettings,`;
if (dash.includes(rendererAnchor)) {
  dash = dash.replace(rendererAnchor, rendererNew);
  console.log('✓ Reports view wired into nav switch');
}

// ─── 3. Insert renderReports + helpers before renderSettings ───────────────
const reportsCode = `
// ============================================================================
// REPORTS — date-filterable weekly view
// ============================================================================
var __reportRange = (function(){
  // Default: this week (Mon → today)
  var today = new Date(); today.setHours(0,0,0,0);
  var day = today.getDay(); // 0 Sun .. 6 Sat
  var diff = day === 0 ? -6 : 1 - day; // Mon = 1
  var monday = new Date(today.getTime() + diff * 86400000);
  return { start: monday.toISOString().slice(0,10), end: today.toISOString().slice(0,10), preset: 'this_week' };
})();

function applyReportPreset(preset) {
  var today = new Date(); today.setHours(0,0,0,0);
  var day = today.getDay();
  var monday = new Date(today.getTime() + ((day === 0 ? -6 : 1 - day)) * 86400000);
  function fmt(d){ return d.toISOString().slice(0,10); }
  var ranges = {
    today:        { start: fmt(today), end: fmt(today) },
    last_7:       { start: fmt(new Date(today.getTime() - 6*86400000)), end: fmt(today) },
    this_week:    { start: fmt(monday), end: fmt(today) },
    last_week:    { start: fmt(new Date(monday.getTime() - 7*86400000)), end: fmt(new Date(monday.getTime() - 1*86400000)) },
    last_14:      { start: fmt(new Date(today.getTime() - 13*86400000)), end: fmt(today) },
    this_month:   { start: fmt(new Date(today.getFullYear(), today.getMonth(), 1)), end: fmt(today) },
    last_30:      { start: fmt(new Date(today.getTime() - 29*86400000)), end: fmt(today) },
    this_quarter: { start: fmt(new Date(today.getFullYear(), Math.floor(today.getMonth()/3)*3, 1)), end: fmt(today) },
  };
  if (ranges[preset]) {
    __reportRange = Object.assign(ranges[preset], { preset: preset });
    renderReports();
  }
}

function applyReportCustom() {
  var s = document.getElementById('rp-start').value;
  var e = document.getElementById('rp-end').value;
  if (!s || !e) { toast('Pick both dates'); return; }
  if (s > e) { toast('Start must be ≤ End'); return; }
  __reportRange = { start: s, end: e, preset: 'custom' };
  renderReports();
}

function renderReports() {
  loading();
  if (typeof google === 'undefined') { renderReportsData([]); return; }
  google.script.run
    .withSuccessHandler(function(t){ S.tasks = t || []; renderReportsData(S.tasks); })
    .withFailureHandler(function(){ renderReportsData(S.tasks || []); })
    .serverGetTasks();
}

function renderReportsData(tasks) {
  var r = __reportRange;
  function inRange(d) {
    if (!d) return false;
    var s = String(d).slice(0, 10);
    return s >= r.start && s <= r.end;
  }
  // Filter tasks by Submitted_At (assigned date) within the range
  var rangeTasks = tasks.filter(function(t){
    return inRange(String(t.Submitted_At || t.Assigned_At || '').slice(0,10));
  });
  var doneInRange = tasks.filter(function(t){
    var status = String(t.Status || '');
    return /complete|done/i.test(status) && inRange(String(t.Status_Updated_At || t.Submitted_At || '').slice(0,10));
  });
  var activeNow = tasks.filter(function(t){
    var status = String(t.Status || '');
    return !/complete|done/i.test(status);
  });
  var overdue = tasks.filter(function(t){
    var due = String(t.Due_Date || '').slice(0,10);
    var status = String(t.Status || '');
    if (!due || /complete|done/i.test(status)) return false;
    return due < new Date().toISOString().slice(0,10);
  });

  // Aggregations
  function groupCount(items, keyFn) {
    var m = {};
    items.forEach(function(t){ var k = keyFn(t) || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).sort(function(a,b){ return b[1] - a[1]; });
  }
  var byOwner = groupCount(rangeTasks, function(t){ return resolveOwnerNames_(t.Owner || ''); });
  var byModule = groupCount(rangeTasks, function(t){ return t.Module; });
  var byStatus = groupCount(rangeTasks, function(t){ return String(t.Status || 'New').replace(/_/g, ' '); });
  var byPriority = groupCount(rangeTasks, function(t){
    var p = String(t.Priority || '');
    return /p1|urgent/i.test(p) ? 'P1 · Urgent' : /p2|high/i.test(p) ? 'P2 · High' : /p3|normal/i.test(p) ? 'P3 · Normal' : p || 'Normal';
  });

  // Header with date controls
  function presetBtn(code, label) {
    var on = r.preset === code;
    return '<button class="chip' + (on ? ' on' : '') + '" onclick="applyReportPreset(\\'' + code + '\\')">' + label + '</button>';
  }

  var html = '<div class="card"><div class="card-hdr"><h3>📊 Range: ' + r.start + ' → ' + r.end + '</h3>' +
    '<button class="hdr-btn" onclick="exportReportCSV()" style="background:var(--blue);font-size:11px;padding:6px 12px">⬇ Export CSV</button>' +
    '</div><div class="card-body">' +
    '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
      presetBtn('today', 'Today') +
      presetBtn('last_7', 'Last 7 days') +
      presetBtn('this_week', 'This week') +
      presetBtn('last_week', 'Last week') +
      presetBtn('last_14', 'Last 14 days') +
      presetBtn('this_month', 'This month') +
      presetBtn('last_30', 'Last 30 days') +
      presetBtn('this_quarter', 'This quarter') +
    '</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<label style="font-size:11px;color:var(--muted)">Custom range:</label>' +
      '<input id="rp-start" type="date" value="' + r.start + '" style="width:160px">' +
      '<span style="color:var(--muted)">→</span>' +
      '<input id="rp-end" type="date" value="' + r.end + '" style="width:160px">' +
      '<button class="btn btn-primary" onclick="applyReportCustom()" style="padding:6px 14px">Apply</button>' +
    '</div></div></div>';

  // KPI strip for the range
  function kpiCard(cls, icon, val, label, sub) {
    return '<div class="kpi-card ' + cls + '"><div class="kpi-icon">' + icon + '</div><div class="kpi-value">' + val + '</div><div class="kpi-label">' + label + '</div>' + (sub ? '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + sub + '</div>' : '') + '</div>';
  }
  html += '<div class="kpi-grid">' +
    kpiCard('blue', '📥', rangeTasks.length, 'Assigned in range', 'New tasks received') +
    kpiCard('green', '✅', doneInRange.length, 'Completed in range', 'Status set to Done') +
    kpiCard('amber', '⚡', activeNow.length, 'Active now', 'Across all dates') +
    kpiCard('red', '⏰', overdue.length, 'Overdue now', 'Past due, not done') +
    '</div>';

  // Breakdown tables
  function breakdownCard(title, icon, data, total) {
    var rows = data.map(function(pair){
      var pct = total ? Math.round(pair[1] / total * 100) : 0;
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(48,54,61,.4)">' +
        '<div style="flex:1;font-size:12px">' + esc(pair[0]) + '</div>' +
        '<div style="width:100px;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:var(--accent)"></div></div>' +
        '<div style="width:70px;text-align:right;font-size:11px;color:var(--muted)">' + pair[1] + ' (' + pct + '%)</div>' +
      '</div>';
    }).join('');
    if (!data.length) rows = '<div class="empty" style="padding:14px">No data</div>';
    return '<div class="card"><div class="card-hdr"><h3>' + icon + ' ' + title + '</h3><span class="hint">' + total + ' total</span></div><div class="card-body" style="padding:10px 16px">' + rows + '</div></div>';
  }

  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:16px">' +
    breakdownCard('By Owner', '🧑', byOwner, rangeTasks.length) +
    breakdownCard('By Module', '🗂', byModule, rangeTasks.length) +
    breakdownCard('By Status', '📌', byStatus, rangeTasks.length) +
    breakdownCard('By Priority', '⚡', byPriority, rangeTasks.length) +
    '</div>';

  // Detail table
  html += '<div class="card" style="margin-top:16px"><div class="card-hdr"><h3>📋 Tasks in range (' + rangeTasks.length + ')</h3><span class="hint">Sorted by Assigned date</span></div><div style="overflow-x:auto"><table><thead><tr><th>Assigned</th><th>ID</th><th>Title</th><th>Owner</th><th>Module</th><th>Brand</th><th>Status</th></tr></thead><tbody>';
  if (!rangeTasks.length) {
    html += '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:18px">No tasks in this date range</td></tr>';
  } else {
    rangeTasks.slice().sort(function(a,b){ return String(b.Submitted_At||'').localeCompare(String(a.Submitted_At||'')); }).forEach(function(t){
      var status = String(t.Status || 'New').replace(/_/g, ' ');
      var statusClass = /complete|done/i.test(t.Status) ? 'green' : /progress/i.test(t.Status) ? 'amber' : /risk/i.test(t.Status) ? 'red' : /approv|pending|qc|ready/i.test(t.Status) ? 'purple' : 'blue';
      html += '<tr>' +
        '<td style="color:var(--muted);font-size:11px;white-space:nowrap">' + esc(String(t.Submitted_At || '').slice(0,10)) + '</td>' +
        '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID || '').slice(-8)) + '</td>' +
        '<td style="font-weight:500;max-width:280px">' + esc(t.Title || '—') + '</td>' +
        '<td>' + esc(resolveOwnerNames_(t.Owner || '')) + '</td>' +
        '<td>' + esc(t.Module || '—') + '</td>' +
        '<td>' + esc(t.Brand || '—') + '</td>' +
        '<td><span class="badge ' + statusClass + '">' + esc(status) + '</span></td>' +
        '</tr>';
    });
  }
  html += '</tbody></table></div></div>';
  // Stash rangeTasks for CSV export
  window.__reportRangeTasks = rangeTasks;
  content(html);
}

function exportReportCSV() {
  var tasks = window.__reportRangeTasks || [];
  if (!tasks.length) { toast('No data to export'); return; }
  var headers = ['Assigned','Task_ID','Title','Owner','Module','Brand','Priority','Status','Due_Date'];
  var rows = tasks.map(function(t){ return [
    String(t.Submitted_At || '').slice(0,10),
    t.Task_ID || '',
    t.Title || '',
    resolveOwnerNames_(t.Owner || ''),
    t.Module || '',
    t.Brand || '',
    t.Priority || '',
    String(t.Status || '').replace(/_/g, ' '),
    String(t.Due_Date || '').slice(0,10),
  ]; });
  var csv = [headers].concat(rows).map(function(r){
    return r.map(function(v){
      v = String(v == null ? '' : v);
      if (/[",\\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      return v;
    }).join(',');
  }).join('\\n');
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'promo-report-' + __reportRange.start + '-to-' + __reportRange.end + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 100);
  toast('✓ Exported ' + tasks.length + ' rows');
}

// ============================================================================
// SETTINGS
// ============================================================================
function renderSettings`;

const oldSettingsAnchor = `// ============================================================================
// SETTINGS
// ============================================================================
function renderSettings`;

if (dash.includes(oldSettingsAnchor) && !dash.includes('REPORTS — date-filterable weekly view')) {
  dash = dash.replace(oldSettingsAnchor, reportsCode);
  console.log('✓ Reports module added (renderReports + presets + CSV export)');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V37 + Reports module ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Reports module' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
