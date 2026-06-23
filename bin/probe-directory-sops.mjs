#!/usr/bin/env node
/**
 * Probe Directory → SOP + Knowledge Library tabs so the Knowledge Base
 * module in the dashboard knows what to render and which links to wire.
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

// Pull hyperlinks too so the dashboard can deep-link
async function sheetsApiFull(tabName, range) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${DIR_SS_ID}?ranges=${encodeURIComponent(tabName + '!' + range)}&fields=sheets.data.rowData.values(formattedValue,hyperlink,textFormatRuns(format.link.uri,startIndex),userEnteredFormat.textFormat.link.uri,effectiveValue,userEnteredValue,chipRuns)`,
    { headers: { Authorization: 'Bearer ' + tok } },
  );
  if (!r.ok) throw new Error(`${tabName}: ${r.status} ${await r.text()}`);
  return r.json();
}

for (const tabName of ['SOP', 'Knowledge Library']) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('TAB:', tabName);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  const data = await sheetsApi(`/values/${encodeURIComponent(tabName)}!A1:Z200`);
  const rows = data.values || [];
  if (!rows.length) { console.log('(empty)'); continue; }

  const headers = rows[0];
  console.log('Headers:', headers);
  console.log('\nRows:');
  rows.slice(1).forEach((r, i) => {
    const obj = {};
    headers.forEach((h, j) => { if (r[j] != null && r[j] !== '') obj[h] = r[j]; });
    if (Object.keys(obj).length) console.log('  ' + (i + 2) + ':', JSON.stringify(obj));
  });

  // Pull hyperlinks too
  try {
    const full = await sheetsApiFull(tabName, 'A1:Z200');
    const sheet = full.sheets?.[0];
    const rowData = sheet?.data?.[0]?.rowData || [];
    console.log('\nHyperlinks:');
    rowData.forEach((row, ri) => {
      (row.values || []).forEach((cell, ci) => {
        const link =
          cell.hyperlink ||
          cell.userEnteredFormat?.textFormat?.link?.uri ||
          cell.userEnteredValue?.formulaValue?.match(/=HYPERLINK\("([^"]+)"/i)?.[1] ||
          (cell.textFormatRuns || []).map(t => t.format?.link?.uri).filter(Boolean)[0] ||
          (cell.chipRuns || []).map(c => c.chip?.richLinkProperties?.uri || c.chip?.personProperties?.email).filter(Boolean)[0];
        if (link) {
          console.log(`  [${ri + 1},${String.fromCharCode(65 + ci)}] "${cell.formattedValue || ''}" → ${link}`);
        }
      });
    });
  } catch (e) {
    console.log('  (hyperlink probe failed:', e.message + ')');
  }
}
