#!/usr/bin/env node
/**
 * Seed the Users sheet in PromoOps_Control_Layer with known team members,
 * so the V60 allow-list doesn't lock anyone out.
 *
 * Edit the USERS array to add/remove people before running.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const SS_ID = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

// ── Edit this list before running ────────────────────────────────────────────
// Pulled from Directory sheet → "Team Contact Details" tab (2026-05-21).
// Refer to Directory for the canonical roster; refresh this array when team
// changes happen, then re-run: node bin/seed-users-sheet.mjs
const USERS = [
  // Admins — full access (everything in sidebar)
  { email: 'jascinta.pilos@thebrandingpeople.co', role: 'admin',  name: 'Jascinta Pilos' },
  { email: 'waiyip@thebrandingpeople.co',         role: 'admin',  name: 'Kan Wai Yip' },

  // Members — MAIN section only
  { email: 'bangun.priambodo@alphaiotabpo.com',   role: 'member', name: 'Bangun Priambodo' },
  { email: 'gabrielle.tiffany@alphaiotabpo.com',  role: 'member', name: 'Gabrielle Tiffany (Gaby)' },
  { email: 'booninn.wang@thebrandingpeople.co',   role: 'member', name: 'Wang Boon Inn (Wen)' },
  { email: 'menhua.foong@thebrandingpeople.co',   role: 'member', name: 'Foong Men Hua (Alysa)' },
  { email: 'elyssa.mae@thebrandingpeople.co',     role: 'member', name: 'Elyssa Mae Cataag' },
];

// ── Emails to REMOVE from the Users sheet (not in directory anymore) ────────
const REMOVE_EMAILS = [
  'mia@thebrandingpeople.co',
  'qa@thebrandingpeople.co',
  'leadership@thebrandingpeople.co',
  'jascintapilos@thebrandingpeople.co',  // duplicate alias of jascinta.pilos@
];

async function sheetsApi(path, method = 'GET', body) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SS_ID}${path}`, {
    method,
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Get current Users tab + rows
const meta = await sheetsApi('');
let usersTab = meta.sheets.find(s => s.properties.title === 'Users');

// Create if missing
if (!usersTab) {
  console.log('Users tab missing — creating…');
  const add = await sheetsApi(':batchUpdate', 'POST', {
    requests: [{ addSheet: { properties: { title: 'Users' } } }],
  });
  usersTab = { properties: add.replies[0].addSheet.properties };
  await sheetsApi(`/values/Users!A1:D1?valueInputOption=USER_ENTERED`, 'PUT', {
    values: [['Email', 'Role', 'Name', 'Added_At']],
  });
}

// Read existing rows
const cur = await sheetsApi('/values/Users!A2:D1000');
const existing = (cur.values || []).map(r => ({
  email: String(r[0] || '').toLowerCase().trim(),
  role:  String(r[1] || '').toLowerCase().trim(),
  name:  String(r[2] || '').trim(),
  row:   null,  // we'll fill row index below
}));
existing.forEach((u, i) => (u.row = i + 2));  // header at row 1, data starts row 2

console.log(`Current Users sheet has ${existing.length} entries:`);
existing.forEach(u => console.log(`  • ${u.email} → ${u.role || '(unset)'} ${u.name ? '(' + u.name + ')' : ''}`));

console.log('\nSeeding:');
const now = new Date().toISOString();
const valuesToUpdate = [];
const valuesToAppend = [];

for (const u of USERS) {
  const lowered = u.email.toLowerCase().trim();
  const cur = existing.find(e => e.email === lowered);
  if (cur) {
    // Update if role/name differs
    if (cur.role !== u.role.toLowerCase() || cur.name !== u.name) {
      valuesToUpdate.push({ row: cur.row, email: u.email, role: u.role, name: u.name });
      console.log(`  ✏ ${u.email} → role=${u.role}, name=${u.name}`);
    } else {
      console.log(`  ✓ ${u.email} already up to date`);
    }
  } else {
    valuesToAppend.push([u.email, u.role, u.name, now]);
    console.log(`  + ${u.email} (new) → role=${u.role}, name=${u.name}`);
  }
}

// Apply updates
for (const u of valuesToUpdate) {
  await sheetsApi(`/values/Users!A${u.row}:D${u.row}?valueInputOption=USER_ENTERED`, 'PUT', {
    values: [[u.email, u.role, u.name, now]],
  });
}

// Append new rows
if (valuesToAppend.length) {
  await sheetsApi(`/values/Users!A:D:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, 'POST', {
    values: valuesToAppend,
  });
}

console.log(`\n→ ${valuesToUpdate.length} updated, ${valuesToAppend.length} added.`);

// ── Remove de-listed rows ───────────────────────────────────────────────────
console.log('\nRemoving de-listed emails:');
const removed = [];
// Re-read sheet so we know the latest row positions (existing fetched before update)
const after = await sheetsApi('/values/Users!A2:D1000');
const afterRows = (after.values || []).map((r, i) => ({
  email: String(r[0] || '').toLowerCase().trim(),
  row: i + 2,
}));
const rowsToDelete = afterRows
  .filter(r => REMOVE_EMAILS.includes(r.email))
  .sort((a, b) => b.row - a.row);  // delete bottom-up so indices stay valid

if (rowsToDelete.length) {
  // Need the Users sheetId for deleteDimension
  const usersGid = usersTab.properties.sheetId;
  const requests = rowsToDelete.map(r => ({
    deleteDimension: {
      range: {
        sheetId: usersGid,
        dimension: 'ROWS',
        startIndex: r.row - 1,
        endIndex: r.row,
      },
    },
  }));
  await sheetsApi(':batchUpdate', 'POST', { requests });
  rowsToDelete.forEach(r => { console.log(`  − ${r.email} (row ${r.row})`); removed.push(r.email); });
} else {
  console.log('  (none of the de-listed emails are present)');
}

console.log(`\n✓ Seed complete — ${valuesToUpdate.length} updated, ${valuesToAppend.length} added, ${removed.length} removed.`);
console.log('Approved list now matches Directory → Team Contact Details.');
console.log('Anyone NOT in this sheet will hit the Access Denied screen after V60 promotes.');
