#!/usr/bin/env node
/**
 * Add Assigned-date column + sortable headers to Tasks page.
 * Also fix Slack sync to use the original message ts as Assigned_At.
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

// ───────── Code.gs: set Assigned_At from Slack ts in serverSyncSlackTasks ──
// Slack ts is in the Source field as 'slack:<ts>:...'. Parse and store as date.
const oldSyncBlock = `        tasks.forEach(function(t){
          if (existingSources[t.Source]) return;
          var now = new Date().toISOString();
          var id = 'T-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          var row = headers.map(function(h){
            if (h === 'Task_ID') return id;
            if (h === 'Created_At' || h === 'Updated_At') return now;
            return t[h] !== undefined ? t[h] : '';
          });
          sheet.appendRow(row);`;
const newSyncBlock = `        tasks.forEach(function(t){
          if (existingSources[t.Source]) return;
          var now = new Date().toISOString();
          // Parse Slack message ts → real Date for Assigned_At
          var slackTs = (t.Source || '').match(/^slack:([\\d.]+)/);
          var assignedAt = slackTs ? new Date(parseFloat(slackTs[1]) * 1000).toISOString() : now;
          var id = 'T-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          var row = headers.map(function(h){
            if (h === 'Task_ID') return id;
            if (h === 'Created_At' || h === 'Updated_At') return now;
            if (h === 'Assigned_At') return assignedAt;
            return t[h] !== undefined ? t[h] : '';
          });
          sheet.appendRow(row);`;
if (code.includes(oldSyncBlock)) {
  code = code.replace(oldSyncBlock, newSyncBlock);
  console.log('✓ Code.gs: Slack sync now sets Assigned_At from message ts');
}

// Ensure Assigned_At column exists in Task_Master at sync time
const oldHeaderCheck = `    if (headers.indexOf('Source') < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Source');
      headers.push('Source');
    }`;
const newHeaderCheck = `    if (headers.indexOf('Source') < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Source');
      headers.push('Source');
    }
    if (headers.indexOf('Assigned_At') < 0) {
      sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Assigned_At');
      headers.push('Assigned_At');
    }`;
if (code.includes(oldHeaderCheck)) {
  code = code.replace(oldHeaderCheck, newHeaderCheck);
  console.log('✓ Code.gs: ensures Assigned_At column exists');
}

// Also set Assigned_At in serverCreateTask (manual New Task)
const oldCreateTask = `    var row = headers.map(function(h){
      if (h === 'Task_ID') return id;
      if (h === 'Created_At' || h === 'Updated_At') return now;
      if (h === 'Status' && !task[h]) return 'New';
      return task[h] !== undefined ? task[h] : '';
    });
    sheet.appendRow(row);
    return { success:true, id:id };`;
const newCreateTask = `    var row = headers.map(function(h){
      if (h === 'Task_ID') return id;
      if (h === 'Created_At' || h === 'Updated_At' || h === 'Assigned_At') return now;
      if (h === 'Status' && !task[h]) return 'New';
      return task[h] !== undefined ? task[h] : '';
    });
    sheet.appendRow(row);
    return { success:true, id:id };`;
if (code.includes(oldCreateTask)) {
  code = code.replace(oldCreateTask, newCreateTask);
  console.log('✓ Code.gs: serverCreateTask sets Assigned_At');
}

// ───────── Dashboard.html: add Assigned column + sort ──────────────────────
const oldRenderTasksData = `function renderTasksData(tasks) {
  if (!tasks.length) { content('<div class="empty">📭 No tasks in Task_Master sheet</div>'); return; }
  var html = '<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><div style="display:flex;align-items:center;gap:10px"><button class="hdr-btn" onclick="syncSlack()" style="background:#4a154b;font-size:11px;padding:6px 12px">🔄 Sync from Slack</button><span class="hint">From Task_Master sheet</span></div></div><div style="overflow-x:auto"><table><thead><tr><th>ID</th><th>Title</th><th>Module</th><th>Brand</th><th>Owner</th><th>Due</th><th>Priority</th><th>Status</th></tr></thead><tbody>';
  tasks.forEach(function(t){
    var status = (t.Status || 'New').replace('_', ' ');
    var statusClass = /complete|done/i.test(status) ? 'green' : /progress/i.test(status) ? 'amber' : /risk/i.test(status) ? 'red' : /approv|pending/i.test(status) ? 'purple' : 'blue';
    var priClass = /urgent/i.test(t.Priority) ? 'red' : /high/i.test(t.Priority) ? 'amber' : 'muted';
    html += '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID || '').slice(-8)) + '</td>' +
      '<td style="font-weight:500;max-width:260px">' + esc(t.Title || '—') + '</td>' +
      '<td>' + esc(t.Module || '—') + '</td>' +
      '<td>' + esc(t.Brand || '—') + '</td>' +
      '<td>' + esc(t.Owner || '—') + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap">' + esc(String(t.Due_Date || '').slice(0,10)) + '</td>' +
      '<td><span class="badge ' + priClass + '">' + esc(t.Priority || 'Normal') + '</span></td>' +
      '<td><span class="badge ' + statusClass + '">' + esc(status) + '</span></td>' +
      '</tr>';
  });
  html += '</tbody></table></div></div>';
  content(html);
}`;

const newRenderTasksData = `var __taskSort = { col: 'Assigned_At', dir: 'desc' };
function renderTasksData(tasks) {
  if (!tasks.length) { content('<div class="empty">📭 No tasks in Task_Master sheet</div>'); return; }
  // Sort by current sort column + direction
  var sorted = tasks.slice().sort(function(a,b){
    var av = String(a[__taskSort.col] || ''), bv = String(b[__taskSort.col] || '');
    if (av === bv) return 0;
    return (__taskSort.dir === 'asc' ? 1 : -1) * (av < bv ? -1 : 1);
  });
  function hdr(col, label){
    var arrow = __taskSort.col === col ? (__taskSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    return '<th onclick="sortTasks(\\'' + col + '\\')" style="cursor:pointer;user-select:none">' + label + arrow + '</th>';
  }
  var html = '<div class="card"><div class="card-hdr"><h3>All Tasks (' + tasks.length + ')</h3><div style="display:flex;align-items:center;gap:10px"><button class="hdr-btn" onclick="syncSlack()" style="background:#4a154b;font-size:11px;padding:6px 12px">🔄 Sync from Slack</button><span class="hint">Click column to sort</span></div></div><div style="overflow-x:auto"><table><thead><tr>' +
    hdr('Task_ID','ID') +
    hdr('Assigned_At','Assigned') +
    hdr('Title','Title') +
    hdr('Module','Module') +
    hdr('Brand','Brand') +
    hdr('Owner','Owner') +
    hdr('Due_Date','Due') +
    hdr('Priority','Priority') +
    hdr('Status','Status') +
    '</tr></thead><tbody>';
  sorted.forEach(function(t){
    var status = (t.Status || 'New').replace('_', ' ');
    var statusClass = /complete|done/i.test(status) ? 'green' : /progress/i.test(status) ? 'amber' : /risk/i.test(status) ? 'red' : /approv|pending/i.test(status) ? 'purple' : 'blue';
    var priClass = /urgent/i.test(t.Priority) ? 'red' : /high/i.test(t.Priority) ? 'amber' : 'muted';
    var assigned = String(t.Assigned_At || t.Created_At || '').slice(0,10);
    html += '<tr>' +
      '<td style="font-family:monospace;font-size:10px;color:var(--muted)">' + esc(String(t.Task_ID || '').slice(-8)) + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap;font-size:11px">' + esc(assigned) + '</td>' +
      '<td style="font-weight:500;max-width:260px">' + esc(t.Title || '—') + '</td>' +
      '<td>' + esc(t.Module || '—') + '</td>' +
      '<td>' + esc(t.Brand || '—') + '</td>' +
      '<td>' + esc(t.Owner || '—') + '</td>' +
      '<td style="color:var(--muted);white-space:nowrap">' + esc(String(t.Due_Date || '').slice(0,10)) + '</td>' +
      '<td><span class="badge ' + priClass + '">' + esc(t.Priority || 'Normal') + '</span></td>' +
      '<td><span class="badge ' + statusClass + '">' + esc(status) + '</span></td>' +
      '</tr>';
  });
  html += '</tbody></table></div></div>';
  content(html);
}

function sortTasks(col) {
  if (__taskSort.col === col) {
    __taskSort.dir = __taskSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    __taskSort.col = col;
    __taskSort.dir = col === 'Assigned_At' || col === 'Due_Date' ? 'desc' : 'asc';
  }
  renderTasksData(S.tasks);
}`;

if (dash.includes(oldRenderTasksData)) {
  dash = dash.replace(oldRenderTasksData, newRenderTasksData);
  console.log('✓ Dashboard: Tasks page now has Assigned column + sortable headers');
}

proj.files[codeIdx].source = code;
proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V33 + Assigned col + sort ' + new Date().toISOString(),
});
const promo = await api('PUT', `/projects/${SCRIPT_ID}/deployments/${DEPLOYMENT_ID}`, {
  deploymentConfig: { scriptId: SCRIPT_ID, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Assigned + sort' },
});
console.log('✓ Promoted V' + promo.deploymentConfig.versionNumber);
