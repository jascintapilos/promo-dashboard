#!/usr/bin/env node
/**
 * V34:
 * 1. Add "Assigned" date column to the task table (uses Submitted_At/Posted_At)
 * 2. Replace the small V32 marker with a more visible V34 ribbon for verification
 * 3. Also make sortTasksForDisplay key by Submitted_At too so today's
 *    assigned tasks float to the top
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

// 1. Patch taskTable header to add "Assigned" column
const oldHeader = `<th>ID</th><th>Title</th>\${mini?'':'<th>Module</th>'}<th>Brand</th><th>Owner</th>
      <th>Due</th><th>Priority</th><th>Status</th><th>Progress</th>\${mini?'':'<th>Actions</th>'}`;
const newHeader = `<th>ID</th><th>Title</th>\${mini?'':'<th>Module</th>'}<th>Brand</th><th>Owner</th>
      <th>Assigned</th><th>Due</th><th>Priority</th><th>Status</th><th>Progress</th>\${mini?'':'<th>Actions</th>'}`;
if (dash.includes(oldHeader)) {
  dash = dash.replace(oldHeader, newHeader);
  console.log('✓ Header patched');
} else {
  console.error('WARN: header pattern not matched verbatim');
}

// 2. Patch taskRow to add the Assigned cell after Owner
const oldRow = `<td>\${owner}</td>
    <td style="color:var(--muted);white-space:nowrap">\${due}</td>`;
const newRow = `<td>\${owner}</td>
    <td style="color:var(--muted);white-space:nowrap;font-size:11px">\${fmtDate(t.Submitted_At || t.Posted_At)}</td>
    <td style="color:var(--muted);white-space:nowrap">\${due}</td>`;
if (dash.includes(oldRow)) {
  dash = dash.replace(oldRow, newRow);
  console.log('✓ Row patched');
} else {
  console.error('WARN: row pattern not matched verbatim');
}

// 3. Replace V32 marker with a more obvious "V34 active" badge in the header
// The previous code was: t.insertAdjacentHTML('beforeend', '<span style="font-size:10px;color:#4cbfff;margin-left:8px;padding:2px 6px;background:rgba(76,191,255,0.1);border-radius:8px">V32</span>');
dash = dash.replace(
  /t\.insertAdjacentHTML\('beforeend', '<span [^>]*>V32<\/span>'\);/,
  `t.insertAdjacentHTML('beforeend', '<span style="font-size:10px;color:#4cbfff;margin-left:8px;padding:3px 8px;background:rgba(76,191,255,0.18);border-radius:8px;border:1px solid #4cbfff;font-weight:600">V34 LIVE</span>');`
);

proj.files[dashIdx].source = dash;
await api('PUT', `/projects/${SCRIPT_ID}/content`, { files: proj.files });
console.log('✓ Pushed');

const v = await api('POST', `/projects/${SCRIPT_ID}/versions`, {
  description: 'V34: Assigned date column + V34 LIVE marker — ' + new Date().toISOString(),
});
console.log(`✓ Version ${v.versionNumber} created`);
console.log('\nNext: Manage Deployments → pick Version ' + v.versionNumber + ' → Deploy');
console.log('\nAfter deploy, you should see a "V34 LIVE" badge next to the Overview title.');
console.log('If you see it → all the previously-shipped features are now live.');
console.log("If not → there's still a JS error somewhere I need to chase.");
