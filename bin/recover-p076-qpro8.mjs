#!/usr/bin/env node
// One-shot recovery: P076 QPRO8 partial state.
// Promo + MT were already created (promo_id=612, mt_id=732).
// This script creates the missing popup, per-locale names, and does the
// final PUT to link everything. Idempotent if run again (popup creation
// will fail gracefully; just re-link with the existing popup id).
//
//   node bin/recover-p076-qpro8.mjs           -- dry run
//   node bin/recover-p076-qpro8.mjs --commit  -- live

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveDuplicates } from '../src/planner.js';
import { loadBoCodeIndex, fetchBoCodeAsRecord } from '../src/bo-cache.js';
import { getSite } from '../src/sites.js';
import { createDialogPopup, addPromotionName, updatePromotion } from '../src/api-client.js';
import { buildApiPlan } from '../src/api-mapper-qpro.js';

const COMMIT = process.argv.includes('--commit');
const PROMO_ID = 612;
const MT_ID    = 732;

console.log(`\n=== P076 QPRO8 Recovery (${COMMIT ? 'LIVE' : 'DRY RUN'}) ===`);
console.log(`  promo_id=${PROMO_ID}  mt_id=${MT_ID}\n`);

const fixturePath = path.resolve('captures/requests/P076-r77.json');
const record = JSON.parse(readFileSync(fixturePath, 'utf8'));
if (!record) throw new Error(`fixture not found at ${fixturePath}`);

const bo = await loadBoCodeIndex('qpro8');
// byCode not needed for non-duplicate records; pass empty map
const resolved = await resolveDuplicates(record, {}, { boIndex: bo.byCode, boFetcher: fetchBoCodeAsRecord });
const site = getSite('qpro8');

console.log(`code:  ${resolved.promo_code}`);
console.log(`name:  ${resolved.promotion_name_en} / ${resolved.promotion_name_zh_id}`);

const plan = await buildApiPlan(resolved, { brand: 'QPRO8', site });

console.log('\nPopup body:');
console.log(JSON.stringify(plan.dialogPopup, null, 2));

if (!COMMIT) {
  const names = plan.buildNames(PROMO_ID);
  console.log(`\nPromotion names (${names.length} locales):`);
  names.forEach(n => console.log(`  locale ${n.settings_locale_id}: ${n.name}`));
  const putBody = plan.buildUpdate(PROMO_ID, MT_ID, null);
  console.log(`\nPUT /api/bo/promotion/${PROMO_ID} (preview, no popup yet):`);
  console.log(JSON.stringify(putBody, null, 2).slice(0, 400));
  console.log('\nDRY RUN done. Re-run with --commit to apply.');
  process.exit(0);
}

// Step 3: Create popup
let dialogPopup = null;
try {
  const r3 = await createDialogPopup(site, plan.dialogPopup);
  const rows = r3?.data?.rows || r3?.data;
  if (rows?.id && rows?.code) {
    dialogPopup = { id: rows.id, code: rows.code, start_date: rows.start_date || plan.dialogPopup.start_date, label: resolved.promotion_name_en };
    console.log(`✓ popup created: id=${dialogPopup.id} code=${dialogPopup.code}`);
  } else {
    console.log('⚠ popup POST returned unexpected shape:', JSON.stringify(r3).slice(0, 200));
  }
} catch (e) {
  console.error('✗ popup POST failed:', e.message);
}

// Step 4: Per-locale names
for (const name of plan.buildNames(PROMO_ID)) {
  try {
    await addPromotionName(site, name);
    console.log(`✓ name locale=${name.settings_locale_id}: "${name.name}"`);
  } catch (e) {
    console.error(`✗ name locale=${name.settings_locale_id} failed: ${e.message}`);
  }
}

// Step 5: PUT to link
const putBody = plan.buildUpdate(PROMO_ID, MT_ID, dialogPopup);
try {
  await updatePromotion(site, PROMO_ID, putBody);
  console.log(`✓ PUT /api/bo/promotion/${PROMO_ID}: mt=${MT_ID} popup=${dialogPopup?.id ?? 'null'}`);
} catch (e) {
  console.error('✗ PUT failed:', e.message);
}

console.log('\nRecovery complete.');
