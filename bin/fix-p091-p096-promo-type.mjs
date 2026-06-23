#!/usr/bin/env node
// Re-PUT P091-P096 QP2C saves to fix promo_type (was 1 = Manual, should be
// 2 = Deposit Bonus). The mapper's promoTypeInt() already returns 2 for
// "deposit" bonus_type; the live records have promo_type=1 from an earlier
// state of the mapper. Re-running the mapper-driven PUT corrects them.
//
// Usage: node bin/fix-p091-p096-promo-type.mjs [--commit]

import fs from 'node:fs';
import { authedFetch, updatePromotion, readDialogForPreservation } from '../src/api-client.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');
const site = getSite('ibc22');

const targets = [
  { handle: 'P091-r92', id: 1193 },
  { handle: 'P092-r93', id: 1194 },
  { handle: 'P093-r94', id: 1195 },
  { handle: 'P094-r95', id: 1196 },
  { handle: 'P095-r96', id: 1197 },
  { handle: 'P096-r97', id: 1198 },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P091-P096 QP2C promo_type — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const t of targets) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${t.handle}.json`, 'utf8'));
  const before = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
  console.log(`\n${t.handle} id=${t.id}  before: promo_type=${before.promo_type} promo_sub_type=${before.promo_sub_type}`);
  if (!commit) {
    console.log(`  [dry-run] would re-PUT via mapper (expected promo_type=2)`);
    continue;
  }
  const plan = await buildQp2Plan(resolved, { brand: 'QP2C', site, merchantIds: [3] });
  // Preserve existing dialog popup link — buildUpdate(..., null) would wipe
  // dialog_popup_list. readDialogForPreservation uses the listing endpoint
  // (detail endpoint hides this field).
  const dialog = await readDialogForPreservation(site, resolved.promo_code);
  const putBody = plan.buildUpdate(t.id, before.message_template_id || 0, dialog);
  putBody.merchant_ids = { '0': 3 };
  await updatePromotion(site, t.id, putBody);
  const after = (await authedFetch(site, `/api/bo/promotion/${t.id}`)).data.rows;
  console.log(`  after:  promo_type=${after.promo_type} promo_sub_type=${after.promo_sub_type}`);
}

console.log('\nDone.');
