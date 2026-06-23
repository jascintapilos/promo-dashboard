#!/usr/bin/env node
/**
 * V40: Fix "today's tasks not showing at top" + clickable Assigned sort
 *
 * Root cause of today-tasks-buried bug:
 *   sortTasksForDisplay groups by score (0=today, 1=overdue, 2=future).
 *   Within score-0, it sorted by Due_Date ASC first — so older tasks whose
 *   Due_Date happens to be today ranked above newly-assigned tasks (also score-0
 *   but due later).
 *
 * Fix 1: swap within-group sort: Submitted_At DESC first, then Due_Date ASC as
 *   tiebreak. Today-assigned tasks now float to the very top.
 *
 * Fix 2: clickable Assigned column header with ▼/▲ toggle:
 *   - default ▼ = newest assigned first (uses sortTasksForDisplay)
 *   - click → ▲ = oldest assigned first (pure Submitted_At ASC sort)
 *   - click again → ▼ (back to default)
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SCRIPT_ID = '1G8PrjOQ45yafM4lo3dL1AG8HKFSZ8tSlX7ei9EPZgw6bacjHk5CPtTW_';
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

// ── FIX 1: swap within-group sort in sortTasksForDisplay ─────────────────────
// Old: sorts by Due_Date ASC first, then Submitted_At DESC
// New: sorts by Submitted_At DESC first (today's new tasks float up), then Due_Date ASC tiebreak
const OLD_SORT_BODY = `  return tasks.slice().sort(function(a,b){
    var sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    var da = dateMs(a.Due_Date), db = dateMs(b.Due_Date);
    if (da !== null && db !== null && da !== db) return da - db; // earliest due first
    if (da !== null && db === null) return -1;
    if (db !== null && da === null) return 1;
    var sba = dateMs(a.Submitted_At || a.Posted_At), sbb = dateMs(b.Submitted_At || b.Posted_At);
    return (sbb || 0) - (sba || 0); // newest submitted first
  });`;

const NEW_SORT_BODY = `  return tasks.slice().sort(function(a,b){
    var sa = score(a), sb = score(b);
    if (sa !== sb) return sa - sb;
    // Within group: newest assigned first — today's tasks float to top
    var sba = dateMs(a.Submitted_At || a.Posted_At), sbb = dateMs(b.Submitted_At || b.Posted_At);
    if (sba !== sbb) return (sbb||0) - (sba||0);
    // Tiebreak: earliest due first
    var da = dateMs(a.Due_Date), db = dateMs(b.Due_Date);
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (db !== null && da === null) return 1;
    return 0;
  });`;

if (dash.includes(OLD_SORT_BODY)) {
  dash = dash.replace(OLD_SORT_BODY, NEW_SORT_BODY);
  console.log('✓ sortTasksForDisplay: newest-assigned-first within group');
} else {
  console.error('WARN: sortTasksForDisplay sort body not matched');
}

// ── FIX 2a: add _assignedSortDir var + toggleAssignedSort_ before filterTasks ─
const OLD_FILTER_ANCHOR = `\nfunction filterTasks() {`;
const NEW_FILTER_ANCHOR = `
var _assignedSortDir = 'desc';
function toggleAssignedSort_() {
  _assignedSortDir = _assignedSortDir === 'desc' ? 'asc' : 'desc';
  var icon = document.getElementById('assigned-sort-icon');
  if (icon) icon.textContent = _assignedSortDir === 'desc' ? '▼' : '▲';
  filterTasks();
}

function filterTasks() {`;

if (dash.includes(OLD_FILTER_ANCHOR)) {
  dash = dash.replace(OLD_FILTER_ANCHOR, NEW_FILTER_ANCHOR);
  console.log('✓ toggleAssignedSort_ + _assignedSortDir added before filterTasks');
} else {
  console.error('WARN: filterTasks anchor not matched');
}

// ── FIX 2b: update filterTasks to honour _assignedSortDir ────────────────────
const OLD_FILTER_RENDER = `  const wrap = document.getElementById('task-table-wrap');
  if (wrap) { wrap.innerHTML = taskTable(sortTasksForDisplay(filtered), false); setTimeout(syncScrollSlider_, 0); }
}`;

const NEW_FILTER_RENDER = `  var sorted = sortTasksForDisplay(filtered);
  if (_assignedSortDir === 'asc') {
    sorted = filtered.slice().sort(function(a,b){
      function dms(v){if(!v)return 0;var d=new Date(String(v).slice(0,10)+'T00:00:00');return isNaN(d)?0:d.getTime();}
      return dms(a.Submitted_At||a.Posted_At) - dms(b.Submitted_At||b.Posted_At);
    });
  }
  const wrap = document.getElementById('task-table-wrap');
  if (wrap) { wrap.innerHTML = taskTable(sorted, false); setTimeout(syncScrollSlider_, 0); }
}`;

if (dash.includes(OLD_FILTER_RENDER)) {
  dash = dash.replace(OLD_FILTER_RENDER, NEW_FILTER_RENDER);
  console.log('✓ filterTasks: respects _assignedSortDir asc/desc');
} else {
  console.error('WARN: filterTasks render line not matched');
}

// ── FIX 2c: make Assigned <th> clickable with sort icon ──────────────────────
const OLD_ASSIGNED_TH = `<th>ID</th><th>Assigned</th><th>Title</th>`;
const NEW_ASSIGNED_TH = `<th>ID</th><th onclick="toggleAssignedSort_()" style="cursor:pointer;user-select:none;white-space:nowrap">Assigned <span id="assigned-sort-icon">▼</span></th><th>Title</th>`;

if (dash.includes(OLD_ASSIGNED_TH)) {
  dash = dash.replace(OLD_ASSIGNED_TH, NEW_ASSIGNED_TH);
  console.log('✓ Assigned <th> now clickable with ▼/▲ sort icon');
} else {
  console.error('WARN: Assigned th pattern not matched');
}

// ── FIX 3: Badge V39 → V40 ───────────────────────────────────────────────────
const OLD_BADGE = `>V39 ✓</span>`;
const NEW_BADGE = `>V40 ✓</span>`;
if (dash.includes(OLD_BADGE)) {
  dash = dash.replace(OLD_BADGE, NEW_BADGE);
  console.log('✓ Badge → V40');
} else {
  console.error('WARN: V39 badge not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V40: today-tasks sort fix + clickable Assigned sort ▼▲ — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
