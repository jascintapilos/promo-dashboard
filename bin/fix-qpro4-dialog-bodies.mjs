#!/usr/bin/env node
// Patch QPRO4 dialog popup bodies for P001-P008 to use the correct short-body
// template (renderDialogBody) instead of the full inbox body (renderBody).

import { readFile } from 'node:fs/promises';
import { authedFetch } from '../src/api-client.js';
import { getSite } from '../src/sites.js';
import { renderDialogBody, localeDocKey } from '../src/message-template-renderer.js';

const qpro4 = getSite('qpro4');

const TARGETS = [
  { handle: 'P001', fixture: 'P001-r2', dialogId: 312 },
  { handle: 'P002', fixture: 'P002-r3', dialogId: 313 },
  { handle: 'P003', fixture: 'P003-r4', dialogId: 314 },
  { handle: 'P004', fixture: 'P004-r5', dialogId: 315 },
  { handle: 'P005', fixture: 'P005-r6', dialogId: 316 },
  { handle: 'P006', fixture: 'P006-r7', dialogId: 317 },
  { handle: 'P007', fixture: 'P007-r8', dialogId: 318 },
  { handle: 'P008', fixture: 'P008-r9', dialogId: 319 },
];

function toBoDate(iso) {
  if (!iso) return null;
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
}

for (const t of TARGETS) {
  const resolved = JSON.parse(await readFile(`captures/requests/${t.fixture}.json`, 'utf8'));

  // Fetch popup row from listing
  let row = null;
  let page = 1;
  while (!row) {
    const res = await authedFetch(qpro4, `/api/bo/popups?page=${page}&perPage=50`);
    const rows = res?.data?.rows || [];
    row = rows.find(r => r.id === t.dialogId);
    if (rows.length < 50 || row) break;
    page++;
  }
  if (!row) { console.log(`${t.handle} dialog ${t.dialogId} NOT FOUND — skip`); continue; }

  // Re-render each locale's content with the short dialog body
  const contents = {};
  for (const [idx, content] of Object.entries(row.contents || {})) {
    // Derive docKey from locale_name
    const lname = content.locale_name || '';
    const dk = /中文|ZH/i.test(lname) ? 'ZH' : /indonesia|bahasa/i.test(lname) ? 'ID' : 'EN';

    // Only EN + ZH in dialog popups
    if (dk === 'ID') { contents[idx] = content; continue; }

    // Map locale_id back to a locale string renderDialogBody understands
    const localeMap = { 1: 'MY_EN', 3: 'MY_ZH', 6: 'SG_EN', 7: 'SG_ZH', 4: 'ID_ID' };
    const locale = localeMap[content.locale_id] || 'MY_EN';

    const rendered = await renderDialogBody({ bonusType: resolved.bonus_type, locale, resolved });
    if (rendered.skipped) { contents[idx] = content; continue; }

    contents[idx] = { ...content, content: rendered.html };
    console.log(`  ${t.handle} [${content.locale_name}] → re-rendered (${rendered.html.length} chars)`);
  }

  const putBody = {
    ...row,
    start_date: toBoDate(row.start_date),
    end_date:   toBoDate(row.end_date),
    contents,
  };

  const putRes = await authedFetch(qpro4, `/api/bo/popups/${t.dialogId}`, { method: 'PUT', body: putBody });
  const ok = putRes?.success === true || putRes?.data != null;
  console.log(`${t.handle} dialog ${t.dialogId} → ${ok ? '✓' : '✗ ' + JSON.stringify(putRes).slice(0, 120)}`);
}

console.log('\nDone.');
