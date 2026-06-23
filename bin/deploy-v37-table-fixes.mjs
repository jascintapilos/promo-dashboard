#!/usr/bin/env node
/**
 * V37: Three task table fixes
 * 1. Move "Assigned" column from after Owner → immediately after ID
 * 2. Add visible styled horizontal scroll slider on the task table
 * 3. Refresh button in Task Orchestration now syncs Slack first, then reloads
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

// ── FIX 1: Move Assigned header from after Owner → after ID ─────────────────
const OLD_HEADER = `<th>ID</th><th>Title</th>\${mini?'':'<th>Module</th>'}<th>Brand</th><th>Owner</th>
      <th>Assigned</th><th>Due</th><th>Priority</th><th>Status</th><th>Progress</th>\${mini?'':'<th>Actions</th>'}`;
const NEW_HEADER = `<th>ID</th><th>Assigned</th><th>Title</th>\${mini?'':'<th>Module</th>'}<th>Brand</th><th>Owner</th>
      <th>Due</th><th>Priority</th><th>Status</th><th>Progress</th>\${mini?'':'<th>Actions</th>'}`;

if (dash.includes(OLD_HEADER)) {
  dash = dash.replace(OLD_HEADER, NEW_HEADER);
  console.log('✓ Header: Assigned moved after ID');
} else {
  console.error('WARN: header pattern not matched');
}

// ── FIX 2: Move Assigned cell in row from after Owner → after ID cell ────────
const OLD_ROW_CELLS = `    <td style="color:var(--muted);font-family:monospace;font-size:11px">\${esc(String(id).slice(-8))}</td>
    <td style="font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${title}</td>
    \${mini?'':\'<td style="color:var(--muted)">\${esc(t.Module||\'—\')}</td>\'}
    <td>\${brand}</td>
    <td>\${owner}</td>
    <td style="color:var(--muted);white-space:nowrap;font-size:11px">\${fmtDate(t.Submitted_At || t.Posted_At)}</td>`;

const NEW_ROW_CELLS = `    <td style="color:var(--muted);font-family:monospace;font-size:11px">\${esc(String(id).slice(-8))}</td>
    <td style="color:var(--muted);white-space:nowrap;font-size:11px">\${fmtDate(t.Submitted_At || t.Posted_At)}</td>
    <td style="font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${title}</td>
    \${mini?'':\'<td style="color:var(--muted)">\${esc(t.Module||\'—\')}</td>\'}
    <td>\${brand}</td>
    <td>\${owner}</td>`;

if (dash.includes(OLD_ROW_CELLS)) {
  dash = dash.replace(OLD_ROW_CELLS, NEW_ROW_CELLS);
  console.log('✓ Row: Assigned cell moved after ID cell');
} else {
  console.error('WARN: row cell pattern not matched — trying simpler pattern');
  // Simpler approach: just move the assigned cell
  const SIMPLER_OLD = `    <td>\${owner}</td>
    <td style="color:var(--muted);white-space:nowrap;font-size:11px">\${fmtDate(t.Submitted_At || t.Posted_At)}</td>
    <td style="color:var(--muted);white-space:nowrap">\${due}</td>`;
  const ID_CELL = `    <td style="color:var(--muted);font-family:monospace;font-size:11px">\${esc(String(id).slice(-8))}</td>`;
  
  if (dash.includes(SIMPLER_OLD) && dash.includes(ID_CELL)) {
    // Remove assigned from after owner
    dash = dash.replace(SIMPLER_OLD,
      `    <td>\${owner}</td>\n    <td style="color:var(--muted);white-space:nowrap">\${due}</td>`);
    // Add after ID cell
    dash = dash.replace(ID_CELL,
      ID_CELL + '\n    <td style="color:var(--muted);white-space:nowrap;font-size:11px">${fmtDate(t.Submitted_At || t.Posted_At)}</td>');
    console.log('✓ Row: Assigned moved via simpler pattern');
  } else {
    console.error('WARN: simpler pattern also not matched — skipping row move');
  }
}

// ── FIX 3: Add styled scrollbar CSS ─────────────────────────────────────────
const OLD_TBL_WRAP = `.tbl-wrap{overflow-x:auto}`;
const NEW_TBL_WRAP = `.tbl-wrap{overflow-x:auto;padding-bottom:6px}
.tbl-wrap::-webkit-scrollbar{height:6px}
.tbl-wrap::-webkit-scrollbar-track{background:var(--card2);border-radius:3px}
.tbl-wrap::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.tbl-wrap::-webkit-scrollbar-thumb:hover{background:var(--accent)}`;

if (dash.includes(OLD_TBL_WRAP)) {
  dash = dash.replace(OLD_TBL_WRAP, NEW_TBL_WRAP);
  console.log('✓ Scrollbar CSS added');
} else {
  console.error('WARN: .tbl-wrap CSS not found');
}

// Also ensure task table has min-width so horizontal scroll always works
const OLD_TABLE_CSS = `table{width:100%;border-collapse:collapse}`;
const NEW_TABLE_CSS = `table{width:100%;border-collapse:collapse;min-width:900px}`;
if (dash.includes(OLD_TABLE_CSS)) {
  dash = dash.replace(OLD_TABLE_CSS, NEW_TABLE_CSS);
  console.log('✓ Table min-width:900px set (ensures scroll triggers)');
} else {
  console.error('WARN: table CSS not found');
}

// ── FIX 4: Refresh in Task Orchestration syncs Slack first ──────────────────
const OLD_REFRESH = `<button class="btn btn-ghost" onclick="loadAllTasks(t=>{S.tasks=t;renderTasks()})">⟳ Refresh</button>`;
const NEW_REFRESH = `<button class="btn btn-ghost" onclick="this.disabled=true;this.textContent='Syncing…';google.script.run.withSuccessHandler(()=>{loadAllTasks(t=>{S.tasks=t;renderTasks()})}).withFailureHandler(()=>{loadAllTasks(t=>{S.tasks=t;renderTasks()})}).serverSyncSlackTasks()">⟳ Refresh</button>`;

if (dash.includes(OLD_REFRESH)) {
  dash = dash.replace(OLD_REFRESH, NEW_REFRESH);
  console.log('✓ Refresh button now syncs Slack first');
} else {
  console.error('WARN: Refresh button pattern not found');
}

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V37: Assigned col after ID + scroll slider + Refresh syncs Slack — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('');
console.log('Now: Manage deployments → pick Version ' + v.versionNumber + ' → Deploy');
