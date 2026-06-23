#!/usr/bin/env node
// Quick reader for the Directory sheet — dumps a given tab.
// Usage: node bin/read-directory.mjs "BO & Brands"

import { getSheetsClient, listTabs } from '../src/sheets-client.js';

const DIRECTORY_ID = '1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68';
const tabArg = process.argv[2];

const { sheets } = await getSheetsClient();

if (!tabArg || tabArg === '--list') {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: DIRECTORY_ID });
  console.log('Tabs:');
  for (const s of meta.data.sheets) console.log('  -', s.properties.title);
  process.exit(0);
}

const res = await sheets.spreadsheets.values.get({
  spreadsheetId: DIRECTORY_ID,
  range: `'${tabArg}'`,
});
const rows = res.data.values || [];
for (const row of rows) console.log(row.join(' | '));
