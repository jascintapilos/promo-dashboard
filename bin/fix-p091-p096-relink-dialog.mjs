#!/usr/bin/env node
// Re-link dialog popups for P091-P096 on QP2C + QPRO4. The earlier fix
// scripts re-PUT the promotion records but the dialog_popup_list
// preservation block was reading from snapshots where the field had
// already been dropped — so relink never happened. This script reads the
// original canary run logs (popup IDs) and rebuilds the PUT through the
// mapper with the popup link forced in.
//
// Usage: node bin/fix-p091-p096-relink-dialog.mjs [--commit]

import fs from 'node:fs';
import { authedFetch, updatePromotion } from '../src/api-client.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const targets = [
  { handle: 'P091-r92', qp2c: 1193, qp2Popup: 1122, qpro4: 363, qproPopup: 166 },
  { handle: 'P092-r93', qp2c: 1194, qp2Popup: 1123, qpro4: 364, qproPopup: 167 },
  { handle: 'P093-r94', qp2c: 1195, qp2Popup: 1124, qpro4: 365, qproPopup: 168 },
  { handle: 'P094-r95', qp2c: 1196, qp2Popup: 1125, qpro4: 366, qproPopup: 169 },
  { handle: 'P095-r96', qp2c: 1197, qp2Popup: 1126, qpro4: 367, qproPopup: 170 },
  { handle: 'P096-r97', qp2c: 1198, qp2Popup: 1127, qpro4: 368, qproPopup: 171 },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`RELINK P091-P096 dialog popups — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Preload QP2 popup catalog once.
const ibc22 = getSite('ibc22');
const popupListResp = await authedFetch(ibc22, '/api/bo/popups?perPage=500&page=1&date_type=start_date&sort_by=id&sort_order=desc');
const allPopups = popupListResp.data?.rows || [];

const qpro4 = getSite('qpro4');

for (const t of targets) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${t.handle}.json`, 'utf8'));
  console.log(`\n${t.handle}`);

  // ── QPRO4 ──
  {
    const before = (await authedFetch(qpro4, `/api/bo/promotion/${t.qpro4}`)).data.rows;
    const existing = (before.dialog_popup_list || []).map((d) => d.popup_id || d.id);
    console.log(`  QPRO4 id=${t.qpro4} before: dialog=${existing.length ? existing.join(',') : 'NONE'} (want popup ${t.qproPopup})`);
    if (commit && !existing.includes(t.qproPopup)) {
      const plan = await buildQproPlan(resolved, { brand: 'QPRO4', site: qpro4 });
      // QPRO uses 6-field dialog_popup_list shape: { popup_id }
      const dialog = { id: t.qproPopup };
      const putBody = plan.buildUpdate(t.qpro4, before.message_template_id || 0, dialog);
      await updatePromotion(qpro4, t.qpro4, putBody);
      const after = (await authedFetch(qpro4, `/api/bo/promotion/${t.qpro4}`)).data.rows;
      const afterIds = (after.dialog_popup_list || []).map((d) => d.popup_id || d.id);
      console.log(`  QPRO4 id=${t.qpro4} after:  dialog=${afterIds.length ? afterIds.join(',') : 'NONE'}`);
    }
  }

  // ── QP2C ──
  {
    const before = (await authedFetch(ibc22, `/api/bo/promotion/${t.qp2c}`)).data.rows;
    const existing = (before.dialog_popup_list || []).map((d) => d.popup_id || d.id);
    console.log(`  QP2C  id=${t.qp2c} before: dialog=${existing.length ? existing.join(',') : 'NONE'} (want popup ${t.qp2Popup})`);
    if (commit && !existing.includes(t.qp2Popup)) {
      const popupRow = allPopups.find((p) => p.id === t.qp2Popup);
      if (!popupRow) { console.log(`    popup ${t.qp2Popup} not in listing — skipping`); continue; }
      const dialog = { id: t.qp2Popup, fullRow: popupRow };
      const plan = await buildQp2Plan(resolved, { brand: 'QP2C', site: ibc22, merchantIds: [3] });
      const putBody = plan.buildUpdate(t.qp2c, before.message_template_id || 0, dialog);
      putBody.merchant_ids = { '0': 3 };
      await updatePromotion(ibc22, t.qp2c, putBody);
      const after = (await authedFetch(ibc22, `/api/bo/promotion/${t.qp2c}`)).data.rows;
      const afterIds = (after.dialog_popup_list || []).map((d) => d.popup_id || d.id);
      console.log(`  QP2C  id=${t.qp2c} after:  dialog=${afterIds.length ? afterIds.join(',') : 'NONE'}`);
    }
  }
}

console.log('\nDone.');
