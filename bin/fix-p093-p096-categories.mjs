#!/usr/bin/env node
// Re-PUT P093-P096 saves so Slots/Fishing category constraint applies.
// Bug: parser required word "only" to extract categories — operator wrote
// "Game Categories : Slots/Fishing reload" (no "only"), so categories_only
// stayed null and the mapper defaulted to all 7 wallet categories. Parser
// fixed in src/ingest.js (rule J'). This script re-runs the mapper against
// the now-correct fixtures and PUT-updates the live promotions.
//
// Targets: QP2C (ibc22) + QPRO4 only — P091/P092 are "Game : All games"
// (no restriction) and already correct.
//
// Usage: node bin/fix-p093-p096-categories.mjs [--commit]

import fs from 'node:fs';
import { authedFetch, updatePromotion, readDialogForPreservation } from '../src/api-client.js';
import { buildApiPlan as buildQproPlan } from '../src/api-mapper-qpro.js';
import { buildApiPlan as buildQp2Plan } from '../src/api-mapper-qp2.js';
import { getSite } from '../src/sites.js';

const commit = process.argv.includes('--commit');

const targets = [
  { handle: 'P093-r94', qp2c: 1195, qpro4: 365 },
  { handle: 'P094-r95', qp2c: 1196, qpro4: 366 },
  { handle: 'P095-r96', qp2c: 1197, qpro4: 367 },
  { handle: 'P096-r97', qp2c: 1198, qpro4: 368 },
];

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`FIX P093-P096 categories — ${commit ? 'LIVE' : 'DRY-RUN'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const t of targets) {
  const resolved = JSON.parse(fs.readFileSync(`captures/requests/${t.handle}.json`, 'utf8'));
  console.log(`\n${t.handle}  categories_only=${JSON.stringify(resolved.instructions?.categories_only)}`);

  // ── QPRO4 ─────────────────────────────────────────────────────────────
  {
    const site = getSite('qpro4');
    const before = (await authedFetch(site, `/api/bo/promotion/${t.qpro4}`)).data.rows;
    const beforeCats = (before.promotion_category || []).map((c) => c.category_id);
    const beforeGps = (before.game_provider_ids || before.target?.[0]?.game_provider_ids || []).length;
    console.log(`  QPRO4 id=${t.qpro4} before: cats=${JSON.stringify(beforeCats)} gp_count=${beforeGps}`);
    if (commit) {
      const plan = await buildQproPlan(resolved, { brand: 'QPRO4', site });
      // Preserve existing dialog popup link — buildUpdate(..., null) would
      // wipe dialog_popup_list. Read from listing endpoint (detail endpoint
      // hides this field).
      const dialog = await readDialogForPreservation(site, resolved.promo_code);
      const putBody = plan.buildUpdate(t.qpro4, before.message_template_id || 0, dialog);
      await updatePromotion(site, t.qpro4, putBody);
      const after = (await authedFetch(site, `/api/bo/promotion/${t.qpro4}`)).data.rows;
      const afterCats = (after.promotion_category || []).map((c) => c.category_id);
      const afterGps = (after.game_provider_ids || after.target?.[0]?.game_provider_ids || []).length;
      console.log(`  QPRO4 id=${t.qpro4} after:  cats=${JSON.stringify(afterCats)} gp_count=${afterGps} dialog=${dialog?.id || 'none'}`);
    }
  }

  // ── QP2C ──────────────────────────────────────────────────────────────
  {
    const site = getSite('ibc22');
    const before = (await authedFetch(site, `/api/bo/promotion/${t.qp2c}`)).data.rows;
    const beforeGpCodes = (before.target?.[0]?.game_provider_codes || before.game_provider_codes || []).length;
    console.log(`  QP2C  id=${t.qp2c} before: target_gp_codes=${beforeGpCodes}`);
    if (commit) {
      const plan = await buildQp2Plan(resolved, { brand: 'QP2C', site, merchantIds: [3] });
      // Preserve existing dialog popup link (detail endpoint hides this).
      const dialog = await readDialogForPreservation(site, resolved.promo_code);
      const putBody = plan.buildUpdate(t.qp2c, before.message_template_id || 0, dialog);
      // Preserve merchant_ids (QP2C merchant_id = 3)
      putBody.merchant_ids = { '0': 3 };
      await updatePromotion(site, t.qp2c, putBody);
      const after = (await authedFetch(site, `/api/bo/promotion/${t.qp2c}`)).data.rows;
      const afterGpCodes = (after.target?.[0]?.game_provider_codes || after.game_provider_codes || []).length;
      console.log(`  QP2C  id=${t.qp2c} after:  target_gp_codes=${afterGpCodes}`);
    }
  }
}

console.log('\nDone.');
