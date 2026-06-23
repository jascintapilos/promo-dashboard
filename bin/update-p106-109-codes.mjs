#!/usr/bin/env node
// Update P106-P109 promo_code column with the multi-line "all 4 codes"
// format matching the operator's template:
//
//   WS1
//   Code 1: FT_..._D1
//   Code 2: FT_..._D2
//   Code 3: FT_..._D3
//
//   QP2A
//   Code: FT_...
//
// One-shot helper, not part of the regular canary write-back.

import { getSheetsClient, resolveCurrentMonthTab, readHeader,
         detectColumnMapFromHeader, writeFields } from '../src/sheets-client.js';
import { loadAllRequests } from '../src/planner.js';

const handles = ['P106-r107', 'P107-r108', 'P108-r109', 'P109-r110'];
const c = await getSheetsClient();
const tab = await resolveCurrentMonthTab(c);
const header = await readHeader(c, tab);
const colMap = detectColumnMapFromHeader(header);
const { byHandle } = await loadAllRequests();

for (const h of handles) {
  const rec = byHandle.get(h);
  if (!rec) { console.log(`skip ${h} — no fixture`); continue; }
  const base = rec.promo_code;
  if (!base) { console.log(`skip ${h} — no promo_code`); continue; }
  // Construct multi-line block. WS1 codes have FT_..._D1/D2/D3 suffix,
  // QP2A code is the bare base.
  const multi = [
    'WS1',
    `Code 1: ${base}_D1`,
    `Code 2: ${base}_D2`,
    `Code 3: ${base}_D3`,
    '',
    'QP2A',
    `Code: ${base}`,
  ].join('\n');
  const res = await writeFields(c, tab, rec.source_line, { promo_code: multi }, colMap);
  console.log(`✓ ${h} (row ${rec.source_line}): ${res.totalUpdatedCells ?? 0} cell(s) updated`);
}
