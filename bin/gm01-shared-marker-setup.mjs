#!/usr/bin/env node
// One-time bootstrap for the GM01 shared success-marker Google Sheet.
//
// Run this ONCE on ANY VDI to create a new spreadsheet with the header row,
// then share it read/write with the other operator's Google account, and copy
// the resulting spreadsheetId + choose a role into gm01-shared-marker.local.json
// on the SECOND VDI. Or, if a shared sheet already exists, skip the creation
// step and just write the local config manually.
//
// Usage:
//   node bin/gm01-shared-marker-setup.mjs --role=primary
//   node bin/gm01-shared-marker-setup.mjs --role=backup --spreadsheet-id=1abc...
//
// --spreadsheet-id  reuse an existing sheet (backup VDI does this)
// --role            primary | backup — recorded in the local config

import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getSheetsClient } from '../src/sheets-client.js';

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(ROOT, 'gm01-shared-marker.local.json');
const TAB_NAME    = 'GM01-Daily-Log';

const args = {};
for (const a of process.argv.slice(2)) {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (m) args[m[1]] = m[2] ?? true;
}

const role = args.role;
if (!role || (role !== 'primary' && role !== 'backup')) {
  console.error('✗ Usage: node bin/gm01-shared-marker-setup.mjs --role=primary|backup [--spreadsheet-id=...]');
  process.exit(1);
}

const { sheets } = await getSheetsClient();

let spreadsheetId = args['spreadsheet-id'];

if (!spreadsheetId) {
  console.log('Creating new spreadsheet: "GM01 Daily Submit Log"...');
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: 'GM01 Daily Submit Log' },
      sheets: [{ properties: { title: TAB_NAME } }],
    },
  });
  spreadsheetId = created.data.spreadsheetId;
  console.log(`✓ Created: ${spreadsheetId}`);
  console.log(`  URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB_NAME}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: {
      values: [['date', 'timestamp', 'machine', 'role', 'status', 'combos_ok', 'combos_err']],
    },
  });
  console.log('✓ Header row written.');
  console.log('');
  console.log('IMPORTANT — share this sheet with the OTHER VDI\'s Google account (Editor access):');
  console.log(`  https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
  console.log('');
  console.log('Then on the OTHER VDI, run:');
  console.log(`  node bin/gm01-shared-marker-setup.mjs --role=<primary|backup> --spreadsheet-id=${spreadsheetId}`);
}

const config = { spreadsheetId, tabName: TAB_NAME, role };

if (existsSync(CONFIG_FILE)) {
  console.log(`⚠ ${CONFIG_FILE} already exists — overwriting.`);
}
writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
console.log(`✓ Wrote local config: ${CONFIG_FILE}`);
console.log(`  { spreadsheetId, tabName: "${TAB_NAME}", role: "${role}" }`);
