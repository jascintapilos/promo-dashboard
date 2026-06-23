#!/usr/bin/env node
/**
 * Records a single pull's status to the 'System Status' tab.
 * Upserts by Instance: deletes existing rows for the same Instance, appends new.
 *
 * Usage:
 *   node bin/record-pull-status.mjs <instance> <label> <status> [detail]
 *
 * Examples:
 *   node bin/record-pull-status.mjs bo-ytd "BO Promos" OK "2249 rows"
 *   node bin/record-pull-status.mjs smartico "Smartico CRM" FAILED "token expired"
 */
import { getSheetsClient } from '../src/sheets-client.js';
import { getOpsSheetId } from '../src/ops-sheet.js';

const [instance, label, status, detail = ''] = process.argv.slice(2);
if (!instance || !label || !status) {
  console.error('Usage: record-pull-status.mjs <instance> <label> <status> [detail]');
  process.exit(2);
}

const OPS_ID = getOpsSheetId();
const TAB = 'System Status';
const NOW = new Date().toISOString();

try {
  const { sheets } = await getSheetsClient();

  // Ensure tab exists
  const meta = await sheets.spreadsheets.get({ spreadsheetId: OPS_ID, fields: 'sheets.properties.title,sheets.properties.sheetId' });
  const tabMeta = meta.data.sheets.find(s => s.properties.title === TAB);
  if (!tabMeta) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: OPS_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: OPS_ID,
      range: `'${TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [['Timestamp', 'Instance', 'Label', 'Status', 'Valid Until', 'Detail']] },
    });
  }

  // Read all existing rows, drop any with same Instance, append new
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:F` });
  const all = existing.data.values || [];
  const header = all[0] || ['Timestamp', 'Instance', 'Label', 'Status', 'Valid Until', 'Detail'];
  const kept = all.slice(1).filter(r => r && r.some(c => c) && r[1] !== instance);
  const newRow = [NOW, instance, label, status, '', detail];
  const rows = [header, ...kept, newRow];

  await sheets.spreadsheets.values.clear({ spreadsheetId: OPS_ID, range: `'${TAB}'!A:F` });
  await sheets.spreadsheets.values.update({
    spreadsheetId: OPS_ID,
    range: `'${TAB}'!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✓ Status recorded: ${instance} = ${status}${detail ? ' — ' + detail : ''}`);
} catch (e) {
  console.error(`⚠  Could not record status for ${instance}: ${e.message}`);
  process.exit(1);
}
