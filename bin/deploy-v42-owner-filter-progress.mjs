#!/usr/bin/env node
/**
 * V42: Owner/team-member filter dropdown + progress % label in task rows
 *
 * 1. Add <select id="task-owner"> to filter bar (after Priority, before Create Task)
 * 2. Add populateOwnerFilter_() that builds options from S.tasks unique Owner values
 * 3. Call populateOwnerFilter_() inside loadAllTasks callback in renderTasks()
 * 4. Wire matchOw into filterTasks() — add const ow + matchOw in filter predicate
 * 5. Show ${prog}% text label alongside the progress bar in each task row
 * 6. Badge V41 → V42
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

// ── FIX 1: Insert owner <select> in filter bar (before Create Task button) ────
const OLD_CREATE_BTN = `      <button class="btn btn-primary" onclick="showTaskModal()">＋ Create Task</button>`;
const NEW_CREATE_BTN = `      <select id="task-owner" onchange="filterTasks()" style="padding:4px 8px;border:1px solid var(--border);border-radius:6px;background:var(--card2);color:inherit;font-size:13px">
        <option value="">All members</option>
      </select>
      <button class="btn btn-primary" onclick="showTaskModal()">＋ Create Task</button>`;

if (dash.includes(OLD_CREATE_BTN)) {
  dash = dash.replace(OLD_CREATE_BTN, NEW_CREATE_BTN);
  console.log('✓ Owner filter <select> added to filter bar');
} else {
  console.error('WARN: Create Task button anchor not matched — skipping owner select insert');
}

// ── FIX 2: Add populateOwnerFilter_() call in renderTasks() loadAllTasks cb ──
const OLD_LOAD_CB = `  loadAllTasks(tasks => {
    S.tasks = tasks;
    filterTasks();
  });
}`;
const NEW_LOAD_CB = `  loadAllTasks(tasks => {
    S.tasks = tasks;
    populateOwnerFilter_();
    filterTasks();
  });
}`;

if (dash.includes(OLD_LOAD_CB)) {
  dash = dash.replace(OLD_LOAD_CB, NEW_LOAD_CB);
  console.log('✓ populateOwnerFilter_() wired into renderTasks() loadAllTasks callback');
} else {
  console.error('WARN: loadAllTasks callback in renderTasks not matched');
}

// ── FIX 3: Add populateOwnerFilter_() function before filterTasks() ──────────
// Anchor: the filterTasks() call inside toggleAssignedSort_, then function filterTasks
const OLD_BEFORE_FILTER = `  filterTasks();
}

function filterTasks() {`;
const NEW_BEFORE_FILTER = `  filterTasks();
}

function populateOwnerFilter_() {
  var sel = document.getElementById('task-owner');
  if (!sel || !S.tasks) return;
  var cur = sel.value;
  var owners = S.tasks.map(function(t){return t.Owner||'';})
    .filter(function(v,i,a){return v && a.indexOf(v) === i;})
    .sort();
  sel.innerHTML = '<option value="">All members</option>' +
    owners.map(function(o){return '<option value="' + o + '">' + o + '</option>';}).join('');
  if (cur && owners.indexOf(cur) >= 0) sel.value = cur;
}

function filterTasks() {`;

if (dash.includes(OLD_BEFORE_FILTER)) {
  dash = dash.replace(OLD_BEFORE_FILTER, NEW_BEFORE_FILTER);
  console.log('✓ populateOwnerFilter_() function added before filterTasks()');
} else {
  console.error('WARN: toggleAssignedSort_→filterTasks anchor not matched');
}

// ── FIX 4a: Add const ow after const pr in filterTasks() ──────────────────────
const OLD_CONST_PR = `  const pr = (document.getElementById('task-priority')||{}).value || '';
  const filtered = S.tasks.filter(t => {`;
const NEW_CONST_PR = `  const pr = (document.getElementById('task-priority')||{}).value || '';
  const ow = (document.getElementById('task-owner')||{}).value || '';
  const filtered = S.tasks.filter(t => {`;

if (dash.includes(OLD_CONST_PR)) {
  dash = dash.replace(OLD_CONST_PR, NEW_CONST_PR);
  console.log('✓ const ow added to filterTasks()');
} else {
  console.error('WARN: const pr anchor in filterTasks not matched');
}

// ── FIX 4b: Add matchOw into filter predicate ─────────────────────────────────
const OLD_MATCH_PR = `    const matchPr = !pr || (t.Priority||'').toLowerCase() === pr.toLowerCase();
    return matchQ && matchSt && matchPr;`;
const NEW_MATCH_PR = `    const matchPr = !pr || (t.Priority||'').toLowerCase() === pr.toLowerCase();
    const matchOw = !ow || (t.Owner||'').toLowerCase() === ow.toLowerCase();
    return matchQ && matchSt && matchPr && matchOw;`;

if (dash.includes(OLD_MATCH_PR)) {
  dash = dash.replace(OLD_MATCH_PR, NEW_MATCH_PR);
  console.log('✓ matchOw added to filterTasks() predicate');
} else {
  console.error('WARN: matchPr + return line in filterTasks not matched');
}

// ── FIX 5: Add ${prog}% text label alongside progress bar in task rows ────────
const OLD_PROG_TD = `<td><div class="progress-bar"><div class="progress-fill" style="width:\${prog}%;background:\${prog>=100?'var(--green)':prog>50?'var(--accent)':'var(--amber)'}"></div></div></td>`;
const NEW_PROG_TD = `<td style="white-space:nowrap"><div style="display:flex;align-items:center;gap:5px"><div class="progress-bar"><div class="progress-fill" style="width:\${prog}%;background:\${prog>=100?'var(--green)':prog>50?'var(--accent)':'var(--amber)'}"></div></div><span style="font-size:11px;color:var(--muted)">\${prog}%</span></div></td>`;

if (dash.includes(OLD_PROG_TD)) {
  dash = dash.replace(OLD_PROG_TD, NEW_PROG_TD);
  console.log('✓ Progress TD: ${prog}% text label added');
} else {
  console.error('WARN: progress <td> pattern not matched');
}

// ── FIX 6: Badge V41 → V42 ───────────────────────────────────────────────────
const OLD_BADGE = `>V41 ✓</span>`;
const NEW_BADGE = `>V42 ✓</span>`;
if (dash.includes(OLD_BADGE)) {
  dash = dash.replace(OLD_BADGE, NEW_BADGE);
  console.log('✓ Badge → V42');
} else {
  console.error('WARN: V41 badge not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V42: owner filter + progress % label — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Deploy V' + v.versionNumber + ' → Manage deployments → pick Version ' + v.versionNumber);
