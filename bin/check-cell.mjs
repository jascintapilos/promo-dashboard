#!/usr/bin/env node
// Inspect raw cell data including formatting for K29 (banner deadline)
import { getGoogleAuth, loadGoogleapis } from '../src/google-auth.js';

const SHEET = '16iI85GrAqldbBcGhpvAwJT3_3JJDqLemLaGhjPXMlQk';
const { client } = await getGoogleAuth();
const { google } = await loadGoogleapis();
const sheets = google.sheets({ version: 'v4', auth: client });

// Get full cell metadata for K29 — the deadline column of first banner row
const r = await sheets.spreadsheets.get({
  spreadsheetId: SHEET,
  ranges: ["'Task_Master'!K29:K47"],
  includeGridData: true,
});
const cells = r.data.sheets[0].data[0].rowData || [];
cells.forEach((row, i) => {
  const c = row.values?.[0] || {};
  console.log(`R${i+29}: ` +
    `formatted="${c.formattedValue}" | ` +
    `string="${c.userEnteredValue?.stringValue ?? ''}" | ` +
    `number=${c.userEnteredValue?.numberValue ?? ''} | ` +
    `type=${c.effectiveFormat?.numberFormat?.type || 'none'} | ` +
    `pattern=${c.effectiveFormat?.numberFormat?.pattern || 'none'}`);
});
