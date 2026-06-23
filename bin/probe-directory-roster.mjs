#!/usr/bin/env node
/**
 * Read the "Team roster" tab from the Directory sheet so we know who to seed
 * into the dashboard Users allow-list.
 */
import { getGoogleAuth } from '../src/google-auth.js';
const DIR_SS_ID = '1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68';
const { client } = await getGoogleAuth();
const tok = (await client.getAccessToken()).token;

async function sheetsApi(path) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${DIR_SS_ID}${path}`, {
    headers: { Authorization: 'Bearer ' + tok },
  });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

const meta = await sheetsApi('');
console.log('Directory tabs:');
meta.sheets.forEach(s => console.log('  • ' + s.properties.title + ' (gid=' + s.properties.sheetId + ')'));

// Find "Team roster" or similar
const candidate = meta.sheets.find(s => /team|roster|people|staff|member/i.test(s.properties.title));
if (!candidate) { console.log('\n⚠ No roster-like tab found.'); process.exit(0); }

console.log('\nUsing tab:', candidate.properties.title);
const data = await sheetsApi(`/values/${encodeURIComponent(candidate.properties.title)}!A1:Z200`);
const rows = data.values || [];
if (!rows.length) { console.log('Empty.'); process.exit(0); }

const headers = rows[0];
console.log('\nHeaders:', headers);

console.log('\nRows:');
rows.slice(1).forEach((r, i) => {
  const obj = {};
  headers.forEach((h, j) => { if (r[j] != null && r[j] !== '') obj[h] = r[j]; });
  if (Object.keys(obj).length) console.log('  ' + (i + 2) + ':', JSON.stringify(obj));
});
