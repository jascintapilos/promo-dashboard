// API client for the Banner Schedule ID Google Sheet.
//
// Reuses the shared OAuth auth from src/google-auth.js (same credentials,
// different spreadsheet ID).  All reads/writes target Sheet1 of:
//   https://docs.google.com/spreadsheets/d/1YqxgQ0x1KtDgdJd9I7E6dc2Lf24yPKtBKYNrdN4griQ
//
// Public API:
//   readAllEntries()               → BannerEntry[]
//   campaignExists(title)          → boolean
//   findNextSlots(count)           → Slot[]  (pre-populated OR auto-created IDs)
//   addBannerEntries(entry)        → SavedSlot[]
//
// Column layout (confirmed from sheet UI):
//   A  Banner ID          D  Status              H  Platform / Placement
//   B  Campaign Title     E  Requestor            I  Start Date
//   C  (hidden column)    F  Type of Promotion    J  End Date
//                         G  Backoffice / Brand   K  Banner Link
//                                                 L  T&C Link
//                                                 M  Ready Date
//                                                 N  Remarks

import { getSheetsClient } from './sheets-client.js';

export const BANNER_SCHEDULE_ID = '1YqxgQ0x1KtDgdJd9I7E6dc2Lf24yPKtBKYNrdN4griQ';
export const BANNER_TAB         = 'Sheet1';

const DATA_START_ROW = 2;   // Row 1 is the header
const MAX_SCAN_ROWS  = 500; // Safety cap for reads

// Fixed column letters (C is hidden in the UI but exists in the sheet)
const COL = {
  banner_id:      'A',
  campaign_title: 'B',
  status:         'D',
  requestor:      'E',
  type:           'F',
  brand:          'G',
  platform:       'H',
  start_date:     'I',
  end_date:       'J',
  banner_link:    'K',
  tnc_link:       'L',
  ready_date:     'M',
  remarks:        'N',
};

// ── Reads ────────────────────────────────────────────────────────────────────

// Read all entries that have a Banner ID (skips completely empty rows).
// Returns rows in sheet order; empty-title rows (pre-allocated slots) are
// included so callers can detect capacity.
export async function readAllEntries() {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BANNER_SCHEDULE_ID,
    range: `${BANNER_TAB}!A${DATA_START_ROW}:N${DATA_START_ROW + MAX_SCAN_ROWS - 1}`,
    valueRenderOption:    'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const rows = res.data.values || [];
  return rows
    .map((row, i) => ({
      row:             DATA_START_ROW + i,
      banner_id:       (row[0]  ?? '').toString().trim(),
      campaign_title:  (row[1]  ?? '').toString().trim(),
      status:          (row[3]  ?? '').toString().trim(),
      requestor:       (row[4]  ?? '').toString().trim(),
      type:            (row[5]  ?? '').toString().trim(),
      brand:           (row[6]  ?? '').toString().trim(),
      platform:        (row[7]  ?? '').toString().trim(),
      start_date:      (row[8]  ?? '').toString().trim(),
      end_date:       (row[9]  ?? '').toString().trim(),
      banner_link:    (row[10] ?? '').toString().trim(),
      tnc_link:       (row[11] ?? '').toString().trim(),
      ready_date:     (row[12] ?? '').toString().trim(),
      remarks:        (row[13] ?? '').toString().trim(),
    }))
    .filter(e => e.banner_id !== '');
}

// Returns true if any row already has this campaign title (case-insensitive).
export async function campaignExists(title) {
  const entries = await readAllEntries();
  const normalize = s => s.toLowerCase().trim().replace(/—|–/g, '-');
  const needle = normalize(title);
  return entries.some(e => normalize(e.campaign_title) === needle);
}

// ── Slot allocation ──────────────────────────────────────────────────────────

// Returns `count` consecutive available slots.  A slot is either:
//   • A pre-populated row (has Banner ID in col A, no title in col B), or
//   • A new row beyond the last-used row (Banner ID computed sequentially).
//
// Each returned object: { row: number, banner_id: string }
export async function findNextSlots(count = 2) {
  const { sheets } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: BANNER_SCHEDULE_ID,
    range: `${BANNER_TAB}!A${DATA_START_ROW}:B${DATA_START_ROW + MAX_SCAN_ROWS - 1}`,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const rows = res.data.values || [];

  const slots = [];

  // Pass 1 — pre-populated rows with no title yet
  for (let i = 0; i < rows.length && slots.length < count; i++) {
    const id    = (rows[i]?.[0] ?? '').toString().trim();
    const title = (rows[i]?.[1] ?? '').toString().trim();
    if (/^B\d+$/i.test(id) && !title) {
      slots.push({ row: DATA_START_ROW + i, banner_id: id });
    }
  }

  // Pass 2 — append beyond last row that has any Banner ID
  if (slots.length < count) {
    const allIds  = rows.map(r => (r?.[0] ?? '').toString().trim()).filter(id => /^B\d+$/i.test(id));
    const maxNum  = allIds.reduce((m, id) => Math.max(m, parseInt(id.slice(1), 10)), 0);
    const lastIdx = rows.reduce((last, r, i) => ((r?.[0] ?? '').trim() ? i : last), -1);
    let nextRow = DATA_START_ROW + lastIdx + 1;
    let nextNum = maxNum + 1;

    while (slots.length < count) {
      slots.push({
        row:       nextRow,
        banner_id: `B${String(nextNum).padStart(2, '0')}`,
      });
      nextRow++;
      nextNum++;
    }
  }

  return slots;
}

// ── Writes ───────────────────────────────────────────────────────────────────

// Add one entry per brand to the next available slots.
//
// entry shape:
//   {
//     campaign_title: string,
//     start_date:     string,   // e.g. "6-Jul-2026"
//     end_date:       string,   // e.g. "27-Sep-2026"
//     requestor?:     string,   // default "Gab"
//     type?:          string,   // default "Vendor"
//     platform?:      string,   // default "Homepage & Promotion"
//     brands?:        string[], // default ["UG01", "UG02"]
//     banner_link?:   string,
//     tnc_link?:      string,
//     remarks?:       string,
//   }
//
// Returns the slots that were written: [{ row, banner_id, brand, campaign_title }]
export async function addBannerEntries(entry, { dryRun = false } = {}) {
  const {
    campaign_title,
    start_date,
    end_date,
    requestor   = 'Gab',
    type        = 'Vendor',
    platform    = 'Homepage & Promotion',
    brands      = ['UG01', 'UG02'],
    banner_link = '',
    tnc_link    = '',
    remarks     = '',
  } = entry;

  if (!campaign_title) throw new Error('campaign_title is required');
  if (!start_date)     throw new Error('start_date is required');
  if (!end_date)       throw new Error('end_date is required');

  const slots = await findNextSlots(brands.length);

  if (dryRun) {
    return slots.map((s, i) => ({ ...s, brand: brands[i], campaign_title, dryRun: true }));
  }

  const { sheets } = await getSheetsClient();
  const data = [];

  for (let i = 0; i < brands.length; i++) {
    const { row, banner_id } = slots[i];

    const cells = {
      [COL.banner_id]:      banner_id,
      [COL.campaign_title]: campaign_title,
      [COL.status]:         'Requesting',
      [COL.requestor]:      requestor,
      [COL.type]:           type,
      [COL.brand]:          brands[i],
      [COL.platform]:       platform,
      [COL.start_date]:     start_date,
      [COL.end_date]:       end_date,
      ...(banner_link && { [COL.banner_link]: banner_link }),
      ...(tnc_link    && { [COL.tnc_link]:    tnc_link    }),
      ...(remarks     && { [COL.remarks]:     remarks     }),
    };

    for (const [col, value] of Object.entries(cells)) {
      data.push({
        range:  `${BANNER_TAB}!${col}${row}`,
        values: [[value]],
      });
    }
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: BANNER_SCHEDULE_ID,
    requestBody: { valueInputOption: 'USER_ENTERED', data },
  });

  return slots.map((s, i) => ({ ...s, brand: brands[i], campaign_title }));
}
